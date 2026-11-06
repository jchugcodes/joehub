"""Dashboard password hashes. The hash comes from the environment or a file outside the repo."""

from __future__ import annotations

import hashlib
import hmac
import secrets

from joehub.config import Settings, load_settings
from joehub.errors import AuthConfigError, ValidationError


def hash_password(password: str) -> str:
    if not isinstance(password, str) or password == "":
        raise ValidationError("password must be non-empty")
    salt = secrets.token_bytes(16)
    n, r, p = 2**14, 8, 1
    digest = hashlib.scrypt(password.encode("utf-8"), salt=salt, n=n, r=r, p=p, dklen=32)
    return f"scrypt${n}${r}${p}${salt.hex()}${digest.hex()}"


def verify_password(password: str, stored: str) -> bool:
    try:
        algo, n_raw, r_raw, p_raw, salt_hex, hash_hex = stored.strip().split("$")
        if algo != "scrypt":
            return False
        n, r, p = int(n_raw), int(r_raw), int(p_raw)
        if n > 2**16 or n < 2 or r < 1 or r > 16 or p < 1 or p > 4:
            return False
        expected = bytes.fromhex(hash_hex)
        salt = bytes.fromhex(salt_hex)
        digest = hashlib.scrypt(password.encode("utf-8"), salt=salt, n=n, r=r, p=p, dklen=len(expected))
        return hmac.compare_digest(digest, expected)
    except (ValueError, TypeError, AttributeError):
        return False


def load_password_hash(settings: Settings | None = None) -> str:
    settings = settings or load_settings()
    if settings.auth_hash:
        return settings.auth_hash.strip()
    path = settings.auth_hash_file
    if path.is_file():
        data = path.read_text(encoding="utf-8").strip()
        if not data:
            raise AuthConfigError("password hash file is empty")
        return data
    raise AuthConfigError(
        "Set JOEHUB_AUTH_HASH or create the hash file with scripts/hash_password.py before starting the dashboard."
    )
