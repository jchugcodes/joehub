"""Domain table specs. Ownership of each table is stored in table_registry and checked here."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

APPLICATION_STATUSES = (
    "Interested",
    "Applied",
    "Interviewing",
    "Offer",
    "Rejected",
    "Passed",
)
EVENT_KINDS = ("migration_baseline", "transition")
ALLOWED_OWNERS = ("Ledger", "Scout", "Cato")
HALL_PASS = "hall_pass"
OPERATIONS = ("insert", "update", "delete_request", "delete_confirm")

AUDIT_COLUMNS = (
    "id",
    "notion_id",
    "migrated_on",
    "last_modified_by",
    "last_modified_at",
)

_MISSING = object()


@dataclass(frozen=True)
class Field:
    name: str
    kind: str  # text, int, date, timestamp, uuid
    required: bool = False
    choices: tuple[str, ...] | None = None
    min_value: int | None = None
    default: Any = _MISSING
    references: str | None = None

    @property
    def has_default(self) -> bool:
        return self.default is not _MISSING


def _text(
    name: str,
    *,
    required: bool = False,
    choices: tuple[str, ...] | None = None,
    default: Any = _MISSING,
) -> Field:
    return Field(name, "text", required=required, choices=choices, default=default)


def _int(name: str, *, required: bool = False, min_value: int | None = None, default: Any = _MISSING) -> Field:
    return Field(name, "int", required=required, min_value=min_value, default=default)


def _date(name: str, *, required: bool = False) -> Field:
    return Field(name, "date", required=required)


def _ts(name: str, *, required: bool = False) -> Field:
    return Field(name, "timestamp", required=required)


def _uuid(name: str, *, required: bool = False, references: str | None = None) -> Field:
    return Field(name, "uuid", required=required, references=references)


# Column order is the on-disk order after the shared audit columns.
TABLES: dict[str, tuple[Field, ...]] = {
    "categories": (
        _text("name", required=True),
        _text("kind", required=True, choices=("income", "expense", "transfer")),
    ),
    "accounts": (
        _text("name", required=True),
        _text(
            "account_type",
            required=True,
            choices=("checking", "savings", "credit", "cash", "investment", "other"),
        ),
        _text("institution"),
        _text("currency", required=True, default="USD"),
    ),
    "budgets": (
        _text("name", required=True),
        _uuid("category_id", required=True, references="categories"),
        _uuid("account_id", references="accounts"),
        _text("period", required=True, choices=("weekly", "monthly", "yearly")),
        _int("amount_cents", required=True, min_value=0),
        _date("start_date", required=True),
        _date("end_date"),
    ),
    "goals": (
        _text("name", required=True),
        _int("target_cents", required=True, min_value=0),
        _int("current_cents", required=True, min_value=0, default=0),
        _date("target_date"),
        _uuid("account_id", references="accounts"),
        _text(
            "status",
            required=True,
            default="active",
            choices=("active", "paused", "completed", "cancelled"),
        ),
    ),
    "transactions": (
        _uuid("account_id", required=True, references="accounts"),
        _uuid("category_id", references="categories"),
        _uuid("goal_id", references="goals"),
        _int("amount_cents", required=True),
        _date("date", required=True),
        _text("payee"),
        _text("memo"),
    ),
    "companies": (
        _text("name", required=True),
        _text("website"),
        _text("notes"),
    ),
    "contacts": (
        _uuid("company_id", references="companies"),
        _text("name", required=True),
        _text("email"),
        _text("role"),
        _text("notes"),
    ),
    "applications": (
        _uuid("company_id", references="companies"),
        _uuid("contact_id", references="contacts"),
        _text("role_title", required=True),
        _text("status", required=True, choices=APPLICATION_STATUSES),
        _date("applied_on"),
        _text("notes"),
        _text("raw_company"),
        _text("raw_contact"),
        _text("raw_status"),
        _text("raw_source"),
    ),
    "application_status_history": (
        _uuid("application_id", required=True, references="applications"),
        _text("from_status", choices=APPLICATION_STATUSES),
        _text("to_status", required=True, choices=APPLICATION_STATUSES),
        _text("event_kind", required=True, choices=EVENT_KINDS),
        _ts("occurred_at", required=True),
        _text("note"),
    ),
    "events": (
        _text("title", required=True),
        _ts("starts_at", required=True),
        _ts("ends_at"),
        _text("location"),
        _text("notes"),
    ),
    "journal_entries": (
        _date("entry_date", required=True),
        _text("title"),
        _text("body", required=True),
        _text("mood"),
    ),
    "bot_activity": (
        _text("bot_name", required=True),
        _text("action", required=True),
        _ts("occurred_at", required=True),
        _text("detail"),
    ),
    "export_history": (
        _ts("started_at", required=True),
        _ts("finished_at"),
        _text("status", required=True, choices=("running", "succeeded", "failed")),
        _text("export_dir", required=True),
        _text("remote"),
        _text("push_status", choices=("pushed", "refused", "failed")),
        _text(
            "publication_state",
            choices=("not_requested", "pushed", "refused", "failed", "incomplete"),
        ),
        _text("detail"),
    ),
}

# Meta tables are registered to Cato so every table has one owner. The public
# write API does not accept them. Privileged maintenance (migrations, the hall
# pass, the queue, error rows, delegations, and restore) is the only writer.
META_TABLES = (
    "schema_migrations",
    "owners",
    "table_registry",
    "write_queue",
    "locks",
    "errors",
    "pending_deletes",
    "principals",
    "delegations",
)

TABLE_OWNERS = {
    "categories": "Ledger",
    "accounts": "Ledger",
    "budgets": "Ledger",
    "goals": "Ledger",
    "transactions": "Ledger",
    "companies": "Scout",
    "contacts": "Scout",
    "applications": "Scout",
    "application_status_history": "Scout",
    "events": "Cato",
    "journal_entries": "Cato",
    "bot_activity": "Cato",
    "export_history": "Cato",
    "schema_migrations": "Cato",
    "owners": "Cato",
    "table_registry": "Cato",
    "write_queue": "Cato",
    "locks": "Cato",
    "errors": "Cato",
    "pending_deletes": "Cato",
    "principals": "Cato",
    "delegations": "Cato",
}

APPLICATION_EXTRAS = frozenset({"event_kind", "occurred_at"})


def fields_by_name(table: str) -> dict[str, Field]:
    return {field.name: field for field in TABLES[table]}


def column_names(table: str) -> list[str]:
    """Full column order for a domain table, including audit columns."""
    return [*AUDIT_COLUMNS, *[field.name for field in TABLES[table]]]
