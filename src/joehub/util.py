"""Small shared helpers. No I/O."""

from __future__ import annotations

import re
import uuid
from datetime import datetime, timedelta, timezone

from joehub.errors import ValidationError

_TS_RE = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$")
_IDENT_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")


def utcnow() -> str:
    """UTC timestamp with second precision, lexicographically sortable."""
    return datetime.now(timezone.utc).replace(microsecond=0).strftime("%Y-%m-%dT%H:%M:%SZ")


def add_seconds(stamp: str, seconds: int) -> str:
    parsed = datetime.strptime(stamp, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)
    return (parsed + timedelta(seconds=seconds)).strftime("%Y-%m-%dT%H:%M:%SZ")


def canonical_uuid(value: object) -> str:
    if not isinstance(value, str):
        raise ValidationError("id must be a UUID string")
    try:
        parsed = uuid.UUID(value)
    except ValueError as exc:
        raise ValidationError("id must be a UUID string") from exc
    return str(parsed)


def quote_ident(name: str) -> str:
    if not isinstance(name, str) or not _IDENT_RE.fullmatch(name):
        raise ValidationError("invalid identifier")
    return '"' + name.replace('"', '""') + '"'


def is_timestamp(value: object) -> bool:
    if not isinstance(value, str) or not _TS_RE.fullmatch(value):
        return False
    try:
        datetime.strptime(value, "%Y-%m-%dT%H:%M:%SZ")
    except ValueError:
        return False
    return True
