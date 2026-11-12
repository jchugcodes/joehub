import { LIST_PALETTE } from "./list-display.mjs";

const PALETTE_LIGHT = new Set(LIST_PALETTE.map((slot) => slot.light.toLowerCase()));
const NAME_LIMIT = 80;

function cleanName(value) {
  if (typeof value !== "string") return { ok: false, detail: "Enter a list name." };
  const name = value.trim();
  if (!name) return { ok: false, detail: "Enter a list name." };
  if (name.length > NAME_LIMIT) return { ok: false, detail: "List name is too long." };
  return { ok: true, name };
}

function cleanColor(value, { required }) {
  if (value == null || value === "") {
    if (required) return { ok: false, detail: "Choose a color." };
    return { ok: true, color: null };
  }
  if (typeof value !== "string" || !PALETTE_LIGHT.has(value.toLowerCase())) return { ok: false, detail: "Choose a color." };
  const slot = LIST_PALETTE.find((item) => item.light.toLowerCase() === value.toLowerCase());
  return { ok: true, color: slot.light };
}

export function validateListCreate(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { ok: false, detail: "List must be an object." };
  const name = cleanName(body.name);
  if (!name.ok) return name;
  const color = cleanColor(body.color, { required: true });
  if (!color.ok) return color;
  return { ok: true, name: name.name, color: color.color };
}

export function validateListPatch(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { ok: false, detail: "List must be an object." };
  const keys = Object.keys(body);
  if (!keys.length) return { ok: false, detail: "List must include a field." };
  const patch = {};
  for (const key of keys) {
    if (key !== "name" && key !== "color") return { ok: false, detail: `${key} isn't accepted.` };
  }
  if (Object.prototype.hasOwnProperty.call(body, "name")) {
    const name = cleanName(body.name);
    if (!name.ok) return name;
    patch.name = name.name;
  }
  if (Object.prototype.hasOwnProperty.call(body, "color")) {
    const color = cleanColor(body.color, { required: false });
    if (!color.ok) return color;
    patch.color = color.color;
  }
  return { ok: true, patch };
}

function nameTaken(lists, name, exceptId) {
  const needle = name.trim().toLowerCase();
  return [...lists.values()].some((list) => list.id !== exceptId && list.name.trim().toLowerCase() === needle);
}

export function attachMemoryLists(backend) {
  const lists = new Map();
  function counts() {
    const tally = new Map();
    for (const task of backend.tasks.values()) {
      if (!task || !task.project) continue;
      tally.set(task.project, (tally.get(task.project) || 0) + 1);
    }
    return tally;
  }
  return {
    lists,
    async listLists() {
      const tally = counts();
      return [...lists.values()]
        .sort((left, right) => left.createdAt - right.createdAt || (left.id < right.id ? -1 : 1))
        .map((list) => ({ ...list, count: tally.get(list.id) || 0 }));
    },
    async createList(raw, now) {
      const parsed = validateListCreate(raw);
      if (!parsed.ok) return { status: 400, body: { detail: parsed.detail } };
      if (nameTaken(lists, parsed.name)) return { status: 409, body: { detail: "That list already exists." } };
      const id = globalThis.crypto.randomUUID();
      const list = { id, name: parsed.name, color: parsed.color, createdAt: now, updatedAt: now };
      lists.set(id, list);
      return { status: 201, body: { ...list, count: 0 } };
    },
    async patchList(id, raw, now) {
      const existing = lists.get(id);
      if (!existing) return { status: 404, body: { detail: "That list is no longer here." } };
      const parsed = validateListPatch(raw);
      if (!parsed.ok) return { status: 400, body: { detail: parsed.detail } };
      if (parsed.patch.name && nameTaken(lists, parsed.patch.name, id)) return { status: 409, body: { detail: "That list already exists." } };
      const next = { ...existing, ...parsed.patch, updatedAt: now };
      lists.set(id, next);
      return { status: 200, body: { ...next, count: counts().get(id) || 0 } };
    },
    async deleteList(id) {
      const existing = lists.get(id);
      if (!existing) return { status: 404, body: { detail: "That list is no longer here." } };
      let moved = 0;
      for (const [taskId, task] of backend.tasks) {
        if (!task || task.project !== id) continue;
        const createdAt = task.createdAt;
        const updatedAt = task.updatedAt;
        const next = { ...task, project: null };
        next.createdAt = createdAt;
        next.updatedAt = updatedAt;
        backend.tasks.set(taskId, next);
        moved += 1;
      }
      lists.delete(id);
      return { status: 200, body: { deleted: true, id, moved } };
    },
  };
}
