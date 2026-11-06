"""Regression tests for the PR #1 review. One test per fix."""

from __future__ import annotations

import inspect
import os
import sqlite3
import subprocess
from dataclasses import replace
from pathlib import Path

import pytest

from joehub.actions import perform
from joehub.backup import (
    decode_cell,
    encode_cell,
    export_all,
    git_push,
    publish_snapshot,
    published_dir,
    read_consistent_snapshot,
    restore_all,
)
from joehub.config import load_settings
from joehub.db import connect, connect_writer, list_tables
from joehub.errors import ConfigError, JoehubError, PermanentWriteError, UnauthorizedError
from joehub.principals import HUMAN_NAME, ensure_principals, token_digest, token_for
from joehub.registry import META_TABLES, TABLE_OWNERS, TABLES
from joehub.write import WriteLayer, request_fingerprint


def test_owner_name_is_not_a_credential_and_humans_need_delegation(writer, settings):
    with pytest.raises(UnauthorizedError):
        writer.write(
            credential="Ledger",
            table="accounts",
            operation="insert",
            idempotency_key="spoof-name",
            payload={"name": "Spoof", "account_type": "checking"},
        )
    human = token_for(settings, HUMAN_NAME)
    _result, err = perform(
        credential=human,
        table="accounts",
        operation="insert",
        payload={"name": "No delegation", "account_type": "checking"},
        idempotency_key="human-without",
        settings=settings,
    )
    assert err and "delegation" in err
    with pytest.raises(UnauthorizedError, match="human"):
        writer.delegate(token_for(settings, "Ledger"), "Scout")
    conn = connect_writer(settings.db_path)
    try:
        bot_token = "jht_bot_not_a_human_principal_token"
        conn.execute(
            """
            INSERT INTO principals (
                id, notion_id, migrated_on, last_modified_by, last_modified_at,
                name, kind, owner_name, token_sha256
            ) VALUES ('018f0000-0000-7000-8000-000000000199', NULL, NULL, 'system',
                      '2026-01-01T00:00:00Z', 'importer-bot', 'bot', NULL, ?)
            """,
            (token_digest(bot_token),),
        )
    finally:
        conn.close()
    with pytest.raises(UnauthorizedError, match="bot"):
        writer.write(
            credential=bot_token,
            table="accounts",
            operation="insert",
            idempotency_key="bot-write",
            payload={"name": "Bot", "account_type": "checking"},
        )
    delegation_id = writer.delegate(human, "Ledger")
    saved = writer.write(
        credential=human,
        table="accounts",
        operation="insert",
        idempotency_key="human-with",
        payload={"name": "Delegated Checking", "account_type": "checking"},
    )
    assert saved.replayed is False
    conn = connect(settings.db_path)
    try:
        audit = conn.execute(
            "SELECT last_modified_by, owner_name, note FROM delegations WHERE id = ?",
            (delegation_id,),
        ).fetchone()
        assert audit["last_modified_by"] == HUMAN_NAME
        assert audit["owner_name"] == "Ledger"
        assert "explicit" in audit["note"]
        assert conn.execute("SELECT COUNT(*) FROM accounts").fetchone()[0] == 1
    finally:
        conn.close()


def test_commit_hook_is_gone_and_the_default_connection_cannot_write(settings):
    assert "commit_hook" not in inspect.signature(WriteLayer.write).parameters
    layer = WriteLayer(settings)
    with pytest.raises(TypeError):
        layer.write(
            credential=token_for(settings, "Ledger"),
            table="categories",
            operation="insert",
            idempotency_key="hook",
            payload={"name": "Nope", "kind": "expense"},
            commit_hook=lambda _conn: None,
        )
    conn = connect(settings.db_path)
    try:
        with pytest.raises(sqlite3.OperationalError):
            conn.execute(
                """
                INSERT INTO categories (
                    id, notion_id, migrated_on, last_modified_by, last_modified_at, name, kind
                ) VALUES ('018f0000-0000-7000-8000-000000000188', NULL, NULL, 'Ledger',
                          '2026-01-01T00:00:00Z', 'Direct', 'expense')
                """
            )
    finally:
        conn.close()


def test_export_snapshot_ignores_a_commit_between_tables(settings, writer, monkeypatch):
    writer.write(
        credential=token_for(settings, "Ledger"),
        table="categories",
        operation="insert",
        idempotency_key="snap-cat",
        payload={"name": "Before", "kind": "expense"},
    )
    original = read_consistent_snapshot
    seen = {}

    def wrapped(db_path):
        shots = original(db_path)
        writer.write(
            credential=token_for(settings, "Ledger"),
            table="categories",
            operation="insert",
            idempotency_key="snap-during",
            payload={"name": "During", "kind": "income"},
        )
        return shots

    monkeypatch.setattr("joehub.backup.read_consistent_snapshot", wrapped)
    # Call the real reader once so the assertion is about one transaction,
    # then prove a later read sees the new row while the first shot does not.
    first = read_consistent_snapshot(settings.db_path)
    import joehub.backup as backup

    monkeypatch.setattr(backup, "read_consistent_snapshot", original)
    during = {"name": "Torn"}
    conn = connect_writer(settings.db_path)
    try:
        conn.execute("BEGIN")
        try:
            tables = list_tables(conn)
            first_table = tables[0]
            _ = conn.execute(f'SELECT COUNT(*) FROM "{first_table}"').fetchone()
            other = connect_writer(settings.db_path)
            try:
                other.execute(
                    """
                    INSERT INTO categories (
                        id, notion_id, migrated_on, last_modified_by, last_modified_at, name, kind
                    ) VALUES ('018f0000-0000-7000-8000-000000000177', NULL, NULL, 'Ledger',
                              '2026-01-01T00:00:00Z', 'Torn', 'expense')
                    """
                )
            finally:
                other.close()
            visible = conn.execute(
                "SELECT COUNT(*) FROM categories WHERE name = 'Torn'"
            ).fetchone()[0]
            seen["during"] = visible
            seen["tables"] = len(tables)
        finally:
            conn.rollback()
    finally:
        conn.close()
    assert seen["during"] == 0
    assert b"Torn" not in first.get("categories", b"")
    after = read_consistent_snapshot(settings.db_path)
    assert b"Torn" in after["categories"]
    assert during["name"] == "Torn"


def test_interrupted_publish_keeps_the_previous_generation(tmp_path, monkeypatch):
    export_dir = tmp_path / "exports"
    first = {"accounts.csv.age": b"generation-one", "categories.csv.age": b"generation-one"}
    publish_snapshot(export_dir, first)
    real_replace = os.replace

    def boom(src, dst):
        if Path(dst).name == "current":
            raise OSError("interrupted before publish")
        return real_replace(src, dst)

    monkeypatch.setattr("joehub.backup.os.replace", boom)
    with pytest.raises(OSError, match="interrupted"):
        publish_snapshot(
            export_dir,
            {"accounts.csv.age": b"generation-two", "categories.csv.age": b"generation-two"},
        )
    current = published_dir(export_dir)
    assert (current / "accounts.csv.age").read_bytes() == b"generation-one"
    assert (export_dir / "accounts.csv.age").read_bytes() == b"generation-one"


def test_csv_null_empty_and_sentinel_round_trip(writer, settings):
    assert encode_cell(None) == r"\N"
    assert encode_cell("") == ""
    assert encode_cell(r"\N") == r"\\N"
    assert decode_cell(r"\N", "TEXT") is None
    assert decode_cell("", "TEXT") == ""
    assert decode_cell(r"\\N", "TEXT") == r"\N"
    writer.write(
        credential=token_for(settings, "Ledger"),
        table="accounts",
        operation="insert",
        idempotency_key="null-acct",
        payload={"name": "Null Checking", "account_type": "checking"},
    )
    account = connect(settings.db_path).execute("SELECT id FROM accounts").fetchone()["id"]
    writer.write(
        credential=token_for(settings, "Ledger"),
        table="transactions",
        operation="insert",
        idempotency_key="null-tx",
        payload={
            "account_id": account,
            "amount_cents": -1,
            "date": "2026-04-01",
            "payee": "",
            "memo": None,
        },
    )
    writer.write(
        credential=token_for(settings, "Ledger"),
        table="transactions",
        operation="insert",
        idempotency_key="sentinel-tx",
        payload={
            "account_id": account,
            "amount_cents": -2,
            "date": "2026-04-02",
            "payee": r"\N",
            "memo": r"\N",
        },
    )
    export_all(settings)
    restored = settings.db_path.parent / "null-restored.db"
    restore_all(replace(settings, db_path=restored))
    conn = connect(restored)
    try:
        rows = conn.execute(
            "SELECT payee, memo, amount_cents FROM transactions ORDER BY date"
        ).fetchall()
        assert rows[0]["payee"] == ""
        assert rows[0]["memo"] is None
        assert rows[1]["payee"] == r"\N"
        assert rows[1]["memo"] == r"\N"
        assert all(isinstance(row["amount_cents"], int) for row in rows)
    finally:
        conn.close()


def test_failed_restore_leaves_the_original_database(settings, writer):
    writer.write(
        credential=token_for(settings, "Ledger"),
        table="categories",
        operation="insert",
        idempotency_key="keep-cat",
        payload={"name": "Keep", "kind": "expense"},
    )
    export_all(settings)
    original = settings.db_path.read_bytes()
    (published_dir(settings.export_dir) / "categories.csv.age").write_bytes(b"not-age")
    (settings.export_dir / "categories.csv.age").write_bytes(b"not-age")
    with pytest.raises(JoehubError, match="decrypt"):
        restore_all(settings, force=True)
    assert settings.db_path.read_bytes() == original
    conn = connect(settings.db_path)
    try:
        assert conn.execute("SELECT name FROM categories").fetchone()["name"] == "Keep"
    finally:
        conn.close()


def test_sensitive_paths_and_git_allowlist(monkeypatch, tmp_path, settings):
    export_dir = tmp_path / "exports"
    monkeypatch.setenv("JOEHUB_EXPORT_DIR", str(export_dir))
    monkeypatch.setenv("JOEHUB_DB_PATH", str(export_dir / "nested" / "joehub.db"))
    monkeypatch.setenv("JOEHUB_KEY_DIR", str(tmp_path / "keys"))
    with pytest.raises(ConfigError, match="export"):
        load_settings()
    monkeypatch.setenv("JOEHUB_DB_PATH", str(tmp_path / "joehub.db"))
    monkeypatch.setenv("JOEHUB_AUTH_HASH_FILE", str(export_dir / "dashboard_auth_hash"))
    with pytest.raises(ConfigError, match="hash"):
        load_settings()

    export_all(settings)
    (settings.export_dir / "dashboard_auth_hash").write_text("scrypt$secret", encoding="utf-8")
    (settings.export_dir / "joehub.db").write_bytes(b"sqlite")
    generation = published_dir(settings.export_dir)
    (generation / "notes.txt").write_text("do not publish", encoding="utf-8")
    bare = tmp_path / "remote.git"
    subprocess.run(["git", "init", "--bare", "-b", "main", str(bare)], check=True, capture_output=True)
    names = sorted(path.name for path in generation.glob("*.csv.age"))
    git_push(settings.export_dir, str(bare), names)
    clone = tmp_path / "clone"
    subprocess.run(["git", "clone", str(bare), str(clone)], check=True, capture_output=True)
    published = {path.name for path in clone.iterdir() if path.is_file()}
    assert "dashboard_auth_hash" not in published
    assert "joehub.db" not in published
    assert "notes.txt" not in published
    assert "transactions.csv.age" in published or "categories.csv.age" in published


def test_push_keeps_a_prepopulated_remote(settings, tmp_path):
    bare = tmp_path / "remote.git"
    subprocess.run(["git", "init", "--bare", "-b", "main", str(bare)], check=True, capture_output=True)
    seed = tmp_path / "seed"
    subprocess.run(["git", "clone", str(bare), str(seed)], check=True, capture_output=True)
    subprocess.run(["git", "-C", str(seed), "config", "user.email", "seed@example.com"], check=True)
    subprocess.run(["git", "-C", str(seed), "config", "user.name", "seed"], check=True)
    (seed / "README.md").write_text("already here\n", encoding="utf-8")
    subprocess.run(["git", "-C", str(seed), "add", "README.md"], check=True)
    subprocess.run(["git", "-C", str(seed), "commit", "-m", "Add README"], check=True, capture_output=True)
    subprocess.run(["git", "-C", str(seed), "push", "origin", "HEAD:main"], check=True, capture_output=True)
    readme = subprocess.run(
        ["git", "--git-dir", str(bare), "rev-parse", "HEAD"],
        check=True,
        capture_output=True,
        text=True,
    ).stdout.strip()
    summary = export_all(settings, remote=str(bare), visibility_check=lambda _remote: "PRIVATE")
    assert summary.pushed is True
    assert summary.push_status == "pushed"
    clone = tmp_path / "clone"
    subprocess.run(["git", "clone", str(bare), str(clone)], check=True, capture_output=True)
    assert (clone / "README.md").read_text(encoding="utf-8") == "already here\n"
    assert list(clone.glob("*.csv.age"))
    ancestor = subprocess.run(
        ["git", "-C", str(clone), "merge-base", "--is-ancestor", readme, "HEAD"],
        capture_output=True,
    )
    assert ancestor.returncode == 0
    log = subprocess.run(
        ["git", "--git-dir", str(bare), "log", "--format=%s"],
        check=True,
        capture_output=True,
        text=True,
    ).stdout
    assert "Add README" in log
    source = (Path(__file__).resolve().parents[1] / "src" / "joehub" / "backup.py").read_text(
        encoding="utf-8"
    )
    assert '"push", "--force"' not in source
    assert "refusing force-push" in source


def test_export_failure_does_not_claim_success(settings, monkeypatch):
    def boom(_settings, _recipient):
        raise JoehubError("disk full")

    monkeypatch.setattr("joehub.backup._encrypted_snapshot", boom)
    with pytest.raises(JoehubError, match="disk full"):
        export_all(settings)
    conn = connect(settings.db_path)
    try:
        row = conn.execute(
            "SELECT status, publication_state FROM export_history"
        ).fetchone()
        assert row["status"] == "failed"
        assert row["publication_state"] == "failed"
        assert conn.execute(
            "SELECT COUNT(*) FROM export_history WHERE status = 'succeeded'"
        ).fetchone()[0] == 0
    finally:
        conn.close()


def test_idempotency_rejects_a_different_payload_and_does_not_overwrite_running(writer, settings):
    writer.write(
        credential=token_for(settings, "Ledger"),
        table="categories",
        operation="insert",
        idempotency_key="same-key",
        payload={"name": "Original", "kind": "expense"},
    )
    writer.delegate(token_for(settings, HUMAN_NAME), "Ledger")
    with pytest.raises(PermanentWriteError, match="different request"):
        writer.write(
            credential=token_for(settings, HUMAN_NAME),
            table="categories",
            operation="insert",
            idempotency_key="same-key",
            payload={"name": "Original", "kind": "expense"},
        )
    conn = connect_writer(settings.db_path)
    try:
        principal_id = conn.execute("SELECT id FROM principals WHERE name = 'Ledger'").fetchone()["id"]
        payload = {"name": "Running", "kind": "income"}
        fingerprint = request_fingerprint(
            principal_id=principal_id,
            owner="Ledger",
            table="categories",
            operation="insert",
            payload=payload,
        )
        import json
        import uuid
        from joehub.util import utcnow

        now = utcnow()
        conn.execute(
            """
            INSERT INTO write_queue (
                id, notion_id, migrated_on, last_modified_by, last_modified_at,
                idempotency_key, owner_name, table_name, operation, payload_json,
                status, row_id, attempt_count, created_at, completed_at,
                request_fingerprint, actor_principal_id, fence
            ) VALUES (?, NULL, NULL, 'Ledger', ?, 'running-key', 'Ledger', 'categories', 'insert', ?,
                      'running', NULL, 1, ?, NULL, ?, ?, 1)
            """,
            (
                str(uuid.uuid4()),
                now,
                json.dumps(payload, sort_keys=True, separators=(",", ":")),
                now,
                fingerprint,
                principal_id,
            ),
        )
    finally:
        conn.close()
    with pytest.raises(PermanentWriteError, match="different request"):
        writer.write(
            credential=token_for(settings, "Ledger"),
            table="categories",
            operation="insert",
            idempotency_key="running-key",
            payload={"name": "Replaced", "kind": "expense"},
        )
    conn = connect(settings.db_path)
    try:
        stored = conn.execute(
            "SELECT payload_json, status FROM write_queue WHERE idempotency_key = 'running-key'"
        ).fetchone()
        assert stored["status"] == "running"
        assert "Running" in stored["payload_json"]
        assert "Replaced" not in stored["payload_json"]
    finally:
        conn.close()


def test_startup_recovery_and_fence(settings, writer):
    account = writer.write(
        credential=token_for(settings, "Ledger"),
        table="accounts",
        operation="insert",
        idempotency_key="fence-acct",
        payload={"name": "Fence Checking", "account_type": "checking"},
    ).row_id
    holder = WriteLayer(settings)
    assert holder._acquire_hall_pass("Ledger") is True
    fence = holder.fence
    conn = connect_writer(settings.db_path)
    try:
        conn.execute(
            "UPDATE locks SET expires_at = '2000-01-01T00:00:00Z' WHERE lock_name = 'hall_pass'"
        )
    finally:
        conn.close()
    other = WriteLayer(settings, recover=False)
    assert other._acquire_hall_pass("Scout") is True
    assert other.fence == fence + 1
    conn = connect_writer(settings.db_path)
    try:
        with pytest.raises(Exception):
            holder._touch_lease(conn)
        conn.rollback()
    finally:
        conn.close()
    other._release_hall_pass()
    payload = {"account_id": account, "amount_cents": 40, "date": "2026-04-08"}
    import json
    import uuid
    from joehub.util import utcnow

    now = utcnow()
    conn = connect_writer(settings.db_path)
    try:
        principal_id = conn.execute("SELECT id FROM principals WHERE name = 'Ledger'").fetchone()["id"]
        fingerprint = request_fingerprint(
            principal_id=principal_id,
            owner="Ledger",
            table="transactions",
            operation="insert",
            payload=payload,
        )
        conn.execute(
            """
            INSERT INTO write_queue (
                id, notion_id, migrated_on, last_modified_by, last_modified_at,
                idempotency_key, owner_name, table_name, operation, payload_json,
                status, row_id, attempt_count, created_at, completed_at,
                request_fingerprint, actor_principal_id, fence
            ) VALUES (?, NULL, NULL, 'Ledger', ?, 'auto-recover', 'Ledger', 'transactions', 'insert', ?,
                      'running', NULL, 1, ?, NULL, ?, ?, 1)
            """,
            (
                str(uuid.uuid4()),
                now,
                json.dumps(payload, sort_keys=True, separators=(",", ":")),
                now,
                fingerprint,
                principal_id,
            ),
        )
    finally:
        conn.close()
    recovered = WriteLayer(settings)
    conn = connect(settings.db_path)
    try:
        status = conn.execute(
            "SELECT status FROM write_queue WHERE idempotency_key = 'auto-recover'"
        ).fetchone()["status"]
        assert status == "committed"
        assert conn.execute("SELECT amount_cents FROM transactions").fetchone()["amount_cents"] == 40
    finally:
        conn.close()
    assert recovered.holder_id


def test_every_table_has_one_registered_owner(settings):
    from joehub.db import migrate

    migrate(settings.db_path)
    ensure_principals(settings)
    conn = connect(settings.db_path)
    try:
        tables = set(list_tables(conn))
        registry = {
            row["table_name"]: row["owner_name"]
            for row in conn.execute(
                """
                SELECT table_registry.table_name, owners.name AS owner_name
                FROM table_registry JOIN owners ON owners.id = table_registry.owner_id
                """
            )
        }
        assert set(registry) == tables
        assert registry == TABLE_OWNERS
        for table in META_TABLES:
            assert registry[table] == "Cato"
        assert set(TABLES).isdisjoint(META_TABLES)
    finally:
        conn.close()
    with pytest.raises(UnauthorizedError):
        WriteLayer(settings).write(
            credential=token_for(settings, "Cato"),
            table="schema_migrations",
            operation="insert",
            idempotency_key="meta-write",
            payload={"version": "nope"},
        )
