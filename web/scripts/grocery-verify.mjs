import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { createClient } from "@libsql/client";
import { isItemId } from "../lib/grocery.mjs";
import { localLibsqlUrl, readLibsqlConfig, remoteLibsqlUrl } from "../lib/libsql-config.mjs";
import { createSqliteStore } from "../lib/store-sqlite.mjs";

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

function score(item) {
  if (item.checked) return typeof item.checkedAt === "number" ? item.checkedAt : item.updatedAt;
  return item.createdAt;
}

function byIndex(left, right) {
  return left.score - right.score || (left.id < right.id ? -1 : left.id > right.id ? 1 : 0);
}

export function createSnapshotStore(snapshot) {
  const items = (snapshot.items || []).map((entry) => clone(entry.body));
  const byId = new Map(items.map((item) => [item.id, item]));
  return {
    async listGrocery() {
      const rows = items.map((item) => ({ id: item.id, item, score: score(item), checked: Boolean(item.checked) }));
      const unchecked = rows.filter((row) => !row.checked).sort(byIndex);
      const checked = rows.filter((row) => row.checked).sort(byIndex);
      return [...unchecked, ...checked].map((row) => clone(row.item));
    },
    async getGrocery(id) {
      if (!isItemId(id)) return null;
      const item = byId.get(id);
      return item ? clone(item) : null;
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

export async function verifyGrocery(snapshot, client) {
  const source = createSnapshotStore(snapshot);
  const target = createSqliteStore({ client, env: QUIET });
  const bad = new Set();
  const stored = await client.execute("SELECT id FROM grocery_items ORDER BY id");
  const targetIds = stored.rows.map((row) => String(row.id));
  const sourceIds = (snapshot.items || []).map((entry) => entry.id);
  for (const id of sourceIds) if (!targetIds.includes(id)) add(bad, id);
  for (const id of targetIds) if (!sourceIds.includes(id)) add(bad, id);
  for (const id of new Set([...sourceIds, ...targetIds])) {
    if (!same(await source.getGrocery(id), await target.getGrocery(id))) add(bad, id);
  }
  const listed = await source.listGrocery();
  differIds(bad, listed, await target.listGrocery());
  const items = (snapshot.items || []).map((entry) => entry.body).filter(Boolean);
  return {
    ok: bad.size === 0,
    items: items.length,
    unchecked: items.filter((item) => !item.checked).length,
    checked: items.filter((item) => item.checked).length,
    ids: [...bad].sort(),
  };
}

export function formatVerifyReport(result) {
  const lines = [result.ok ? "PASS" : "FAIL", `items ${result.items}`, `unchecked ${result.unchecked}`, `checked ${result.checked}`];
  if (!result.ok) lines.push(`ids ${result.ids.join(" ")}`.trimEnd());
  return `${lines.join("\n")}\n`;
}

function readArgs(argv) {
  let snapshot = "";
  let url = "";
  let test = false;
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
    else throw new Error(`refusing to verify: unknown argument ${arg}`);
  }
  return { snapshot, url, test };
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
  const config = readLibsqlConfig(env);
  const url = String(args.url || config.url).trim();
  assertVerifyUrl(url, { test: args.test });
  if (remoteLibsqlUrl(url) && !config.authToken) throw new Error("refusing to verify: libSQL auth token is missing");
  let snapshot;
  try {
    snapshot = JSON.parse(await readFile(args.snapshot, "utf8"));
  } catch {
    throw new Error("refusing to verify: snapshot is not a grocery export");
  }
  if (!snapshot || snapshot.kind !== "joehub-grocery-snapshot") throw new Error("refusing to verify: snapshot is not a grocery export");
  const client = createClient({ url, ...(config.authToken ? { authToken: config.authToken } : {}) });
  try {
    const result = await verifyGrocery(snapshot, client);
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
