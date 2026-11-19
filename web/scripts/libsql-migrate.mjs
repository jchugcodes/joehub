import { createClient } from "@libsql/client";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const MIGRATION_ACTOR = "system";
const MIGRATIONS_DIR = fileURLToPath(new URL("../migrations-libsql/", import.meta.url));
const ADD_COLUMN = /^ALTER\s+TABLE\s+"?([A-Za-z_][A-Za-z0-9_]*)"?\s+ADD\s+COLUMN\s+"?([A-Za-z_][A-Za-z0-9_]*)"?\b/i;

const RECORD = `INSERT INTO schema_migrations (
    id, notion_id, migrated_on, last_modified_by, last_modified_at, version, applied_at
) VALUES (?, NULL, NULL, ?, ?, ?, ?)`;

export function utcStamp(date = new Date()) {
  return date.toISOString().replace(/\.\d{3}Z$/, "Z");
}

export function isFileOrMemoryUrl(value) {
  const url = String(value || "").trim().toLowerCase();
  return url === ":memory:" || url.startsWith("file:");
}

export function assertMigratableUrl(url, { test = false } = {}) {
  const value = String(url || "").trim();
  if (!value) throw new Error("refusing to migrate: libSQL URL is missing");
  if (!test && isFileOrMemoryUrl(value)) {
    throw new Error("refusing to migrate: :memory: and file: URLs need --test");
  }
}

export function assertAppendOnly(script, name = "migration") {
  const upper = String(script).toUpperCase();
  if (upper.includes("DROP TABLE") || upper.includes("DROP INDEX")) {
    throw new Error(`${name} drops objects; joehub migrations are append-only`);
  }
}

export function sqlStatements(script) {
  const statements = [];
  let current = "";
  let i = 0;
  let inSingle = false;
  let inDouble = false;
  let inLineComment = false;
  let inBlockComment = false;
  let beginDepth = 0;

  while (i < script.length) {
    const ch = script[i];
    const next = script[i + 1];

    if (inLineComment) {
      current += ch;
      if (ch === "\n") inLineComment = false;
      i += 1;
      continue;
    }
    if (inBlockComment) {
      current += ch;
      if (ch === "*" && next === "/") {
        current += next;
        i += 2;
        inBlockComment = false;
        continue;
      }
      i += 1;
      continue;
    }
    if (inSingle) {
      current += ch;
      if (ch === "'" && next === "'") {
        current += next;
        i += 2;
        continue;
      }
      if (ch === "'") inSingle = false;
      i += 1;
      continue;
    }
    if (inDouble) {
      current += ch;
      if (ch === '"' && next === '"') {
        current += next;
        i += 2;
        continue;
      }
      if (ch === '"') inDouble = false;
      i += 1;
      continue;
    }
    if (ch === "-" && next === "-") {
      current += ch + next;
      i += 2;
      inLineComment = true;
      continue;
    }
    if (ch === "/" && next === "*") {
      current += ch + next;
      i += 2;
      inBlockComment = true;
      continue;
    }
    if (ch === "'") {
      inSingle = true;
      current += ch;
      i += 1;
      continue;
    }
    if (ch === '"') {
      inDouble = true;
      current += ch;
      i += 1;
      continue;
    }
    if (/[A-Za-z_]/.test(ch)) {
      const word = script.slice(i).match(/^[A-Za-z_][A-Za-z0-9_]*/)[0];
      current += word;
      i += word.length;
      const upper = word.toUpperCase();
      if (upper === "BEGIN") beginDepth += 1;
      else if (upper === "END" && beginDepth > 0) beginDepth -= 1;
      continue;
    }
    if (ch === ";" && beginDepth === 0) {
      current += ch;
      const text = stripLeadingComments(current);
      if (text) statements.push(text);
      current = "";
      i += 1;
      continue;
    }
    current += ch;
    i += 1;
  }

  const leftover = stripLeadingComments(current);
  if (leftover) throw new Error("migration has an incomplete SQL statement");
  return statements;
}

function stripLeadingComments(text) {
  const lines = String(text).split("\n");
  while (lines.length && lines[0].trim().startsWith("--")) lines.shift();
  return lines.join("\n").trim();
}

export function addColumnTarget(statement) {
  const match = ADD_COLUMN.exec(String(statement).trim());
  if (!match) return null;
  return { table: match[1], column: match[2] };
}

export async function migrationFiles(dir = MIGRATIONS_DIR) {
  const names = (await readdir(dir)).filter((name) => name.endsWith(".sql")).sort();
  return names.map((name) => ({ name, path: path.join(dir, name) }));
}

async function appliedVersions(client) {
  const found = await client.execute(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'",
  );
  if (!found.rows.length) return new Set();
  const rows = await client.execute("SELECT version FROM schema_migrations");
  return new Set(rows.rows.map((row) => String(row.version)));
}

async function columnExists(tx, table, column) {
  const rows = await tx.execute(`PRAGMA table_info(${quoteIdent(table)})`);
  return rows.rows.some((row) => String(row.name) === column);
}

function quoteIdent(name) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) throw new Error("invalid identifier");
  return `"${name}"`;
}

async function applyFile(client, file) {
  const script = await readFile(file.path, "utf8");
  assertAppendOnly(script, file.name);
  const statements = sqlStatements(script).filter((statement) => !statement.toUpperCase().startsWith("PRAGMA"));
  const now = utcStamp();
  const tx = await client.transaction("write");
  try {
    for (const statement of statements) {
      const add = addColumnTarget(statement);
      if (add && (await columnExists(tx, add.table, add.column))) continue;
      await tx.execute(statement);
    }
    await tx.execute({
      sql: RECORD,
      args: [crypto.randomUUID(), MIGRATION_ACTOR, now, file.name, now],
    });
    await tx.commit();
  } catch (error) {
    try {
      await tx.rollback();
    } catch {
      // The transaction may already be closed.
    }
    throw error;
  }
}

export async function migrateLibsql({ client, url, test = false, dir = MIGRATIONS_DIR, authToken } = {}) {
  const target = String(url || "").trim();
  let opened = null;
  if (!client) {
    assertMigratableUrl(target, { test });
    const secret = String(authToken ?? process.env.JOEHUB_LIBSQL_AUTH_TOKEN ?? "").trim();
    if (!isFileOrMemoryUrl(target) && !secret) {
      throw new Error("refusing to migrate: libSQL auth token is missing");
    }
    opened = createClient({ url: target, ...(secret ? { authToken: secret } : {}) });
    client = opened;
  } else {
    assertMigratableUrl(target || ":memory:", { test });
  }
  try {
    await client.execute("PRAGMA foreign_keys = ON");
    const applied = await appliedVersions(client);
    const files = await migrationFiles(dir);
    const ran = [];
    for (const file of files) {
      if (applied.has(file.name)) continue;
      await applyFile(client, file);
      applied.add(file.name);
      ran.push(file.name);
    }
    return ran;
  } finally {
    if (opened) opened.close();
  }
}

function readArgs(argv) {
  let url = process.env.JOEHUB_LIBSQL_URL || "";
  let test = false;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--test") test = true;
    else if (arg === "--url") {
      url = argv[i + 1] || "";
      i += 1;
    } else if (arg.startsWith("--url=")) url = arg.slice("--url=".length);
    else throw new Error(`refusing to migrate: unknown argument ${arg}`);
  }
  return { url, test };
}

async function main() {
  const { url, test } = readArgs(process.argv.slice(2));
  const ran = await migrateLibsql({ url, test });
  if (!ran.length) process.stdout.write("already applied\n");
  else process.stdout.write(`${ran.join("\n")}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
