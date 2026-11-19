import { createHash } from "node:crypto";
import { chmod, readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

function assertSnapshot(snapshot) {
  if (!snapshot || snapshot.kind !== "joehub-grocery-snapshot" || !Array.isArray(snapshot.items)) {
    throw new Error("refusing to transform: snapshot is not a grocery export");
  }
}

function itemRow(entry) {
  const body = entry && entry.body;
  if (!entry || typeof entry.id !== "string" || !body || typeof body !== "object" || Array.isArray(body)) {
    throw new Error("refusing to transform: an item record is incomplete");
  }
  if (body.id !== entry.id) throw new Error("refusing to transform: an item key does not match its id");
  if (typeof body.name !== "string" || typeof body.createdAt !== "number" || typeof body.updatedAt !== "number") {
    throw new Error("refusing to transform: an item record is incomplete");
  }
  if (typeof body.checked !== "boolean") throw new Error("refusing to transform: an item record is incomplete");
  const stored = { ...body, id: entry.id };
  return {
    id: entry.id,
    name: stored.name,
    quantity: stored.quantity || null,
    notes: stored.notes || null,
    section: stored.section || null,
    checked: stored.checked ? 1 : 0,
    created_at: stored.createdAt,
    updated_at: stored.updatedAt,
    source_id: stored.sourceId || null,
    checked_at: typeof stored.checkedAt === "number" ? stored.checkedAt : null,
    body: JSON.stringify(stored),
  };
}

function unique(rows) {
  const seen = new Set();
  for (const row of rows) {
    if (seen.has(row.id)) throw new Error("refusing to transform: duplicate item");
    seen.add(row.id);
  }
}

// Rows match web/lib/store-sqlite.mjs. body is the Upstash document.
// Empty quantity, notes, section, and source id stay null. checked_at is set
// only when the document has a numeric checkedAt.
export function transformGrocerySnapshot(snapshot) {
  assertSnapshot(snapshot);
  const items = snapshot.items.map(itemRow);
  unique(items);
  return { kind: "joehub-grocery-rows", version: 1, items };
}

function readArgs(argv) {
  let input = "";
  let out = "";
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--in") {
      input = argv[i + 1] || "";
      i += 1;
    } else if (arg.startsWith("--in=")) input = arg.slice("--in=".length);
    else if (arg === "--out") {
      out = argv[i + 1] || "";
      i += 1;
    } else if (arg.startsWith("--out=")) out = arg.slice("--out=".length);
    else throw new Error(`refusing to transform: unknown argument ${arg}`);
  }
  return { input, out };
}

export function formatTransformReport(rows, sha256) {
  return `items ${rows.items.length}\nsha256 ${sha256}\n`;
}

export async function runTransform(argv, io = {}) {
  const args = readArgs(argv);
  if (!args.input || !args.out) throw new Error("refusing to transform: input and output paths are required");
  let snapshot;
  try {
    snapshot = JSON.parse(await readFile(args.input, "utf8"));
  } catch {
    throw new Error("refusing to transform: snapshot is not a grocery export");
  }
  const rows = transformGrocerySnapshot(snapshot);
  const text = `${JSON.stringify(rows, null, 2)}\n`;
  await writeFile(args.out, text, { mode: 0o600, flag: "w" });
  await chmod(args.out, 0o600);
  const sha256 = createHash("sha256").update(text).digest("hex");
  const stdout = io.stdout || ((chunk) => process.stdout.write(chunk));
  stdout(formatTransformReport(rows, sha256));
  return { rows, sha256, out: args.out };
}

async function main() {
  await runTransform(process.argv.slice(2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : "refusing to transform"}\n`);
    process.exitCode = 1;
  });
}
