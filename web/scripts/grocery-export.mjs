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

const ITEM_DOC = /^joehub:grocery:item:[A-Za-z0-9-]{1,80}$/;

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

function parseDocument(raw, id) {
  if (typeof raw !== "string") throw new Error("refusing to export: a record was missing");
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("refusing to export: a record was not JSON");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("refusing to export: a record was not JSON");
  if (parsed.id !== id) throw new Error("refusing to export: a key does not match its id");
  return parsed;
}

export async function exportGrocery({ url, token, prefixEnv, out }) {
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
  const itemKeys = [];
  for (const key of keys) {
    const logical = logicalKey(prefix.prefix, key);
    if (ITEM_DOC.test(logical)) itemKeys.push(key);
  }
  const values = await readValues(command, itemKeys);
  const items = itemKeys.map((key) => {
    const logical = logicalKey(prefix.prefix, key);
    const id = logical.slice("joehub:grocery:item:".length);
    return { id, body: parseDocument(values.get(key), id) };
  });
  items.sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));
  const snapshot = { kind: "joehub-grocery-snapshot", version: 1, prefix: prefix.prefix, items };
  const text = `${JSON.stringify(snapshot, null, 2)}\n`;
  await writeFile(out, text, { mode: 0o600, flag: "w" });
  await chmod(out, 0o600);
  const sha256 = createHash("sha256").update(text).digest("hex");
  return { items: items.length, sha256, out };
}

export function formatExportReport(result) {
  return `items ${result.items}\nsha256 ${result.sha256}\n`;
}

export async function runExport(argv, env = process.env, io = {}) {
  const args = readArgs(argv);
  if (!args.ok) throw new Error("refusing to export: Joe's OK is required");
  if (!args.out) throw new Error("refusing to export: snapshot path is missing");
  const result = await exportGrocery({
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
