"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Sheet } from "../../components/Sheet";
import { detroitCalendarDate } from "../../lib/detroit-date.mjs";

const CACHE_KEY = "joehub.tasks.unfinished";

type Priority = "High" | "Medium" | "Low";
type Status = "To do" | "Doing" | "Blocked";

interface Task {
  id: string;
  title: string;
  notes?: string;
  dueDate?: string;
  priority?: Priority;
  status: Status | "Done";
  project?: string;
  createdAt: number;
  updatedAt: number;
}

interface Draft {
  title: string;
  notes: string;
  dueDate: string;
  priority: "" | Priority;
  status: Status;
  project: string;
}

const emptyDraft = (): Draft => ({
  title: "",
  notes: "",
  dueDate: "",
  priority: "",
  status: "To do",
  project: "",
});

function formatDetroit(ms: number) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Detroit",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(ms);
}

function readCache(): { savedAt: number; tasks: Task[] } | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { savedAt?: unknown; tasks?: unknown };
    if (!parsed || typeof parsed.savedAt !== "number" || !Array.isArray(parsed.tasks)) return null;
    return { savedAt: parsed.savedAt, tasks: parsed.tasks as Task[] };
  } catch {
    return null;
  }
}

function writeCache(tasks: Task[], savedAt: number) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ savedAt, tasks }));
  } catch {
    // A full or blocked cache still leaves the on-screen list usable.
  }
}

function newKey() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `key-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export default function TasksPage() {
  const [mode, setMode] = useState<"loading" | "ready" | "error">("loading");
  const [tasks, setTasks] = useState<Task[]>([]);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [offline, setOffline] = useState(false);
  const [sheet, setSheet] = useState<null | "add" | "edit">(null);
  const [editingId, setEditingId] = useState("");
  const [gone, setGone] = useState("");
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [titleError, setTitleError] = useState("");
  const [formError, setFormError] = useState("");
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const idemRef = useRef("");
  const loadGen = useRef(0);

  const load = useCallback(async () => {
    const gen = ++loadGen.current;
    try {
      const response = await fetch("/api/tasks", { cache: "no-store" });
      if (!response.ok) throw new Error(String(response.status));
      const body = (await response.json()) as unknown;
      if (!Array.isArray(body)) throw new Error("tasks");
      if (gen !== loadGen.current) return;
      const next = body as Task[];
      const at = Date.now();
      writeCache(next, at);
      setTasks(next);
      setSavedAt(at);
      setOffline(false);
      setMode("ready");
    } catch {
      if (gen !== loadGen.current) return;
      const snap = readCache();
      if (snap) {
        setTasks(snap.tasks);
        setSavedAt(snap.savedAt);
        setOffline(true);
        setMode("ready");
        return;
      }
      setOffline(true);
      setMode("error");
    }
  }, []);

  useEffect(() => {
    void load();
    const onFocus = () => void load();
    const onOffline = () => {
      const snap = readCache();
      if (snap) {
        setTasks(snap.tasks);
        setSavedAt(snap.savedAt);
        setMode("ready");
      }
      setOffline(true);
    };
    const onOnline = () => void load();
    const onVisible = () => {
      if (document.visibilityState === "visible") void load();
    };
    window.addEventListener("focus", onFocus);
    window.addEventListener("offline", onOffline);
    window.addEventListener("online", onOnline);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("offline", onOffline);
      window.removeEventListener("online", onOnline);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [load]);

  function openAdd() {
    if (offline || mode !== "ready") return;
    idemRef.current = newKey();
    setEditingId("");
    setDraft(emptyDraft());
    setTitleError("");
    setFormError("");
    setGone("");
    setSheet("add");
  }

  function openEdit(task: Task) {
    if (offline || mode !== "ready") return;
    const status: Status = task.status === "Doing" || task.status === "Blocked" ? task.status : "To do";
    setEditingId(task.id);
    setDraft({
      title: task.title,
      notes: task.notes || "",
      dueDate: task.dueDate || "",
      priority: task.priority || "",
      status,
      project: task.project || "",
    });
    setTitleError("");
    setFormError("");
    setGone("");
    setSheet("edit");
  }

  function cancel() {
    if (savingRef.current) return;
    setSheet(null);
    setEditingId("");
    setTitleError("");
    setFormError("");
    setDraft(emptyDraft());
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (savingRef.current || offline) return;
    const title = draft.title.trim();
    if (!title) {
      setTitleError("Enter a title.");
      setFormError("");
      return;
    }
    savingRef.current = true;
    setSaving(true);
    setTitleError("");
    setFormError("");
    const editing = sheet === "edit";
    const payload: Record<string, string | null> = editing
      ? {
          title,
          notes: draft.notes.trim() || null,
          dueDate: draft.dueDate || null,
          priority: draft.priority || null,
          status: draft.status,
          project: draft.project.trim() || null,
        }
      : { title, status: draft.status };
    if (!editing) {
      if (draft.notes.trim()) payload.notes = draft.notes.trim();
      if (draft.dueDate) payload.dueDate = draft.dueDate;
      if (draft.priority) payload.priority = draft.priority;
      if (draft.project.trim()) payload.project = draft.project.trim();
    }
    try {
      const response = await fetch(editing ? `/api/tasks/${editingId}` : "/api/tasks", {
        method: editing ? "PATCH" : "POST",
        headers: editing
          ? { "content-type": "application/json" }
          : { "content-type": "application/json", "idempotency-key": idemRef.current },
        body: JSON.stringify(payload),
      });
      const body = (await response.json().catch(() => null)) as { detail?: string; field?: string; id?: string } | null;
      if (response.status === 404 && editing) {
        setSheet(null);
        setEditingId("");
        setDraft(emptyDraft());
        setGone(body?.detail || "This task is no longer here.");
        void load();
        return;
      }
      if (response.status === 400 && body?.field === "title") {
        setTitleError(body.detail || "Enter a title.");
        return;
      }
      if (!response.ok || !body || typeof body.id !== "string") {
        setFormError(editing ? "Couldn't save these edits. Your changes are still here." : "Couldn't save this task. Your draft is still here.");
        return;
      }
      const task = body as Task;
      const at = Date.now();
      const next = editing
        ? tasks.map((item) => (item.id === task.id ? task : item)).filter((item) => item.status !== "Done")
        : [task, ...tasks.filter((item) => item.id !== task.id)];
      writeCache(next, at);
      setTasks(next);
      setSavedAt(at);
      setSheet(null);
      setEditingId("");
      setDraft(emptyDraft());
      void load();
    } catch {
      setFormError(editing ? "Couldn't save these edits. Your changes are still here." : "Couldn't save this task. Your draft is still here.");
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  const addDisabled = offline || mode !== "ready";

  return (
    <div data-ready={mode === "loading" ? undefined : "true"} className="min-w-0">
      <header className="px-5 pt-3">
        <p className="text-ui-13 text-muted">joehub</p>
        <h1 className="text-ui-22 font-bold">Tasks</h1>
        <p className="mt-1 text-ui-13 leading-relaxed text-muted">Everything you haven’t finished, newest first.</p>
      </header>
      {offline && savedAt ? (
        <p role="status" data-offline="true" className="mx-4 mt-3 rounded-xl bg-line px-3 py-2 text-ui-13 font-semibold">
          Offline · last updated {formatDetroit(savedAt)}
        </p>
      ) : null}
      {gone ? (
        <p role="alert" data-missing="true" className="mx-4 mt-3 rounded-xl bg-line px-3 py-2 text-ui-13 font-semibold">
          {gone}
        </p>
      ) : null}
      <div className="mt-4 px-4">
        <button
          type="button"
          className="flex min-h-11 w-full items-center justify-center rounded-xl bg-ink px-4 text-ui-14 font-bold text-white disabled:opacity-50"
          onClick={openAdd}
          disabled={addDisabled}
        >
          Add a task
        </button>
      </div>
      {mode === "loading" ? (
        <p className="mt-5 px-5 text-ui-13 text-muted" role="status">
          Loading tasks…
        </p>
      ) : null}
      {mode === "error" ? (
        <div className="px-4">
          <div className="card mt-4 p-4">
            <h2 className="text-ui-20 font-bold">Tasks unavailable</h2>
            <p className="mt-2 text-ui-14 leading-relaxed text-muted">The unfinished list couldn’t be loaded.</p>
          </div>
          <button
            type="button"
            className="mt-4 flex min-h-11 w-full items-center justify-center rounded-xl border border-ink px-4 text-ui-14 font-bold"
            onClick={() => void load()}
          >
            Retry
          </button>
        </div>
      ) : null}
      {mode === "ready" && tasks.length === 0 ? (
        <div className="px-4" data-empty="true">
          <div className="card mt-4 p-4">
            <h2 className="text-ui-20 font-bold">No unfinished tasks</h2>
            <p className="mt-2 text-ui-14 leading-relaxed text-muted">
              Add a task to keep it here. Done tasks stay off this list.
            </p>
          </div>
        </div>
      ) : null}
      {mode === "ready" && tasks.length > 0 ? (
        <ul aria-label="Unfinished tasks" className="mt-4 space-y-3 px-4">
          {tasks.map((task) => (
            <li key={task.id} className="min-w-0">
              <button
                type="button"
                className="card block w-full min-w-0 p-4 text-left disabled:opacity-50"
                aria-label={`Edit ${task.title}`}
                disabled={offline}
                onClick={() => openEdit(task)}
              >
              <div className="flex items-start justify-between gap-3">
                <h2 className="min-w-0 break-words text-ui-16 font-bold">{task.title}</h2>
                <span className="shrink-0 text-ui-12 font-semibold">{task.status}</span>
              </div>
              {task.project ? <p className="mt-1 break-words text-ui-12 text-muted">{task.project}</p> : null}
              <p className="mt-2 text-ui-12 text-muted">
                {task.priority ? <span>{task.priority}</span> : null}
                {task.priority && task.dueDate ? <span> · </span> : null}
                {task.dueDate ? <span>Due {task.dueDate}</span> : null}
                {!task.priority && !task.dueDate ? <span>No due date</span> : null}
              </p>
              {task.notes ? <p className="mt-2 break-words text-ui-13 leading-relaxed">{task.notes}</p> : null}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <p className="mb-4 mt-6 px-4 text-center text-ui-10 text-muted">EXAMPLE DATA · unfinished tasks only</p>
      {sheet ? (
        <Sheet title={sheet === "edit" ? "Edit task" : "Add a task"} onClose={cancel} frame>
          <form className="mt-4" onSubmit={save}>
            <label className="block text-ui-13 font-semibold" htmlFor="task-title">
              Title
            </label>
            <input
              id="task-title"
              value={draft.title}
              data-autofocus=""
              onChange={(event) => {
                setDraft({ ...draft, title: event.target.value });
                if (titleError) setTitleError("");
              }}
              aria-invalid={titleError ? true : undefined}
              aria-describedby={titleError ? "task-title-error" : undefined}
              className="relative z-10 mt-1 w-full min-w-0 rounded-xl border border-line bg-surface px-3 py-3 text-ui-16"
              autoComplete="off"
            />
            {titleError ? (
              <p id="task-title-error" role="alert" className="mt-1 text-ui-13 font-semibold text-finance-dining">
                {titleError}
              </p>
            ) : null}
            <label className="mt-3 block text-ui-13 font-semibold" htmlFor="task-notes">
              Notes
            </label>
            <textarea
              id="task-notes"
              value={draft.notes}
              onChange={(event) => setDraft({ ...draft, notes: event.target.value })}
              rows={3}
              className="mt-1 w-full min-w-0 rounded-xl border border-line bg-surface px-3 py-3 text-ui-16"
            />
            <label className="mt-3 block text-ui-13 font-semibold" htmlFor="task-due">
              Due date
            </label>
            <input
              id="task-due"
              type="date"
              value={draft.dueDate}
              onChange={(event) => setDraft({ ...draft, dueDate: event.target.value })}
              className="mt-1 w-full min-w-0 rounded-xl border border-line bg-surface px-3 py-3 text-ui-16"
            />
            <div className="mt-1 flex items-center justify-between gap-3">
              <p className="text-ui-12 text-muted">Optional.</p>
              {sheet === "edit" ? (
                <button
                  type="button"
                  className="min-h-11 px-1 text-ui-13 font-semibold disabled:opacity-50"
                  disabled={offline}
                  onClick={() => setDraft({ ...draft, dueDate: detroitCalendarDate(Date.now()) })}
                >
                  Today
                </button>
              ) : null}
            </div>
            <label className="mt-3 block text-ui-13 font-semibold" htmlFor="task-priority">
              Priority
            </label>
            <select
              id="task-priority"
              value={draft.priority}
              onChange={(event) => setDraft({ ...draft, priority: event.target.value as Draft["priority"] })}
              className="mt-1 w-full min-w-0 rounded-xl border border-line bg-surface px-3 py-3 text-ui-16"
            >
              <option value="">None</option>
              <option>High</option>
              <option>Medium</option>
              <option>Low</option>
            </select>
            <label className="mt-3 block text-ui-13 font-semibold" htmlFor="task-status">
              Status
            </label>
            <select
              id="task-status"
              value={draft.status}
              onChange={(event) => setDraft({ ...draft, status: event.target.value as Status })}
              className="mt-1 w-full min-w-0 rounded-xl border border-line bg-surface px-3 py-3 text-ui-16"
            >
              <option>To do</option>
              <option>Doing</option>
              <option>Blocked</option>
            </select>
            <label className="mt-3 block text-ui-13 font-semibold" htmlFor="task-project">
              Project
            </label>
            <input
              id="task-project"
              value={draft.project}
              onChange={(event) => setDraft({ ...draft, project: event.target.value })}
              className="mt-1 w-full min-w-0 rounded-xl border border-line bg-surface px-3 py-3 text-ui-16"
              autoComplete="off"
            />
            {formError ? (
              <p role="alert" className="mt-3 text-ui-13 font-semibold text-finance-dining">
                {formError}
              </p>
            ) : null}
            <div className="sticky bottom-0 z-10 mt-5 flex gap-2 bg-surface py-3">
              <button
                type="button"
                className="flex min-h-11 flex-1 items-center justify-center rounded-xl border border-ink px-3 text-ui-14 font-bold"
                onClick={cancel}
                disabled={saving}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="flex min-h-11 flex-1 items-center justify-center rounded-xl bg-ink px-3 text-ui-14 font-bold text-white disabled:opacity-50"
                disabled={offline || saving}
              >
                {saving ? "Saving…" : "Save"}
              </button>
            </div>
          </form>
        </Sheet>
      ) : null}
    </div>
  );
}
