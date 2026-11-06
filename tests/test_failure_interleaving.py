"""Failure interleaving for restore handover, publication, and recovery threads."""

from __future__ import annotations

import json
import sqlite3
import subprocess
import threading
import time
from pathlib import Path

import pytest

import joehub.db as db
import joehub.handover as handover
from joehub.backup import export_all, restore_all
from joehub.config import load_settings
from joehub.db import _maintenance_connect, connect, maintenance_gate_path
from joehub.errors import JoehubError
from joehub.handover import handover_completed_path, handover_journal_path, original_copy_path
from joehub.principals import operator_token, operator_token_path, token_digest, write_token_file
from joehub.write import RecoveryPool, WriteLayer
from tests.acting import credential

_CLEANUP_BOUNDARIES = (
    "before_unlink_original",
    "before_unlink_staged",
    "before_unlink_previous",
    "before_unlink_gate",
    "before_unlink_journal",
    "before_unlink_completed",
)


def _export_then_diverge(settings):
    credential(settings, "Ledger")
    credential(settings, "Cato")
    layer = WriteLayer(settings, recover=False)
    try:
        layer.write(
            credential=operator_token(settings),
            table="categories",
            operation="insert",
            idempotency_key="keep",
            payload={"name": "Keep", "kind": "expense"},
        )
    finally:
        layer.close()
    export_all(settings)
    layer = WriteLayer(settings, recover=False)
    try:
        layer.write(
            credential=operator_token(settings),
            table="categories",
            operation="insert",
            idempotency_key="extra",
            payload={"name": "Extra", "kind": "income"},
        )
    finally:
        layer.close()
    operator_token_path(settings).unlink()


def _names(path: Path) -> set[str]:
    conn = sqlite3.connect(path)
    try:
        return {row[0] for row in conn.execute("SELECT name FROM categories")}
    finally:
        conn.close()


def _live_digest(path: Path) -> str:
    conn = sqlite3.connect(path)
    try:
        return conn.execute(
            "SELECT token_sha256 FROM principals WHERE name = 'operator'"
        ).fetchone()[0]
    finally:
        conn.close()


def _fixed_staging_absent(settings) -> None:
    directory = operator_token_path(settings).parent
    assert not (directory / "operator.token.staged").exists()
    assert not (directory / "operator.token.previous").exists()


def _assert_restored_pair(settings) -> None:
    conn = connect(settings.db_path)
    try:
        assert {row["name"] for row in conn.execute("SELECT name FROM categories")} == {"Keep"}
        stored = conn.execute(
            "SELECT token_sha256 FROM principals WHERE name = 'operator'"
        ).fetchone()[0]
    finally:
        conn.close()
    assert token_digest(operator_token(settings)) == stored
    assert not original_copy_path(settings.db_path).exists()
    assert not maintenance_gate_path(settings.db_path).exists()
    assert not handover_journal_path(settings.db_path).exists()
    assert not handover_completed_path(settings.db_path).exists()
    _fixed_staging_absent(settings)


def _record(path: Path) -> dict:
    if path.is_file():
        return json.loads(path.read_text(encoding="utf-8"))
    raise AssertionError(f"missing handover record {path}")


def test_competing_opener_is_refused_through_the_handover(settings):
    _export_then_diverge(settings)
    paused = threading.Event()
    resume = threading.Event()
    at_lock = threading.Event()
    opened: dict[str, set[str]] = {}
    errors: list[BaseException] = []

    def before_connect(path: Path) -> None:
        if Path(path) != settings.db_path or paused.is_set():
            return
        paused.set()
        if not resume.wait(30):
            raise TimeoutError("opener was not released")

    def before_lock() -> None:
        at_lock.set()

    def opener() -> None:
        try:
            conn = connect(settings.db_path)
            try:
                opened["names"] = {row["name"] for row in conn.execute("SELECT name FROM categories")}
            finally:
                conn.close()
        except BaseException as exc:
            errors.append(exc)

    def run_restore() -> None:
        try:
            restore_all(settings, force=True)
        except BaseException as exc:
            errors.append(exc)

    db._before_connect = before_connect
    handover._before_exclusive_lock = before_lock
    opener_thread = threading.Thread(target=opener)
    restore_thread = threading.Thread(target=run_restore)
    try:
        opener_thread.start()
        assert paused.wait(30)
        assert opener_thread.is_alive()
        restore_thread.start()
        assert at_lock.wait(30)
        time.sleep(0.2)
        assert restore_thread.is_alive()
        assert _names(settings.db_path) == {"Keep", "Extra"}
        assert not operator_token_path(settings).is_file()
        _fixed_staging_absent(settings)
        resume.set()
        opener_thread.join(30)
        restore_thread.join(120)
    finally:
        resume.set()
        db._before_connect = None
        handover._before_exclusive_lock = None
        if opener_thread.is_alive():
            opener_thread.join(5)
        if restore_thread.is_alive():
            restore_thread.join(5)
    assert errors == []
    assert not opener_thread.is_alive()
    assert not restore_thread.is_alive()
    assert opened["names"] == {"Keep", "Extra"}
    _assert_restored_pair(settings)

    layer = WriteLayer(settings, recover=False)
    try:
        layer.write(
            credential=operator_token(settings),
            table="categories",
            operation="insert",
            idempotency_key="extra-again",
            payload={"name": "Extra", "kind": "income"},
        )
    finally:
        layer.close()
    operator_token_path(settings).unlink()

    seen: dict[str, str] = {}
    loser_errors: list[BaseException] = []
    arrived = threading.Event()
    calls = {"n": 0}

    def note_lock() -> None:
        calls["n"] += 1
        if calls["n"] >= 2:
            arrived.set()

    def loser() -> None:
        try:
            restore_all(settings, force=True)
        except BaseException as exc:
            loser_errors.append(exc)

    loser_thread = threading.Thread(target=loser)

    def interrupt() -> None:
        with pytest.raises(JoehubError, match="handover"):
            connect(settings.db_path)
        with pytest.raises(JoehubError, match="handover"):
            _maintenance_connect(settings.db_path)
        with pytest.raises(JoehubError, match="handover"):
            WriteLayer(settings, recover=False)
        original = original_copy_path(settings.db_path)
        assert original.is_file()
        assert _names(original) == {"Keep", "Extra"}
        assert _names(settings.db_path) == {"Keep"}
        assert not operator_token_path(settings).is_file()
        assert _live_digest(settings.db_path) != ""
        journal = json.loads(handover_journal_path(settings.db_path).read_text(encoding="utf-8"))
        staged = Path(journal["staged_token_path"])
        assert staged.name.startswith("operator.token.staged.")
        assert staged.is_file()
        digest = staged.read_text(encoding="utf-8")
        _fixed_staging_absent(settings)
        loser_thread.start()
        assert arrived.wait(60)
        assert loser_thread.is_alive()
        time.sleep(0.3)
        assert loser_thread.is_alive()
        assert staged.read_text(encoding="utf-8") == digest
        assert json.loads(handover_journal_path(settings.db_path).read_text(encoding="utf-8"))["nonce"] == journal["nonce"]
        _fixed_staging_absent(settings)
        seen["during"] = "blocked"

    handover._before_exclusive_lock = note_lock
    try:
        restore_all(settings, force=True, _interrupt=interrupt)
        loser_thread.join(120)
    finally:
        handover._before_exclusive_lock = None
        if loser_thread.is_alive():
            loser_thread.join(5)
    assert seen["during"] == "blocked"
    assert loser_errors == []
    assert not loser_thread.is_alive()
    _assert_restored_pair(settings)


def test_crash_between_database_and_credential_keeps_the_original(settings):
    _export_then_diverge(settings)

    def interrupt() -> None:
        assert original_copy_path(settings.db_path).is_file()
        assert _names(original_copy_path(settings.db_path)) == {"Keep", "Extra"}
        assert _names(settings.db_path) == {"Keep"}
        assert not operator_token_path(settings).is_file()
        raise RuntimeError("interrupted before credential install")

    with pytest.raises(RuntimeError, match="interrupted"):
        restore_all(settings, force=True, _interrupt=interrupt)

    original = original_copy_path(settings.db_path)
    assert original.is_file()
    assert _names(original) == {"Keep", "Extra"}
    journal = json.loads(handover_journal_path(settings.db_path).read_text(encoding="utf-8"))
    assert journal["phase"] == "db_installed"
    assert maintenance_gate_path(settings.db_path).is_file()

    _assert_restored_pair(settings)
    assert not original.exists()

    for boundary in _CLEANUP_BOUNDARIES:
        state = {"hit": False}

        def hook(name: str, boundary: str = boundary, state: dict[str, bool] = state) -> None:
            if name == boundary and not state["hit"]:
                state["hit"] = True
                raise RuntimeError(boundary)

        handover._cleanup_boundary = hook
        try:
            with pytest.raises(RuntimeError, match=boundary):
                restore_all(settings, force=True)
            assert state["hit"] is True
            _assert_cleanup_crash(settings, boundary)
            if boundary == "before_unlink_gate":
                recover_state = {"hit": False}

                def recover_hook(name: str, recover_state: dict[str, bool] = recover_state) -> None:
                    if name == "before_unlink_journal" and not recover_state["hit"]:
                        recover_state["hit"] = True
                        raise RuntimeError("recovery cleanup")

                handover._cleanup_boundary = recover_hook
                with pytest.raises(RuntimeError, match="recovery cleanup"):
                    connect(settings.db_path)
                assert recover_state["hit"] is True
                assert not maintenance_gate_path(settings.db_path).exists()
                assert handover_journal_path(settings.db_path).is_file()
                record = _record(handover_journal_path(settings.db_path))
                assert record["phase"] == "completed"
        finally:
            handover._cleanup_boundary = None
        _assert_restored_pair(settings)


def _assert_cleanup_crash(settings, boundary: str) -> None:
    journal_path = handover_journal_path(settings.db_path)
    completed_path = handover_completed_path(settings.db_path)
    gate_exists = maintenance_gate_path(settings.db_path).is_file()
    if boundary == "before_unlink_completed":
        assert not journal_path.exists()
        assert not gate_exists
        record = _record(completed_path)
    else:
        assert journal_path.is_file()
        record = _record(journal_path)
        assert completed_path.is_file()
    assert record["phase"] == "completed"
    staged = Path(record["staged_token_path"])
    previous = Path(record["previous_token_path"])
    original = Path(record["original_db"])
    if boundary == "before_unlink_original":
        assert original.is_file()
        assert staged.is_file()
        assert previous.is_file()
        assert gate_exists
    elif boundary == "before_unlink_staged":
        assert not original.exists()
        assert staged.is_file()
        assert previous.is_file()
        assert gate_exists
    elif boundary == "before_unlink_previous":
        assert not original.exists()
        assert not staged.exists()
        assert previous.is_file()
        assert gate_exists
    elif boundary == "before_unlink_gate":
        assert not original.exists()
        assert not staged.exists()
        assert not previous.exists()
        assert gate_exists
    elif boundary == "before_unlink_journal":
        assert not gate_exists
        assert journal_path.is_file()
    _fixed_staging_absent(settings)


def test_failed_token_write_is_recovered_without_losing_the_original(settings, monkeypatch):
    _export_then_diverge(settings)
    real = write_token_file
    state = {"failed": False}

    def fail_once(path: Path, credential: str) -> None:
        if path.name == "operator.token" and not state["failed"]:
            state["failed"] = True
            raise OSError("token write failed")
        real(path, credential)

    monkeypatch.setattr("joehub.handover.write_token_file", fail_once)
    with pytest.raises(OSError, match="token write failed"):
        restore_all(settings, force=True)
    assert state["failed"] is True
    assert original_copy_path(settings.db_path).is_file()
    assert _names(original_copy_path(settings.db_path)) == {"Keep", "Extra"}
    assert _names(settings.db_path) == {"Keep"}
    assert not operator_token_path(settings).is_file()
    journal = json.loads(handover_journal_path(settings.db_path).read_text(encoding="utf-8"))
    assert journal["phase"] == "db_installed"
    assert Path(journal["staged_token_path"]).name.startswith("operator.token.staged.")
    _fixed_staging_absent(settings)

    conn = connect(settings.db_path)
    try:
        assert {row["name"] for row in conn.execute("SELECT name FROM categories")} == {"Keep"}
        stored = conn.execute(
            "SELECT token_sha256 FROM principals WHERE name = 'operator'"
        ).fetchone()[0]
    finally:
        conn.close()
    assert token_digest(operator_token(settings)) == stored
    assert not original_copy_path(settings.db_path).exists()


def test_concurrent_exporters_cannot_overwrite_the_journal(settings, tmp_path, monkeypatch):
    credential(settings, "Cato")
    bare = tmp_path / "remote.git"
    subprocess.run(["git", "init", "--bare", "-b", "main", str(bare)], check=True, capture_output=True)
    import joehub.backup as backup

    started = threading.Event()
    release = threading.Event()
    state = {"blocked": False}
    real = backup._write_journal

    def hooked(export_dir, payload):
        real(export_dir, payload)
        if payload.get("phase") == "first_in_progress" and not state["blocked"]:
            state["blocked"] = True
            started.set()
            if not release.wait(15):
                raise TimeoutError("publication lock was not released")

    monkeypatch.setattr(backup, "_write_journal", hooked)
    errors: list[BaseException] = []

    def run() -> None:
        try:
            export_all(settings, remote=str(bare), visibility_check=lambda _remote: "PRIVATE")
        except BaseException as exc:
            errors.append(exc)

    first = threading.Thread(target=run)
    second = threading.Thread(target=run)
    first.start()
    assert started.wait(30)
    journal = json.loads((settings.export_dir / ".publication-journal.json").read_text(encoding="utf-8"))
    second.start()
    time.sleep(0.4)
    while_blocked = json.loads((settings.export_dir / ".publication-journal.json").read_text(encoding="utf-8"))
    assert while_blocked["export_id"] == journal["export_id"]
    assert while_blocked["phase"] == journal["phase"]
    release.set()
    assert second.is_alive()
    first.join(timeout=120)
    second.join(timeout=120)
    assert not first.is_alive()
    assert not second.is_alive()
    assert errors == []
    assert not (settings.export_dir / ".publication-journal.json").exists()


def test_ui_calls_do_not_leak_recovery_workers(monkeypatch):
    monkeypatch.setenv("JOEHUB_RECOVERY_INTERVAL_SECONDS", "60")
    settings = load_settings()
    token = credential(settings, "Ledger")
    from joehub.actions import perform

    for index in range(30):
        result, error = perform(
            credential=token,
            table="categories",
            operation="insert",
            payload={"name": f"UI {index}", "kind": "expense"},
            idempotency_key=f"ui-{index}",
            settings=settings,
        )
        assert error is None
        assert result is not None
        assert RecoveryPool.worker_count() == 0
    alive = [thread for thread in threading.enumerate() if thread.name == "joehub-recovery" and thread.is_alive()]
    assert alive == []
