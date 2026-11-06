"""Test helper for the cooperative operator credential.

Production code has no function that loads an arbitrary principal token.
"""

from __future__ import annotations

import secrets

from joehub.config import Settings
from joehub.db import _maintenance_connect
from joehub.principals import ensure_principals, operator_token, token_digest
from joehub.write import WriteLayer

_delegated: set[tuple[str, str]] = set()


def credential(settings: Settings, owner: str) -> str:
    """Operator token plus an explicit delegation to ``owner``."""
    token = operator_token(settings)
    key = (str(settings.db_path), owner)
    if key not in _delegated:
        layer = WriteLayer(settings, recover=False)
        try:
            layer.delegate(token, owner)
        finally:
            layer.close()
        _delegated.add(key)
    return token


def bind_owner_secret(settings: Settings, name: str) -> str:
    """Point an owner row at a secret this test holds.

    This uses the maintenance connection on purpose: same-user code can write
    the database file. joehub does not offer a token lookup by name.
    """
    ensure_principals(settings)
    secret = "jht_" + secrets.token_urlsafe(32)
    conn = _maintenance_connect(settings.db_path)
    try:
        conn.execute("BEGIN IMMEDIATE")
        updated = conn.execute(
            """
            UPDATE principals SET token_sha256 = ?
            WHERE name = ? AND kind = 'owner'
            """,
            (token_digest(secret), name),
        )
        if updated.rowcount != 1:
            conn.rollback()
            raise RuntimeError(f"no owner principal named {name}")
        conn.commit()
    finally:
        conn.close()
    return secret
