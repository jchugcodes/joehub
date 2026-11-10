export const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;
const PENDING_MS = 30 * 1000;
const PRIORITIES = new Set(["High", "Medium", "Low"]);
const CREATE_STATUSES = new Set(["To do", "Doing", "Blocked"]);

export const HANDOFF_ID = "d4d4d4d4-d4d4-4d4d-8d4d-d4d4d4d4d4d4";

export function detroitDay(now = Date.now()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Detroit", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

export function buildSampleTasks(now = Date.now()) {
  return [
    {
      id: "a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1",
      title: "Sketch the sample poster",
      status: "Doing",
      priority: "High",
      project: "Home",
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
      createdAt: 1_760_000_000_000,
      updatedAt: 1_760_000_000_000,
    },
    {
      id: HANDOFF_ID,
      title: "Draft the handoff note",
      status: "To do",
      priority: "High",
      project: "joehub",
      dueDate: detroitDay(now),
      createdAt: 1_759_000_000_000,
      updatedAt: 1_759_000_000_000,
    },
  ];
}

export const SAMPLE_TASKS = buildSampleTasks();

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

export async function performCreate(backend, raw, idemKey, now, newId = newTaskId) {
  const parsed = validateTaskCreate(raw);
  if (!parsed.ok) {
    const body = { detail: parsed.detail };
    if (parsed.field) body.field = parsed.field;
    return { status: 400, body };
  }
  let claimed = false;
  if (idemKey) {
    const stored = await backend.readIdem(idemKey, now);
    if (stored) return stored;
    claimed = await backend.claimIdem(idemKey, now);
    if (!claimed) {
      for (let attempt = 0; attempt < 20; attempt += 1) {
        const again = await backend.readIdem(idemKey, now);
        if (again) return again;
        await delay(25);
      }
      return { status: 503, body: { detail: "unavailable" } };
    }
  }
  let created = false;
  try {
    if (idemKey) {
      const stored = await backend.readIdem(idemKey, now);
      if (stored) return stored;
    }
    const task = taskFrom(parsed, newId(), now);
    await backend.putTask(task);
    created = true;
    const response = { status: 201, body: task };
    if (idemKey) {
      try {
        await backend.writeIdem(idemKey, response, now);
      } catch (error) {
        // The task is already stored. Keep the claim pointed at it so a retry
        // returns this task instead of inserting another one.
        try {
          await backend.noteCreated(idemKey, response, now);
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
        await backend.releasePending(idemKey, now);
      } catch {
        // The original store error is the one the caller should see.
      }
    }
    throw error;
  }
}

export function createMemoryBackend() {
  const tasks = new Map();
  const idem = new Map();
  return {
    tasks,
    async putTask(task) {
      tasks.set(task.id, structuredClone(task));
    },
    async list() {
      return unfinishedNewestFirst([...tasks.values()]);
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
  store.listUnfinishedTasks = () => backend.list();
  store.createTask = (raw, idemKey, now) => performCreate(backend, raw, idemKey, now);
  return store;
}
