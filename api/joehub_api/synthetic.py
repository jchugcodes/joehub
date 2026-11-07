"""Load the shared synthetic fixture file. No database and no secrets."""

from __future__ import annotations

import json
from pathlib import Path

from joehub_api.models import (
    AccountBalance,
    ApplicationRow,
    EventRow,
    JournalEntry,
    StatusCount,
    TransactionRow,
)


def fixtures_path() -> Path:
    return Path(__file__).resolve().parents[2] / "contract" / "fixtures.json"


def load_fixtures(path: Path | None = None) -> dict[str, list[dict]]:
    source = path or fixtures_path()
    data = json.loads(source.read_text(encoding="utf-8"))
    for row in data["accounts"]:
        AccountBalance.model_validate(row)
    for row in data["transactions"]:
        TransactionRow.model_validate(row)
    for row in data["applications"]:
        ApplicationRow.model_validate(row)
    for row in data["statuses"]:
        StatusCount.model_validate(row)
    for row in data["entries"]:
        JournalEntry.model_validate(row)
    for row in data["events"]:
        EventRow.model_validate(row)
    return data
