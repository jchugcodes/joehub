"""Operator credential and principal rows.

The database stores SHA-256 digests. The only plaintext joehub writes is the
human operator token, in one mode-600 file. There is no lookup that returns an
owner or bot token by name, and owner plaintext is not kept on disk.

On one shared OS user that file is readable by every process. It does not
enforce bot identity. The socket daemon does not accept it. See
``docs/TRUST_BOUNDARY.md``.
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
from joehub.db import _maintenance_connect, connect, migrate
from joehub.errors import JoehubError, UnauthorizedError
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


def operator_token_path(settings: Settings) -> Path:
    return settings.key_dir / "principals" / f"{HUMAN_NAME}.token"


def token_digest(credential: str) -> str:
    return hashlib.sha256(credential.encode("utf-8")).hexdigest()


def ensure_principals(settings: Settings) -> None:
    """Create the human row and the three owner rows when they are missing.

    Owner plaintext is discarded. A missing operator token is not replaced
    here: that would not match a restored hash. Restore from the encrypted
    exports with the age key instead.
    """
    migrate(settings.db_path)
    directory = settings.key_dir / "principals"
    directory.mkdir(parents=True, mode=0o700, exist_ok=True)
    os.chmod(directory, 0o700)
    conn = _maintenance_connect(settings.db_path)
    try:
        conn.execute("BEGIN IMMEDIATE")
        _ensure_operator(conn, settings)
        for name in OWNER_NAMES:
            _ensure_owner_row(conn, name)
        conn.commit()
    except Exception:
        try:
            conn.rollback()
        except sqlite3.Error:
            pass
        raise
    finally:
        conn.close()


def operator_token(settings: Settings) -> str:
    """Read the operator token only. Names of other principals are not accepted."""
    ensure_principals(settings)
    path = operator_token_path(settings)
    if not path.is_file():
        raise UnauthorizedError("operator credential is not provisioned")
    os.chmod(path, 0o600)
    return path.read_text(encoding="utf-8").strip()


def install_operator_token(settings: Settings, credential: str) -> None:
    """Atomically replace the operator token file. Callers must not log the value."""
    write_token_file(operator_token_path(settings), credential)


def write_token_file(path: Path, credential: str) -> None:
    """Atomically replace a token file and fsync it and its directory."""
    if not isinstance(credential, str) or credential.strip() == "" or credential != credential.strip():
        raise JoehubError("refusing to install an empty operator credential")
    path.parent.mkdir(parents=True, mode=0o700, exist_ok=True)
    os.chmod(path.parent, 0o700)
    temporary = path.with_name(f".{path.name}.{uuid.uuid4().hex}")
    fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    try:
        os.write(fd, (credential + "\n").encode("utf-8"))
        os.fsync(fd)
    except Exception:
        os.close(fd)
        if temporary.exists():
            temporary.unlink()
        raise
    os.close(fd)
    os.chmod(temporary, 0o600)
    os.replace(temporary, path)
    os.chmod(path, 0o600)
    dir_fd = os.open(path.parent, os.O_RDONLY)
    try:
        os.fsync(dir_fd)
    finally:
        os.close(dir_fd)


def reprovision_principals(
    conn: sqlite3.Connection,
    settings: Settings,
    *,
    authenticated_by_age_key: bool,
) -> str | None:
    """Issue a new operator token when the on-disk token is missing or stale.

    Restore calls this only after the age key has decrypted the exports. No
    previous token file is required. Principal ids, names, kinds, owner names,
    ``notion_id``, and ``migrated_on`` stay. Every principal hash is rotated so
    a leftover owner token file stops matching. Only the operator plaintext is
    returned; owner plaintext is discarded. The caller writes the operator file
    after the restored database is in place.

    Returns None when the current operator file already matches the row.
    """
    if not authenticated_by_age_key:
        raise JoehubError("reprovisioning requires the age identity that decrypted the exports")
    rows = list(conn.execute("SELECT * FROM principals ORDER BY name"))
    operator = next((row for row in rows if row["name"] == HUMAN_NAME), None)
    if operator is None:
        raise JoehubError("restored database has no operator principal")
    path = operator_token_path(settings)
    if path.is_file():
        current = path.read_text(encoding="utf-8").strip()
        if current and hmac.compare_digest(token_digest(current), str(operator["token_sha256"])):
            return None
    now = utcnow()
    minted: str | None = None
    for row in rows:
        token = "jht_" + secrets.token_urlsafe(32)
        conn.execute(
            """
            UPDATE principals
            SET token_sha256 = ?, last_modified_by = 'restore', last_modified_at = ?
            WHERE id = ?
            """,
            (token_digest(token), now, row["id"]),
        )
        if row["name"] == HUMAN_NAME:
            minted = token
    if minted is None:
        raise JoehubError("restored database has no operator principal")
    return minted


def principal_by_name(settings: Settings, name: str) -> Principal | None:
    """Load one principal row by its stored name. This does not authenticate anyone."""
    conn = connect(settings.db_path)
    try:
        row = conn.execute(
            "SELECT id, name, kind, owner_name FROM principals WHERE name = ?",
            (name,),
        ).fetchone()
    finally:
        conn.close()
    if row is None:
        return None
    return Principal(
        id=str(row["id"]),
        name=str(row["name"]),
        kind=str(row["kind"]),
        owner_name=None if row["owner_name"] is None else str(row["owner_name"]),
    )


def resolve_credential(settings: Settings, credential: object) -> Principal:
    if not isinstance(credential, str) or credential.strip() != credential or len(credential) < 20:
        raise UnauthorizedError("writer credential was not issued by the server")
    if credential in OWNER_NAMES or credential == HUMAN_NAME:
        raise UnauthorizedError("an owner name is not a writer credential")
    digest = token_digest(credential)
    conn = connect(settings.db_path)
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


def _ensure_operator(conn: sqlite3.Connection, settings: Settings) -> None:
    existing = conn.execute("SELECT id, token_sha256 FROM principals WHERE name = ?", (HUMAN_NAME,)).fetchone()
    path = operator_token_path(settings)
    if existing is None:
        if path.exists():
            os.chmod(path, 0o600)
            credential = path.read_text(encoding="utf-8").strip()
        else:
            credential = "jht_" + secrets.token_urlsafe(32)
            _write_new_token(path, credential)
        _insert_principal(conn, HUMAN_NAME, "human", None, token_digest(credential))
        return
    if not path.exists():
        raise JoehubError(
            "operator token is missing; restore the encrypted exports with the age key to reprovision"
        )


def _ensure_owner_row(conn: sqlite3.Connection, name: str) -> None:
    existing = conn.execute("SELECT id FROM principals WHERE name = ?", (name,)).fetchone()
    if existing is not None:
        return
    # Discard the plaintext. Cooperative mode does not keep owner bearer files.
    credential = "jht_" + secrets.token_urlsafe(32)
    _insert_principal(conn, name, "owner", name, token_digest(credential))


def _insert_principal(
    conn: sqlite3.Connection,
    name: str,
    kind: str,
    owner_name: str | None,
    digest: str,
) -> None:
    now = utcnow()
    conn.execute(
        """
        INSERT INTO principals (
            id, notion_id, migrated_on, last_modified_by, last_modified_at,
            name, kind, owner_name, token_sha256
        ) VALUES (?, NULL, NULL, 'system', ?, ?, ?, ?, ?)
        """,
        (str(uuid.uuid4()), now, name, kind, owner_name, digest),
    )


def _write_new_token(path: Path, credential: str) -> None:
    path.parent.mkdir(parents=True, mode=0o700, exist_ok=True)
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as handle:
        handle.write(credential + "\n")
    os.chmod(path, 0o600)
