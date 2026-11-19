import { randomBytes, randomUUID } from "node:crypto";
import { createClient } from "@libsql/client";
import { pathToFileURL } from "node:url";
import { tokenDigest } from "../lib/ingest.mjs";
import { isFileOrMemoryUrl, migrateLibsql, utcStamp } from "./libsql-migrate.mjs";

const NAMES = { ledger: "Ledger", scout: "Scout", cato: "Cato" };

function remoteLibsqlUrl(value) {
  if (!value || value === ":memory:" || String(value).toLowerCase().startsWith("file:")) return false;
  let url;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== "libsql:" && url.protocol !== "https:") return false;
  return url.hostname.length > 0;
}

export function assertIngestUrl(url, { test = false } = {}) {
  const value = String(url || "").trim();
  if (!value) throw new Error("refusing to mint: libSQL URL is missing");
  if (test) {
    if (!isFileOrMemoryUrl(value)) throw new Error("refusing to mint: --test is only for :memory: and file: URLs");
    return;
  }
  if (!remoteLibsqlUrl(value)) {
    throw new Error("refusing to mint: libSQL URL must be a remote libsql:// or https:// database");
  }
}

export function principalName(value) {
  const name = NAMES[String(value || "").trim().toLowerCase()];
  if (!name) throw new Error("refusing to mint: principal must be ledger, scout, or cato");
  return name;
}

export function newIngestToken() {
  return `jht_${randomBytes(32).toString("base64url")}`;
}

export async function mintIngestToken(client, principal, now = new Date()) {
  const name = principalName(principal);
  const token = newIngestToken();
  const digest = tokenDigest(token);
  const stamp = utcStamp(now);
  const existing = await client.execute({
    sql: "SELECT id FROM principals WHERE name = ?",
    args: [name],
  });
  if (existing.rows[0]) {
    await client.execute({
      sql: `UPDATE principals
            SET token_sha256 = ?, last_modified_by = ?, last_modified_at = ?
            WHERE name = ?`,
      args: [digest, "system", stamp, name],
    });
  } else {
    await client.execute({
      sql: `INSERT INTO principals (
              id, notion_id, migrated_on, last_modified_by, last_modified_at,
              name, kind, owner_name, token_sha256
            ) VALUES (?, NULL, NULL, 'system', ?, ?, 'owner', ?, ?)`,
      args: [randomUUID(), stamp, name, name, digest],
    });
  }
  return token;
}

function readArgs(argv) {
  let url = process.env.JOEHUB_LIBSQL_URL || "";
  let principal = "";
  let test = false;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--test") test = true;
    else if (arg === "--url") {
      url = argv[i + 1] || "";
      i += 1;
    } else if (arg.startsWith("--url=")) url = arg.slice("--url=".length);
    else if (arg === "--principal") {
      principal = argv[i + 1] || "";
      i += 1;
    } else if (arg.startsWith("--principal=")) principal = arg.slice("--principal=".length);
    else throw new Error(`refusing to mint: unknown argument ${arg}`);
  }
  return { url, principal, test };
}

async function main() {
  const { url, principal, test } = readArgs(process.argv.slice(2));
  principalName(principal);
  assertIngestUrl(url, { test });
  const authToken = String(process.env.JOEHUB_LIBSQL_AUTH_TOKEN || "").trim();
  if (!test && !authToken) throw new Error("refusing to mint: libSQL auth token is missing");
  const client = createClient({ url, ...(authToken ? { authToken } : {}) });
  try {
    if (test) await migrateLibsql({ client, url, test: true });
    const token = await mintIngestToken(client, principal);
    process.stdout.write(`${token}\n`);
  } finally {
    client.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : "refusing to mint"}\n`);
    process.exitCode = 1;
  });
}
