import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

export { LIST_PALETTE, nextPaletteColor, resolveTaskList } from "./list-display.mjs";
export { attachMemoryLists, validateListCreate, validateListPatch } from "./list-store.mjs";

/** Fixed namespace so a list name always maps to the same id. */
export const LIST_NAMESPACE = "a3b1c2d4-e5f6-5718-8abc-def012345678";

export function uuidv5(name, namespace = LIST_NAMESPACE) {
  const ns = Buffer.from(String(namespace).replace(/-/g, ""), "hex");
  if (ns.length !== 16) throw new Error("namespace");
  const hash = createHash("sha1").update(ns).update(String(name), "utf8").digest();
  const bytes = Buffer.from(hash.subarray(0, 16));
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function listIdForName(name) {
  return uuidv5(String(name || "").trim().toLowerCase());
}

export function createdLine(createdAt, timeZone = "America/Detroit") {
  if (!Number.isFinite(createdAt)) return "";
  const ymd = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(createdAt);
  const month = Number(ymd.slice(5, 7));
  const day = Number(ymd.slice(8, 10));
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  if (!month || !day) return "";
  return `Created ${months[month - 1]} ${day}`;
}

export function sortByCreated(tasks, order) {
  const dir = order === "oldest" ? 1 : -1;
  return [...(Array.isArray(tasks) ? tasks : [])].sort((left, right) => {
    const delta = (Number(left && left.createdAt) || 0) - (Number(right && right.createdAt) || 0);
    if (delta) return dir * delta;
    const leftId = String(left && left.id ? left.id : "");
    const rightId = String(right && right.id ? right.id : "");
    return leftId < rightId ? -1 : leftId > rightId ? 1 : 0;
  });
}

const TASK_KEY = /^joehub:task:[^:]+$/;
const LIST_KEY = /^joehub:list:[^:]+$/;

function clone(value) {
  return value == null || typeof value !== "object" ? value : JSON.parse(JSON.stringify(value));
}

/**
 * Rewrite task.project from a display name to a list id.
 * Only task records and the list index change. Dates, scores, grocery, and session keys stay put.
 */
export function planListMigration(entries) {
  const copy = (Array.isArray(entries) ? entries : []).map((entry) => ({ key: entry.key, value: clone(entry.value) }));
  const lists = new Map();
  for (const entry of copy) {
    if (!LIST_KEY.test(entry.key) || !entry.value || typeof entry.value !== "object" || Array.isArray(entry.value)) continue;
    if (entry.value.id) lists.set(entry.value.id, entry.value);
  }
  const byName = new Map();
  for (const list of lists.values()) {
    if (typeof list.name === "string") byName.set(list.name.trim().toLowerCase(), list);
  }
  const tasks = copy
    .filter((entry) => TASK_KEY.test(entry.key) && entry.value && typeof entry.value === "object" && !Array.isArray(entry.value))
    .sort((left, right) => (Number(left.value.createdAt) || 0) - (Number(right.value.createdAt) || 0));
  const created = [];
  const rewritten = [];
  for (const entry of tasks) {
    const project = entry.value.project;
    if (typeof project !== "string" || !project.trim()) continue;
    if (lists.has(project)) continue;
    const needle = project.trim().toLowerCase();
    let list = byName.get(needle);
    if (!list) {
      const id = listIdForName(needle);
      list = lists.get(id);
      if (!list) {
        const at = Number(entry.value.createdAt) || 0;
        list = { id, name: project.trim(), color: null, createdAt: at, updatedAt: at };
        lists.set(id, list);
        byName.set(needle, list);
        created.push(list);
        copy.push({ key: `joehub:list:${id}`, value: list });
      }
    }
    const createdAt = entry.value.createdAt;
    const updatedAt = entry.value.updatedAt;
    entry.value.project = list.id;
    entry.value.createdAt = createdAt;
    entry.value.updatedAt = updatedAt;
    rewritten.push(entry.key);
  }
  if (created.length) {
    let index = copy.find((entry) => entry.key === "joehub:lists");
    if (!index) {
      index = { key: "joehub:lists", value: [] };
      copy.push(index);
    }
    if (!Array.isArray(index.value)) index.value = [];
    for (const list of created) {
      if (!index.value.some((member) => member && member.member === list.id)) {
        index.value.push({ member: list.id, score: list.createdAt });
      }
    }
  }
  return { entries: copy, created, rewritten };
}

export function encryptBackup(plaintext, key) {
  if (!Buffer.isBuffer(key) || key.length !== 32) throw new Error("backup key");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const data = Buffer.concat([cipher.update(String(plaintext), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    ciphertext: Buffer.concat([iv, tag, data]).toString("base64"),
    sha256: createHash("sha256").update(String(plaintext), "utf8").digest("hex"),
  };
}

export function decryptBackup(ciphertext, key) {
  const body = Buffer.from(String(ciphertext), "base64");
  const iv = body.subarray(0, 12);
  const tag = body.subarray(12, 28);
  const data = body.subarray(28);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
}
