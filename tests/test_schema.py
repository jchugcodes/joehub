from __future__ import annotations

import sqlite3
from pathlib import Path

from joehub.db import connect, _maintenance_connect, list_tables, migrate, migrations_dir, table_columns
from tests.acting import credential
from joehub.registry import AUDIT_COLUMNS, META_TABLES, TABLE_OWNERS, TABLES

EXPECTED_FKS = {
    ("table_registry", "owner_id", "owners"),
    ("delegations", "human_principal_id", "principals"),
    ("budgets", "category_id", "categories"),
    ("budgets", "account_id", "accounts"),
    ("goals", "account_id", "accounts"),
    ("transactions", "account_id", "accounts"),
    ("transactions", "category_id", "categories"),
    ("transactions", "goal_id", "goals"),
    ("contacts", "company_id", "companies"),
    ("applications", "company_id", "companies"),
    ("applications", "contact_id", "contacts"),
    ("application_status_history", "application_id", "applications"),
}


def test_migrations_are_append_only():
    files = list(migrations_dir().glob("*.sql"))
    assert files
    for path in files:
        text = path.read_text(encoding="utf-8").upper()
        assert "DROP TABLE" not in text
        assert "DROP INDEX" not in text


def test_schema_has_audit_columns_owners_and_foreign_keys(settings):
    migrate(settings.db_path)
    conn = connect(settings.db_path)
    try:
        tables = set(list_tables(conn))
        assert set(TABLES) | set(META_TABLES) == tables
        for table in tables:
            info = table_columns(conn, table)
            names = [row["name"] for row in info]
            assert names[0] == "id"
            for column in AUDIT_COLUMNS:
                assert column in names
            pk = [row["name"] for row in info if row["pk"]]
            assert pk == ["id"]
        found = set()
        for table in tables:
            for row in conn.execute(f"PRAGMA foreign_key_list({table})"):
                found.add((table, row["from"], row["table"]))
        assert found == EXPECTED_FKS
        owners = [row["name"] for row in conn.execute("SELECT name FROM owners ORDER BY name")]
        assert owners == ["Cato", "Ledger", "Scout"]
        registry = {
            row["table_name"]: row["owner_name"]
            for row in conn.execute(
                """
                SELECT table_registry.table_name, owners.name AS owner_name
                FROM table_registry JOIN owners ON owners.id = table_registry.owner_id
                """
            )
        }
        assert registry == TABLE_OWNERS
        amount = next(row for row in table_columns(conn, "transactions") if row["name"] == "amount_cents")
        date = next(row for row in table_columns(conn, "transactions") if row["name"] == "date")
        assert amount["notnull"] == 1
        assert date["notnull"] == 1
        status_sql = conn.execute(
            "SELECT sql FROM sqlite_master WHERE name = 'applications'"
        ).fetchone()["sql"]
        for status in ("Interested", "Applied", "Interviewing", "Offer", "Rejected", "Passed"):
            assert status in status_sql
        history_sql = conn.execute(
            "SELECT sql FROM sqlite_master WHERE name = 'application_status_history'"
        ).fetchone()["sql"]
        assert "migration_baseline" in history_sql
        assert "transition" in history_sql
    finally:
        conn.close()


def test_migrate_is_idempotent(settings):
    migrate(settings.db_path)
    migrate(settings.db_path)
    conn = connect(settings.db_path)
    try:
        assert conn.execute("SELECT COUNT(*) FROM owners").fetchone()[0] == 3
        assert conn.execute("SELECT COUNT(*) FROM schema_migrations").fetchone()[0] == 2
        assert conn.execute("PRAGMA foreign_key_check").fetchall() == []
    finally:
        conn.close()


def test_database_constraints_reject_bad_status_and_id_changes(writer, settings):
    created = writer.write(
        credential=credential(writer.settings, "Scout"),
        table="companies",
        operation="insert",
        idempotency_key="schema-co",
        payload={"name": "Constraint Labs"},
    )
    conn = _maintenance_connect(settings.db_path)
    try:
        with pytest_raises_integrity():
            conn.execute(
                """
                INSERT INTO applications (
                    id, notion_id, migrated_on, last_modified_by, last_modified_at,
                    role_title, status
                ) VALUES ('018f0000-0000-7000-8000-000000000201', NULL, NULL, 'Scout',
                          '2026-01-01T00:00:00Z', 'Role', 'Ghosted')
                """
            )
        with pytest_raises_integrity():
            conn.execute(
                "UPDATE companies SET id = '018f0000-0000-7000-8000-000000000299' WHERE id = ?",
                (created.row_id,),
            )
    finally:
        conn.close()


def pytest_raises_integrity():
    import pytest

    return pytest.raises(sqlite3.IntegrityError)


def test_migration_file_lives_at_repo_root():
    path = Path(migrations_dir())
    assert path.name == "migrations"
    assert (path / "001_initial.sql").is_file()
    assert (path / "002_writers_and_registry.sql").is_file()
