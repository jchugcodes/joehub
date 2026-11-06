"""SQLite connection helpers and migration runner.

``connect`` never returns a writable handle. Turning ``query_only`` off on that
handle still cannot write: an authorizer denies mutating statements. That is
not a principal boundary. A process running as the same OS user can open the
database file itself. See ``docs/TRUST_BOUNDARY.md``.

Every opener in this module also honors the restore maintenance gate. While a
handover is in progress, a new runtime cannot open the database that was just
swapped into place.
"""

from __future__ import annotations

import fcntl
import hmac
import json
import os
import re
import sqlite3
import uuid
from pathlib import Path

from joehub.errors import JoehubError
from joehub.util import quote_ident, utcnow

MIGRATION_ACTOR = "system"

_ADD_COLUMN = re.compile(
    r"""^ALTER\s+TABLE\s+"?([A-Za-z_][A-Za-z0-9_]*)"?\s+ADD\s+COLUMN\s+"?([A-Za-z_][A-Za-z0-9_]*)"?\b""",
    re.IGNORECASE | re.DOTALL,
)

_WRITE_ACTIONS = frozenset(
    {
        sqlite3.SQLITE_INSERT,
        sqlite3.SQLITE_UPDATE,
        sqlite3.SQLITE_DELETE,
        sqlite3.SQLITE_DROP_TABLE,
        sqlite3.SQLITE_DROP_INDEX,
        sqlite3.SQLITE_DROP_TRIGGER,
        sqlite3.SQLITE_DROP_VIEW,
        sqlite3.SQLITE_DROP_VTABLE,
        sqlite3.SQLITE_CREATE_INDEX,
        sqlite3.SQLITE_CREATE_TABLE,
        sqlite3.SQLITE_CREATE_TEMP_INDEX,
        sqlite3.SQLITE_CREATE_TEMP_TABLE,
        sqlite3.SQLITE_CREATE_TEMP_TRIGGER,
        sqlite3.SQLITE_CREATE_TEMP_VIEW,
        sqlite3.SQLITE_CREATE_TRIGGER,
        sqlite3.SQLITE_CREATE_VIEW,
        sqlite3.SQLITE_CREATE_VTABLE,
        sqlite3.SQLITE_ALTER_TABLE,
        sqlite3.SQLITE_REINDEX,
        sqlite3.SQLITE_ATTACH,
        sqlite3.SQLITE_DETACH,
    }
)


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


def maintenance_gate_path(db_path: Path) -> Path:
    return Path(str(db_path) + ".maintenance")


def maintenance_lock_path(db_path: Path) -> Path:
    return Path(str(db_path) + ".maintenance.lock")


def _read_gate(db_path: Path) -> dict | None:
    path = maintenance_gate_path(db_path)
    if not path.is_file():
        return None
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise JoehubError("database maintenance gate is unreadable; refusing to open") from exc
    if not isinstance(data, dict) or not isinstance(data.get("nonce"), str) or not data["nonce"]:
        raise JoehubError("database maintenance gate is unreadable; refusing to open")
    return data


def _nonce_matches(presented: str | None, nonce: str) -> bool:
    if presented is None or len(presented) != len(nonce):
        return False
    return hmac.compare_digest(presented, nonce)


def gate_owner_alive(db_path: Path) -> bool:
    """True when the process that opened the handover still holds its lock.

    ``flock`` is dropped by the kernel when that process dies, including a
    crash between installing the database and installing its credential.
    """
    path = maintenance_lock_path(db_path)
    if not path.exists():
        return False
    fd = os.open(path, os.O_RDWR)
    try:
        try:
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            return True
        fcntl.flock(fd, fcntl.LOCK_UN)
        return False
    finally:
        os.close(fd)


def _honor_maintenance_gate(db_path: Path, maintenance_token: str | None) -> None:
    gate = _read_gate(db_path)
    if gate is None:
        return
    if _nonce_matches(maintenance_token, str(gate["nonce"])):
        return
    if gate_owner_alive(db_path):
        raise JoehubError("database is in a restore handover; refusing to open")
    from joehub.handover import recover_restore_handover

    recover_restore_handover(db_path)
    gate = _read_gate(db_path)
    if gate is None:
        return
    if _nonce_matches(maintenance_token, str(gate["nonce"])):
        return
    raise JoehubError("database is in a restore handover; refusing to open")


def _open(db_path: Path, *, maintenance_token: str | None = None) -> sqlite3.Connection:
    _honor_maintenance_gate(db_path, maintenance_token)
    db_path.parent.mkdir(parents=True, mode=0o700, exist_ok=True)
    conn = sqlite3.connect(db_path, timeout=30, isolation_level=None)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA busy_timeout = 5000")
    return conn


def _deny_writes(action: int, _arg1: str | None, _arg2: str | None, _db_name: str | None, _source: str | None) -> int:
    if action in _WRITE_ACTIONS:
        return sqlite3.SQLITE_DENY
    return sqlite3.SQLITE_OK


def connect(db_path: Path) -> sqlite3.Connection:
    """Open a read-only connection.

    There is no writable switch. ``PRAGMA query_only = OFF`` does not make this
    connection able to write. Domain changes go through ``WriteLayer``.
    """
    conn = _open(db_path)
    conn.execute("PRAGMA query_only = ON")
    conn.set_authorizer(_deny_writes)
    return conn


def _maintenance_connect(db_path: Path, *, maintenance_token: str | None = None) -> sqlite3.Connection:
    """Writable connection for migrations, the write layer, and restore.

    Not an authorization boundary and not part of the supported writer API.
    Same-user processes are not isolated from the database file. The
    maintenance token only lets the restore handover open the database it
    already locked; it does not grant a client a principal.
    """
    conn = _open(db_path, maintenance_token=maintenance_token)
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


def _statements(script: str) -> list[str]:
    statements: list[str] = []
    buffer = ""
    for line in script.splitlines():
        if not buffer and line.strip().startswith("--"):
            continue
        buffer += line + "\n"
        if sqlite3.complete_statement(buffer):
            text = buffer.strip()
            buffer = ""
            if text and not text.startswith("--"):
                statements.append(text)
    leftover = buffer.strip()
    if leftover:
        raise RuntimeError("migration has an incomplete SQL statement")
    return statements


def _column_exists(conn: sqlite3.Connection, table: str, column: str) -> bool:
    rows = conn.execute(f"PRAGMA table_info({quote_ident(table)})").fetchall()
    return any(row["name"] == column for row in rows)


def _execute_statement(conn: sqlite3.Connection, statement: str) -> None:
    match = _ADD_COLUMN.match(statement.strip())
    if match is not None and _column_exists(conn, match.group(1), match.group(2)):
        return
    conn.execute(statement)


def _apply_file(conn: sqlite3.Connection, path: Path) -> None:
    script = path.read_text(encoding="utf-8")
    upper = script.upper()
    if "DROP TABLE" in upper or "DROP INDEX" in upper:
        raise RuntimeError(f"{path.name} drops objects; joehub migrations are append-only")
    statements = [
        statement
        for statement in _statements(script)
        if not statement.upper().startswith("PRAGMA")
    ]
    conn.execute("BEGIN IMMEDIATE")
    try:
        for statement in statements:
            _execute_statement(conn, statement)
        now = utcnow()
        conn.execute(
            """
            INSERT INTO schema_migrations (
                id, notion_id, migrated_on, last_modified_by, last_modified_at, version, applied_at
            ) VALUES (?, NULL, NULL, ?, ?, ?, ?)
            """,
            (str(uuid.uuid4()), MIGRATION_ACTOR, now, path.name, now),
        )
        conn.commit()
    except Exception:
        try:
            conn.rollback()
        except sqlite3.Error:
            pass
        raise


def migrate(db_path: Path) -> None:
    """Apply migrations one file at a time.

    Each file's statements and its ``schema_migrations`` row commit together.
    A crash rolls that file back, so the next start can run it again. Callers
    are serialized on a lock file so two first starts cannot interleave.
    ``ALTER TABLE ... ADD COLUMN`` is skipped when the column is already there,
    so a database left mid-upgrade by an older runner can start.
    """
    db_path.parent.mkdir(parents=True, mode=0o700, exist_ok=True)
    lock_path = Path(str(db_path) + ".migrate.lock")
    with lock_path.open("a", encoding="utf-8") as handle:
        fcntl.flock(handle.fileno(), fcntl.LOCK_EX)
        try:
            conn = _maintenance_connect(db_path)
            try:
                conn.execute("PRAGMA foreign_keys = ON")
                applied = _applied_versions(conn)
                for path in sorted(migrations_dir().glob("*.sql")):
                    if path.name in applied:
                        continue
                    _apply_file(conn, path)
                    applied.add(path.name)
            finally:
                conn.close()
        finally:
            fcntl.flock(handle.fileno(), fcntl.LOCK_UN)


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
