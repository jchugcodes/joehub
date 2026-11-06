"""Read models for the dashboard. Writes do not go through this module."""

from __future__ import annotations

import sqlite3

from joehub.db import list_tables, table_columns
from joehub.errors import ValidationError
from joehub.util import quote_ident


def _dicts(rows: list[sqlite3.Row]) -> list[dict]:
    return [dict(row) for row in rows]


def account_balances(conn: sqlite3.Connection) -> list[dict]:
    rows = conn.execute(
        """
        SELECT accounts.id, accounts.name, accounts.account_type, accounts.institution,
               COALESCE(SUM(transactions.amount_cents), 0) AS balance_cents
        FROM accounts
        LEFT JOIN transactions ON transactions.account_id = accounts.id
        GROUP BY accounts.id
        ORDER BY accounts.name
        """
    ).fetchall()
    return _dicts(rows)


def net_worth_cents(conn: sqlite3.Connection) -> int:
    row = conn.execute("SELECT COALESCE(SUM(amount_cents), 0) AS total FROM transactions").fetchone()
    return int(row["total"])


def recent_transactions(conn: sqlite3.Connection, limit: int = 20) -> list[dict]:
    rows = conn.execute(
        """
        SELECT transactions.id, transactions.date, transactions.amount_cents, transactions.payee,
               transactions.memo, accounts.name AS account_name, categories.name AS category_name
        FROM transactions
        JOIN accounts ON accounts.id = transactions.account_id
        LEFT JOIN categories ON categories.id = transactions.category_id
        ORDER BY transactions.date DESC, transactions.last_modified_at DESC
        LIMIT ?
        """,
        (limit,),
    ).fetchall()
    return _dicts(rows)


def budgets_with_spend(conn: sqlite3.Connection) -> list[dict]:
    rows = conn.execute(
        """
        SELECT budgets.id, budgets.name, budgets.amount_cents, budgets.period, budgets.start_date,
               budgets.end_date, categories.name AS category_name,
               (
                   SELECT COALESCE(SUM(CASE WHEN transactions.amount_cents < 0
                                            THEN -transactions.amount_cents ELSE 0 END), 0)
                   FROM transactions
                   WHERE transactions.category_id = budgets.category_id
                     AND transactions.date >= budgets.start_date
                     AND (budgets.end_date IS NULL OR transactions.date <= budgets.end_date)
               ) AS spent_cents
        FROM budgets
        JOIN categories ON categories.id = budgets.category_id
        ORDER BY budgets.name
        """
    ).fetchall()
    return _dicts(rows)


def goals(conn: sqlite3.Connection) -> list[dict]:
    rows = conn.execute(
        """
        SELECT id, name, target_cents, current_cents, target_date, status
        FROM goals
        ORDER BY name
        """
    ).fetchall()
    return _dicts(rows)


def applications(conn: sqlite3.Connection) -> list[dict]:
    rows = conn.execute(
        """
        SELECT applications.id, applications.role_title, applications.status, applications.applied_on,
               applications.raw_company, applications.raw_contact, applications.raw_status,
               applications.raw_source, applications.notes, applications.company_id,
               companies.name AS company_name
        FROM applications
        LEFT JOIN companies ON companies.id = applications.company_id
        ORDER BY applications.last_modified_at DESC
        """
    ).fetchall()
    return _dicts(rows)


def status_counts(conn: sqlite3.Connection) -> list[dict]:
    rows = conn.execute(
        """
        SELECT status, COUNT(*) AS total
        FROM applications
        GROUP BY status
        ORDER BY status
        """
    ).fetchall()
    return _dicts(rows)


def journal_entries(conn: sqlite3.Connection) -> list[dict]:
    rows = conn.execute(
        """
        SELECT id, entry_date, title, body, mood
        FROM journal_entries
        ORDER BY entry_date DESC, last_modified_at DESC
        """
    ).fetchall()
    return _dicts(rows)


def events(conn: sqlite3.Connection) -> list[dict]:
    rows = conn.execute(
        """
        SELECT id, title, starts_at, ends_at, location, notes
        FROM events
        ORDER BY starts_at DESC
        """
    ).fetchall()
    return _dicts(rows)


def companies(conn: sqlite3.Connection) -> list[dict]:
    return _dicts(conn.execute("SELECT id, name FROM companies ORDER BY name").fetchall())


def contacts(conn: sqlite3.Connection) -> list[dict]:
    return _dicts(conn.execute("SELECT id, name, company_id FROM contacts ORDER BY name").fetchall())


def accounts(conn: sqlite3.Connection) -> list[dict]:
    return _dicts(
        conn.execute("SELECT id, name, account_type FROM accounts ORDER BY name").fetchall()
    )


def categories(conn: sqlite3.Connection) -> list[dict]:
    return _dicts(conn.execute("SELECT id, name, kind FROM categories ORDER BY name").fetchall())


def domain_counts(conn: sqlite3.Connection) -> dict[str, int]:
    counts = {}
    for table in ("transactions", "applications", "journal_entries", "events"):
        row = conn.execute(f"SELECT COUNT(*) AS total FROM {quote_ident(table)}").fetchone()
        counts[table] = int(row["total"])
    return counts


def inspect_table(
    conn: sqlite3.Connection,
    table: str,
    *,
    search: str | None = None,
    sort: str | None = None,
    descending: bool = False,
    limit: int = 500,
) -> list[dict]:
    known = set(list_tables(conn))
    if table not in known:
        raise ValidationError("unknown table")
    columns = [row["name"] for row in table_columns(conn, table)]
    if sort is None or sort not in columns:
        sort = "id" if "id" in columns else columns[0]
    direction = "DESC" if descending else "ASC"
    quoted = quote_ident(table)
    params: list[object] = []
    where = ""
    if search:
        escaped = search.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        clauses = [f"CAST({quote_ident(column)} AS TEXT) LIKE ? ESCAPE '\\'" for column in columns]
        where = " WHERE " + " OR ".join(clauses)
        params.extend([f"%{escaped}%"] * len(columns))
    params.append(max(1, min(limit, 1000)))
    sql = f"SELECT * FROM {quoted}{where} ORDER BY {quote_ident(sort)} {direction} LIMIT ?"
    return _dicts(conn.execute(sql, params).fetchall())


def pending_delete(conn: sqlite3.Connection, table: str, row_id: str) -> dict | None:
    row = conn.execute(
        """
        SELECT id, status, owner_name, requested_at
        FROM pending_deletes
        WHERE table_name = ? AND row_id = ? AND status = 'pending'
        """,
        (table, row_id),
    ).fetchone()
    return dict(row) if row else None
