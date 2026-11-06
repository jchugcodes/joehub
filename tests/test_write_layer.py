from __future__ import annotations

import uuid

import pytest

from joehub.db import connect
from joehub.errors import PermanentWriteError, UnauthorizedError, ValidationError
from joehub.principals import token_for


def _account(writer, name="Everyday Checking") -> str:
    result = writer.write(
        credential=token_for(writer.settings, "Ledger"),
        table="accounts",
        operation="insert",
        idempotency_key=f"acct-{name}",
        payload={"name": name, "account_type": "checking", "institution": "Example Harbor Credit Union"},
    )
    return result.row_id


def _category(writer) -> str:
    result = writer.write(
        credential=token_for(writer.settings, "Ledger"),
        table="categories",
        operation="insert",
        idempotency_key="cat-groceries",
        payload={"name": "Groceries", "kind": "expense"},
    )
    return result.row_id


def test_idempotent_replay_does_not_duplicate_or_apply_a_new_payload(writer, settings):
    account_id = _account(writer)
    payload = {"account_id": account_id, "amount_cents": -1250, "date": "2026-04-02", "payee": "Corner Market"}
    first = writer.write(
        credential=token_for(writer.settings, "Ledger"),
        table="transactions",
        operation="insert",
        idempotency_key="tx-1",
        payload=payload,
    )
    with pytest.raises(PermanentWriteError, match="different request"):
        writer.write(
            credential=token_for(writer.settings, "Ledger"),
            table="transactions",
            operation="insert",
            idempotency_key="tx-1",
            payload={**payload, "amount_cents": -9999, "payee": "Someone else"},
        )
    second = writer.write(
        credential=token_for(writer.settings, "Ledger"),
        table="transactions",
        operation="insert",
        idempotency_key="tx-1",
        payload=payload,
    )
    assert second.replayed is True
    assert second.row_id == first.row_id
    conn = connect(settings.db_path)
    try:
        rows = conn.execute("SELECT amount_cents, payee FROM transactions").fetchall()
        assert len(rows) == 1
        assert rows[0]["amount_cents"] == -1250
        assert isinstance(rows[0]["amount_cents"], int)
        assert rows[0]["payee"] == "Corner Market"
        audit = conn.execute("SELECT last_modified_by FROM transactions").fetchone()
        assert audit["last_modified_by"] == "Ledger"
    finally:
        conn.close()


def test_invalid_fields_are_persistent_and_do_not_insert(writer, settings):
    account_id = _account(writer)
    cases = [
        {"account_id": account_id, "date": "2026-04-02"},
        {"account_id": account_id, "amount_cents": 100, "date": "04/02/2026"},
        {"account_id": account_id, "amount_cents": True, "date": "2026-04-02"},
        {"account_id": account_id, "amount_cents": "100", "date": "2026-04-02"},
        {"account_id": account_id, "amount_cents": 1.5, "date": "2026-04-02"},
    ]
    for index, payload in enumerate(cases):
        with pytest.raises(PermanentWriteError):
            writer.write(
                credential=token_for(writer.settings, "Ledger"),
                table="transactions",
                operation="insert",
                idempotency_key=f"bad-{index}",
                payload=payload,
            )
    with pytest.raises(ValidationError):
        writer.write(
            credential=token_for(writer.settings, "Scout"),
            table="applications",
            operation="insert",
            idempotency_key="bad-status",
            payload={"role_title": "Operator", "status": "Ghosted"},
        )
    conn = connect(settings.db_path)
    try:
        assert conn.execute("SELECT COUNT(*) FROM transactions").fetchone()[0] == 0
        errors = conn.execute("SELECT persistent FROM errors").fetchall()
        assert errors
        assert all(row["persistent"] == 1 for row in errors)
    finally:
        conn.close()


def test_failed_key_is_not_retried(writer):
    with pytest.raises(PermanentWriteError):
        writer.write(
            credential=token_for(writer.settings, "Ledger"),
            table="transactions",
            operation="insert",
            idempotency_key="same-bad",
            payload={"amount_cents": 1},
        )
    with pytest.raises(PermanentWriteError, match="already failed"):
        writer.write(
            credential=token_for(writer.settings, "Ledger"),
            table="transactions",
            operation="insert",
            idempotency_key="same-bad",
            payload={"account_id": str(uuid.uuid4()), "amount_cents": 1, "date": "2026-04-02"},
        )


def test_unauthorized_writes_and_deletes(writer, settings):
    account_id = _account(writer)
    category_id = _category(writer)
    with pytest.raises(UnauthorizedError):
        writer.write(
            credential=token_for(writer.settings, "Scout"),
            table="transactions",
            operation="insert",
            idempotency_key="scout-tx",
            payload={"account_id": account_id, "amount_cents": 1, "date": "2026-04-02"},
        )
    with pytest.raises(UnauthorizedError):
        writer.write(
            credential="Mallory",
            table="transactions",
            operation="insert",
            idempotency_key="mallory",
            payload={"account_id": account_id, "amount_cents": 1, "date": "2026-04-02"},
        )
    with pytest.raises(UnauthorizedError):
        writer.write(
            credential=token_for(writer.settings, "Cato"),
            table="categories",
            operation="delete_request",
            idempotency_key="cato-delete",
            payload={"id": category_id},
        )
    conn = connect(settings.db_path)
    try:
        assert conn.execute("SELECT COUNT(*) FROM transactions").fetchone()[0] == 0
        assert conn.execute("SELECT COUNT(*) FROM pending_deletes").fetchone()[0] == 0
        assert conn.execute("SELECT COUNT(*) FROM errors WHERE persistent = 1").fetchone()[0] >= 3
    finally:
        conn.close()


def test_two_step_delete_requires_the_owner(writer, settings):
    category_id = _category(writer)
    writer.write(
        credential=token_for(writer.settings, "Ledger"),
        table="categories",
        operation="delete_request",
        idempotency_key="del-req",
        payload={"id": category_id},
    )
    with pytest.raises(UnauthorizedError):
        writer.write(
            credential=token_for(writer.settings, "Scout"),
            table="categories",
            operation="delete_confirm",
            idempotency_key="del-scout",
            payload={"id": category_id},
        )
    with pytest.raises(PermanentWriteError, match="no pending delete"):
        writer.write(
            credential=token_for(writer.settings, "Ledger"),
            table="categories",
            operation="delete_confirm",
            idempotency_key="del-without-request",
            payload={"id": str(uuid.uuid4())},
        )
    confirmed = writer.write(
        credential=token_for(writer.settings, "Ledger"),
        table="categories",
        operation="delete_confirm",
        idempotency_key="del-ok",
        payload={"id": category_id},
    )
    assert confirmed.replayed is False
    replay = writer.write(
        credential=token_for(writer.settings, "Ledger"),
        table="categories",
        operation="delete_confirm",
        idempotency_key="del-ok",
        payload={"id": category_id},
    )
    assert replay.replayed is True
    conn = connect(settings.db_path)
    try:
        assert conn.execute("SELECT COUNT(*) FROM categories").fetchone()[0] == 0
        pending = conn.execute("SELECT status, confirmed_at, owner_name FROM pending_deletes").fetchone()
        assert pending["status"] == "confirmed"
        assert pending["confirmed_at"]
        assert pending["owner_name"] == "Ledger"
    finally:
        conn.close()


def test_rollback_removes_application_and_history(writer, settings):
    with pytest.raises(TypeError):
        writer.write(
            credential=token_for(writer.settings, "Scout"),
            table="applications",
            operation="insert",
            idempotency_key="no-hook",
            payload={"role_title": "Operator", "status": "Interested"},
            commit_hook=lambda _conn: None,
        )
    writer.write(
        credential=token_for(writer.settings, "Scout"),
        table="applications",
        operation="insert",
        idempotency_key="rollback-app",
        payload={
            "role_title": "Operator",
            "status": "Interested",
            "notion_id": "synthetic-notion-1",
            "raw_company": "Fictional Widgets LLC",
        },
    )
    with pytest.raises(PermanentWriteError):
        writer.write(
            credential=token_for(writer.settings, "Scout"),
            table="applications",
            operation="insert",
            idempotency_key="rollback-dup",
            payload={
                "role_title": "Other",
                "status": "Applied",
                "notion_id": "synthetic-notion-1",
            },
        )
    conn = connect(settings.db_path)
    try:
        assert conn.execute("SELECT COUNT(*) FROM applications").fetchone()[0] == 1
        assert conn.execute("SELECT COUNT(*) FROM application_status_history").fetchone()[0] == 1
        assert conn.execute("SELECT persistent FROM errors").fetchone()["persistent"] == 1
    finally:
        conn.close()
    follow = writer.write(
        credential=token_for(writer.settings, "Scout"),
        table="companies",
        operation="insert",
        idempotency_key="after-rollback",
        payload={"name": "Still Writing"},
    )
    assert follow.replayed is False


def test_unknown_foreign_key_rolls_back(writer, settings):
    with pytest.raises(PermanentWriteError):
        writer.write(
            credential=token_for(writer.settings, "Ledger"),
            table="transactions",
            operation="insert",
            idempotency_key="missing-account",
            payload={"account_id": str(uuid.uuid4()), "amount_cents": 100, "date": "2026-04-02"},
        )
    conn = connect(settings.db_path)
    try:
        assert conn.execute("SELECT COUNT(*) FROM transactions").fetchone()[0] == 0
    finally:
        conn.close()


def test_company_link_is_exact_and_raw_text_is_kept(writer, settings):
    north = writer.write(
        credential=token_for(writer.settings, "Scout"),
        table="companies",
        operation="insert",
        idempotency_key="co-north",
        payload={"name": "Northwind Labs"},
    ).row_id
    writer.write(
        credential=token_for(writer.settings, "Scout"),
        table="companies",
        operation="insert",
        idempotency_key="co-twin-a",
        payload={"name": "Twin Co"},
    )
    writer.write(
        credential=token_for(writer.settings, "Scout"),
        table="companies",
        operation="insert",
        idempotency_key="co-twin-b",
        payload={"name": "Twin Co"},
    )
    contact = writer.write(
        credential=token_for(writer.settings, "Scout"),
        table="contacts",
        operation="insert",
        idempotency_key="contact-riley",
        payload={"name": "Riley Example", "company_id": north, "email": "riley.example@example.com"},
    ).row_id
    linked = writer.write(
        credential=token_for(writer.settings, "Scout"),
        table="applications",
        operation="insert",
        idempotency_key="app-linked",
        payload={
            "role_title": "Data generalist",
            "status": "Applied",
            "raw_company": "Northwind Labs",
            "raw_contact": "Riley Example",
            "raw_status": "applied",
            "raw_source": "example board",
            "event_kind": "transition",
        },
    ).row_id
    ambiguous = writer.write(
        credential=token_for(writer.settings, "Scout"),
        table="applications",
        operation="insert",
        idempotency_key="app-ambiguous",
        payload={
            "role_title": "Operator",
            "status": "Interested",
            "raw_company": "Twin Co",
            "raw_contact": "  Nobody  ",
            "raw_status": "saved",
        },
    ).row_id
    baseline = writer.write(
        credential=token_for(writer.settings, "Scout"),
        table="applications",
        operation="insert",
        idempotency_key="app-baseline",
        payload={
            "role_title": "Studio coordinator",
            "status": "Interested",
            "raw_company": "Lumen & Co",
            "event_kind": "migration_baseline",
            "occurred_at": "2026-01-05T12:00:00Z",
        },
    ).row_id
    writer.write(
        credential=token_for(writer.settings, "Scout"),
        table="applications",
        operation="update",
        idempotency_key="app-baseline-next",
        payload={"id": baseline, "status": "Applied", "event_kind": "transition"},
    )
    conn = connect(settings.db_path)
    try:
        row = conn.execute("SELECT * FROM applications WHERE id = ?", (linked,)).fetchone()
        assert row["company_id"] == north
        assert row["contact_id"] == contact
        assert row["raw_status"] == "applied"
        assert row["raw_source"] == "example board"
        other = conn.execute("SELECT company_id, contact_id, raw_company, raw_contact FROM applications WHERE id = ?", (ambiguous,)).fetchone()
        assert other["company_id"] is None
        assert other["contact_id"] is None
        assert other["raw_company"] == "Twin Co"
        assert other["raw_contact"] == "  Nobody  "
        kinds = [
            item["event_kind"]
            for item in conn.execute(
                "SELECT event_kind FROM application_status_history WHERE application_id = ? ORDER BY occurred_at",
                (baseline,),
            )
        ]
        assert kinds == ["migration_baseline", "transition"]
    finally:
        conn.close()
