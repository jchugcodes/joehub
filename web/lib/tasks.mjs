import { detroitCalendarDate } from "./detroit-date.mjs";

function addCalendarDays(ymd, count) {
  const [year, month, day] = ymd.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + count);
  return date.toISOString().slice(0, 10);
}

export function completedRecently(task, now) {
  if (!task || task.status !== "Done" || typeof task.completedAt !== "number" || typeof now !== "number") return false;
  const today = detroitCalendarDate(now);
  const doneOn = detroitCalendarDate(task.completedAt);
  return doneOn <= today && doneOn >= addCalendarDays(today, -6);
}

export function recentCompletedNewestFirst(tasks, now) {
  return tasks
    .filter((task) => completedRecently(task, now))
    .sort((left, right) => right.completedAt - left.completedAt || (left.id < right.id ? -1 : 1));
}

export const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;
export const DONE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const TASK_NAMESPACE = "3f1a0c2e-7b44-4d5a-9e11-8c2b6a0d4f77";
const TASK_ID = /^[A-Za-z0-9-]{1,80}$/;
const PENDING_MS = 30 * 1000;
const PRIORITIES = new Set(["High", "Medium", "Low"]);
const CREATE_STATUSES = new Set(["To do", "Doing", "Blocked"]);
const PATCH_FIELDS = new Set(["title", "notes", "dueDate", "priority", "status", "project"]);

export const SAMPLE_TASKS = [
  {
    id: "a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1",
    title: "Sketch the sample poster",
    status: "Doing",
    priority: "High",
    project: "Home",
    bot: { name: "Cela", detail: "Building sample list · 60%", progress: 60 },
    createdAt: 1_762_000_000_000,
    updatedAt: 1_762_000_000_000,
  },
  {
    id: "b2b2b2b2-b2b2-4b2b-8b2b-b2b2b2b2b2b2",
    title: "Pack the example bag",
    notes: "Synthetic task. Not a real errand.",
    dueDate: "2026-11-15",
    priority: "Medium",
    status: "To do",
    project: "Errands",
    createdAt: 1_761_000_000_000,
    updatedAt: 1_761_000_000_000,
  },
  {
    id: "c3c3c3c3-c3c3-4c3c-8c3c-c3c3c3c3c3c3",
    title: "Hold for the sample reply",
    status: "Blocked",
    priority: "Low",
    bot: { name: "Scout", detail: "Waiting on your reply · 2 of 3 questions" },
    createdAt: 1_760_000_000_000,
    updatedAt: 1_760_000_000_000,
  },
];

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function isCalendarDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

export function validateTaskCreate(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, detail: "Task must be an object" };
  }
  if (body.bot != null || body.assignee != null) {
    return { ok: false, detail: "Bot assignment can't be changed." };
  }
  if (typeof body.title !== "string") return { ok: false, field: "title", detail: "Enter a title." };
  const title = body.title.trim();
  if (!title) return { ok: false, field: "title", detail: "Enter a title." };
  if (title.length > 200) return { ok: false, field: "title", detail: "Title is too long." };

  let notes = "";
  if (body.notes != null && body.notes !== "") {
    if (typeof body.notes !== "string") return { ok: false, field: "notes", detail: "Notes must be text." };
    notes = body.notes.trim();
    if (notes.length > 4000) return { ok: false, field: "notes", detail: "Notes are too long." };
  }

  let dueDate = "";
  if (body.dueDate != null && body.dueDate !== "") {
    if (typeof body.dueDate !== "string" || !isCalendarDate(body.dueDate)) {
      return { ok: false, field: "dueDate", detail: "Use a due date as YYYY-MM-DD." };
    }
    dueDate = body.dueDate;
  }

  let priority = "";
  if (body.priority != null && body.priority !== "") {
    if (typeof body.priority !== "string" || !PRIORITIES.has(body.priority)) {
      return { ok: false, field: "priority", detail: "Priority must be High, Medium, or Low." };
    }
    priority = body.priority;
  }

  let status = "To do";
  if (body.status != null && body.status !== "") {
    if (body.status === "Done") {
      return { ok: false, field: "status", detail: "Done isn't available when adding a task." };
    }
    if (typeof body.status !== "string" || !CREATE_STATUSES.has(body.status)) {
      return { ok: false, field: "status", detail: "Status must be To do, Doing, or Blocked." };
    }
    status = body.status;
  }

  let project = "";
  if (body.project != null && body.project !== "") {
    if (typeof body.project !== "string") return { ok: false, field: "project", detail: "Project must be text." };
    project = body.project.trim();
    if (project.length > 120) return { ok: false, field: "project", detail: "Project is too long." };
  }

  return { ok: true, title, notes, dueDate, priority, status, project };
}

function reject(field, detail) {
  const body = { ok: false, detail };
  if (field) body.field = field;
  return body;
}

export function isTaskId(id) {
  return typeof id === "string" && TASK_ID.test(id);
}

export function validateTaskPatch(body, now) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return reject("", "Task must be an object");
  }
  for (const key of Object.keys(body)) {
    if (!PATCH_FIELDS.has(key)) return reject(key, `${key} can't be changed.`);
  }
  const patch = {};
  if (Object.prototype.hasOwnProperty.call(body, "title")) {
    if (typeof body.title !== "string") return reject("title", "Enter a title.");
    const title = body.title.trim();
    if (!title) return reject("title", "Enter a title.");
    if (title.length > 200) return reject("title", "Title is too long.");
    patch.title = title;
  }
  if (Object.prototype.hasOwnProperty.call(body, "notes")) {
    if (body.notes == null || body.notes === "") patch.notes = null;
    else if (typeof body.notes !== "string") return reject("notes", "Notes must be text.");
    else {
      const notes = body.notes.trim();
      if (notes.length > 4000) return reject("notes", "Notes are too long.");
      patch.notes = notes || null;
    }
  }
  if (Object.prototype.hasOwnProperty.call(body, "dueDate")) {
    if (body.dueDate == null || body.dueDate === "") patch.dueDate = null;
    else if (body.dueDate === "today") patch.dueDate = detroitCalendarDate(now);
    else if (typeof body.dueDate !== "string" || !isCalendarDate(body.dueDate)) {
      return reject("dueDate", "Use a due date as YYYY-MM-DD.");
    } else patch.dueDate = body.dueDate;
  }
  if (Object.prototype.hasOwnProperty.call(body, "priority")) {
    if (body.priority == null || body.priority === "") patch.priority = null;
    else if (typeof body.priority !== "string" || !PRIORITIES.has(body.priority)) {
      return reject("priority", "Priority must be High, Medium, or Low.");
    } else patch.priority = body.priority;
  }
  if (Object.prototype.hasOwnProperty.call(body, "status")) {
    if (body.status === "Done") patch.status = "Done";
    else if (typeof body.status !== "string" || !CREATE_STATUSES.has(body.status)) {
      return reject("status", "Status must be To do, Doing, or Blocked.");
    } else patch.status = body.status;
  }
  if (Object.prototype.hasOwnProperty.call(body, "project")) {
    if (body.project == null || body.project === "") patch.project = null;
    else if (typeof body.project !== "string") return reject("project", "Project must be text.");
    else {
      const project = body.project.trim();
      if (project.length > 120) return reject("project", "Project is too long.");
      patch.project = project || null;
    }
  }
  return { ok: true, patch };
}

export function applyTaskPatch(existing, patch, now) {
  const next = structuredClone(existing);
  if (patch.title) next.title = patch.title;
  if (patch.status) next.status = patch.status;
  for (const key of ["notes", "dueDate", "priority", "project"]) {
    if (!Object.prototype.hasOwnProperty.call(patch, key)) continue;
    if (patch[key]) next[key] = patch[key];
    else delete next[key];
  }
  next.id = existing.id;
  next.createdAt = existing.createdAt;
  next.updatedAt = now > existing.updatedAt ? now : existing.updatedAt + 1;
  return next;
}

export function unfinishedNewestFirst(tasks) {
  return tasks
    .filter((task) => task && task.status !== "Done")
    .slice()
    .sort((left, right) => right.createdAt - left.createdAt || (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));
}

function taskFrom(parsed, id, now) {
  const task = {
    id,
    title: parsed.title,
    status: parsed.status,
    createdAt: now,
    updatedAt: now,
  };
  if (parsed.notes) task.notes = parsed.notes;
  if (parsed.dueDate) task.dueDate = parsed.dueDate;
  if (parsed.priority) task.priority = parsed.priority;
  if (parsed.project) task.project = parsed.project;
  return task;
}

function newTaskId() {
  return globalThis.crypto.randomUUID();
}

function uuidToBytes(uuid) {
  const hex = uuid.replace(/-/g, "");
  const out = new Uint8Array(16);
  for (let index = 0; index < 16; index += 1) out[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  return out;
}

export async function taskIdForKey(scope, key) {
  const name = new TextEncoder().encode(`${scope}\0${key}`);
  const data = new Uint8Array(16 + name.length);
  data.set(uuidToBytes(TASK_NAMESPACE), 0);
  data.set(name, 16);
  const digest = new Uint8Array(await globalThis.crypto.subtle.digest("SHA-1", data));
  const bytes = digest.slice(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function taskMatchesQuery(task, query) {
  const needle = String(query || "").trim().toLowerCase();
  if (!needle) return false;
  return [task.title, task.notes, task.project].some((part) => String(part || "").toLowerCase().includes(needle));
}

export function combineSearch(unfinished, recentDone, query) {
  const open = unfinishedNewestFirst(unfinished.filter((task) => taskMatchesQuery(task, query)));
  const done = recentDone
    .filter((task) => task && task.status === "Done" && taskMatchesQuery(task, query))
    .slice()
    .sort((left, right) => (right.completedAt || 0) - (left.completedAt || 0) || (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));
  return [...open, ...done];
}

export async function performCreate(backend, raw, idemKey, now, newId = newTaskId, scope = "") {
  const parsed = validateTaskCreate(raw);
  if (!parsed.ok) {
    const body = { detail: parsed.detail };
    if (parsed.field) body.field = parsed.field;
    return { status: 400, body };
  }
  const storedKey = idemKey && scope ? `${scope}\0${idemKey}` : idemKey;
  let claimed = false;
  if (storedKey) {
    const stored = await backend.readIdem(storedKey, now);
    if (stored) return stored;
    claimed = await backend.claimIdem(storedKey, now);
    if (!claimed) {
      for (let attempt = 0; attempt < 20; attempt += 1) {
        const again = await backend.readIdem(storedKey, now);
        if (again) return again;
        await delay(25);
      }
      return { status: 503, body: { detail: "unavailable" } };
    }
  }
  let created = false;
  try {
    if (storedKey) {
      const stored = await backend.readIdem(storedKey, now);
      if (stored) return stored;
    }
    const id = idemKey && newId === newTaskId ? await taskIdForKey(scope || "", idemKey) : newId();
    const task = taskFrom(parsed, id, now);
    const inserted = await backend.putTask(task);
    if (inserted === false) {
      const existing = await backend.getTask(id);
      if (!existing) throw new Error("unavailable");
      const replay = { status: 201, body: existing };
      if (storedKey) {
        try {
          await backend.writeIdem(storedKey, replay, now);
        } catch {
          // The stored task is still the one this key names.
        }
      }
      claimed = false;
      return replay;
    }
    created = true;
    const response = { status: 201, body: task };
    if (storedKey) {
      try {
        await backend.writeIdem(storedKey, response, now);
      } catch (error) {
        // The task is already stored. Keep the claim pointed at it so a retry
        // returns this task instead of inserting another one.
        try {
          await backend.noteCreated(storedKey, response, now);
        } catch {
          // Leave the short pending claim. Releasing it would allow a second task.
        }
        throw error;
      }
    }
    claimed = false;
    return response;
  } catch (error) {
    if (claimed && !created) {
      try {
        await backend.releasePending(storedKey, now);
      } catch {
        // The original store error is the one the caller should see.
      }
    }
    throw error;
  }
}

export async function performPatch(backend, id, raw, now) {
  if (!isTaskId(id)) return { status: 404, body: { detail: "This task is no longer here." } };
  const existing = await backend.getTask(id);
  if (!existing) return { status: 404, body: { detail: "This task is no longer here." } };
  const parsed = validateTaskPatch(raw, now);
  if (!parsed.ok) {
    const body = { detail: parsed.detail };
    if (parsed.field) body.field = parsed.field;
    return { status: 400, body };
  }
  const next = applyTaskPatch(existing, parsed.patch, now);
  if (parsed.patch.status === "Done" && existing.status !== "Done") next.completedAt = now;
  await backend.replaceTask(next);
  return { status: 200, body: next };
}

function touch(existing, now) {
  return now > existing.updatedAt ? now : existing.updatedAt + 1;
}

export async function performComplete(backend, id, now) {
  if (!isTaskId(id)) return { status: 404, body: { detail: "This task is no longer here." } };
  const existing = await backend.getTask(id);
  if (!existing) return { status: 404, body: { detail: "This task is no longer here." } };
  if (existing.status === "Done") return { status: 200, body: existing };
  const next = { ...existing, status: "Done", completedAt: now, updatedAt: touch(existing, now) };
  await backend.replaceTask(next);
  return { status: 200, body: next };
}

function dueForPurge(task, now) {
  return task && task.status === "Done" && typeof task.completedAt === "number" && task.completedAt < now - DONE_WINDOW_MS;
}

export async function performDelete(backend, id) {
  if (!isTaskId(id)) return { status: 404, body: { detail: "This task is no longer here." } };
  const existing = await backend.getTask(id);
  if (!existing) return { status: 404, body: { detail: "This task is no longer here." } };
  await backend.removeTask(id);
  return { status: 200, body: { deleted: true, id } };
}

export async function performReopen(backend, id, now) {
  if (!isTaskId(id)) return { status: 404, body: { detail: "This task is no longer here." } };
  const existing = await backend.getTask(id);
  if (!existing) return { status: 404, body: { detail: "This task is no longer here." } };
  if (existing.status !== "Done") return { status: 200, body: existing };
  const next = { ...existing, status: "To do", updatedAt: touch(existing, now) };
  delete next.completedAt;
  await backend.replaceTask(next);
  return { status: 200, body: next };
}

export function createMemoryBackend() {
  const tasks = new Map();
  const idem = new Map();
  return {
    tasks,
    idem,
    async putTask(task) {
      if (tasks.has(task.id)) return false;
      tasks.set(task.id, structuredClone(task));
      return true;
    },
    async replaceTask(task) {
      tasks.set(task.id, structuredClone(task));
    },
    async removeTask(id) {
      tasks.delete(id);
    },
    purge(now) {
      for (const [id, task] of tasks) {
        if (dueForPurge(task, now)) tasks.delete(id);
      }
    },
    async list(now) {
      const rows = [...tasks.values()];
      return [...unfinishedNewestFirst(rows), ...recentCompletedNewestFirst(rows, now)];
    },
    async search(query, now) {
      const rows = [...tasks.values()];
      const unfinished = rows.filter((task) => task.status !== "Done");
      const done = rows.filter((task) => task.status === "Done").sort((left, right) => (right.completedAt || 0) - (left.completedAt || 0));
      return combineSearch(unfinished, done, query);
    },
    async complete(id, now) {
      return performComplete(this, id, now);
    },
    async reopen(id, now) {
      return performReopen(this, id, now);
    },
    async getTask(id) {
      if (!isTaskId(id)) return null;
      const task = tasks.get(id);
      return task ? structuredClone(task) : null;
    },
    async readIdem(key, now) {
      const row = idem.get(key);
      if (!row || !row.response) return null;
      if (now >= row.expiresAt) {
        idem.delete(key);
        return null;
      }
      return structuredClone(row.response);
    },
    async writeIdem(key, response, now) {
      idem.set(key, { response: structuredClone(response), expiresAt: now + IDEMPOTENCY_TTL_MS });
    },
    async noteCreated(key, response, now) {
      const taskId = response && response.body ? response.body.id : "";
      idem.set(key, {
        response: structuredClone(response),
        expiresAt: now + IDEMPOTENCY_TTL_MS,
        taskId,
      });
    },
    async claimIdem(key, now) {
      const row = idem.get(key);
      if (row && row.response && now < row.expiresAt) return false;
      if (row && row.pendingUntil && now < row.pendingUntil && !row.response) return false;
      idem.set(key, { pendingUntil: now + PENDING_MS });
      return true;
    },
    async releasePending(key) {
      const row = idem.get(key);
      if (row && !row.response) idem.delete(key);
    },
  };
}

export function installMemoryTasks(store) {
  const backend = createMemoryBackend();
  if (process.env.JOEHUB_SEED_TASKS === "1") {
    for (const sample of SAMPLE_TASKS) backend.tasks.set(sample.id, structuredClone(sample));
  }
  store.listUnfinishedTasks = (now) => backend.list(now);
  store.searchTasks = (query, now) => backend.search(query, now);
  store.createTask = (raw, idemKey, now, scope) => performCreate(backend, raw, idemKey, now, newTaskId, scope || "");
  store.getTask = (id) => backend.getTask(id);
  store.patchTask = (id, raw, now) => performPatch(backend, id, raw, now);
  store.completeTask = (id, now) => backend.complete(id, now);
  store.reopenTask = (id, now) => backend.reopen(id, now);
  store.deleteTask = (id) => performDelete(backend, id);
  return store;
}
