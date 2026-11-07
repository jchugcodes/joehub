"""Integer-cent money helpers used by the dashboard and tests."""

from __future__ import annotations

import re
from decimal import Decimal, InvalidOperation

from joehub.errors import ValidationError

_DOLLARS = re.compile(r"^-?\d+(\.\d{1,2})?$")


def dollars_to_cents(text: str) -> int:
    raw = text.strip()
    if not _DOLLARS.fullmatch(raw):
        raise ValidationError("enter a dollar amount with at most 2 decimal places")
    try:
        cents = (Decimal(raw) * 100).quantize(Decimal("1"))
    except InvalidOperation as exc:
        raise ValidationError("enter a dollar amount with at most 2 decimal places") from exc
    return int(cents)


def format_cents(cents: int) -> str:
    sign = "-" if cents < 0 else ""
    absolute = abs(int(cents))
    return f"{sign}${absolute // 100:,}.{absolute % 100:02d}"
