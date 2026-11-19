import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { createClient } from "@libsql/client";
import { localLibsqlUrl, readLibsqlConfig, remoteLibsqlUrl } from "../lib/libsql-config.mjs";

function readArgs(argv) {
  let input = "";
  let url = "";
  let test = false;
  let merge = false;
  let ok = false;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--i-have-joes-ok") ok = true;
    else if (arg === "--test") test = true;
    else if (arg === "--merge") merge = true;
    else if (arg === "--in") {
      input = argv[i + 1] || "";
      i += 1;
    } else if (arg.startsWith("--in=")) input = arg.slice("--in=".length);
    else if (arg === "--url") {
      url = argv[i + 1] || "";
      i += 1;
    } else if (arg.startsWith("--url=")) url = arg.slice("--url=".length);
    else throw new Error(`refusing to import: unknown argument ${arg}`);
  }
  return { input, url, test, merge, ok };
}

export function assertImportUrl(url, { test = false } = {}) {
  const value = String(url || "").trim();
  if (!value) throw new Error("refusing to import: libSQL URL is missing");
  if (!test && localLibsqlUrl(value)) throw new Error("refusing to import: :memory: and file: URLs need --test");
  if (!test && !remoteLibsqlUrl(value)) {
    throw new Error("refusing to import: libSQL URL must be a remote libsql:// or https:// database");
  }
  if (test && !localLibsqlUrl(value) && !remoteLibsqlUrl(value)) {
    throw new Error("refusing to import: libSQL URL must be a remote libsql:// or https:// database");
  }
}

function assertRows(rows) {
  if (!rows || rows.kind !== "joehub-grocery-rows" || !Array.isArray(rows.items)) {
    throw new Error("refusing to import: rows file is not a grocery transform");
  }
}

export async function applyGroceryRows(client, rows, { merge = false } = {}) {
  assertRows(rows);
  const count = await client.execute("SELECT count(*) AS n FROM grocery_items");
  if (Number(count.rows[0].n) > 0 && !merge) throw new Error("refusing to import: target already has grocery items");
  const tx = await client.transaction("write");
  try {
    for (const row of rows.items) {
      await tx.execute({
        sql: `INSERT INTO grocery_items (
                id, name, quantity, notes, section, checked, created_at, updated_at, source_id, checked_at, body
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
              ON CONFLICT(id) DO UPDATE SET
                name = excluded.name,
                quantity = excluded.quantity,
                notes = excluded.notes,
                section = excluded.section,
                checked = excluded.checked,
                created_at = excluded.created_at,
                updated_at = excluded.updated_at,
                source_id = excluded.source_id,
                checked_at = excluded.checked_at,
                body = excluded.body`,
        args: [
          row.id,
          row.name,
          row.quantity,
          row.notes,
          row.section,
          row.checked,
          row.created_at,
          row.updated_at,
          row.source_id,
          row.checked_at,
          row.body,
        ],
      });
    }
    await tx.commit();
  } catch (error) {
    try {
      await tx.rollback();
    } catch {
      // The transaction may already be closed.
    }
    throw error;
  } finally {
    tx.close();
  }
  return { items: rows.items.length };
}

export function formatImportReport(result) {
  return `items ${result.items}\n`;
}

export async function runImport(argv, env = process.env, io = {}) {
  const args = readArgs(argv);
  if (!args.ok) throw new Error("refusing to import: Joe's OK is required");
  if (!args.input) throw new Error("refusing to import: rows path is missing");
  const config = readLibsqlConfig(env);
  const url = String(args.url || config.url).trim();
  assertImportUrl(url, { test: args.test });
  if (remoteLibsqlUrl(url) && !config.authToken) throw new Error("refusing to import: libSQL auth token is missing");
  let rows;
  try {
    rows = JSON.parse(await readFile(args.input, "utf8"));
  } catch {
    throw new Error("refusing to import: rows file is not a grocery transform");
  }
  const client = createClient({ url, ...(config.authToken ? { authToken: config.authToken } : {}) });
  try {
    const result = await applyGroceryRows(client, rows, { merge: args.merge });
    const stdout = io.stdout || ((text) => process.stdout.write(text));
    stdout(formatImportReport(result));
    return result;
  } finally {
    client.close();
  }
}

async function main() {
  await runImport(process.argv.slice(2), process.env);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : "refusing to import"}\n`);
    process.exitCode = 1;
  });
}
