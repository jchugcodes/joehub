"""In-memory grocery items for the separable API. The Next.js app owns the Upstash copy."""

from __future__ import annotations

import re
import time
import uuid
from collections.abc import Callable

CREATE_FIELDS = {"name", "quantity", "notes", "section"}
ITEM_ID = re.compile(r"^[A-Za-z0-9-]{1,80}$")
IDEM = re.compile(r"^[A-Za-z0-9._:-]{1,200}$")
LEADING_NEGATIVE = re.compile(r"^-\s*\d")
REAL_AMOUNT = re.compile(r"[A-Za-z0-9]")
MISSING = {"detail": "This item is no longer here."}
IDEM_TTL_MS = 24 * 60 * 60 * 1000


def _quantity(value: object) -> tuple[str | None, dict | None]:
    if value is None or value == "":
        return "", None
    if not isinstance(value, str):
        return None, {"detail": "Enter a valid quantity.", "field": "quantity"}
    text = value.strip()
    if not text:
        return "", None
    if len(text) > 80:
        return None, {"detail": "Quantity is too long.", "field": "quantity"}
    if LEADING_NEGATIVE.match(text) or not REAL_AMOUNT.search(text):
        return None, {"detail": "Enter a valid quantity.", "field": "quantity"}
    return text, None


def _text(value: object, field: str, type_detail: str, limit: int, too_long: str) -> tuple[str | None, dict | None]:
    if value is None or value == "":
        return "", None
    if not isinstance(value, str):
        return None, {"detail": type_detail, "field": field}
    text = value.strip()
    if len(text) > limit:
        return None, {"detail": too_long, "field": field}
    return text, None


def validate_item(body: object) -> tuple[dict | None, dict | None]:
    if not isinstance(body, dict):
        return None, {"detail": "Item must be an object"}
    for key in body:
        if key not in CREATE_FIELDS:
            return None, {"detail": f"{key} isn't accepted.", "field": key}
    name = body.get("name")
    if not isinstance(name, str) or not name.strip():
        return None, {"detail": "Enter a name.", "field": "name"}
    name = name.strip()
    if len(name) > 200:
        return None, {"detail": "Name is too long.", "field": "name"}
    quantity, error = _quantity(body.get("quantity"))
    if error:
        return None, error
    notes, error = _text(body.get("notes"), "notes", "Notes must be text.", 4000, "Notes are too long.")
    if error:
        return None, error
    section, error = _text(body.get("section"), "section", "Section must be text.", 120, "Section is too long.")
    if error:
        return None, error
    parsed = {"name": name}
    if quantity:
        parsed["quantity"] = quantity
    if notes:
        parsed["notes"] = notes
    if section:
        parsed["section"] = section
    return parsed, None


def validate_patch(body: object) -> tuple[dict | None, dict | None]:
    if not isinstance(body, dict):
        return None, {"detail": "Item must be an object"}
    if not body:
        return None, {"detail": "Item must include a field"}
    for key in body:
        if key not in CREATE_FIELDS:
            return None, {"detail": f"{key} isn't accepted.", "field": key}
    patch: dict = {}
    if "name" in body:
        name = body.get("name")
        if not isinstance(name, str) or not name.strip():
            return None, {"detail": "Enter a name.", "field": "name"}
        name = name.strip()
        if len(name) > 200:
            return None, {"detail": "Name is too long.", "field": "name"}
        patch["name"] = name
    if "quantity" in body:
        quantity, error = _quantity(body.get("quantity"))
        if error:
            return None, error
        patch["quantity"] = quantity
    if "notes" in body:
        notes, error = _text(body.get("notes"), "notes", "Notes must be text.", 4000, "Notes are too long.")
        if error:
            return None, error
        patch["notes"] = notes
    if "section" in body:
        section, error = _text(body.get("section"), "section", "Section must be text.", 120, "Section is too long.")
        if error:
            return None, error
        patch["section"] = section
    return patch, None


class GroceryStore:
    def __init__(self, clock: Callable[[], int] | None = None) -> None:
        self.clock = clock or (lambda: int(time.time() * 1000))
        self.items: dict[str, dict] = {}
        self.idem: dict[str, tuple[int, dict]] = {}

    def create(self, body: object, idem_key: str | None) -> tuple[int, dict]:
        now = self.clock()
        if idem_key:
            if not IDEM.fullmatch(idem_key):
                return 400, {"detail": "Invalid Idempotency-Key"}
            stored = self.idem.get(idem_key)
            if stored and stored[0] > now:
                return stored[1]["status"], stored[1]["body"]
        parsed, error = validate_item(body)
        if error:
            return 400, error
        assert parsed is not None
        item = {
            "id": str(uuid.uuid4()),
            "name": parsed["name"],
            "checked": False,
            "createdAt": now,
            "updatedAt": now,
        }
        for name in ("quantity", "notes", "section"):
            if name in parsed:
                item[name] = parsed[name]
        self.items[item["id"]] = item
        response = {"status": 201, "body": item}
        if idem_key:
            self.idem[idem_key] = (now + IDEM_TTL_MS, response)
        return 201, item

    def get(self, item_id: str) -> tuple[int, dict]:
        if not ITEM_ID.fullmatch(item_id) or item_id not in self.items:
            return 404, dict(MISSING)
        return 200, self.items[item_id]

    def patch(self, item_id: str, body: object) -> tuple[int, dict]:
        if not ITEM_ID.fullmatch(item_id) or item_id not in self.items:
            return 404, dict(MISSING)
        parsed, error = validate_patch(body)
        if error:
            return 400, error
        assert parsed is not None
        item = dict(self.items[item_id])
        item["updatedAt"] = self.clock()
        if "name" in parsed:
            item["name"] = parsed["name"]
        for field in ("quantity", "notes", "section"):
            if field not in parsed:
                continue
            if parsed[field]:
                item[field] = parsed[field]
            else:
                item.pop(field, None)
        self.items[item_id] = item
        return 200, item

    def _set_checked(self, item_id: str, checked: bool) -> tuple[int, dict]:
        if not ITEM_ID.fullmatch(item_id) or item_id not in self.items:
            return 404, dict(MISSING)
        item = dict(self.items[item_id])
        if bool(item.get("checked")) == checked:
            return 200, item
        item["checked"] = checked
        item["updatedAt"] = self.clock()
        if checked:
            item["checkedAt"] = item["updatedAt"]
        else:
            item.pop("checkedAt", None)
        self.items[item_id] = item
        return 200, item

    def check(self, item_id: str) -> tuple[int, dict]:
        return self._set_checked(item_id, True)

    def uncheck(self, item_id: str) -> tuple[int, dict]:
        return self._set_checked(item_id, False)

    def delete(self, item_id: str) -> tuple[int, dict]:
        if not ITEM_ID.fullmatch(item_id) or item_id not in self.items:
            return 404, dict(MISSING)
        del self.items[item_id]
        return 200, {"deleted": True, "id": item_id}

    def list_items(self) -> list[dict]:
        rows = list(self.items.values())
        rows.sort(key=lambda item: (item["createdAt"], item["id"]))
        return rows
