"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Sheet } from "../../components/Sheet";

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
  const [link, setLink] = useState<"live" | "offline" | "reconnecting" | "back">("live");
  const downRef = useRef(false);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [titleError, setTitleError] = useState("");
  const [formError, setFormError] = useState("");
  const [saving, setSaving] = useState(false);
  const [wide, setWide] = useState(false);
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
      const recovered = downRef.current;
      downRef.current = false;
      setOffline(false);
      setLink(recovered ? "back" : "live");
      setMode("ready");
    } catch {
      if (gen !== loadGen.current) return;
      downRef.current = true;
      const snap = readCache();
      if (snap) {
        setTasks(snap.tasks);
        setSavedAt(snap.savedAt);
        setOffline(true);
        setLink("offline");
        setMode("ready");
        return;
      }
      setOffline(true);
      setLink("offline");
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
      downRef.current = true;
      setOffline(true);
      setLink("offline");
    };
    const onOnline = () => {
      if (!downRef.current) return;
      setLink("reconnecting");
      void load();
    };
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

  useEffect(() => {
    if (!offline) return undefined;
    let stopped = false;
    let timer = 0;
    let delay = 2000;
    const probe = async () => {
      if (stopped) return;
      setLink("reconnecting");
      let reachable = false;
      try {
        const response = await fetch("/api/health", { cache: "no-store" });
        reachable = response.ok;
      } catch {
        reachable = false;
      }
      if (stopped) return;
      if (reachable) await load();
      else setLink("offline");
      if (stopped) return;
      timer = window.setTimeout(() => void probe(), delay);
      delay = Math.min(delay * 2, 15000);
    };
    timer = window.setTimeout(() => void probe(), delay);
    return () => {
      stopped = true;
      window.clearTimeout(timer);
    };
  }, [offline, load]);

  useEffect(() => {
    const query = window.matchMedia("(min-width: 1024px)");
    const apply = () => setWide(query.matches);
    apply();
    query.addEventListener("change", apply);
    return () => query.removeEventListener("change", apply);
  }, []);

  useEffect(() => {
    if (link !== "back") return undefined;
    const timer = window.setTimeout(() => setLink("live"), 3000);
    return () => window.clearTimeout(timer);
  }, [link]);

  function openAdd() {
    if (offline || mode !== "ready") return;
    idemRef.current = newKey();
    setDraft(emptyDraft());
    setTitleError("");
    setFormError("");
    setOpen(true);
  }

  function cancel() {
    if (savingRef.current) return;
    setOpen(false);
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
    const payload: Record<string, string> = { title, status: draft.status };
    if (draft.notes.trim()) payload.notes = draft.notes.trim();
    if (draft.dueDate) payload.dueDate = draft.dueDate;
    if (draft.priority) payload.priority = draft.priority;
    if (draft.project.trim()) payload.project = draft.project.trim();
    try {
      const response = await fetch("/api/tasks", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": idemRef.current,
        },
        body: JSON.stringify(payload),
      });
      const body = (await response.json().catch(() => null)) as { detail?: string; field?: string; id?: string } | null;
      if (response.status === 400 && body?.field === "title") {
        setTitleError(body.detail || "Enter a title.");
        return;
      }
      if (!response.ok || !body || typeof body.id !== "string") {
        setFormError("Couldn't save this task. Your draft is still here.");
        return;
      }
      const task = body as Task;
      const at = Date.now();
      const next = [task, ...tasks.filter((item) => item.id !== task.id)];
      writeCache(next, at);
      setTasks(next);
      setSavedAt(at);
      setOpen(false);
      setDraft(emptyDraft());
      void load();
    } catch {
      setFormError("Couldn't save this task. Your draft is still here.");
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  const addDisabled = offline || mode !== "ready";

  return (
    <div data-ready={mode === "loading" ? undefined : "true"} data-layout={wide ? "panel" : "sheet"} className={wide && open ? "flex min-w-0 items-start gap-6" : "min-w-0"}>
      <div className="min-w-0 flex-1">
      <header className="px-5 pt-3">
        <p className="text-ui-13 text-muted">joehub</p>
        <h1 className="text-ui-22 font-bold">Tasks</h1>
        <p className="mt-1 text-ui-13 leading-relaxed text-muted">Everything unfinished · newest first</p>
      </header>
      {link === "offline" && savedAt ? (
        <p role="status" data-offline="true" data-link="offline" className="mx-4 mt-3 rounded-2xl border border-[#C9CEC8] bg-[#EEF0EC] px-3.5 py-3 text-ui-13 font-bold">
          Offline · read-only
          <span className="mt-0.5 block text-ui-12 font-medium text-muted">Last updated {formatDetroit(savedAt)}</span>
        </p>
      ) : null}
      {link === "reconnecting" ? (
        <p role="status" data-offline="true" data-link="reconnecting" className="mx-4 mt-3 rounded-2xl border border-[#E9B94933] bg-[#E9B9491F] px-3.5 py-3 text-ui-13 font-bold text-[#8A6B14]">
          Reconnecting…
          <span className="mt-0.5 block text-ui-12 font-medium text-muted">
            Still showing cached data{savedAt ? ` · last updated ${formatDetroit(savedAt)}` : ""}
          </span>
        </p>
      ) : null}
      {link === "back" ? (
        <p role="status" data-link="back" className="mx-4 mt-3 flex items-start justify-between gap-3 rounded-2xl border border-[#2E8B6A33] bg-[#2E8B6A1F] px-3.5 py-3 text-ui-13 font-bold text-[#246C53]">
          <span>
            Back online
            <span className="mt-0.5 block text-ui-12 font-medium text-muted">List refreshed · edits available</span>
          </span>
          <button type="button" className="text-ui-12 font-semibold text-muted" onClick={() => setLink("live")}>
            Dismiss
          </button>
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
            <h2 className="text-ui-20 font-bold">You&apos;re all caught up</h2>
            <p className="mt-2 text-ui-14 leading-relaxed text-muted">No unfinished tasks. Add one when something comes up.</p>
          </div>
        </div>
      ) : null}
      {mode === "ready" && tasks.length > 0 ? (
        <ul aria-label="Unfinished tasks" className="mt-4 space-y-3 px-4">
          {tasks.map((task) => (
            <li key={task.id} className="card min-w-0 p-4">
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
            </li>
          ))}
        </ul>
      ) : null}
      <p className="mb-4 mt-6 px-4 text-center text-ui-10 text-muted">EXAMPLE DATA · unfinished tasks only</p>
      </div>
      {open ? (
        <Sheet
          title="Add a task"
          onClose={cancel}
          frame
          dock={wide ? "panel" : "sheet"}
          actions={
            wide ? (
              <div className="flex gap-2">
                <button type="button" className="flex min-h-10 items-center justify-center rounded-xl border border-ink px-3 text-ui-13 font-bold" onClick={cancel}>
                  Cancel
                </button>
                <button
                  type="submit"
                  form="task-form"
                  className="flex min-h-10 items-center justify-center rounded-xl bg-ink px-4 text-ui-13 font-bold text-white disabled:opacity-50"
                  disabled={offline || saving}
                >
                  {saving ? "Saving…" : "Save"}
                </button>
              </div>
            ) : null
          }
        >
          <form id="task-form" className={wide ? "" : "mt-4"} onSubmit={save}>
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
              placeholder="What needs doing?"
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
            <p className="mt-1 text-ui-12 text-muted">Optional.</p>
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
            {wide ? null : (
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
            )}
          </form>
        </Sheet>
      ) : null}
    </div>
  );
}
