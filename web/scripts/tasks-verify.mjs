import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { createClient } from "@libsql/client";
import { localLibsqlUrl, readLibsqlConfig, remoteLibsqlUrl } from "../lib/libsql-config.mjs";
import { createSqliteStore } from "../lib/store-sqlite.mjs";
import { combineSearch, recentCompletedNewestFirst, unfinishedNewestFirst } from "../lib/tasks.mjs";

const TASK_ID = /^[A-Za-z0-9-]{1,80}$/;
const QUIET = { VERCEL_ENV: "production" };

function same(left, right) {
  try {
    assert.deepEqual(left, right);
    return true;
  } catch {
    return false;
  }
}

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

export function createSnapshotStore(snapshot) {
  const tasks = (snapshot.tasks || []).map((entry) => clone(entry.body));
  const lists = (snapshot.lists || []).map((entry) => ({
    id: entry.id,
    name: entry.name,
    color: entry.color,
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
  }));
  const byId = new Map(tasks.map((task) => [task.id, task]));
  return {
    async listUnfinishedTasks(now) {
      return [...unfinishedNewestFirst(tasks), ...recentCompletedNewestFirst(tasks, now)];
    },
    async searchTasks(query, now) {
      const unfinished = tasks.filter((task) => task && task.status !== "Done");
      const done = tasks
        .filter((task) => task && task.status === "Done")
        .sort((left, right) => (right.completedAt || 0) - (left.completedAt || 0));
      return combineSearch(unfinished, done, query);
    },
    async getTask(id) {
      if (typeof id !== "string" || !TASK_ID.test(id)) return null;
      const task = byId.get(id);
      return task ? clone(task) : null;
    },
    async listLists() {
      const tally = new Map();
      for (const task of tasks) {
        if (!task || !task.project) continue;
        tally.set(task.project, (tally.get(task.project) || 0) + 1);
      }
      return lists
        .slice()
        .sort((left, right) => left.createdAt - right.createdAt || (left.id < right.id ? -1 : 1))
        .map((list) => ({ ...list, count: tally.get(list.id) || 0 }));
    },
  };
}

function add(bad, id) {
  if (id) bad.add(id);
}

function differIds(bad, left, right) {
  const leftIds = new Set((left || []).map((row) => row && row.id));
  const rightIds = new Set((right || []).map((row) => row && row.id));
  for (const id of leftIds) if (!rightIds.has(id)) add(bad, id);
  for (const id of rightIds) if (!leftIds.has(id)) add(bad, id);
  const rightById = new Map((right || []).filter((row) => row && row.id).map((row) => [row.id, row]));
  for (const row of left || []) {
    if (!row || !row.id) continue;
    if (rightById.has(row.id) && !same(row, rightById.get(row.id))) add(bad, row.id);
  }
  const leftOrder = (left || []).map((row) => (row && row.id) || "").join("\n");
  const rightOrder = (right || []).map((row) => (row && row.id) || "").join("\n");
  if (leftOrder !== rightOrder) {
    for (const id of leftIds) add(bad, id);
    for (const id of rightIds) add(bad, id);
  }
}

function statusCounts(tasks) {
  const counts = {};
  for (const task of tasks) {
    const status = task && typeof task.status === "string" ? task.status : "unknown";
    counts[status] = (counts[status] || 0) + 1;
  }
  return counts;
}

export async function verifyTasks(snapshot, client, now = Date.now()) {
  const source = createSnapshotStore(snapshot);
  const target = createSqliteStore({ client, env: QUIET });
  const bad = new Set();
  const sourceTasks = [];
  for (const entry of snapshot.tasks || []) {
    sourceTasks.push(await source.getTask(entry.id));
  }
  const stored = await client.execute("SELECT id FROM tasks ORDER BY id");
  const targetIds = stored.rows.map((row) => String(row.id));
  const sourceIds = (snapshot.tasks || []).map((entry) => entry.id);
  for (const id of sourceIds) if (!targetIds.includes(id)) add(bad, id);
  for (const id of targetIds) if (!sourceIds.includes(id)) add(bad, id);
  for (const id of new Set([...sourceIds, ...targetIds])) {
    if (!same(await source.getTask(id), await target.getTask(id))) add(bad, id);
  }
  differIds(bad, await source.listUnfinishedTasks(now), await target.listUnfinishedTasks(now));
  differIds(bad, await source.listLists(), await target.listLists());
  const queries = new Set();
  for (const task of sourceTasks) {
    if (!task) continue;
    if (typeof task.title === "string" && task.title.trim()) queries.add(task.title);
    if (typeof task.notes === "string" && task.notes.trim()) queries.add(task.notes);
  }
  for (const query of queries) differIds(bad, await source.searchTasks(query, now), await target.searchTasks(query, now));
  const targetTasks = [];
  for (const id of targetIds) targetTasks.push(await target.getTask(id));
  return {
    ok: bad.size === 0 && same(statusCounts(sourceTasks), statusCounts(targetTasks)),
    tasks: sourceTasks.length,
    lists: (snapshot.lists || []).length,
    statuses: statusCounts(sourceTasks),
    listCounts: (await source.listLists()).map((list) => [list.id, list.count]),
    ids: [...bad].sort(),
  };
}

export function formatVerifyReport(result) {
  const lines = [result.ok ? "PASS" : "FAIL", `tasks ${result.tasks}`, `lists ${result.lists}`];
  for (const status of Object.keys(result.statuses).sort()) lines.push(`status ${status} ${result.statuses[status]}`);
  for (const [id, count] of result.listCounts) lines.push(`list ${id} ${count}`);
  if (!result.ok) lines.push(`ids ${result.ids.join(" ")}`.trimEnd());
  return `${lines.join("\n")}\n`;
}

function readArgs(argv) {
  let snapshot = "";
  let url = "";
  let test = false;
  let now = Date.now();
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--test") test = true;
    else if (arg === "--snapshot") {
      snapshot = argv[i + 1] || "";
      i += 1;
    } else if (arg.startsWith("--snapshot=")) snapshot = arg.slice("--snapshot=".length);
    else if (arg === "--url") {
      url = argv[i + 1] || "";
      i += 1;
    } else if (arg.startsWith("--url=")) url = arg.slice("--url=".length);
    else if (arg === "--now") {
      now = Number(argv[i + 1]);
      i += 1;
    } else if (arg.startsWith("--now=")) now = Number(arg.slice("--now=".length));
    else throw new Error(`refusing to verify: unknown argument ${arg}`);
  }
  return { snapshot, url, test, now };
}

function assertVerifyUrl(url, { test = false } = {}) {
  const value = String(url || "").trim();
  if (!value) throw new Error("refusing to verify: libSQL URL is missing");
  if (!test && localLibsqlUrl(value)) throw new Error("refusing to verify: :memory: and file: URLs need --test");
  if (!test && !remoteLibsqlUrl(value)) {
    throw new Error("refusing to verify: libSQL URL must be a remote libsql:// or https:// database");
  }
  if (test && !localLibsqlUrl(value) && !remoteLibsqlUrl(value)) {
    throw new Error("refusing to verify: libSQL URL must be a remote libsql:// or https:// database");
  }
}

export async function runVerify(argv, env = process.env, io = {}) {
  const args = readArgs(argv);
  if (!args.snapshot) throw new Error("refusing to verify: snapshot path is missing");
  if (!Number.isFinite(args.now)) throw new Error("refusing to verify: now is not a time");
  const config = readLibsqlConfig(env);
  const url = String(args.url || config.url).trim();
  assertVerifyUrl(url, { test: args.test });
  if (remoteLibsqlUrl(url) && !config.authToken) throw new Error("refusing to verify: libSQL auth token is missing");
  let snapshot;
  try {
    snapshot = JSON.parse(await readFile(args.snapshot, "utf8"));
  } catch {
    throw new Error("refusing to verify: snapshot is not a tasks export");
  }
  if (!snapshot || snapshot.kind !== "joehub-tasks-snapshot") throw new Error("refusing to verify: snapshot is not a tasks export");
  const client = createClient({ url, ...(config.authToken ? { authToken: config.authToken } : {}) });
  try {
    const result = await verifyTasks(snapshot, client, args.now);
    const stdout = io.stdout || ((text) => process.stdout.write(text));
    stdout(formatVerifyReport(result));
    if (!result.ok && io.exitCode !== false) process.exitCode = 1;
    return result;
  } finally {
    client.close();
  }
}

async function main() {
  const result = await runVerify(process.argv.slice(2), process.env);
  if (!result.ok) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : "refusing to verify"}\n`);
    process.exitCode = 1;
  });
}
