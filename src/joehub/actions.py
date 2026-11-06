"""Dashboard mutations. Every change goes through the write layer."""

from __future__ import annotations

import sqlite3

from joehub.config import Settings, load_settings
from joehub.db import connect
from joehub.errors import JoehubError, ValidationError
from joehub.registry import TABLES, fields_by_name
from joehub.write import WriteLayer, WriteResult, coerce_field


def owner_for(conn: sqlite3.Connection, table: str) -> str:
    row = conn.execute(
        """
        SELECT owners.name AS owner_name
        FROM table_registry
        JOIN owners ON owners.id = table_registry.owner_id
        WHERE table_registry.table_name = ?
        """,
        (table,),
    ).fetchone()
    if row is None:
        raise ValidationError(f"{table} is not writable")
    return str(row["owner_name"])


def perform(
    *,
    table: str,
    operation: str,
    payload: dict,
    idempotency_key: str,
    settings: Settings | None = None,
) -> tuple[WriteResult | None, str | None]:
    settings = settings or load_settings()
    conn = connect(settings.db_path)
    try:
        owner = owner_for(conn, table)
    except JoehubError as exc:
        return None, str(exc)
    finally:
        conn.close()
    try:
        result = WriteLayer(settings).write(
            owner=owner,
            table=table,
            operation=operation,
            payload=payload,
            idempotency_key=idempotency_key,
        )
    except JoehubError as exc:
        return None, str(exc)
    return result, None


def coerce_form_value(table: str, field_name: str, raw: str):
    field = fields_by_name(table)[field_name]
    if raw == "":
        return coerce_field(field, None)
    if field.kind == "int":
        try:
            value: object = int(raw)
        except ValueError as exc:
            raise ValidationError(f"{field_name} must be an integer") from exc
        return coerce_field(field, value)
    return coerce_field(field, raw)


def editable_field_names(table: str) -> list[str]:
    if table not in TABLES:
        return []
    return [field.name for field in TABLES[table]]
