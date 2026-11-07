"""Process settings for the public API.

The API never accepts a database path, an age identity, or an operator token.
Production refuses to start when dev auth is on or the session secret is missing.
"""

from __future__ import annotations

import os
from collections.abc import Mapping
from dataclasses import dataclass

SYNTHETIC_READ_CREDENTIAL = "synthetic-read"
MIN_SECRET_LENGTH = 16

FORBIDDEN_ENV = (
    "JOEHUB_DB_PATH",
    "JOEHUB_KEY_DIR",
    "JOEHUB_EXPORT_DIR",
    "JOEHUB_OPERATOR_TOKEN",
    "JOEHUB_AGE_IDENTITY",
    "JOEHUB_AUTH_HASH",
    "JOEHUB_AUTH_HASH_FILE",
)


class StartupError(RuntimeError):
    """The process must not serve traffic."""


@dataclass(frozen=True)
class ApiSettings:
    env: str
    dev_auth: bool
    fake_auth: bool
    session_secret: str
    read_credential: str

    @classmethod
    def from_env(cls, env: Mapping[str, str] | None = None) -> ApiSettings:
        source = os.environ if env is None else env
        return cls(
            env=source.get("JOEHUB_API_ENV", "development"),
            dev_auth=source.get("JOEHUB_DEV_AUTH") == "1",
            fake_auth=source.get("JOEHUB_FAKE_AUTH") == "1",
            session_secret=source.get("JOEHUB_SESSION_SECRET", ""),
            read_credential=source.get("JOEHUB_READ_CREDENTIAL", SYNTHETIC_READ_CREDENTIAL),
        )

    def check(self, env: Mapping[str, str]) -> None:
        for name in FORBIDDEN_ENV:
            if env.get(name):
                raise StartupError(
                    "refusing to start: database, age key, or operator settings are present"
                )
        dev_login = self.dev_auth or self.fake_auth
        secret_ok = len(self.session_secret) >= MIN_SECRET_LENGTH
        if self.env == "production":
            if dev_login or not secret_ok:
                raise StartupError(
                    "refusing to start: production forbids dev auth and requires a session secret"
                )
            placeholder = self.read_credential == SYNTHETIC_READ_CREDENTIAL
            if len(self.read_credential) < MIN_SECRET_LENGTH or placeholder:
                raise StartupError(
                    "refusing to start: production requires a scoped read credential"
                )
        elif dev_login and not secret_ok:
            raise StartupError("refusing to start: dev auth requires a session secret")
