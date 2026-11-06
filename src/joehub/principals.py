"""Server-side writer credentials.

Tokens are random, stored only as SHA-256 in the database, and the plaintext
lives in the key directory (mode 600). A caller-supplied owner name is not a
credential. Human edits require an explicit delegation row. Bot principals
cannot write.
"""

from __future__ import annotations

import hashlib
import hmac
import os
import secrets
import sqlite3
import uuid
from dataclasses import dataclass
from pathlib import Path

from joehub.config import Settings
from joehub.db import connect_writer
from joehub.errors import UnauthorizedError
from joehub.util import utcnow

HUMAN_NAME = "operator"
OWNER_NAMES = ("Ledger", "Scout", "Cato")
_DUMMY_HASH = "0" * 64


@dataclass(frozen=True)
class Principal:
    id: str
    name: str
    kind: str
    owner_name: str | None


def token_path(settings: Settings, name: str) -> Path:
    return settings.key_dir / "principals" / f"{name}.token"


def token_digest(credential: str) -> str:
    return hashlib.sha256(credential.encode("utf-8")).hexdigest()


def ensure_principals(settings: Settings) -> None:
    """Create the human and the three owner principals when they are missing."""
    directory = settings.key_dir / "principals"
    directory.mkdir(parents=True, mode=0o700, exist_ok=True)
    os.chmod(directory, 0o700)
    conn = connect_writer(settings.db_path)
    try:
        conn.execute("BEGIN IMMEDIATE")
        _ensure_one(conn, settings, HUMAN_NAME, "human", None)
        for name in OWNER_NAMES:
            _ensure_one(conn, settings, name, "owner", name)
        conn.commit()
    except Exception:
        try:
            conn.rollback()
        except sqlite3.Error:
            pass
        raise
    finally:
        conn.close()


def token_for(settings: Settings, name: str) -> str:
    """Read a provisioned token. Does not create a bot token or accept a name as a secret."""
    ensure_principals(settings)
    path = token_path(settings, name)
    if not path.is_file():
        raise UnauthorizedError("writer credential is not provisioned")
    return path.read_text(encoding="utf-8").strip()


def resolve_credential(settings: Settings, credential: object) -> Principal:
    if not isinstance(credential, str) or credential.strip() != credential or len(credential) < 20:
        raise UnauthorizedError("writer credential was not issued by the server")
    if credential in OWNER_NAMES or credential == HUMAN_NAME:
        raise UnauthorizedError("an owner name is not a writer credential")
    digest = token_digest(credential)
    conn = connect_writer(settings.db_path)
    try:
        row = conn.execute(
            "SELECT id, name, kind, owner_name, token_sha256 FROM principals WHERE token_sha256 = ?",
            (digest,),
        ).fetchone()
    finally:
        conn.close()
    presented = digest
    stored = row["token_sha256"] if row is not None else _DUMMY_HASH
    if not hmac.compare_digest(presented, stored) or row is None:
        raise UnauthorizedError("writer credential was not issued by the server")
    if row["kind"] == "bot":
        raise UnauthorizedError("bots cannot impersonate an owner")
    if row["kind"] not in {"human", "owner"}:
        raise UnauthorizedError("unknown principal")
    return Principal(
        id=str(row["id"]),
        name=str(row["name"]),
        kind=str(row["kind"]),
        owner_name=None if row["owner_name"] is None else str(row["owner_name"]),
    )


def _ensure_one(
    conn: sqlite3.Connection,
    settings: Settings,
    name: str,
    kind: str,
    owner_name: str | None,
) -> None:
    existing = conn.execute("SELECT id FROM principals WHERE name = ?", (name,)).fetchone()
    path = token_path(settings, name)
    if not path.exists():
        credential = "jht_" + secrets.token_urlsafe(32)
        fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            handle.write(credential + "\n")
        os.chmod(path, 0o600)
    else:
        os.chmod(path, 0o600)
        credential = path.read_text(encoding="utf-8").strip()
    if existing is not None:
        return
    now = utcnow()
    conn.execute(
        """
        INSERT INTO principals (
            id, notion_id, migrated_on, last_modified_by, last_modified_at,
            name, kind, owner_name, token_sha256
        ) VALUES (?, NULL, NULL, 'system', ?, ?, ?, ?, ?)
        """,
        (str(uuid.uuid4()), now, name, kind, owner_name, token_digest(credential)),
    )
