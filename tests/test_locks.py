from __future__ import annotations

import json
import multiprocessing
import os
import sqlite3
import uuid

import pytest

from dataclasses import replace

from joehub.db import connect, _maintenance_connect
from joehub.errors import PermanentWriteError
from joehub.principals import operator_token
from tests.acting import credential
from joehub.registry import HALL_PASS
from joehub.util import utcnow
from joehub.write import WriteLayer, request_fingerprint


def insert_transaction(db_path, export_dir, key_dir, account_id, idem_key, cents):
    os.environ["JOEHUB_DB_PATH"] = str(db_path)
    os.environ["JOEHUB_EXPORT_DIR"] = str(export_dir)
    os.environ["JOEHUB_KEY_DIR"] = str(key_dir)
    os.environ["JOEHUB_MAX_RETRIES"] = "40"
    os.environ["JOEHUB_RETRY_BACKOFF_SECONDS"] = "0.05"
    os.environ["JOEHUB_LOCK_TTL_SECONDS"] = "8"
    from joehub.config import load_settings
    from joehub.write import WriteLayer as WorkerWriter

    result = WorkerWriter().write(
        credential=operator_token(load_settings()),
        table="transactions",
        operation="insert",
        idempotency_key=idem_key,
        payload={
            "account_id": account_id,
            "amount_cents": cents,
            "date": "2026-04-01",
            "payee": "Synthetic worker",
            "memo": idem_key,
        },
    )
    return result.row_id, result.replayed


def test_stale_lock_can_be_recovered_and_release_does_not_steal(settings):
    holder = WriteLayer(settings)
    other = WriteLayer(settings)
    assert holder._acquire_hall_pass("Ledger") is True
    assert other._acquire_hall_pass("Scout") is False
    conn = _maintenance_connect(settings.db_path)
    try:
        conn.execute(
            "UPDATE locks SET expires_at = '2000-01-01T00:00:00Z' WHERE lock_name = ?",
            (HALL_PASS,),
        )
    finally:
        conn.close()
    assert other._acquire_hall_pass("Scout") is True
    holder._release_hall_pass()
    conn = connect(settings.db_path)
    try:
        row = conn.execute("SELECT holder_id FROM locks WHERE lock_name = ?", (HALL_PASS,)).fetchone()
        assert row["holder_id"] == other.holder_id
    finally:
        conn.close()
    other._release_hall_pass()
    conn = connect(settings.db_path)
    try:
        assert conn.execute("SELECT COUNT(*) FROM locks").fetchone()[0] == 0
    finally:
        conn.close()


def test_active_lock_blocks_until_retries_are_exhausted(writer, settings):
    account = writer.write(
        credential=credential(settings, "Ledger"),
        table="accounts",
        operation="insert",
        idempotency_key="lock-acct",
        payload={"name": "Lock Checking", "account_type": "checking"},
    ).row_id
    blocker = WriteLayer(settings)
    assert blocker._acquire_hall_pass("Ledger") is True
    impatient = WriteLayer(replace(settings, max_retries=2, retry_backoff_seconds=0.01))
    with pytest.raises(PermanentWriteError, match="retries exhausted"):
        impatient.write(
            credential=credential(settings, "Ledger"),
            table="transactions",
            operation="insert",
            idempotency_key="blocked-tx",
            payload={"account_id": account, "amount_cents": 50, "date": "2026-04-03"},
        )
    blocker._release_hall_pass()
    conn = connect(settings.db_path)
    try:
        assert conn.execute("SELECT COUNT(*) FROM transactions").fetchone()[0] == 0
        error = conn.execute(
            "SELECT persistent FROM errors WHERE idempotency_key = 'blocked-tx'"
        ).fetchone()
        assert error["persistent"] == 1
    finally:
        conn.close()
    recovered = writer.write(
        credential=credential(settings, "Ledger"),
        table="transactions",
        operation="insert",
        idempotency_key="after-block",
        payload={"account_id": account, "amount_cents": 50, "date": "2026-04-03"},
    )
    assert recovered.replayed is False


def test_crash_recovery_completes_a_running_write_once(writer, settings):
    account = writer.write(
        credential=credential(settings, "Ledger"),
        table="accounts",
        operation="insert",
        idempotency_key="crash-acct",
        payload={"name": "Crash Checking", "account_type": "checking"},
    ).row_id
    payload = {"account_id": account, "amount_cents": 2500, "date": "2026-04-04", "memo": "recovered"}
    now = utcnow()
    conn = _maintenance_connect(settings.db_path)
    try:
        principal_id = conn.execute(
            "SELECT id FROM principals WHERE name = 'operator'"
        ).fetchone()["id"]
        fingerprint = request_fingerprint(
            principal_id=principal_id,
            owner="Ledger",
            table="transactions",
            operation="insert",
            payload=payload,
        )
        encoded = json.dumps(payload, sort_keys=True, separators=(",", ":"))
        conn.execute(
            """
            INSERT INTO locks (
                id, notion_id, migrated_on, last_modified_by, last_modified_at,
                lock_name, holder_id, acquired_at, expires_at, ttl_seconds, fence
            ) VALUES (?, NULL, NULL, 'system', ?, ?, 'dead-process', ?, '2000-01-01T00:00:00Z', 5, 1)
            """,
            (str(uuid.uuid4()), now, HALL_PASS, now),
        )
        conn.execute(
            """
            INSERT INTO write_queue (
                id, notion_id, migrated_on, last_modified_by, last_modified_at,
                idempotency_key, owner_name, table_name, operation, payload_json,
                status, row_id, attempt_count, created_at, completed_at,
                request_fingerprint, actor_principal_id, fence
            ) VALUES (?, NULL, NULL, 'Ledger', ?, 'crash-key', 'Ledger', 'transactions', 'insert', ?,
                      'running', NULL, 1, ?, NULL, ?, ?, 1)
            """,
            (str(uuid.uuid4()), now, encoded, now, fingerprint, principal_id),
        )
    finally:
        conn.close()
    assert writer.recover_incomplete() == 1
    again = writer.write(
        credential=credential(settings, "Ledger"),
        table="transactions",
        operation="insert",
        idempotency_key="crash-key",
        payload=payload,
    )
    assert again.replayed is True
    conn = connect(settings.db_path)
    try:
        rows = conn.execute("SELECT id, amount_cents FROM transactions").fetchall()
        assert len(rows) == 1
        assert rows[0]["amount_cents"] == 2500
        assert again.row_id == rows[0]["id"]
        status = conn.execute(
            "SELECT status FROM write_queue WHERE idempotency_key = 'crash-key'"
        ).fetchone()["status"]
        assert status == "committed"
        assert conn.execute("SELECT COUNT(*) FROM locks").fetchone()[0] == 0
    finally:
        conn.close()


def test_multiprocess_contention_and_duplicate_keys(settings, writer):
    account = writer.write(
        credential=credential(settings, "Ledger"),
        table="accounts",
        operation="insert",
        idempotency_key="mp-acct",
        payload={"name": "Pool Checking", "account_type": "checking"},
    ).row_id
    ctx = multiprocessing.get_context("spawn")
    jobs = [
        (str(settings.db_path), str(settings.export_dir), str(settings.key_dir), account, f"mp-{index}", 100 + index)
        for index in range(4)
    ]
    with ctx.Pool(processes=4) as pool:
        results = pool.starmap(insert_transaction, jobs)
    ids = [row_id for row_id, _replayed in results]
    assert len(set(ids)) == 4
    duplicate_jobs = [
        (str(settings.db_path), str(settings.export_dir), str(settings.key_dir), account, "mp-shared", 808)
        for _ in range(2)
    ]
    with ctx.Pool(processes=2) as pool:
        duplicated = pool.starmap(insert_transaction, duplicate_jobs)
    assert duplicated[0][0] == duplicated[1][0]
    assert any(replayed for _row_id, replayed in duplicated)
    conn = connect(settings.db_path)
    try:
        count = conn.execute("SELECT COUNT(*) FROM transactions").fetchone()[0]
        assert count == 5
        shared = conn.execute(
            "SELECT COUNT(*) FROM transactions WHERE memo = 'mp-shared'"
        ).fetchone()[0]
        assert shared == 1
    finally:
        conn.close()


def test_database_is_unlocked_after_a_writer_error(settings):
    conn = connect(settings.db_path)
    try:
        # Touch the file through the normal migrator by opening after WriteLayer.
        pass
    finally:
        conn.close()
    layer = WriteLayer(settings)
    with pytest.raises(PermanentWriteError):
        layer.write(
            credential=credential(settings, "Ledger"),
            table="transactions",
            operation="insert",
            idempotency_key="unlock",
            payload={"amount_cents": 1},
        )
    follow = sqlite3.connect(settings.db_path)
    try:
        follow.execute("SELECT COUNT(*) FROM locks").fetchone()
    finally:
        follow.close()
