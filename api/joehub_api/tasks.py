"""In-memory tasks for the separable API. The Next.js app owns the Upstash copy."""

from __future__ import annotations

import re
import time
import uuid
from collections.abc import Callable
from datetime import datetime
from zoneinfo import ZoneInfo

PRIORITIES = {"High", "Medium", "Low"}
CREATE_STATUSES = {"To do", "Doing", "Blocked"}
DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
IDEM = re.compile(r"^[A-Za-z0-9._:-]{1,200}$")
TASK_ID = re.compile(r"^[A-Za-z0-9-]{1,80}$")
DETROIT = ZoneInfo("America/Detroit")
MISSING = {"detail": "This task is no longer here."}
IDEM_TTL_MS = 24 * 60 * 60 * 1000
DONE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000


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


def detroit_calendar_date(now_ms: int) -> str:
    moment = datetime.fromtimestamp(now_ms / 1000, tz=DETROIT)
    return moment.date().isoformat()


def validate_task_patch(body: object, now_ms: int) -> tuple[dict | None, dict | None]:
    if not isinstance(body, dict):
        return None, {"detail": "Task must be an object"}
    patch: dict = {}
    if "title" in body:
        title = body.get("title")
        if not isinstance(title, str) or not title.strip():
            return None, {"detail": "Enter a title.", "field": "title"}
        title = title.strip()
        if len(title) > 200:
            return None, {"detail": "Title is too long.", "field": "title"}
        patch["title"] = title
    if "notes" in body:
        notes = body.get("notes")
        if notes in (None, ""):
            patch["notes"] = None
        elif not isinstance(notes, str):
            return None, {"detail": "Notes must be text.", "field": "notes"}
        else:
            notes = notes.strip()
            if len(notes) > 4000:
                return None, {"detail": "Notes are too long.", "field": "notes"}
            patch["notes"] = notes or None
    if "dueDate" in body:
        due = body.get("dueDate")
        if due in (None, ""):
            patch["dueDate"] = None
        elif due == "today":
            patch["dueDate"] = detroit_calendar_date(now_ms)
        elif not isinstance(due, str) or not _calendar_date(due):
            return None, {"detail": "Use a due date as YYYY-MM-DD.", "field": "dueDate"}
        else:
            patch["dueDate"] = due
    if "priority" in body:
        priority = body.get("priority")
        if priority in (None, ""):
            patch["priority"] = None
        elif priority not in PRIORITIES:
            return None, {"detail": "Priority must be High, Medium, or Low.", "field": "priority"}
        else:
            patch["priority"] = priority
    if "status" in body:
        status = body.get("status")
        if status == "Done":
            return None, {"detail": "Done isn't available when editing a task.", "field": "status"}
        if status not in CREATE_STATUSES:
            return None, {"detail": "Status must be To do, Doing, or Blocked.", "field": "status"}
        patch["status"] = status
    if "project" in body:
        project = body.get("project")
        if project in (None, ""):
            patch["project"] = None
        elif not isinstance(project, str):
            return None, {"detail": "Project must be text.", "field": "project"}
        else:
            project = project.strip()
            if len(project) > 120:
                return None, {"detail": "Project is too long.", "field": "project"}
            patch["project"] = project or None
    return patch, None


class TaskStore:
    def __init__(self, clock: Callable[[], int] | None = None) -> None:
        self.clock = clock or (lambda: int(time.time() * 1000))
        self.tasks: dict[str, dict] = {}
        self.idem: dict[str, tuple[int, dict]] = {}

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

    def get(self, task_id: str) -> tuple[int, dict]:
        if not TASK_ID.fullmatch(task_id):
            return 404, dict(MISSING)
        task = self.tasks.get(task_id)
        if task is None:
            return 404, dict(MISSING)
        return 200, task

    def patch(self, task_id: str, body: object) -> tuple[int, dict]:
        if not TASK_ID.fullmatch(task_id) or task_id not in self.tasks:
            return 404, dict(MISSING)
        now = self.clock()
        patch, error = validate_task_patch(body, now)
        if error:
            return 400, error
        assert patch is not None
        current = self.tasks[task_id]
        updated = dict(current)
        if "title" in patch:
            updated["title"] = patch["title"]
        if "status" in patch:
            updated["status"] = patch["status"]
        for name in ("notes", "dueDate", "priority", "project"):
            if name not in patch:
                continue
            if patch[name]:
                updated[name] = patch[name]
            else:
                updated.pop(name, None)
        updated["id"] = current["id"]
        updated["createdAt"] = current["createdAt"]
        updated["updatedAt"] = now if now > current["updatedAt"] else current["updatedAt"] + 1
        self.tasks[task_id] = updated
        return 200, updated

    def _purge(self, now: int) -> None:
        stale = [
            task_id
            for task_id, task in self.tasks.items()
            if task.get("status") == "Done" and task.get("completedAt", 0) < now - DONE_WINDOW_MS
        ]
        for task_id in stale:
            del self.tasks[task_id]

    def list_unfinished(self) -> list[dict]:
        self._purge(self.clock())
        rows = [task for task in self.tasks.values() if task.get("status") != "Done"]
        rows.sort(key=lambda task: task["createdAt"], reverse=True)
        return rows

    def search(self, query: str) -> list[dict]:
        now = self.clock()
        self._purge(now)
        needle = query.strip().lower()
        window = now - DONE_WINDOW_MS

        def matches(task: dict) -> bool:
            if not needle:
                return False
            hay = " ".join(str(task.get(name) or "") for name in ("title", "notes", "project")).lower()
            return needle in hay

        unfinished = [task for task in self.tasks.values() if task.get("status") != "Done" and matches(task)]
        recent = [
            task
            for task in self.tasks.values()
            if task.get("status") == "Done" and task.get("completedAt", 0) >= window and matches(task)
        ]
        unfinished.sort(key=lambda task: task["createdAt"], reverse=True)
        recent.sort(key=lambda task: task.get("completedAt", 0), reverse=True)
        return unfinished + recent

    def complete(self, task_id: str) -> tuple[int, dict]:
        now = self.clock()
        self._purge(now)
        if not TASK_ID.fullmatch(task_id) or task_id not in self.tasks:
            return 404, dict(MISSING)
        current = self.tasks[task_id]
        if current.get("status") == "Done":
            return 200, current
        updated = dict(current)
        updated["status"] = "Done"
        updated["completedAt"] = now
        updated["updatedAt"] = now if now > current["updatedAt"] else current["updatedAt"] + 1
        self.tasks[task_id] = updated
        return 200, updated

    def reopen(self, task_id: str) -> tuple[int, dict]:
        now = self.clock()
        self._purge(now)
        if not TASK_ID.fullmatch(task_id) or task_id not in self.tasks:
            return 404, dict(MISSING)
        current = self.tasks[task_id]
        if current.get("status") != "Done":
            return 200, current
        updated = dict(current)
        updated["status"] = "To do"
        updated.pop("completedAt", None)
        updated["updatedAt"] = now if now > current["updatedAt"] else current["updatedAt"] + 1
        self.tasks[task_id] = updated
        return 200, updated
