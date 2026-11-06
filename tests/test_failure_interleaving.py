"""Failure interleaving for restore handover, publication, and recovery threads."""

from __future__ import annotations

import json
import sqlite3
import subprocess
import threading
import time
from pathlib import Path

import pytest

from joehub.backup import export_all, restore_all
from joehub.config import load_settings
from joehub.db import _maintenance_connect, connect, maintenance_gate_path
from joehub.errors import JoehubError
from joehub.handover import handover_journal_path, original_copy_path
from joehub.principals import operator_token, operator_token_path, token_digest, write_token_file
from joehub.write import RecoveryPool, WriteLayer
from tests.acting import credential


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


def test_competing_opener_is_refused_through_the_handover(settings):
    _export_then_diverge(settings)
    seen: dict[str, str] = {}

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
        seen["during"] = "blocked"

    restore_all(settings, force=True, _interrupt=interrupt)
    assert seen["during"] == "blocked"
    assert not original_copy_path(settings.db_path).exists()
    assert not maintenance_gate_path(settings.db_path).exists()
    assert not handover_journal_path(settings.db_path).exists()
    conn = connect(settings.db_path)
    try:
        assert {row["name"] for row in conn.execute("SELECT name FROM categories")} == {"Keep"}
        stored = conn.execute(
            "SELECT token_sha256 FROM principals WHERE name = 'operator'"
        ).fetchone()[0]
    finally:
        conn.close()
    assert token_digest(operator_token(settings)) == stored


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

    conn = connect(settings.db_path)
    try:
        assert {row["name"] for row in conn.execute("SELECT name FROM categories")} == {"Keep"}
        stored = conn.execute(
            "SELECT token_sha256 FROM principals WHERE name = 'operator'"
        ).fetchone()[0]
    finally:
        conn.close()
    assert token_digest(operator_token(settings)) == stored
    assert not original.exists()
    assert not maintenance_gate_path(settings.db_path).exists()
    assert not handover_journal_path(settings.db_path).exists()


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
