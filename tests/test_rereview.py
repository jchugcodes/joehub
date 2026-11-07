"""Regression tests for the re-review of a502ed2. One test per fix."""

from __future__ import annotations

import csv
import inspect
import io
import json
import multiprocessing
import sqlite3
import subprocess
import time
import uuid
from pathlib import Path

import pytest
import pyrage

from joehub.backup import export_all, git_push, load_or_create_identity, reconcile_interrupted_publication, restore_all
from joehub.config import load_settings
from joehub.db import _maintenance_connect, connect, list_tables, migrate
from joehub.errors import ConfigError, PermanentWriteError, UnauthorizedError, ValidationError
from joehub.principals import HUMAN_NAME, operator_token
from joehub.registry import HALL_PASS
from joehub.util import add_seconds, utcnow
from joehub.write import WriteLayer, request_fingerprint
from tests.acting import credential


def _insert_running(
    settings,
    *,
    key: str,
    principal_id: str,
    owner: str,
    table: str,
    operation: str,
    payload: dict,
    expires_at: str | None,
) -> None:
    fingerprint = request_fingerprint(
        principal_id=principal_id,
        owner=owner,
        table=table,
        operation=operation,
        payload=payload,
    )
    encoded = json.dumps(payload, sort_keys=True, separators=(",", ":"))
    now = utcnow()
    conn = _maintenance_connect(settings.db_path)
    try:
        if expires_at is not None:
            conn.execute(
                """
                INSERT INTO locks (
                    id, notion_id, migrated_on, last_modified_by, last_modified_at,
                    lock_name, holder_id, acquired_at, expires_at, ttl_seconds, fence
                ) VALUES (?, NULL, NULL, 'system', ?, ?, 'dead-process', ?, ?, 30, 1)
                """,
                (str(uuid.uuid4()), now, HALL_PASS, now, expires_at),
            )
        conn.execute(
            """
            INSERT INTO write_queue (
                id, notion_id, migrated_on, last_modified_by, last_modified_at,
                idempotency_key, owner_name, table_name, operation, payload_json,
                status, row_id, attempt_count, created_at, completed_at,
                request_fingerprint, actor_principal_id, fence
            ) VALUES (?, NULL, NULL, ?, ?, ?, ?, ?, ?, ?,
                      'running', NULL, 1, ?, NULL, ?, ?, 1)
            """,
            (
                str(uuid.uuid4()),
                owner,
                now,
                key,
                owner,
                table,
                operation,
                encoded,
                now,
                fingerprint,
                principal_id,
            ),
        )
    finally:
        conn.close()


def test_cooperative_mode_has_no_token_lookup_and_no_writable_connect(settings):
    import joehub.db as db
    import joehub.principals as principals

    assert not hasattr(principals, "token_for")
    assert "writable" not in inspect.signature(db.connect).parameters
    assert not hasattr(db, "connect_writer")
    layer = WriteLayer(settings, recover=False)
    layer.close()
    directory = settings.key_dir / "principals"
    assert (directory / "operator.token").is_file()
    assert (directory / "operator.token").stat().st_mode & 0o777 == 0o600
    assert not (directory / "Ledger.token").exists()
    assert not (directory / "Scout.token").exists()
    assert not (directory / "Cato.token").exists()
    conn = connect(settings.db_path)
    try:
        conn.execute("PRAGMA query_only = OFF")
        with pytest.raises(sqlite3.DatabaseError):
            conn.execute("CREATE TABLE should_not_exist (id TEXT)")
    finally:
        conn.close()
    text = (Path(__file__).resolve().parents[1] / "docs" / "TRUST_BOUNDARY.md").read_text(encoding="utf-8")
    lowered = text.lower()
    assert "cooperative" in lowered
    assert "does not enforce bot identity" in lowered
    assert "joe" in lowered
    assert "not achievable on one shared os user" in lowered


def test_forced_restore_into_a_healthy_database(settings):
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
    conn = connect(settings.db_path)
    try:
        assert conn.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
        assert {row["name"] for row in conn.execute("SELECT name FROM categories")} == {"Keep", "Extra"}
    finally:
        conn.close()
    restore_all(settings, force=True)
    assert settings.db_path.is_file()
    conn = connect(settings.db_path)
    try:
        assert conn.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
        assert {row["name"] for row in conn.execute("SELECT name FROM categories")} == {"Keep"}
    finally:
        conn.close()


def test_disaster_restore_uses_only_the_csvs_and_the_age_key(settings):
    credential(settings, "Ledger")
    credential(settings, "Cato")
    original = operator_token(settings)
    layer = WriteLayer(settings, recover=False)
    try:
        layer.write(
            credential=original,
            table="accounts",
            operation="insert",
            idempotency_key="disaster-acct",
            payload={"name": "Disaster Checking", "account_type": "checking"},
        )
    finally:
        layer.close()
    export_all(settings)
    conn = connect(settings.db_path)
    try:
        before = {
            row["name"]: row
            for row in conn.execute(
                "SELECT id, name, kind, owner_name, notion_id, migrated_on, token_sha256 FROM principals"
            )
        }
    finally:
        conn.close()
    for suffix in ("", "-wal", "-shm"):
        sidecar = Path(str(settings.db_path) + suffix)
        if sidecar.exists():
            sidecar.unlink()
    for path in (settings.key_dir / "principals").glob("*"):
        if path.is_file():
            path.unlink()
    assert settings.age_identity_path.is_file()
    assert not list((settings.key_dir / "principals").glob("*.token"))
    restore_all(settings)
    rebuilt = operator_token(settings)
    assert rebuilt != original
    layer = WriteLayer(settings, recover=False)
    try:
        saved = layer.write(
            credential=rebuilt,
            table="accounts",
            operation="insert",
            idempotency_key="after-disaster",
            payload={"name": "After", "account_type": "savings"},
        )
    finally:
        layer.close()
    assert saved.replayed is False
    conn = connect(settings.db_path)
    try:
        after = {
            row["name"]: row
            for row in conn.execute(
                """
                SELECT id, name, kind, owner_name, notion_id, migrated_on,
                       token_sha256, last_modified_by
                FROM principals
                """
            )
        }
        assert set(after) == set(before)
        for name, row in before.items():
            assert after[name]["id"] == row["id"]
            assert after[name]["notion_id"] == row["notion_id"]
            assert after[name]["migrated_on"] == row["migrated_on"]
            assert after[name]["kind"] == row["kind"]
            assert after[name]["owner_name"] == row["owner_name"]
            assert after[name]["token_sha256"] != row["token_sha256"]
            assert after[name]["last_modified_by"] == "restore"
        assert conn.execute("SELECT COUNT(*) FROM accounts").fetchone()[0] == 2
    finally:
        conn.close()
    assert (settings.key_dir / "principals" / "operator.token").is_file()
    assert not (settings.key_dir / "principals" / "Ledger.token").exists()


def test_invalid_auth_and_invalid_key_cannot_poison_the_queue(settings):
    token = credential(settings, "Ledger")
    layer = WriteLayer(settings, recover=False)
    try:
        conn = connect(settings.db_path)
        try:
            human_id = conn.execute(
                "SELECT id FROM principals WHERE name = ?",
                (HUMAN_NAME,),
            ).fetchone()["id"]
        finally:
            conn.close()
        live = {"name": "Live", "kind": "expense"}
        other = {"name": "Other", "kind": "income"}
        _insert_running(
            settings,
            key="live-key",
            principal_id=human_id,
            owner="Ledger",
            table="categories",
            operation="insert",
            payload=live,
            expires_at=None,
        )
        _insert_running(
            settings,
            key="other-key",
            principal_id=human_id,
            owner="Ledger",
            table="categories",
            operation="insert",
            payload=other,
            expires_at=None,
        )
        with pytest.raises(UnauthorizedError):
            layer.write(
                credential="not-a-valid-token-string!!",
                table="categories",
                operation="insert",
                idempotency_key="live-key",
                payload={"name": "Hijack", "kind": "expense"},
            )
        with pytest.raises(UnauthorizedError):
            layer.write(
                credential="Mallory",
                table="categories",
                operation="insert",
                idempotency_key="other-key",
                payload={"name": "Hijack", "kind": "expense"},
            )
        with pytest.raises(PermanentWriteError):
            layer.write(
                credential=token,
                table="categories",
                operation="insert",
                idempotency_key="live-key",
                payload={"name": "Missing kind"},
            )
        with pytest.raises(ValidationError):
            layer.write(
                credential=token,
                table="categories",
                operation="insert",
                idempotency_key="live-key\nbad",
                payload={"name": "Bad key", "kind": "expense"},
            )
        conn = connect(settings.db_path)
        try:
            rows = {
                row["idempotency_key"]: row
                for row in conn.execute(
                    """
                    SELECT idempotency_key, status, payload_json, request_fingerprint, actor_principal_id
                    FROM write_queue
                    WHERE idempotency_key IN ('live-key', 'other-key')
                    """
                )
            }
            assert set(rows) == {"live-key", "other-key"}
            assert rows["live-key"]["status"] == "running"
            assert rows["other-key"]["status"] == "running"
            assert "Live" in rows["live-key"]["payload_json"]
            assert "Hijack" not in rows["live-key"]["payload_json"]
            assert "Missing" not in rows["live-key"]["payload_json"]
            assert rows["live-key"]["actor_principal_id"] == human_id
            assert "Other" in rows["other-key"]["payload_json"]
        finally:
            conn.close()
    finally:
        layer.close()


def test_restart_before_lease_expiry_is_retried_after_expiry(settings, monkeypatch):
    monkeypatch.setenv("JOEHUB_RECOVERY_INTERVAL_SECONDS", "0.05")
    token = credential(settings, "Ledger")
    layer = WriteLayer(settings, recover=False)
    try:
        account = layer.write(
            credential=token,
            table="accounts",
            operation="insert",
            idempotency_key="lease-acct",
            payload={"name": "Lease Checking", "account_type": "checking"},
        ).row_id
    finally:
        layer.close()
    conn = connect(settings.db_path)
    try:
        human_id = conn.execute(
            "SELECT id FROM principals WHERE name = ?",
            (HUMAN_NAME,),
        ).fetchone()["id"]
    finally:
        conn.close()
    payload = {"account_id": account, "amount_cents": 80, "date": "2026-04-09", "memo": "later"}
    _insert_running(
        settings,
        key="lease-key",
        principal_id=human_id,
        owner="Ledger",
        table="transactions",
        operation="insert",
        payload=payload,
        expires_at=add_seconds(utcnow(), 3600),
    )
    restarted = WriteLayer(load_settings())
    try:
        conn = connect(settings.db_path)
        try:
            assert conn.execute("SELECT COUNT(*) FROM transactions").fetchone()[0] == 0
            row = conn.execute(
                "SELECT status, actor_principal_id FROM write_queue WHERE idempotency_key = 'lease-key'"
            ).fetchone()
            assert row["status"] == "running"
            assert row["actor_principal_id"] == human_id
        finally:
            conn.close()
        maint = _maintenance_connect(settings.db_path)
        try:
            maint.execute(
                "UPDATE locks SET expires_at = '2000-01-01T00:00:00Z' WHERE lock_name = ?",
                (HALL_PASS,),
            )
        finally:
            maint.close()
        deadline = time.time() + 5
        status = "running"
        while time.time() < deadline:
            conn = connect(settings.db_path)
            try:
                status = conn.execute(
                    "SELECT status FROM write_queue WHERE idempotency_key = 'lease-key'"
                ).fetchone()["status"]
                actor = conn.execute(
                    "SELECT actor_principal_id FROM write_queue WHERE idempotency_key = 'lease-key'"
                ).fetchone()["actor_principal_id"]
                count = conn.execute("SELECT COUNT(*) FROM transactions").fetchone()[0]
                modified = conn.execute("SELECT last_modified_by FROM transactions").fetchone()
            finally:
                conn.close()
            if status == "committed":
                break
            time.sleep(0.05)
        assert status == "committed"
        assert actor == human_id
        assert count == 1
        assert modified["last_modified_by"] == "Ledger"
    finally:
        restarted.close()


def test_recovery_after_delegation_revoked_does_not_apply(settings):
    token = credential(settings, "Ledger")
    layer = WriteLayer(settings, recover=False)
    try:
        account = layer.write(
            credential=token,
            table="accounts",
            operation="insert",
            idempotency_key="revoke-acct",
            payload={"name": "Revoke Checking", "account_type": "checking"},
        ).row_id
        conn = connect(settings.db_path)
        try:
            human_id = conn.execute(
                "SELECT id FROM principals WHERE name = ?",
                (HUMAN_NAME,),
            ).fetchone()["id"]
        finally:
            conn.close()
        payload = {"account_id": account, "amount_cents": 15, "date": "2026-04-10", "memo": "revoked"}
        _insert_running(
            settings,
            key="revoked-key",
            principal_id=human_id,
            owner="Ledger",
            table="transactions",
            operation="insert",
            payload=payload,
            expires_at="2000-01-01T00:00:00Z",
        )
        layer.revoke_delegation(token, "Ledger")
        assert layer.recover_incomplete() == 0
        conn = connect(settings.db_path)
        try:
            assert conn.execute("SELECT COUNT(*) FROM transactions").fetchone()[0] == 0
            row = conn.execute(
                "SELECT status, actor_principal_id FROM write_queue WHERE idempotency_key = 'revoked-key'"
            ).fetchone()
            assert row["status"] == "failed"
            assert row["actor_principal_id"] == human_id
            message = conn.execute(
                "SELECT message FROM errors WHERE idempotency_key = 'revoked-key'"
            ).fetchone()["message"]
            assert "revoked" in message
        finally:
            conn.close()
    finally:
        layer.close()


def test_interrupted_final_push_is_reconciled(settings, tmp_path, monkeypatch):
    credential(settings, "Cato")
    credential(settings, "Ledger")
    layer = WriteLayer(settings, recover=False)
    try:
        layer.write(
            credential=operator_token(settings),
            table="categories",
            operation="insert",
            idempotency_key="push-cat",
            payload={"name": "Publish", "kind": "expense"},
        )
    finally:
        layer.close()
    bare = tmp_path / "remote.git"
    subprocess.run(["git", "init", "--bare", "-b", "main", str(bare)], check=True, capture_output=True)
    calls = {"n": 0}

    def crash_on_final(export_dir, remote, artifacts):
        calls["n"] += 1
        if calls["n"] == 2:
            raise SystemExit("crash during final push")
        return git_push(export_dir, remote, artifacts)

    monkeypatch.setattr("joehub.backup.git_push", crash_on_final)
    with pytest.raises(SystemExit, match="final push"):
        export_all(settings, remote=str(bare), visibility_check=lambda _remote: "PRIVATE")
    conn = connect(settings.db_path)
    try:
        state = conn.execute("SELECT publication_state FROM export_history").fetchone()["publication_state"]
    finally:
        conn.close()
    journal = json.loads((settings.export_dir / ".publication-journal.json").read_text(encoding="utf-8"))
    assert journal["phase"] == "final_in_progress"
    assert state == "pushed"
    # The push that landed is the pre-audit snapshot. Its export_history row
    # is not pushed. Reconcile has to publish the pushed row before it clears
    # the journal.
    assert _remote_publication_states(bare, settings) == ["incomplete"]
    seen: dict[str, str] = {}

    def spy(export_dir, remote, artifacts):
        conn = connect(settings.db_path)
        try:
            seen["during"] = conn.execute(
                "SELECT publication_state FROM export_history"
            ).fetchone()["publication_state"]
        finally:
            conn.close()
        return git_push(export_dir, remote, artifacts)

    monkeypatch.setattr("joehub.backup.git_push", spy)
    reconcile_interrupted_publication(settings, visibility_check=lambda _remote: "PRIVATE")
    assert seen["during"] == "pushed"
    conn = connect(settings.db_path)
    try:
        assert conn.execute(
            "SELECT publication_state FROM export_history"
        ).fetchone()["publication_state"] == "pushed"
    finally:
        conn.close()
    assert not (settings.export_dir / ".publication-journal.json").exists()
    assert _remote_publication_states(bare, settings) == ["pushed"]
    listed = subprocess.run(
        ["git", "--git-dir", str(bare), "log", "--oneline"],
        check=True,
        capture_output=True,
        text=True,
    )
    assert "joehub" in listed.stdout


def _remote_publication_states(bare: Path, settings) -> list[str]:
    clone = bare.parent / f"clone-{uuid.uuid4().hex}"
    subprocess.run(["git", "clone", str(bare), str(clone)], check=True, capture_output=True)
    identity = load_or_create_identity(settings.age_identity_path)
    plain = pyrage.decrypt((clone / "export_history.csv.age").read_bytes(), [identity]).decode()
    return [row["publication_state"] for row in csv.DictReader(io.StringIO(plain))]


def _migrate_child(path: str) -> str:
    from joehub.db import migrate as child_migrate

    child_migrate(Path(path))
    return "ok"


def test_crash_mid_migration_retries_cleanly(tmp_path, monkeypatch):
    import joehub.db as db

    db_path = tmp_path / "crash.db"
    original = db._execute_statement
    state = {"creates": 0}

    def wrapped(conn, statement):
        if statement.lstrip().upper().startswith("CREATE TABLE"):
            state["creates"] += 1
            if state["creates"] == 2:
                raise RuntimeError("crash mid-migration")
        return original(conn, statement)

    monkeypatch.setattr(db, "_execute_statement", wrapped)
    with pytest.raises(RuntimeError, match="crash mid-migration"):
        migrate(db_path)
    monkeypatch.undo()
    migrate(db_path)
    conn = connect(db_path)
    try:
        tables = set(list_tables(conn))
        assert "transactions" in tables
        assert "principals" in tables
        versions = [
            row["version"]
            for row in conn.execute("SELECT version FROM schema_migrations ORDER BY version")
        ]
        assert versions == ["001_initial.sql", "002_writers_and_registry.sql"]
        assert conn.execute("PRAGMA table_info(locks)").fetchall()
        columns = {row["name"] for row in conn.execute("PRAGMA table_info(locks)")}
        assert "fence" in columns
    finally:
        conn.close()


def test_add_column_is_idempotent_when_the_version_row_is_missing(tmp_path):
    db_path = tmp_path / "partial.db"
    migrate(db_path)
    conn = _maintenance_connect(db_path)
    try:
        conn.execute("DELETE FROM schema_migrations WHERE version = '002_writers_and_registry.sql'")
    finally:
        conn.close()
    migrate(db_path)
    conn = connect(db_path)
    try:
        versions = [
            row["version"]
            for row in conn.execute(
                "SELECT version FROM schema_migrations WHERE version = '002_writers_and_registry.sql'"
            )
        ]
        assert versions == ["002_writers_and_registry.sql"]
        columns = {row["name"] for row in conn.execute("PRAGMA table_info(write_queue)")}
        assert "request_fingerprint" in columns
    finally:
        conn.close()


def test_two_processes_migrate_a_new_database_once(tmp_path):
    db_path = tmp_path / "race.db"
    ctx = multiprocessing.get_context("spawn")
    with ctx.Pool(processes=2) as pool:
        results = pool.map(_migrate_child, [str(db_path), str(db_path)])
    assert results == ["ok", "ok"]
    conn = connect(db_path)
    try:
        versions = [
            row["version"]
            for row in conn.execute("SELECT version FROM schema_migrations ORDER BY version")
        ]
        assert versions == ["001_initial.sql", "002_writers_and_registry.sql"]
        assert "accounts" in list_tables(conn)
    finally:
        conn.close()


def test_path_containment_follows_symlinks(tmp_path, monkeypatch):
    export_dir = tmp_path / "exports"
    export_dir.mkdir()
    outside = tmp_path / "outside"
    outside.mkdir()
    link = outside / "joehub.db"
    link.symlink_to(export_dir / "hidden.db")
    keys = tmp_path / "keys"
    keys.mkdir()
    monkeypatch.setenv("JOEHUB_EXPORT_DIR", str(export_dir))
    monkeypatch.setenv("JOEHUB_DB_PATH", str(link))
    monkeypatch.setenv("JOEHUB_KEY_DIR", str(keys))
    with pytest.raises(ConfigError, match="export"):
        load_settings()

    monkeypatch.setenv("JOEHUB_DB_PATH", str(tmp_path / "data" / "joehub.db"))
    nested = export_dir / "nested-keys"
    nested.mkdir()
    key_link = tmp_path / "key-link"
    key_link.symlink_to(nested)
    monkeypatch.setenv("JOEHUB_KEY_DIR", str(key_link))
    with pytest.raises(ConfigError, match="key"):
        load_settings()
