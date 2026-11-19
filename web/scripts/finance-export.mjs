import { createHash } from "node:crypto";
import { chmod, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { readKeyPrefix } from "../lib/keys.mjs";

const READS = new Set([
  "GET",
  "MGET",
  "SCAN",
  "SMEMBERS",
  "ZRANGE",
  "ZREVRANGE",
  "ZRANGEBYSCORE",
  "ZCARD",
  "EXISTS",
  "TYPE",
  "TTL",
  "PTTL",
  "HGET",
  "HGETALL",
  "HKEYS",
  "SCARD",
  "SISMEMBER",
  "ZSCORE",
  "PING",
  "ECHO",
  "STRLEN",
]);

const TXN_ID = /^[A-Za-z0-9._:-]{1,80}$/;
const ACCOUNT_ID = /^acct-[A-Za-z0-9._:-]{1,70}$/;
const BILL_ID = /^bill-[A-Za-z0-9._:-]{1,70}$/;

export function assertReadCommand(args) {
  const op = String((args && args[0]) || "").toUpperCase();
  if (!READS.has(op)) throw new Error(`refusing to export: ${op || "command"} is not a read`);
}

function readArgs(argv) {
  let out = "";
  let url = "";
  let token = "";
  let ok = false;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--i-have-joes-ok") ok = true;
    else if (arg === "--out") {
      out = argv[i + 1] || "";
      i += 1;
    } else if (arg.startsWith("--out=")) out = arg.slice("--out=".length);
    else if (arg === "--url") {
      url = argv[i + 1] || "";
      i += 1;
    } else if (arg.startsWith("--url=")) url = arg.slice("--url=".length);
    else if (arg === "--token") {
      token = argv[i + 1] || "";
      i += 1;
    } else if (arg.startsWith("--token=")) token = arg.slice("--token=".length);
    else throw new Error(`refusing to export: unknown argument ${arg}`);
  }
  return { out, url, token, ok };
}

function logicalKey(prefix, key) {
  if (!key.startsWith(prefix)) return "";
  return `joehub:${key.slice(prefix.length)}`;
}

function classify(logical) {
  if (logical === "joehub:finance:categories") return { kind: "categories" };
  if (logical === "joehub:finance:caps") return { kind: "caps" };
  if (logical === "joehub:finance:plan") return { kind: "plan" };
  if (logical === "joehub:finance:goals") return { kind: "goals" };
  if (logical === "joehub:finance:snapshots") return { kind: "snapshots" };
  if (logical === "joehub:finance:accounts") return { kind: "legacyAccounts" };
  if (logical.startsWith("joehub:finance:txn:")) {
    const id = logical.slice("joehub:finance:txn:".length);
    if (id.startsWith("idem:") || id.startsWith("bysource:")) return null;
    if (!TXN_ID.test(id)) return null;
    return { kind: "transaction", id };
  }
  if (logical.startsWith("joehub:finance:account:")) {
    const id = logical.slice("joehub:finance:account:".length);
    if (id.startsWith("idem:")) return null;
    if (!ACCOUNT_ID.test(id)) return null;
    return { kind: "account", id };
  }
  if (logical.startsWith("joehub:finance:bill:")) {
    const id = logical.slice("joehub:finance:bill:".length);
    if (id.startsWith("idem:")) return null;
    if (!BILL_ID.test(id)) return null;
    return { kind: "bill", id };
  }
  return null;
}

async function readAllKeys(command, prefix) {
  const keys = [];
  let cursor = "0";
  do {
    const page = await command(["SCAN", cursor, "MATCH", `${prefix}*`, "COUNT", "200"]);
    if (!Array.isArray(page) || page.length < 2 || !Array.isArray(page[1])) {
      throw new Error("refusing to export: Upstash read failed");
    }
    cursor = String(page[0]);
    keys.push(...page[1].map(String));
  } while (cursor !== "0");
  return keys;
}

async function readValues(command, keys) {
  const values = new Map();
  for (let i = 0; i < keys.length; i += 40) {
    const chunk = keys.slice(i, i + 40);
    const raws = await command(["MGET", ...chunk]);
    if (!Array.isArray(raws) || raws.length !== chunk.length) throw new Error("refusing to export: Upstash read failed");
    chunk.forEach((key, index) => values.set(key, raws[index]));
  }
  return values;
}

function parseJson(raw) {
  if (typeof raw !== "string") throw new Error("refusing to export: a record was missing");
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error("refusing to export: a record was not JSON");
  }
}

function byId(left, right) {
  return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
}

export function formatFinanceCounts(result) {
  return `transactions ${result.transactions}\naccounts ${result.accounts}\nbills ${result.bills}\ngoals ${result.goals}\n`;
}

export async function exportFinance({ url, token, prefixEnv, out }) {
  const prefix = readKeyPrefix(prefixEnv);
  if (!prefix.ok) throw new Error("refusing to export: key prefix is invalid");
  if (!url || !token) throw new Error("refusing to export: Upstash credentials are missing");
  async function command(args) {
    assertReadCommand(args);
    let response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify(args),
      });
    } catch {
      throw new Error("refusing to export: Upstash read failed");
    }
    if (!response.ok) throw new Error("refusing to export: Upstash read failed");
    let payload;
    try {
      payload = await response.json();
    } catch {
      throw new Error("refusing to export: Upstash read failed");
    }
    if (!payload || Object.prototype.hasOwnProperty.call(payload, "error")) throw new Error("refusing to export: Upstash read failed");
    return payload.result;
  }

  const keys = await readAllKeys(command, prefix.prefix);
  const selected = [];
  for (const key of keys) {
    const found = classify(logicalKey(prefix.prefix, key));
    if (found) selected.push({ key, ...found });
  }
  const values = await readValues(command, selected.map((item) => item.key));
  const snapshot = {
    kind: "joehub-finance-snapshot",
    version: 1,
    prefix: prefix.prefix,
    categories: null,
    caps: null,
    plan: null,
    goals: [],
    snapshots: null,
    legacyAccounts: null,
    transactions: [],
    accounts: [],
    bills: [],
  };
  for (const item of selected) {
    const parsed = parseJson(values.get(item.key));
    if (item.kind === "transaction" || item.kind === "account" || item.kind === "bill") {
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) || parsed.id !== item.id) {
        throw new Error("refusing to export: a key does not match its id");
      }
      snapshot[`${item.kind}s`].push({ id: item.id, body: parsed });
    } else if (item.kind === "goals") {
      if (!Array.isArray(parsed)) throw new Error("refusing to export: a record was not JSON");
      snapshot.goals = parsed;
    } else {
      snapshot[item.kind] = parsed;
    }
  }
  snapshot.transactions.sort(byId);
  snapshot.accounts.sort(byId);
  snapshot.bills.sort(byId);
  const text = `${JSON.stringify(snapshot, null, 2)}\n`;
  await writeFile(out, text, { mode: 0o600, flag: "w" });
  await chmod(out, 0o600);
  const sha256 = createHash("sha256").update(text).digest("hex");
  return {
    transactions: snapshot.transactions.length,
    accounts: snapshot.accounts.length,
    bills: snapshot.bills.length,
    goals: snapshot.goals.length,
    sha256,
    out,
  };
}

export function formatExportReport(result) {
  return `${formatFinanceCounts(result)}sha256 ${result.sha256}\n`;
}

export async function runExport(argv, env = process.env, io = {}) {
  const args = readArgs(argv);
  if (!args.ok) throw new Error("refusing to export: Joe's OK is required");
  if (!args.out) throw new Error("refusing to export: snapshot path is missing");
  const result = await exportFinance({
    url: args.url || env.UPSTASH_REDIS_REST_URL || "",
    token: args.token || env.UPSTASH_REDIS_REST_TOKEN || "",
    prefixEnv: env,
    out: args.out,
  });
  const stdout = io.stdout || ((text) => process.stdout.write(text));
  stdout(formatExportReport(result));
  return result;
}

async function main() {
  await runExport(process.argv.slice(2), process.env);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : "refusing to export"}\n`);
    process.exitCode = 1;
  });
}
