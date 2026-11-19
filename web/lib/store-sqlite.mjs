import { createClient } from "@libsql/client";
import { syntheticSeedEnabled } from "./seed.mjs";
import { readOptionalSourceId } from "./source-id.mjs";
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
// createSqliteStore does not migrate.
const TASK_METHODS = [
  "listUnfinishedTasks",
  "searchTasks",
  "createTask",
  "getTask",
  "patchTask",
  "completeTask",
  "reopenTask",
  "deleteTask",
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
