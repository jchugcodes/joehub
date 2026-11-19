import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { createClient } from "@libsql/client";
import { localLibsqlUrl, readLibsqlConfig, remoteLibsqlUrl } from "../lib/libsql-config.mjs";

function same(left, right) {
  try {
    assert.deepEqual(left, right);
    return true;
  } catch {
    return false;
  }
}

function add(bad, id) {
  if (id) bad.add(id);
}

function parseBody(raw) {
  return JSON.parse(String(raw));
}

export async function verifyFinance(snapshot, client) {
  const bad = new Set();
  const stored = await client.execute("SELECT entity, web_id, body FROM finance_docs");
  const byEntity = new Map();
  for (const row of stored.rows) {
    const entity = String(row.entity);
    if (!byEntity.has(entity)) byEntity.set(entity, new Map());
    byEntity.get(entity).set(String(row.web_id), parseBody(row.body));
  }
  function checkDocs(entity, entries) {
    const found = byEntity.get(entity) || new Map();
    const wanted = new Map((entries || []).map((entry) => [entry.id, entry.body]));
    for (const [id, body] of wanted) {
      if (!found.has(id) || !same(found.get(id), body)) add(bad, id);
    }
    for (const id of found.keys()) if (!wanted.has(id)) add(bad, id);
  }
  checkDocs("transaction", snapshot.transactions);
  checkDocs("account", snapshot.accounts);
  checkDocs("bill", snapshot.bills);

  const blobs = await client.execute("SELECT key, body FROM finance_blobs");
  const blob = new Map(blobs.rows.map((row) => [String(row.key), parseBody(row.body)]));
  if (!same(blob.get("goals") || [], snapshot.goals || [])) {
    const left = new Map((blob.get("goals") || []).map((goal) => [goal.slug, goal]));
    const right = new Map((snapshot.goals || []).map((goal) => [goal.slug, goal]));
    for (const [slug, goal] of right) if (!left.has(slug) || !same(left.get(slug), goal)) add(bad, slug);
    for (const slug of left.keys()) if (!right.has(slug)) add(bad, slug);
  }
  if (!same(blob.get("categories") ?? null, snapshot.categories ?? null)) add(bad, "categories");
  if (!same(blob.get("caps") ?? null, snapshot.caps ?? null)) add(bad, "caps");
  if (!same(blob.get("plan") ?? null, snapshot.plan ?? null)) add(bad, "plan");
  if (!same(blob.get("snapshots") ?? null, snapshot.snapshots ?? null)) add(bad, "snapshots");
  if (!same(blob.get("accounts") ?? null, snapshot.legacyAccounts ?? null)) add(bad, "legacy-accounts");

  const ids = [...bad].sort();
  return {
    ok: ids.length === 0,
    ids,
    transactions: (snapshot.transactions || []).length,
    accounts: (snapshot.accounts || []).length,
    bills: (snapshot.bills || []).length,
    goals: (snapshot.goals || []).length,
  };
}

export function formatVerifyReport(result) {
  const lines = [result.ok ? "PASS" : "FAIL"];
  if (!result.ok) {
    for (const id of result.ids) lines.push(`id ${id}`);
  }
  lines.push(`transactions ${result.transactions}`);
  lines.push(`accounts ${result.accounts}`);
  lines.push(`bills ${result.bills}`);
  lines.push(`goals ${result.goals}`);
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
    throw new Error("refusing to verify: snapshot is not a finance export");
  }
  if (!snapshot || snapshot.kind !== "joehub-finance-snapshot") throw new Error("refusing to verify: snapshot is not a finance export");
  const client = createClient({ url, ...(config.authToken ? { authToken: config.authToken } : {}) });
  try {
    const result = await verifyFinance(snapshot, client);
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
