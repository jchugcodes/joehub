"""Exception types for joehub."""

from __future__ import annotations


class JoehubError(Exception):
    """Base error for expected joehub failures."""


class ConfigError(JoehubError):
    """Runtime configuration is missing or points at a forbidden path."""


class PrivacyError(JoehubError):
    """Export push refused because the destination is not a private GitHub repo."""


class AuthConfigError(JoehubError):
    """Dashboard password hash is not configured."""


class TransientWriteError(JoehubError):
    """Write failed for a reason that bounded retry may clear (lock, busy database)."""


class PermanentWriteError(JoehubError):
    """Write failed and must be recorded. The same idempotency key will not be reapplied."""


class ValidationError(PermanentWriteError):
    """Payload failed field, type, or relationship checks."""


class UnauthorizedError(PermanentWriteError):
    """Caller is not the owner of the target table, or is not an allowed owner."""
