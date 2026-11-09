"""In-memory tasks for the separable API. The Next.js app owns the Upstash copy."""

from __future__ import annotations

import re
import time
import uuid
from collections.abc import Callable

PRIORITIES = {"High", "Medium", "Low"}
CREATE_STATUSES = {"To do", "Doing", "Blocked"}
DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
IDEM = re.compile(r"^[A-Za-z0-9._:-]{1,200}$")
IDEM_TTL_MS = 24 * 60 * 60 * 1000


def _calendar_date(value: str) -> bool:
    if not DATE.fullmatch(value):
        return False
    year, month, day = (int(part) for part in value.split("-"))
    try:
        from datetime import date

        date(year, month, day)
    except ValueError:
        return False
    return True


def validate_task(body: object) -> tuple[dict | None, dict | None]:
    if not isinstance(body, dict):
        return None, {"detail": "Task must be an object"}
    title = body.get("title")
    if not isinstance(title, str) or not title.strip():
        return None, {"detail": "Enter a title.", "field": "title"}
    title = title.strip()
    if len(title) > 200:
        return None, {"detail": "Title is too long.", "field": "title"}
    parsed: dict = {"title": title, "status": "To do"}
    notes = body.get("notes")
    if notes not in (None, ""):
        if not isinstance(notes, str):
            return None, {"detail": "Notes must be text.", "field": "notes"}
        notes = notes.strip()
        if len(notes) > 4000:
            return None, {"detail": "Notes are too long.", "field": "notes"}
        if notes:
            parsed["notes"] = notes
    due = body.get("dueDate")
    if due not in (None, ""):
        if not isinstance(due, str) or not _calendar_date(due):
            return None, {"detail": "Use a due date as YYYY-MM-DD.", "field": "dueDate"}
        parsed["dueDate"] = due
    priority = body.get("priority")
    if priority not in (None, ""):
        if priority not in PRIORITIES:
            return None, {"detail": "Priority must be High, Medium, or Low.", "field": "priority"}
        parsed["priority"] = priority
    status = body.get("status")
    if status not in (None, ""):
        if status == "Done":
            return None, {"detail": "Done isn't available when adding a task.", "field": "status"}
        if status not in CREATE_STATUSES:
            return None, {"detail": "Status must be To do, Doing, or Blocked.", "field": "status"}
        parsed["status"] = status
    project = body.get("project")
    if project not in (None, ""):
        if not isinstance(project, str):
            return None, {"detail": "Project must be text.", "field": "project"}
        project = project.strip()
        if len(project) > 120:
            return None, {"detail": "Project is too long.", "field": "project"}
        if project:
            parsed["project"] = project
    return parsed, None


class TaskStore:
    def __init__(self, clock: Callable[[], int] | None = None) -> None:
        self.clock = clock or (lambda: int(time.time() * 1000))
        self.tasks: dict[str, dict] = {}
        self.idem: dict[str, tuple[int, dict]] = {}

    def list_unfinished(self) -> list[dict]:
        rows = [task for task in self.tasks.values() if task.get("status") != "Done"]
        rows.sort(key=lambda task: task["createdAt"], reverse=True)
        return rows

    def create(self, body: object, idem_key: str | None) -> tuple[int, dict]:
        now = self.clock()
        if idem_key:
            if not IDEM.fullmatch(idem_key):
                return 400, {"detail": "Invalid Idempotency-Key"}
            stored = self.idem.get(idem_key)
            if stored and stored[0] > now:
                return stored[1]["status"], stored[1]["body"]
        parsed, error = validate_task(body)
        if error:
            return 400, error
        assert parsed is not None
        task = {
            "id": str(uuid.uuid4()),
            "title": parsed["title"],
            "status": parsed["status"],
            "createdAt": now,
            "updatedAt": now,
        }
        for name in ("notes", "dueDate", "priority", "project"):
            if name in parsed:
                task[name] = parsed[name]
        self.tasks[task["id"]] = task
        response = {"status": 201, "body": task}
        if idem_key:
            self.idem[idem_key] = (now + IDEM_TTL_MS, response)
        return 201, task
