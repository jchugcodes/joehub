import { createClient } from "@libsql/client";
import { syntheticSeedEnabled } from "./seed.mjs";
import {
  isItemId,
  performCheck as performGroceryCheck,
  performClear as performGroceryClear,
  performCreate as performGroceryCreate,
  performDelete as performGroceryDelete,
  performPatch as performGroceryPatch,
  SAMPLE_GROCERY,
} from "./grocery.mjs";
import { validateListCreate, validateListPatch } from "./list-store.mjs";
import { readOptionalSourceId } from "./source-id.mjs";
import { createFinanceReads } from "./finance-box.mjs";
import { StoreError } from "./store-upstash.mjs";
import {
  buildSampleTasks,
  combineSearch,
  performComplete,
  performCreate,
  performDelete,
  performPatch,
  performReopen,
  recentCompletedNewestFirst,
  unfinishedNewestFirst,
} from "./tasks.mjs";

const IDEM_TTL_MS = 24 * 60 * 60 * 1000;
const CLAIM_MS = 30 * 1000;
const TASK_ID = /^[A-Za-z0-9-]{1,80}$/;

// Tasks tables come from web/migrations-libsql/003_tasks.sql.
// Grocery documents come from 004_grocery_and_lists.sql plus 006_grocery_documents.sql.
// Finance reads come from 007_finance_reads.sql. Writes stay off this store.
// createSqliteStore does not migrate.
const LIST_ID = /^[A-Za-z0-9-]{1,80}$/;
const TASK_METHODS = [
  "listUnfinishedTasks",
  "searchTasks",
  "createTask",
  "getTask",
  "patchTask",
  "completeTask",
  "reopenTask",
  "deleteTask",
  "listLists",
  "createList",
  "patchList",
  "deleteList",
];

function notMigrated() {
  throw new Error("not migrated");
}

function completedAt(task) {
  return typeof task.completedAt === "number" ? task.completedAt : null;
}

export function createSqliteStore({ client, url, authToken, env = process.env } = {}) {
  const db =
    client ||
    (url
      ? createClient({
          url,
          ...(authToken ? { authToken } : {}),
        })
      : null);
  if (!db) throw new Error("refusing to start: libSQL URL is missing");
  const allowSeed = syntheticSeedEnabled(env);

  async function run(sql, args = []) {
    return db.execute({ sql, args });
  }

  async function one(sql, args = []) {
    const result = await run(sql, args);
    return result.rows[0] || null;
  }

  function parse(raw) {
    try {
      return JSON.parse(raw);
    } catch {
      throw new StoreError();
    }
  }

  async function getTaskRow(id) {
    const row = await one("SELECT body FROM tasks WHERE id = ?", [id]);
    return row ? parse(row.body) : null;
  }

  async function idForSource(sourceId) {
    if (!sourceId) return "";
    const row = await one("SELECT id FROM tasks WHERE source_id = ? LIMIT 1", [sourceId]);
    return row ? String(row.id) : "";
  }

  async function claimSource(task) {
    if (!task.sourceId) return;
    await run("UPDATE tasks SET source_id = NULL WHERE source_id = ? AND id != ?", [task.sourceId, task.id]);
    await run("UPDATE tasks SET source_id = ? WHERE id = ?", [task.sourceId, task.id]);
  }

  const tasks = {
    async putTask(task) {
      const inserted = await run(
        `INSERT INTO tasks (id, body, status, created_at, completed_at, source_id)
         VALUES (?, ?, ?, ?, ?, NULL)
         ON CONFLICT(id) DO NOTHING`,
        [task.id, JSON.stringify(task), task.status, task.createdAt, completedAt(task)],
      );
      if (Number(inserted.rowsAffected) !== 1) return false;
      await claimSource(task);
      return true;
    },
    async replaceTask(task) {
      const body = JSON.stringify(task);
      const source = task.sourceId || null;
      if (source) await run("UPDATE tasks SET source_id = NULL WHERE source_id = ? AND id != ?", [source, task.id]);
      const updated = await run(
        "UPDATE tasks SET body = ?, status = ?, created_at = ?, completed_at = ?, source_id = ? WHERE id = ?",
        [body, task.status, task.createdAt, completedAt(task), source, task.id],
      );
      if (Number(updated.rowsAffected) === 0) {
        await run(
          "INSERT INTO tasks (id, body, status, created_at, completed_at, source_id) VALUES (?, ?, ?, ?, ?, ?)",
          [task.id, body, task.status, task.createdAt, completedAt(task), source],
        );
      }
    },
    async removeTask(id) {
      await run("DELETE FROM tasks WHERE id = ?", [id]);
    },
    async getTask(id) {
      if (typeof id !== "string" || !TASK_ID.test(id)) return null;
      return getTaskRow(id);
    },
    async readIdem(key, now = Date.now()) {
      const row = await one("SELECT body, expires_at FROM task_idempotency WHERE key = ?", [key]);
      if (!row) return null;
      if (Number(row.expires_at) <= now) {
        await run("DELETE FROM task_idempotency WHERE key = ?", [key]);
        return null;
      }
      const parsed = parse(row.body);
      if (parsed.status && parsed.body) return { status: parsed.status, body: parsed.body };
      if (parsed.pending && parsed.taskId) {
        const task = await getTaskRow(parsed.taskId);
        if (task) return { status: 201, body: task };
      }
      if (parsed.pending) return null;
      throw new StoreError();
    },
    async writeIdem(key, response, now = Date.now()) {
      await run(
        `INSERT INTO task_idempotency (key, body, expires_at) VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET body = excluded.body, expires_at = excluded.expires_at`,
        [key, JSON.stringify(response), now + IDEM_TTL_MS],
      );
    },
    async noteCreated(key, response, now = Date.now()) {
      const taskId = response && response.body ? response.body.id : "";
      await run(
        `INSERT INTO task_idempotency (key, body, expires_at) VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET body = excluded.body, expires_at = excluded.expires_at`,
        [key, JSON.stringify({ pending: true, taskId }), now + IDEM_TTL_MS],
      );
    },
    async claimIdem(key, now = Date.now()) {
      await run("DELETE FROM task_idempotency WHERE key = ? AND expires_at <= ?", [key, now]);
      const inserted = await run(
        `INSERT INTO task_idempotency (key, body, expires_at) VALUES (?, ?, ?)
         ON CONFLICT(key) DO NOTHING`,
        [key, JSON.stringify({ pending: true }), now + CLAIM_MS],
      );
      return Number(inserted.rowsAffected) === 1;
    },
    async releasePending(key) {
      const row = await one("SELECT body FROM task_idempotency WHERE key = ?", [key]);
      if (!row) return;
      const parsed = parse(row.body);
      if (parsed && parsed.pending && !parsed.taskId) await run("DELETE FROM task_idempotency WHERE key = ?", [key]);
    },
  };

  async function flag(key) {
    const row = await one("SELECT value FROM task_flags WHERE key = ?", [key]);
    return row ? row.value : null;
  }

  async function setFlag(key) {
    await run("INSERT INTO task_flags (key, value) VALUES (?, '1') ON CONFLICT(key) DO NOTHING", [key]);
  }

  async function placeSample(sample) {
    await run(
      `INSERT INTO tasks (id, body, status, created_at, completed_at, source_id)
       VALUES (?, ?, ?, ?, ?, NULL)
       ON CONFLICT(id) DO NOTHING`,
      [sample.id, JSON.stringify(sample), sample.status, sample.createdAt, completedAt(sample)],
    );
  }

  async function addMissingSamples(samples, version) {
    if ((await flag(`seeded:${version}`)) != null) return;
    for (const sample of samples) await placeSample(sample);
    await setFlag(`seeded:${version}`);
  }

  async function ensureBotSamples(samples) {
    if ((await flag("seeded:v2")) != null) return;
    for (const sample of samples) {
      if (!sample.bot) continue;
      const existing = await getTaskRow(sample.id);
      if (!existing) {
        await placeSample(sample);
        continue;
      }
      if (existing.bot) continue;
      await run("UPDATE tasks SET body = ? WHERE id = ?", [JSON.stringify({ ...existing, bot: sample.bot }), sample.id]);
    }
    await setFlag("seeded:v2");
  }

  async function ensureSeeded(now = Date.now()) {
    if (!allowSeed) return;
    const samples = buildSampleTasks(now);
    if ((await flag("seeded")) == null) {
      for (const sample of samples) await placeSample(sample);
      await setFlag("seeded");
    }
    await ensureBotSamples(samples);
    await addMissingSamples(
      samples.filter((sample) => sample.status !== "Done"),
      "v3",
    );
    await addMissingSamples(
      samples.filter((sample) => sample.status === "Done"),
      "v4",
    );
  }

  async function loadTasks() {
    const result = await run("SELECT body FROM tasks");
    return result.rows.map((row) => parse(row.body));
  }

  function listFrom(row) {
    return {
      id: String(row.id),
      name: String(row.name),
      color: String(row.color),
      createdAt: Number(row.created_at),
      updatedAt: Number(row.updated_at),
    };
  }

  async function loadLists() {
    const result = await run("SELECT id, name, color, created_at, updated_at FROM lists ORDER BY created_at, id");
    return result.rows.map(listFrom);
  }

  async function projectCounts() {
    const tally = new Map();
    for (const task of await loadTasks()) {
      if (!task || !task.project) continue;
      tally.set(task.project, (tally.get(task.project) || 0) + 1);
    }
    return tally;
  }

  async function listsWithCounts() {
    const tally = await projectCounts();
    return (await loadLists()).map((list) => ({ ...list, count: tally.get(list.id) || 0 }));
  }

  async function clearProject(listId) {
    const result = await run("SELECT body FROM tasks");
    let moved = 0;
    for (const row of result.rows) {
      const task = parse(row.body);
      if (!task || task.project !== listId) continue;
      const createdAt = task.createdAt;
      const updatedAt = task.updatedAt;
      const next = { ...task, project: null };
      next.createdAt = createdAt;
      next.updatedAt = updatedAt;
      await tasks.replaceTask(next);
      moved += 1;
    }
    return moved;
  }

  function groceryValues(item) {
    return [
      item.name,
      item.quantity || null,
      item.notes || null,
      item.section || null,
      item.checked ? 1 : 0,
      item.createdAt,
      item.updatedAt,
      item.sourceId || null,
      typeof item.checkedAt === "number" ? item.checkedAt : null,
      JSON.stringify(item),
    ];
  }

  const GROCERY_WRITE = `name = ?, quantity = ?, notes = ?, section = ?, checked = ?, created_at = ?, updated_at = ?, source_id = ?, checked_at = ?, body = ?`;

  async function claimGrocerySource(item) {
    if (!item.sourceId) return;
    await run("UPDATE grocery_items SET source_id = NULL WHERE source_id = ? AND id != ?", [item.sourceId, item.id]);
  }

  function itemScore(item) {
    if (item.checked) return typeof item.checkedAt === "number" ? item.checkedAt : item.updatedAt;
    return item.createdAt;
  }

  function byGroceryIndex(left, right) {
    return left.score - right.score || (left.id < right.id ? -1 : left.id > right.id ? 1 : 0);
  }

  const grocery = {
    async putItem(item) {
      const inserted = await run(
        `INSERT INTO grocery_items (
           id, name, quantity, notes, section, checked, created_at, updated_at, source_id, checked_at, body
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO NOTHING`,
        [item.id, ...groceryValues(item)],
      );
      if (Number(inserted.rowsAffected) !== 1) return false;
      await claimGrocerySource(item);
      return true;
    },
    async replaceItem(item) {
      const updated = await run(`UPDATE grocery_items SET ${GROCERY_WRITE} WHERE id = ?`, [...groceryValues(item), item.id]);
      if (Number(updated.rowsAffected) !== 1) return false;
      await claimGrocerySource(item);
      return true;
    },
    async moveItem(item) {
      return this.replaceItem(item);
    },
    async deleteItem(id) {
      if (!isItemId(id)) return false;
      const removed = await run("DELETE FROM grocery_items WHERE id = ?", [id]);
      return Number(removed.rowsAffected) === 1;
    },
    async getItem(id) {
      if (!isItemId(id)) return null;
      const row = await one("SELECT body FROM grocery_items WHERE id = ?", [id]);
      if (!row) return null;
      if (row.body == null || row.body === "") throw new StoreError();
      return parse(row.body);
    },
    async list() {
      const result = await run("SELECT id, body FROM grocery_items");
      const rows = result.rows.map((row) => {
        if (row.body == null || row.body === "") throw new StoreError();
        const item = parse(row.body);
        return { id: String(row.id), item, score: itemScore(item), checked: Boolean(item.checked) };
      });
      const unchecked = rows.filter((row) => !row.checked).sort(byGroceryIndex);
      const checked = rows.filter((row) => row.checked).sort(byGroceryIndex);
      return [...unchecked, ...checked].map((row) => row.item);
    },
    async readIdem(key, now = Date.now()) {
      const row = await one("SELECT body, expires_at FROM grocery_idempotency WHERE key = ?", [key]);
      if (!row) return null;
      if (Number(row.expires_at) <= now) {
        await run("DELETE FROM grocery_idempotency WHERE key = ?", [key]);
        return null;
      }
      const parsed = parse(row.body);
      if (parsed.status && parsed.body) return { status: parsed.status, body: parsed.body };
      if (parsed.pending && parsed.itemId) {
        const item = await this.getItem(parsed.itemId);
        if (item) return { status: 201, body: item };
      }
      if (parsed.pending) return null;
      throw new StoreError();
    },
    async writeIdem(key, response, now = Date.now()) {
      await run(
        `INSERT INTO grocery_idempotency (key, body, expires_at) VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET body = excluded.body, expires_at = excluded.expires_at`,
        [key, JSON.stringify(response), now + IDEM_TTL_MS],
      );
    },
    async noteCreated(key, response, now = Date.now()) {
      const itemId = response && response.body ? response.body.id : "";
      await run(
        `INSERT INTO grocery_idempotency (key, body, expires_at) VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET body = excluded.body, expires_at = excluded.expires_at`,
        [key, JSON.stringify({ pending: true, itemId }), now + IDEM_TTL_MS],
      );
    },
    async claimIdem(key, now = Date.now()) {
      await run("DELETE FROM grocery_idempotency WHERE key = ? AND expires_at <= ?", [key, now]);
      const inserted = await run(
        `INSERT INTO grocery_idempotency (key, body, expires_at) VALUES (?, ?, ?)
         ON CONFLICT(key) DO NOTHING`,
        [key, JSON.stringify({ pending: true }), now + CLAIM_MS],
      );
      return Number(inserted.rowsAffected) === 1;
    },
    async releasePending(key) {
      const row = await one("SELECT body FROM grocery_idempotency WHERE key = ?", [key]);
      if (!row) return;
      const parsed = parse(row.body);
      if (parsed && parsed.pending && !parsed.itemId) await run("DELETE FROM grocery_idempotency WHERE key = ?", [key]);
    },
  };

  async function groceryIdForSource(sourceId) {
    if (!sourceId) return "";
    const row = await one("SELECT id FROM grocery_items WHERE source_id = ? LIMIT 1", [sourceId]);
    return row ? String(row.id) : "";
  }

  async function ensureGrocerySeeded() {
    if (!allowSeed) return;
    const existing = await one("SELECT value FROM grocery_flags WHERE key = ?", ["seeded"]);
    if (existing) return;
    for (const sample of SAMPLE_GROCERY) {
      await run(
        `INSERT INTO grocery_items (
           id, name, quantity, notes, section, checked, created_at, updated_at, source_id, checked_at, body
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO NOTHING`,
        [sample.id, ...groceryValues(sample)],
      );
    }
    await run("INSERT INTO grocery_flags (key, value) VALUES ('seeded', '1') ON CONFLICT(key) DO NOTHING");
  }

  const api = {
    async listUnfinishedTasks(now) {
      await ensureSeeded(now);
      const rows = await loadTasks();
      return [...unfinishedNewestFirst(rows), ...recentCompletedNewestFirst(rows, now)];
    },
    async searchTasks(query, now) {
      await ensureSeeded(now);
      const rows = await loadTasks();
      const unfinished = rows.filter((task) => task && task.status !== "Done");
      const done = rows
        .filter((task) => task && task.status === "Done")
        .sort((left, right) => (right.completedAt || 0) - (left.completedAt || 0));
      return combineSearch(unfinished, done, query);
    },
    async createTask(raw, idemKey, now, scope) {
      await ensureSeeded();
      const source = readOptionalSourceId(raw || {});
      if (source.ok && source.sourceId) {
        const existingId = await idForSource(source.sourceId);
        if (existingId) {
          const existing = await tasks.getTask(existingId);
          if (existing) return performPatch(tasks, existingId, raw, now);
        }
      }
      return performCreate(tasks, raw, idemKey, now, undefined, scope || "");
    },
    async getTask(id) {
      await ensureSeeded();
      return tasks.getTask(id);
    },
    async patchTask(id, raw, now) {
      await ensureSeeded();
      return performPatch(tasks, id, raw, now);
    },
    async completeTask(id, now) {
      return performComplete(tasks, id, now);
    },
    async reopenTask(id, now) {
      return performReopen(tasks, id, now);
    },
    async deleteTask(id) {
      await ensureSeeded();
      return performDelete(tasks, id);
    },
    async listLists() {
      await ensureSeeded();
      return listsWithCounts();
    },
    async createList(raw, now) {
      const parsed = validateListCreate(raw);
      if (!parsed.ok) return { status: 400, body: { detail: parsed.detail } };
      await ensureSeeded();
      const existing = await loadLists();
      if (existing.some((list) => list.name.trim().toLowerCase() === parsed.name.toLowerCase())) {
        return { status: 409, body: { detail: "That list already exists." } };
      }
      const id = globalThis.crypto.randomUUID();
      const list = { id, name: parsed.name, color: parsed.color, createdAt: now, updatedAt: now };
      await run("INSERT INTO lists (id, name, color, created_at, updated_at) VALUES (?, ?, ?, ?, ?)", [
        list.id,
        list.name,
        list.color,
        list.createdAt,
        list.updatedAt,
      ]);
      return { status: 201, body: { ...list, count: 0 } };
    },
    async patchList(id, raw, now) {
      if (!LIST_ID.test(String(id || ""))) return { status: 404, body: { detail: "That list is no longer here." } };
      const rows = await loadLists();
      const existing = rows.find((list) => list.id === id);
      if (!existing) return { status: 404, body: { detail: "That list is no longer here." } };
      const parsed = validateListPatch(raw);
      if (!parsed.ok) return { status: 400, body: { detail: parsed.detail } };
      if (parsed.patch.name) {
        await ensureSeeded();
        if (rows.some((list) => list.id !== id && list.name.trim().toLowerCase() === parsed.patch.name.toLowerCase())) {
          return { status: 409, body: { detail: "That list already exists." } };
        }
      }
      const next = { ...existing, ...parsed.patch, createdAt: existing.createdAt, updatedAt: now };
      await ensureSeeded();
      await run("UPDATE lists SET name = ?, color = ?, updated_at = ? WHERE id = ?", [next.name, next.color, next.updatedAt, id]);
      const tally = (await listsWithCounts()).find((list) => list.id === id);
      return { status: 200, body: { ...next, count: tally ? tally.count : 0 } };
    },
    async deleteList(id) {
      if (!LIST_ID.test(String(id || ""))) return { status: 404, body: { detail: "That list is no longer here." } };
      const existing = (await loadLists()).find((list) => list.id === id);
      if (!existing) return { status: 404, body: { detail: "That list is no longer here." } };
      const moved = await clearProject(id);
      await run("DELETE FROM lists WHERE id = ?", [id]);
      return { status: 200, body: { deleted: true, id, moved } };
    },
    async listGrocery() {
      await ensureGrocerySeeded();
      return grocery.list();
    },
    async createGrocery(raw, idemKey, now, scope) {
      await ensureGrocerySeeded();
      const source = readOptionalSourceId(raw || {});
      if (source.ok && source.sourceId) {
        const existingId = await groceryIdForSource(source.sourceId);
        if (existingId) {
          const existing = await grocery.getItem(existingId);
          if (existing) return performGroceryPatch(grocery, existingId, raw, now);
        }
      }
      return performGroceryCreate(grocery, raw, idemKey, now, undefined, scope || "");
    },
    async getGrocery(id) {
      await ensureGrocerySeeded();
      return grocery.getItem(id);
    },
    async patchGrocery(id, raw, now) {
      await ensureGrocerySeeded();
      return performGroceryPatch(grocery, id, raw, now);
    },
    async deleteGrocery(id) {
      await ensureGrocerySeeded();
      return performGroceryDelete(grocery, id);
    },
    async checkGrocery(id, now) {
      await ensureGrocerySeeded();
      return performGroceryCheck(grocery, id, now, true);
    },
    async uncheckGrocery(id, now) {
      await ensureGrocerySeeded();
      return performGroceryCheck(grocery, id, now, false);
    },
    async clearGrocery() {
      await ensureGrocerySeeded();
      return performGroceryClear(grocery);
    },
    ...createFinanceReads({ execute: (query) => run(query.sql, query.args || []) }, { allowSeed, env }),
  };

  return new Proxy(api, {
    get(target, prop) {
      if (typeof prop !== "string") return target[prop];
      if (Object.prototype.hasOwnProperty.call(target, prop)) return target[prop];
      if (TASK_METHODS.includes(prop)) return target[prop];
      return notMigrated;
    },
  });
}
