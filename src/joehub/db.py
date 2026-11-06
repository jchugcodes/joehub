"""SQLite connection helpers and migration runner."""

from __future__ import annotations

import sqlite3
import uuid
from pathlib import Path

from joehub.util import quote_ident, utcnow

MIGRATION_ACTOR = "system"


def migrations_dir() -> Path:
    here = Path(__file__).resolve()
    candidates = [
        here.parents[2] / "migrations",
        here.parents[1] / "migrations",
        Path.cwd() / "migrations",
    ]
    for candidate in candidates:
        if candidate.is_dir():
            return candidate
    raise FileNotFoundError("migrations directory not found")


def connect(db_path: Path) -> sqlite3.Connection:
    db_path.parent.mkdir(parents=True, mode=0o700, exist_ok=True)
    conn = sqlite3.connect(db_path, timeout=30, isolation_level=None)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA busy_timeout = 5000")
    conn.execute("PRAGMA journal_mode = WAL")
    conn.execute("PRAGMA synchronous = NORMAL")
    return conn


def _applied_versions(conn: sqlite3.Connection) -> set[str]:
    row = conn.execute(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'"
    ).fetchone()
    if row is None:
        return set()
    return {item["version"] for item in conn.execute("SELECT version FROM schema_migrations")}


def migrate(db_path: Path) -> None:
    """Apply SQL migrations in filename order. Migrations must not drop tables."""
    conn = connect(db_path)
    try:
        applied = _applied_versions(conn)
        for path in sorted(migrations_dir().glob("*.sql")):
            if path.name in applied:
                continue
            script = path.read_text(encoding="utf-8")
            upper = script.upper()
            if "DROP TABLE" in upper or "DROP INDEX" in upper:
                raise RuntimeError(f"{path.name} drops objects; joehub migrations are append-only")
            conn.executescript(script)
            now = utcnow()
            conn.execute(
                """
                INSERT INTO schema_migrations (
                    id, notion_id, migrated_on, last_modified_by, last_modified_at, version, applied_at
                ) VALUES (?, NULL, NULL, ?, ?, ?, ?)
                """,
                (str(uuid.uuid4()), MIGRATION_ACTOR, now, path.name, now),
            )
    finally:
        conn.close()


def list_tables(conn: sqlite3.Connection) -> list[str]:
    rows = conn.execute(
        """
        SELECT name FROM sqlite_master
        WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
        ORDER BY name
        """
    ).fetchall()
    return [row["name"] for row in rows]


def table_columns(conn: sqlite3.Connection, table: str) -> list[sqlite3.Row]:
    quoted = quote_ident(table)
    return list(conn.execute(f"PRAGMA table_info({quoted})"))
