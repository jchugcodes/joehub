"""Dashboard mutations. Every change goes through the write layer as the signed-in human."""

from __future__ import annotations

from joehub.config import Settings, load_settings
from joehub.errors import JoehubError, ValidationError
from joehub.registry import TABLES, fields_by_name
from joehub.write import WriteLayer, WriteResult, coerce_field


def perform(
    *,
    credential: str,
    table: str,
    operation: str,
    payload: dict,
    idempotency_key: str,
    settings: Settings | None = None,
) -> tuple[WriteResult | None, str | None]:
    """Apply a write for an already resolved credential.

    The table owner is not chosen here. The write layer resolves the credential
    and requires an explicit human delegation, or an owner principal for its own tables.
    """
    settings = settings or load_settings()
    layer = WriteLayer(settings)
    try:
        result = layer.write(
            credential=credential,
            table=table,
            operation=operation,
            payload=payload,
            idempotency_key=idempotency_key,
        )
    except JoehubError as exc:
        return None, str(exc)
    finally:
        layer.close()
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
