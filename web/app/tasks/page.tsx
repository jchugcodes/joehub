"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Icon } from "../../components/Icon";
import { Sheet } from "../../components/Sheet";
import { ManageLists, TaskListMenu, listAccent, type TaskList } from "../../components/TaskLists";
import { detroitCalendarDate } from "../../lib/detroit-date.mjs";
import { nextPaletteColor, resolveTaskList } from "../../lib/list-display.mjs";

const CACHE_KEY = "joehub.tasks.unfinished";

type Priority = "High" | "Medium" | "Low";
type Status = "To do" | "Doing" | "Blocked" | "Done";

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
  completedAt?: number;
  bot?: { name: string; detail: string; progress?: number };
}

interface Draft {
  title: string;
  notes: string;
  dueDate: string;
  priority: "" | Priority;
  status: Status;
  project: string;
}

function BotLine({ bot }: { bot: NonNullable<Task["bot"]> }) {
  const progress = typeof bot.progress === "number" ? Math.max(0, Math.min(100, bot.progress)) : null;
  const waiting = progress == null;
  return (
    <div className={`mt-2 rounded-xl px-3 py-2.5 ${waiting ? "bg-[#3A86C81F] text-[#3A86C8]" : "bg-[#2E8B6A1F] text-[#2E8B6A]"}`} data-bot={bot.name}>
      <div className="flex items-start gap-2">
        {waiting ? <Icon name="bot" size={16} className="mt-0.5 shrink-0" /> : null}
        <p className="min-w-0 text-meta">
          <span className="font-medium">{bot.name}</span>
          <span className="font-normal text-muted"> {bot.detail}</span>
        </p>
      </div>
      {waiting ? null : (
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white" aria-hidden="true">
          <div className="h-full rounded-full bg-[#2E8B6A]" style={{ width: `${progress}%` }} />
        </div>
      )}
    </div>
  );
}

const emptyDraft = (): Draft => ({
  title: "",
  notes: "",
  dueDate: "",
  priority: "",
  status: "To do",
  project: "",
});

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const STATUS_VAR: Record<string, string> = {
  "To do": "var(--status-todo)",
  Doing: "var(--status-doing)",
  Blocked: "var(--status-blocked)",
  Done: "var(--status-done)",
};

function detroitToday(now = Date.now()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Detroit", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

function dueLabel(iso: string, today = detroitToday()) {
  if (!iso) return "";
  if (iso === today) return "Due Today";
  const month = Number(iso.slice(5, 7));
  const day = Number(iso.slice(8, 10));
  if (!month || !day) return `Due ${iso}`;
  return `Due ${MONTHS[month - 1]} ${day}`;
}

function createdLabel(ms: number) {
  if (!Number.isFinite(ms)) return "";
  const ymd = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Detroit", year: "numeric", month: "2-digit", day: "2-digit" }).format(ms);
  const month = Number(ymd.slice(5, 7));
  const day = Number(ymd.slice(8, 10));
  if (!month || !day) return "";
  return `Created ${MONTHS[month - 1]} ${day}`;
}

function completedLabel(ms: number) {
  const ymd = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Detroit", year: "numeric", month: "2-digit", day: "2-digit" }).format(ms);
  const month = Number(ymd.slice(5, 7));
  const day = Number(ymd.slice(8, 10));
  if (!month || !day) return "Completed";
  return `Completed ${MONTHS[month - 1]} ${day}`;
}

function taskMeta(task: Task, lists: TaskList[] = [], today = detroitToday()) {
  const list = task.project ? resolveTaskList(task.project, lists).label : "";
  return [list, task.priority, task.dueDate ? dueLabel(task.dueDate, today) : ""].filter(Boolean).join(" · ");
}

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
  const asOf = useSearchParams().get("asOf") || "";
  const [mode, setMode] = useState<"loading" | "ready" | "error">("loading");
  const [tasks, setTasks] = useState<Task[]>([]);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [offline, setOffline] = useState(false);
  const [link, setLink] = useState<"live" | "offline" | "reconnecting" | "back">("live");
  const downRef = useRef(false);
  const [sheet, setSheet] = useState<null | "add" | "edit">(null);
  const [editingId, setEditingId] = useState("");
  const [gone, setGone] = useState("");
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [titleError, setTitleError] = useState("");
  const [formError, setFormError] = useState("");
  const [saving, setSaving] = useState(false);
  const [query, setQuery] = useState("");
  const [activeQuery, setActiveQuery] = useState("");
  const [wide, setWide] = useState(false);
  const [group, setGroup] = useState<"all" | "status" | "project">("all");
  const [sortOrder, setSortOrder] = useState<"newest" | "oldest">("newest");
  const [sortOpen, setSortOpen] = useState(false);
  const [lists, setLists] = useState<TaskList[]>([]);
  const [listOpen, setListOpen] = useState(false);
  const [newListName, setNewListName] = useState("");
  const [newListColor, setNewListColor] = useState("");
  const [colorOpen, setColorOpen] = useState(false);
  const [listError, setListError] = useState("");
  const [manage, setManage] = useState<null | "home" | "edit" | "delete">(null);
  const [editList, setEditList] = useState<TaskList | null>(null);
  const [editName, setEditName] = useState("");
  const [editColor, setEditColor] = useState<string | null>(null);
  const [manageError, setManageError] = useState("");
  const [manageSaving, setManageSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const savingRef = useRef(false);
  const actingRef = useRef(false);
  const idemRef = useRef("");
  const loadGen = useRef(0);
  const queryRef = useRef("");

  const showCached = useCallback((snap: { savedAt: number; tasks: Task[] } | null) => {
    queryRef.current = "";
    setQuery("");
    setActiveQuery("");
    if (snap) {
      setTasks(snap.tasks);
      setSavedAt(snap.savedAt);
      setMode("ready");
    }
    downRef.current = true;
    setOffline(true);
    setLink("offline");
  }, []);

  const load = useCallback(async () => {
    const gen = ++loadGen.current;
    const q = queryRef.current.trim();
    try {
      const params = new URLSearchParams();
      if (q) params.set("q", q);
      if (asOf) params.set("asOf", asOf);
      const response = await fetch(params.size ? `/api/tasks?${params}` : "/api/tasks", { cache: "no-store" });
      if (!response.ok) throw new Error(String(response.status));
      const body = (await response.json()) as unknown;
      if (!Array.isArray(body)) throw new Error("tasks");
      if (gen !== loadGen.current) return;
      const next = body as Task[];
      const at = Date.now();
      if (!q) writeCache(next, at);
      setTasks(next);
      if (!q) setSavedAt(at);
      try {
        const listsResponse = await fetch("/api/lists", { cache: "no-store" });
        if (listsResponse.ok && gen === loadGen.current) {
          const listed = (await listsResponse.json()) as unknown;
          if (Array.isArray(listed)) setLists(listed as TaskList[]);
        }
      } catch {
        // The task list still stands when lists cannot be read.
      }
      setActiveQuery(q);
      const recovered = downRef.current;
      downRef.current = false;
      setOffline(false);
      setLink(recovered ? "back" : "live");
      setMode("ready");
    } catch {
      if (gen !== loadGen.current) return;
      const snap = readCache();
      showCached(snap);
      if (!snap) setMode("error");
    }
  }, [asOf, showCached]);

  useEffect(() => {
    void load();
    const onFocus = () => void load();
    const onOffline = () => {
      showCached(readCache());
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
  }, [load, showCached]);

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

  useEffect(() => {
    if (!confirmDelete) return undefined;
    const onKey = (event: KeyboardEvent) => {
      event.stopPropagation();
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        setConfirmDelete(false);
        return;
      }
      if (event.key !== "Tab") return;
      const root = document.getElementById("delete-dialog");
      const nodes = root ? [...root.querySelectorAll<HTMLElement>("button")] : [];
      if (nodes.length < 2) return;
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [confirmDelete]);

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

  async function removeTask() {
    if (!editingId || offline) return;
    try {
      const response = await fetch(`/api/tasks/${editingId}`, { method: "DELETE" });
      if (!response.ok) {
        setFormError("Couldn't delete this task. It is still here.");
        setConfirmDelete(false);
        return;
      }
      const removed = editingId;
      setTasks((current) => current.filter((task) => task.id !== removed));
      setConfirmDelete(false);
      setSheet(null);
      setEditingId("");
    } catch {
      setFormError("Couldn't delete this task. It is still here.");
      setConfirmDelete(false);
    }
  }

  function cancel() {
    if (savingRef.current) return;
    setSheet(null);
    setEditingId("");
    setTitleError("");
    setFormError("");
    setDraft(emptyDraft());
    setListOpen(false);
  }

  function openListMenu() {
    setNewListColor((current) => current || nextPaletteColor(lists));
    setListError("");
    setColorOpen(false);
    setListOpen(true);
    setManage(null);
  }

  async function addList() {
    const name = newListName.trim();
    if (!name) {
      setListError("Enter a list name.");
      return;
    }
    const response = await fetch("/api/lists", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name, color: newListColor || nextPaletteColor(lists) }),
    });
    const body = (await response.json().catch(() => null)) as { id?: string; detail?: string; name?: string; color?: string | null; createdAt?: number; updatedAt?: number } | null;
    if (!response.ok || !body || typeof body.id !== "string") {
      setListError(body?.detail || "Couldn't add that list.");
      return;
    }
    const created: TaskList = { id: body.id, name: body.name || name, color: body.color || newListColor, createdAt: body.createdAt || Date.now(), updatedAt: body.updatedAt || Date.now(), count: 0 };
    setLists((current) => [...current, created]);
    setDraft((current) => ({ ...current, project: created.id }));
    setNewListName("");
    setListOpen(false);
    setColorOpen(false);
  }

  async function saveListEdit() {
    if (!editList || manageSaving) return;
    setManageSaving(true);
    setManageError("");
    try {
      const response = await fetch(`/api/lists/${editList.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: editName, color: editColor }),
      });
      const body = (await response.json().catch(() => null)) as { detail?: string } | null;
      if (!response.ok) {
        setManageError(body?.detail || "Couldn't save this list.");
        return;
      }
      setManage("home");
      void load();
    } catch {
      setManageError("Couldn't save this list.");
    } finally {
      setManageSaving(false);
    }
  }

  async function removeList() {
    if (!editList || manageSaving) return;
    setManageSaving(true);
    setManageError("");
    try {
      const response = await fetch(`/api/lists/${editList.id}`, { method: "DELETE" });
      const body = (await response.json().catch(() => null)) as { detail?: string } | null;
      if (!response.ok) {
        setManageError(body?.detail || "Couldn't delete this list.");
        return;
      }
      if (draft.project === editList.id) setDraft((current) => ({ ...current, project: "" }));
      setManage("home");
      setEditList(null);
      void load();
    } catch {
      setManageError("Couldn't delete this list.");
    } finally {
      setManageSaving(false);
    }
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (savingRef.current || offline) return;
    const title = draft.title.trim();
    if (!title) {
      setTitleError("Enter a title.");
      setFormError("");
      document.getElementById("task-title")?.focus();
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
        document.getElementById("task-title")?.focus();
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

  function rememberUnfinished(next: Task[], at: number) {
    const open = next.filter((item) => item.status !== "Done");
    writeCache(open, at);
    setSavedAt(at);
  }

  async function completeTask(task: Task) {
    if (offline || actingRef.current) return;
    actingRef.current = true;
    try {
      const response = await fetch(`/api/tasks/${task.id}/complete`, { method: "POST" });
      const body = (await response.json().catch(() => null)) as Task | { detail?: string } | null;
      if (response.status === 404) {
        setGone(body && "detail" in body && body.detail ? body.detail : "This task is no longer here.");
        void load();
        return;
      }
      if (!response.ok || !body || !("id" in body)) return;
      const nextTask = body as Task;
      const at = Date.now();
      const snap = readCache();
      if (snap) writeCache(snap.tasks.map((item) => (item.id === nextTask.id ? nextTask : item)), at);
      setTasks((current) => current.map((item) => (item.id === nextTask.id ? nextTask : item)));
      setSavedAt(at);
      if (!queryRef.current.trim()) void load();
    } catch {
      // The list stays as it was. Complete stays available once the network returns.
    } finally {
      actingRef.current = false;
    }
  }

  async function reopenTask(task: Task) {
    if (offline || actingRef.current) return;
    actingRef.current = true;
    try {
      const response = await fetch(`/api/tasks/${task.id}/reopen`, { method: "POST" });
      const body = (await response.json().catch(() => null)) as Task | { detail?: string } | null;
      if (response.status === 404) {
        setGone(body && "detail" in body && body.detail ? body.detail : "This task is no longer here.");
        void load();
        return;
      }
      if (!response.ok || !body || !("id" in body)) return;
      const nextTask = body as Task;
      const snap = readCache();
      const without = (snap?.tasks || []).filter((item) => item.id !== nextTask.id);
      rememberUnfinished([nextTask, ...without], Date.now());
      if (queryRef.current.trim()) {
        setTasks((current) => current.map((item) => (item.id === nextTask.id ? nextTask : item)));
      }
      void load();
    } catch {
      // The search row stays until the network returns.
    } finally {
      actingRef.current = false;
    }
  }

  function submitSearch(event: React.FormEvent) {
    event.preventDefault();
    if (offline) return;
    queryRef.current = query;
    void load();
  }

  useEffect(() => {
    if (offline || mode === "loading") return undefined;
    const handle = window.setTimeout(() => {
      if (query.trim() === queryRef.current.trim()) return;
      queryRef.current = query;
      void load();
    }, 250);
    return () => window.clearTimeout(handle);
  }, [query, offline, mode, load]);

  function clearSearch() {
    if (offline) return;
    queryRef.current = "";
    setQuery("");
    setActiveQuery("");
    void load();
  }

  const addDisabled = offline || mode !== "ready";
  const controlsDisabled = offline || mode !== "ready";
  const openTasks = tasks.filter((task) => task.status !== "Done");
  const completedTasks = activeQuery ? [] : tasks.filter((task) => task.status === "Done");
  const groups = useMemo(() => {
    const dir = sortOrder === "oldest" ? 1 : -1;
    const ordered = [...(activeQuery ? tasks : openTasks)].sort((left, right) => dir * ((left.createdAt || 0) - (right.createdAt || 0)) || (left.id < right.id ? -1 : 1));
    if (activeQuery || group === "all") return [{ key: "all", label: "", items: ordered }];
    const labelFor = (task: Task) => (group === "status" ? task.status : resolveTaskList(task.project, lists).label);
    const statusOrder = ["Doing", "To do", "Blocked"];
    const seen = [...new Set(ordered.map(labelFor))];
    const labels =
      group === "status"
        ? [...statusOrder.filter((status) => seen.includes(status as Task["status"])), ...seen.filter((status) => !statusOrder.includes(status))]
        : [...seen.filter((label) => label !== "No list").sort((a, b) => a.localeCompare(b)), ...seen.filter((label) => label === "No list")];
    return labels.map((label) => ({ key: label, label, items: ordered.filter((task) => labelFor(task) === label) }));
  }, [activeQuery, group, lists, openTasks, sortOrder, tasks]);
  const showFab = !wide && !offline && mode === "ready" && !activeQuery && openTasks.length > 0;
  const showAddBar = !showFab && !offline && !activeQuery && (wide || (mode === "ready" && openTasks.length === 0));
  function renderTask(task: Task) {
    const done = task.status === "Done";
    const meta = taskMeta(task, lists);
    const statusColor = STATUS_VAR[task.status] || "var(--muted)";
    const listColor = listAccent(resolveTaskList(task.project, lists).color);
    const accent = activeQuery ? "" : group === "status" ? statusColor : group === "project" ? listColor : "";
    const created = createdLabel(task.createdAt);
    return (
      <li
        key={task.id}
        className="card flex min-w-0 items-start gap-1 p-2"
        style={accent ? { boxShadow: `inset 4px 0 0 ${accent}`, backgroundColor: `color-mix(in srgb, ${accent} 8%, transparent)` } : undefined}
      >
        <button
          type="button"
          data-complete={done ? undefined : "true"}
          data-reopen={done ? "true" : undefined}
          className="grid h-11 w-11 shrink-0 place-items-center disabled:opacity-50"
          aria-label={done ? `Reopen ${task.title}` : `Complete ${task.title}`}
          disabled={controlsDisabled}
          onClick={() => void (done ? reopenTask(task) : completeTask(task))}
        >
          <span
            className="grid h-6 w-6 place-items-center rounded-full border-2"
            style={done ? { borderColor: "var(--gain)", background: "var(--gain)", color: "var(--on-gain)" } : { borderColor: "var(--subtle-border)" }}
          >
            {done ? <Icon name="check" size={14} /> : null}
          </span>
        </button>
        <div className="min-w-0 flex-1 py-2 pr-2">
          <button type="button" className="block w-full text-left disabled:opacity-50" aria-label={`Edit ${task.title}`} disabled={offline} onClick={() => openEdit(task)}>
            <div className="flex items-start justify-between gap-3">
              <h2 className={`min-w-0 break-words text-body font-medium ${done ? "text-muted line-through" : ""}`}>{task.title}</h2>
              <span data-done={done ? "true" : undefined} className="shrink-0 rounded-full px-2.5 py-1 text-meta font-medium" style={{ color: statusColor, backgroundColor: `color-mix(in srgb, ${statusColor} 8%, transparent)` }}>
                {task.status}
              </span>
            </div>
            {meta ? <p className="mt-1 break-words text-meta text-muted">{meta}</p> : null}
            {created ? <p className="mt-1 text-meta text-muted">{created}</p> : null}
            {task.notes ? <p className="mt-2 break-words text-meta leading-relaxed">{task.notes}</p> : null}
            {done && typeof task.completedAt === "number" ? <p className="mt-1 text-meta text-muted">{completedLabel(task.completedAt)}</p> : null}
            {task.bot ? <BotLine bot={task.bot} /> : null}
          </button>
          {done ? (
            <button
              type="button"
              data-reopen="true"
              className="mt-2 flex min-h-11 items-center justify-center rounded-xl border border-line px-3 text-body font-medium disabled:opacity-50"
              aria-label={`Reopen ${task.title}`}
              disabled={controlsDisabled}
              onClick={() => void reopenTask(task)}
            >
              Reopen
            </button>
          ) : null}
        </div>
      </li>
    );
  }

  return (
    <div data-ready={mode === "loading" ? undefined : "true"} data-layout={wide ? "panel" : "sheet"} className={`tasks-type ${wide ? "flex min-w-0 items-start gap-6" : "min-w-0"}`}>
      <div className="relative min-w-0 flex-1">
      <header className="flex items-start justify-between gap-3 px-5 pt-3">
        <div>
          <p className="text-meta text-muted">joehub</p>
          <h1 className="text-title font-medium">Tasks</h1>
        </div>
        <button type="button" aria-label="Search tasks" className="grid h-11 w-11 place-items-center text-ink" onClick={() => document.getElementById("task-search")?.focus()}>
          <Icon name="search" size={22} />
        </button>
      </header>
      {link === "offline" && savedAt ? (
        <p role="status" data-offline="true" data-link="offline" className="mx-4 mt-3 rounded-2xl border border-[#C9CEC8] bg-[#EEF0EC] px-3.5 py-3 text-meta font-medium">
          Offline
          <span className="mt-0.5 block text-meta font-normal text-muted">Last updated {formatDetroit(savedAt)}</span>
          <span className="block text-meta font-normal text-muted">America/Detroit</span>
        </p>
      ) : null}
      {link === "reconnecting" ? (
        <p role="status" data-offline="true" data-link="reconnecting" className="mx-4 mt-3 rounded-2xl border border-[#E9B94933] bg-[#E9B9491F] px-3.5 py-3 text-meta font-medium text-[#8A6B14]">
          Reconnecting…
        </p>
      ) : null}
      {link === "back" ? (
        <p role="status" data-link="back" className="mx-4 mt-3 flex items-center justify-between gap-3 rounded-2xl border border-[#2E8B6A33] bg-[#2E8B6A1F] px-3.5 py-3 text-meta font-medium text-[#246C53]">
          <span>Back online</span>
          <button type="button" className="min-h-11 px-2 text-meta font-medium text-muted" onClick={() => setLink("live")}>
            Dismiss
          </button>
        </p>
      ) : null}
      {offline ? (
        <div className="mt-3 px-4">
          <button type="button" className="flex min-h-11 w-full items-center justify-center rounded-xl border border-line bg-surface px-4 text-body font-medium text-muted" disabled>
            Add a task
          </button>
        </div>
      ) : null}
      {gone ? (
        <p role="alert" data-missing="true" className="mx-4 mt-3 rounded-xl bg-line px-3 py-2 text-meta font-medium">
          {gone}
        </p>
      ) : null}
      {mode === "ready" && !activeQuery && tasks.length === 0 ? null : (
      <>
      <form className="mt-4 px-4" onSubmit={submitSearch}>
        <label className="sr-only" htmlFor="task-search">
          Search tasks
        </label>
        <div className="flex min-h-12 items-center gap-2 rounded-full border border-line bg-surface px-3">
          <Icon name="search" size={18} className="shrink-0 text-muted" />
          <input
            id="task-search"
            type="search"
            value={query}
            placeholder="Search tasks"
            disabled={controlsDisabled}
            onChange={(event) => setQuery(event.target.value)}
            className="min-w-0 flex-1 bg-transparent py-3 text-base outline-none disabled:opacity-50"
            autoComplete="off"
          />
          {query ? (
            <button type="button" className="min-h-11 shrink-0 px-2 text-body text-muted disabled:opacity-50" onClick={clearSearch} disabled={controlsDisabled}>
              Clear
            </button>
          ) : null}
        </div>
      </form>
      <div className="mt-3 flex flex-wrap items-center gap-2 px-4" role="group" aria-label="Group tasks">
        {(
          [
            ["all", "All"],
            ["status", "Status"],
            ["project", "List"],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            aria-pressed={group === value}
            className={`min-h-11 rounded-full px-3 text-meta font-medium ${group === value ? "bg-ink text-white" : "border border-line bg-surface text-muted"}`}
            onClick={() => setGroup(value)}
          >
            {label}
          </button>
        ))}
      </div>
      {group !== "all" ? (
        <div className="mt-1 flex items-center gap-2 px-4">
          <span className="rounded-full bg-[#E6E8E4] px-3 py-1 text-meta font-medium text-muted">{group === "status" ? "Status" : "List"}</span>
          <button type="button" className="min-h-11 px-2 text-meta font-medium text-muted" onClick={() => setGroup("all")}>
            Clear
          </button>
        </div>
      ) : null}
      <div className="relative mt-1 flex justify-end px-4">
        <button
          type="button"
          className="inline-flex min-h-11 items-center px-2 text-meta font-medium text-muted"
          aria-expanded={sortOpen}
          aria-haspopup="menu"
          onClick={() => setSortOpen((open) => !open)}
        >
          {sortOrder === "newest" ? "Newest first" : "Oldest first"}
        </button>
        {sortOpen ? (
          <div role="menu" className="absolute right-4 top-11 z-10 min-w-40 rounded-xl border border-line bg-surface p-1 shadow-lg">
            {(["newest", "oldest"] as const).map((value) => (
              <button
                key={value}
                type="button"
                role="menuitemradio"
                aria-checked={sortOrder === value}
                className="flex min-h-11 w-full items-center justify-between px-3 text-left text-body"
                onClick={() => {
                  setSortOrder(value);
                  setSortOpen(false);
                }}
              >
                <span>{value === "newest" ? "Newest first" : "Oldest first"}</span>
                {sortOrder === value ? <span aria-hidden="true">✓</span> : null}
              </button>
            ))}
          </div>
        ) : null}
      </div>
      </>
      )}
      {activeQuery ? <p className="mt-2 px-5 text-meta text-muted">{tasks.length} {tasks.length === 1 ? "match" : "matches"}</p> : null}
      {mode === "loading" ? (
        <p className="mt-5 px-5 text-meta text-muted" role="status">
          Loading tasks…
        </p>
      ) : null}
      {mode === "error" ? (
        <div className="px-4">
          <div className="card mt-4 p-4">
            <h2 className="text-section font-medium">Tasks unavailable</h2>
            <p className="mt-2 text-body leading-relaxed text-muted">The unfinished list couldn’t be loaded.</p>
          </div>
          <button
            type="button"
            className="mt-4 flex min-h-11 w-full items-center justify-center rounded-xl border border-ink px-4 text-body font-medium"
            onClick={() => void load()}
          >
            Retry
          </button>
        </div>
      ) : null}
      {mode === "ready" && activeQuery && tasks.length === 0 ? (
        <div className="px-4" data-search-empty="true">
          <div className="card mt-4 p-4">
            <h2 className="text-section font-medium">No tasks match this search.</h2>
            <button
              type="button"
              className="mt-3 flex min-h-11 items-center text-body font-medium disabled:opacity-50"
              onClick={clearSearch}
              disabled={controlsDisabled}
            >
              Clear search
            </button>
          </div>
        </div>
      ) : null}
      {mode === "ready" && !activeQuery && openTasks.length === 0 ? (
        <div className="px-4" data-empty="true">
          <h2 className="mt-16 text-center text-section font-medium">No unfinished tasks.</h2>
        </div>
      ) : null}
      {mode === "ready" && (activeQuery ? tasks.length > 0 : openTasks.length > 0) ? (
        <div className="mt-4 space-y-4">
          {groups.map((section) => (
            <section key={section.key} aria-label={section.label || undefined}>
              {section.label ? (
                <h2 className="flex items-center justify-between px-5 text-meta font-medium">
                  <span>{section.label}</span>
                  <span className="font-medium text-muted">{section.items.length}</span>
                </h2>
              ) : null}
              <ul aria-label={activeQuery ? "Search results" : "Unfinished tasks"} className={`${section.label ? "mt-2" : ""} space-y-3 px-4`}>
                {section.items.map((task) => renderTask(task))}
              </ul>
            </section>
          ))}
        </div>
      ) : null}
      {mode === "ready" && !activeQuery && completedTasks.length > 0 ? (
        <section aria-label="Completed" className="mt-6" data-completed="true">
          <h2 className="flex items-center justify-between px-5 text-meta font-medium">
            <span>Completed</span>
            <span className="font-medium text-muted">{completedTasks.length}</span>
          </h2>
          <ul className="mt-2 space-y-3 px-4">{[...completedTasks].sort((left, right) => (sortOrder === "oldest" ? 1 : -1) * ((left.createdAt || 0) - (right.createdAt || 0)) || (left.id < right.id ? -1 : 1)).map((task) => renderTask(task))}</ul>
        </section>
      ) : null}
      {showAddBar && !offline ? (
        <div className="mt-4 px-4">
          <button
            type="button"
            className="flex min-h-12 w-full items-center justify-center rounded-2xl bg-ink px-4 text-body font-medium text-white disabled:opacity-50"
            onClick={openAdd}
            disabled={addDisabled}
          >
            Add a task
          </button>
        </div>
      ) : null}
      {showFab ? (
        <button type="button" aria-label="Add a task" className="fixed bottom-24 right-5 z-30 grid h-14 w-14 place-items-center rounded-full bg-ink text-white shadow-lg" onClick={openAdd}>
          <Icon name="plus" size={22} />
          <span className="sr-only">Add a task</span>
        </button>
      ) : null}
      </div>
      {wide && !sheet ? (
        <aside className="card mt-4 h-fit w-[420px] shrink-0 p-5">
          <h2 className="pt-8 text-center text-section font-medium text-muted">Select a task</h2>
        </aside>
      ) : null}
      {sheet && !manage ? (
        <Sheet
          title={sheet === "edit" ? "Edit task" : "Add a task"}
          onClose={cancel}
          frame
          dock={wide ? "panel" : "sheet"}
          header="slim"
          titleClassName="text-section font-medium"
          formId="task-form"
          saveLabel={saving ? "Saving…" : "Save"}
          saveDisabled={offline || saving}
          aside={
            wide && sheet === "edit" ? (
              <button
                type="button"
                className="inline-flex min-h-11 min-w-11 items-center justify-center px-2 text-body font-medium text-warn disabled:opacity-50"
                onClick={() => setConfirmDelete(true)}
                disabled={offline}
              >
                Delete
              </button>
            ) : null
          }
        >
          <form id="task-form" className="space-y-5" onSubmit={save}>
            {sheet === "edit" && !wide ? (
              <button type="button" className="flex min-h-11 min-w-11 items-center text-body font-medium text-warn disabled:opacity-50" onClick={() => setConfirmDelete(true)} disabled={offline}>
                Delete
              </button>
            ) : null}
            {sheet === "edit" && tasks.find((task) => task.id === editingId)?.bot ? (
              <BotLine bot={tasks.find((task) => task.id === editingId)!.bot!} />
            ) : null}
            <div>
            <label className="block text-meta font-medium" htmlFor="task-title">
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
              inputMode="text"
              enterKeyHint="next"
              className="relative z-10 mt-1 min-h-11 w-full min-w-0 rounded-xl border border-line bg-surface px-3 py-3 text-base"
              autoComplete="off"
            />
            {titleError ? (
              <p id="task-title-error" role="alert" className="mt-1 text-meta font-medium text-warn">
                {titleError}
              </p>
            ) : null}
            {sheet === "edit" && createdLabel(tasks.find((task) => task.id === editingId)?.createdAt ?? Number.NaN) ? (
              <p className="mt-2 text-meta text-muted">{createdLabel(tasks.find((task) => task.id === editingId)?.createdAt ?? Number.NaN)}</p>
            ) : null}
            </div>
            {!listOpen ? (<><div>
            <label className="block text-meta font-medium" htmlFor="task-notes">
              Notes
            </label>
            <textarea
              id="task-notes"
              value={draft.notes}
              onChange={(event) => setDraft({ ...draft, notes: event.target.value })}
              rows={3}
              enterKeyHint="next"
              className="mt-1 min-h-11 w-full min-w-0 rounded-xl border border-line bg-surface px-3 py-3 text-base"
            />
            </div>
            <div>
            <label className="block text-meta font-medium" htmlFor="task-due">
              Due date
            </label>
            <input
              id="task-due"
              type="date"
              value={draft.dueDate}
              onChange={(event) => setDraft({ ...draft, dueDate: event.target.value })}
              enterKeyHint="next"
              className="mt-1 min-h-11 w-full min-w-0 rounded-xl border border-line bg-surface px-3 py-3 text-base"
            />
            {sheet === "edit" ? (
              <div className="mt-1 flex justify-end">
                <button
                  type="button"
                  className="min-h-11 min-w-11 px-3 text-meta font-medium text-muted disabled:opacity-50"
                  disabled={offline}
                  onClick={() => setDraft({ ...draft, dueDate: detroitCalendarDate(Date.now()) })}
                >
                  Today
                </button>
              </div>
            ) : null}
            </div>
            <div>
            <label className="block text-meta font-medium" htmlFor="task-priority">
              Priority
            </label>
            <select
              id="task-priority"
              value={draft.priority}
              onChange={(event) => setDraft({ ...draft, priority: event.target.value as Draft["priority"] })}
              className="mt-1 min-h-11 w-full min-w-0 rounded-xl border border-line bg-surface px-3 py-3 text-base"
            >
              <option value="">None</option>
              <option>High</option>
              <option>Medium</option>
              <option>Low</option>
            </select>
            </div>
            <div>
            <label className="block text-meta font-medium" htmlFor="task-status">
              Status
            </label>
            <select
              id="task-status"
              value={draft.status}
              onChange={(event) => setDraft({ ...draft, status: event.target.value as Status })}
              className="mt-1 min-h-11 w-full min-w-0 rounded-xl border border-line bg-surface px-3 py-3 text-base"
            >
              <option>To do</option>
              <option>Doing</option>
              <option>Blocked</option>
              {sheet === "edit" ? <option>Done</option> : null}
            </select>
            </div>
            </>) : null}
            <TaskListMenu
              value={draft.project}
              label={draft.project ? resolveTaskList(draft.project, lists).label : "None"}
              lists={lists}
              legacy={[...new Set(tasks.map((task) => task.project).filter((project): project is string => Boolean(project) && !lists.some((list) => list.id === project)))]}
              open={listOpen}
              name={newListName}
              color={newListColor || nextPaletteColor(lists)}
              colorOpen={colorOpen}
              error={listError}
              onToggle={() => (listOpen ? setListOpen(false) : openListMenu())}
              onPick={(project) => {
                setDraft({ ...draft, project });
                setListOpen(false);
              }}
              onName={setNewListName}
              onColor={setNewListColor}
              onToggleColor={() => setColorOpen((open) => !open)}
              onAdd={() => void addList()}
              onManage={() => {
                setListOpen(false);
                setManage("home");
                setManageError("");
              }}
            />
            {formError ? (
              <p role="alert" className="text-meta font-medium text-warn">
                {formError}
              </p>
            ) : null}
          </form>
        </Sheet>
      ) : null}
      {manage ? (
        <ManageLists
          lists={lists}
          mode={manage}
          name={editName}
          color={editColor}
          error={manageError}
          moved={editList ? lists.find((list) => list.id === editList.id)?.count ?? 0 : 0}
          wide={wide}
          saving={manageSaving}
          onClose={() => setManage(null)}
          onNew={() => {
            setManage(null);
            openListMenu();
          }}
          onOpen={(list) => {
            setEditList(list);
            setEditName(list.name);
            setEditColor(list.color);
            setManageError("");
            setManage("edit");
          }}
          onName={setEditName}
          onColor={setEditColor}
          onSave={() => void saveListEdit()}
          onAskDelete={() => {
            setManageError("");
            setManage("delete");
          }}
          onDelete={() => void removeList()}
          onBack={() => {
            setManageError("");
            setManage(manage === "delete" ? "edit" : "home");
          }}
        />
      ) : null}
      {confirmDelete ? (
        <div id="delete-dialog" className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 pb-[calc(var(--primary-nav-height,84px)+28px)]" role="alertdialog" aria-labelledby="delete-title">
          <div className="card w-full max-w-phone p-5 shadow-2xl">
            <h2 id="delete-title" className="text-section font-medium">Delete this task?</h2>
            {formError ? <p role="alert" className="mt-2 text-meta font-medium text-warn">{formError}</p> : null}
            <button type="button" autoFocus className="mt-5 flex min-h-12 w-full items-center justify-center rounded-xl bg-warn text-body font-medium text-on-warn" onClick={() => void removeTask()}>
              Delete
            </button>
            <button type="button" className="mt-2 flex min-h-12 w-full items-center justify-center rounded-xl border border-ink text-body font-medium" onClick={() => setConfirmDelete(false)}>
              Cancel
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
