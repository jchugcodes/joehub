#!/usr/bin/env python3
"""Load a fictional dataset. Safe to run again: each row uses a stable idempotency key.

Nothing in this file is a real person, account, application, or credential.
"""

from __future__ import annotations

import sys
import uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from joehub.config import load_settings  # noqa: E402
from joehub.db import connect, migrate  # noqa: E402
from joehub.errors import JoehubError  # noqa: E402
from joehub.principals import token_for  # noqa: E402
from joehub.write import WriteLayer  # noqa: E402

NS = uuid.UUID("6f9d8a2e-1c4b-4f0a-9d3e-8a1b2c3d4e5f")


def sid(name: str) -> str:
    return str(uuid.uuid5(NS, name))


def write(
    layer: WriteLayer,
    tokens: dict[str, str],
    *,
    owner: str,
    table: str,
    slug: str,
    payload: dict,
    operation: str = "insert",
) -> bool:
    result = layer.write(
        credential=tokens[owner],
        table=table,
        operation=operation,
        payload=payload,
        idempotency_key=f"seed:{table}:{slug}",
    )
    return result.replayed


def main() -> int:
    settings = load_settings()
    migrate(settings.db_path)
    layer = WriteLayer(settings)
    tokens = {name: token_for(settings, name) for name in ("Ledger", "Scout", "Cato")}
    replayed = 0
    total = 0

    def add(owner: str, table: str, slug: str, payload: dict, operation: str = "insert") -> None:
        nonlocal replayed, total
        total += 1
        if write(layer, tokens, owner=owner, table=table, slug=slug, payload=payload, operation=operation):
            replayed += 1

    pay = sid("cat:pay")
    rent = sid("cat:rent")
    groceries = sid("cat:groceries")
    transit = sid("cat:transit")
    fun = sid("cat:fun")
    for slug, name, kind in (
        ("pay", "Pay", "income"),
        ("rent", "Rent", "expense"),
        ("groceries", "Groceries", "expense"),
        ("transit", "Transit", "expense"),
        ("fun", "Fun", "expense"),
    ):
        add("Ledger", "categories", slug, {"id": sid(f"cat:{slug}"), "name": name, "kind": kind})

    checking = sid("acct:checking")
    savings = sid("acct:savings")
    brokerage = sid("acct:brokerage")
    add(
        "Ledger",
        "accounts",
        "checking",
        {
            "id": checking,
            "name": "Everyday Checking",
            "account_type": "checking",
            "institution": "Example Harbor Credit Union",
        },
    )
    add(
        "Ledger",
        "accounts",
        "savings",
        {
            "id": savings,
            "name": "Safety Savings",
            "account_type": "savings",
            "institution": "Example Harbor Credit Union",
        },
    )
    add(
        "Ledger",
        "accounts",
        "brokerage",
        {
            "id": brokerage,
            "name": "Paper Brokerage",
            "account_type": "investment",
            "institution": "Northline Paper Brokerage",
        },
    )

    emergency = sid("goal:emergency")
    trip = sid("goal:trip")
    add(
        "Ledger",
        "goals",
        "emergency",
        {
            "id": emergency,
            "name": "Synthetic emergency fund",
            "target_cents": 500_000,
            "current_cents": 120_000,
            "target_date": "2027-01-01",
            "account_id": savings,
        },
    )
    add(
        "Ledger",
        "goals",
        "trip",
        {
            "id": trip,
            "name": "Fictional weekend trip",
            "target_cents": 80_000,
            "current_cents": 15_000,
            "target_date": "2026-08-01",
            "account_id": checking,
        },
    )
    add(
        "Ledger",
        "budgets",
        "groceries",
        {
            "id": sid("budget:groceries"),
            "name": "Groceries",
            "category_id": groceries,
            "period": "monthly",
            "amount_cents": 40_000,
            "start_date": "2026-01-01",
            "end_date": "2026-12-31",
        },
    )
    add(
        "Ledger",
        "budgets",
        "fun",
        {
            "id": sid("budget:fun"),
            "name": "Fun",
            "category_id": fun,
            "period": "monthly",
            "amount_cents": 15_000,
            "start_date": "2026-01-01",
        },
    )

    transactions = [
        ("pay-jan", checking, pay, 320_000, "2026-01-15", "Example Harbor Payroll", "Synthetic paycheck"),
        ("rent-jan", checking, rent, -145_000, "2026-01-02", "Port Example Rentals", "Synthetic rent"),
        ("groceries-1", checking, groceries, -6_450, "2026-01-08", "Corner Market", 'Cafe, "synthetic"'),
        ("transit-1", checking, transit, -250, "2026-01-09", "City Loop", None),
        ("fun-1", checking, fun, -1_800, "2026-01-18", "Paper Cinema", None),
        ("save-jan", savings, None, 20_000, "2026-01-16", "Transfer in", "From checking, fictional"),
        ("pay-feb", checking, pay, 320_000, "2026-02-15", "Example Harbor Payroll", "Synthetic paycheck"),
        ("rent-feb", checking, rent, -145_000, "2026-02-02", "Port Example Rentals", "Synthetic rent"),
        ("groceries-2", checking, groceries, -7_125, "2026-02-11", "Corner Market", None),
        ("broker-1", brokerage, None, 50_000, "2026-02-20", "Paper Brokerage", "Synthetic deposit"),
        ("trip-save", checking, fun, -5_000, "2026-03-01", "Trip jar", None),
        ("groceries-3", checking, groceries, -5_990, "2026-03-04", "Corner Market", None),
    ]
    for slug, account_id, category_id, cents, day, payee, memo in transactions:
        payload = {
            "id": sid(f"tx:{slug}"),
            "account_id": account_id,
            "amount_cents": cents,
            "date": day,
            "payee": payee,
            "memo": memo,
        }
        if category_id:
            payload["category_id"] = category_id
        if slug == "trip-save":
            payload["goal_id"] = trip
        add("Ledger", "transactions", slug, payload)

    northwind = sid("co:northwind")
    paperplane = sid("co:paperplane")
    lumen = sid("co:lumen")
    add("Scout", "companies", "northwind", {"id": northwind, "name": "Northwind Labs", "website": "https://example.com/northwind"})
    add(
        "Scout",
        "companies",
        "paperplane",
        {"id": paperplane, "name": "Paperplane Analytics", "website": "https://example.com/paperplane"},
    )
    add("Scout", "companies", "lumen", {"id": lumen, "name": "Lumen & Co", "notes": "Fictional studio"})

    riley = sid("contact:riley")
    jordan = sid("contact:jordan")
    add(
        "Scout",
        "contacts",
        "riley",
        {
            "id": riley,
            "company_id": northwind,
            "name": "Riley Example",
            "email": "riley.example@example.com",
            "role": "Recruiter",
        },
    )
    add(
        "Scout",
        "contacts",
        "jordan",
        {
            "id": jordan,
            "company_id": paperplane,
            "name": "Jordan Example",
            "email": "jordan.example@example.com",
            "role": "Hiring manager",
        },
    )

    add(
        "Scout",
        "applications",
        "northwind",
        {
            "id": sid("app:northwind"),
            "company_id": northwind,
            "contact_id": riley,
            "role_title": "Data generalist",
            "status": "Applied",
            "applied_on": "2026-01-20",
            "raw_company": "Northwind Labs",
            "raw_contact": "Riley Example",
            "raw_status": "applied",
            "raw_source": "example jobs board",
            "notes": "Synthetic application. Not a real employer.",
            "event_kind": "transition",
            "occurred_at": "2026-01-20T16:00:00Z",
        },
    )
    add(
        "Scout",
        "applications",
        "paperplane",
        {
            "id": sid("app:paperplane"),
            "role_title": "Analytics associate",
            "status": "Interviewing",
            "applied_on": "2026-02-03",
            "raw_company": "Paperplane Analytics",
            "raw_contact": "Jordan Example",
            "raw_status": "phone screen",
            "raw_source": "fictional referral",
            "event_kind": "transition",
        },
    )
    add(
        "Scout",
        "applications",
        "lumen",
        {
            "id": sid("app:lumen"),
            "role_title": "Studio coordinator",
            "status": "Interested",
            "raw_company": "Lumen & Co",
            "raw_status": "saved",
            "raw_source": "notebook",
            "event_kind": "migration_baseline",
            "occurred_at": "2026-01-05T12:00:00Z",
        },
    )
    add(
        "Scout",
        "applications",
        "lumen-applied",
        {"id": sid("app:lumen"), "status": "Applied", "event_kind": "transition", "occurred_at": "2026-02-02T15:00:00Z"},
        operation="update",
    )
    add(
        "Scout",
        "applications",
        "widgets",
        {
            "id": sid("app:widgets"),
            "role_title": "Operator",
            "status": "Passed",
            "raw_company": "Fictional Widgets LLC",
            "raw_contact": "Alex Example",
            "raw_status": "closed",
            "raw_source": "synthetic import",
            "notes": "No matching company row, so company_id stays empty.",
        },
    )

    add(
        "Cato",
        "events",
        "interview",
        {
            "id": sid("event:interview"),
            "title": "Synthetic interview block",
            "starts_at": "2026-02-12T18:00:00Z",
            "ends_at": "2026-02-12T19:00:00Z",
            "location": "Port Example",
            "notes": "Fictional calendar item.",
        },
    )
    add(
        "Cato",
        "events",
        "walk",
        {
            "id": sid("event:walk"),
            "title": "Synthetic evening walk",
            "starts_at": "2026-03-02T23:00:00Z",
            "location": "Example Harbor",
        },
    )
    add(
        "Cato",
        "journal_entries",
        "one",
        {
            "id": sid("journal:one"),
            "entry_date": "2026-01-21",
            "title": "Synthetic note",
            "body": "Synthetic entry.\nNot a real diary — São Paulo is fictional here.",
            "mood": "calm",
        },
    )
    add(
        "Cato",
        "journal_entries",
        "two",
        {
            "id": sid("journal:two"),
            "entry_date": "2026-02-14",
            "title": "Practice interview",
            "body": "Walked through fictional questions for Paperplane Analytics.",
            "mood": "focused",
        },
    )
    add(
        "Cato",
        "journal_entries",
        "three",
        {
            "id": sid("journal:three"),
            "entry_date": "2026-03-05",
            "title": "Budget check",
            "body": "Groceries stayed inside the synthetic monthly budget.",
        },
    )
    add(
        "Cato",
        "bot_activity",
        "seed",
        {
            "id": sid("bot:seed"),
            "bot_name": "joehub-seed",
            "action": "seed_complete",
            "occurred_at": "2026-03-06T00:00:00Z",
            "detail": "Loaded the fictional starter set.",
        },
    )

    conn = connect(settings.db_path)
    try:
        counts = {
            table: conn.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
            for table in ("transactions", "applications", "journal_entries", "application_status_history")
        }
    finally:
        conn.close()
    print(
        "seed complete:",
        f"{total} writes ({replayed} already present),",
        f"{counts['transactions']} transactions,",
        f"{counts['applications']} applications,",
        f"{counts['application_status_history']} status events,",
        f"{counts['journal_entries']} journal entries",
    )
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except JoehubError as exc:
        print(f"seed failed: {exc}", file=sys.stderr)
        raise SystemExit(1)
