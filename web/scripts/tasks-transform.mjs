import { createHash } from "node:crypto";
import { chmod, readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

function completedAt(task) {
  return typeof task.completedAt === "number" ? task.completedAt : null;
}

function assertSnapshot(snapshot) {
  if (!snapshot || snapshot.kind !== "joehub-tasks-snapshot" || !Array.isArray(snapshot.tasks) || !Array.isArray(snapshot.lists)) {
    throw new Error("refusing to transform: snapshot is not a tasks export");
  }
}

function taskRow(entry) {
  const body = entry && entry.body;
  if (!entry || typeof entry.id !== "string" || !body || typeof body !== "object" || Array.isArray(body)) {
    throw new Error("refusing to transform: a task record is incomplete");
  }
  if (body.id !== entry.id) throw new Error("refusing to transform: a task key does not match its id");
  if (typeof body.status !== "string" || typeof body.createdAt !== "number") {
    throw new Error("refusing to transform: a task record is incomplete");
  }
  const stored = { ...body, id: entry.id };
  return {
    id: entry.id,
    body: JSON.stringify(stored),
    status: stored.status,
    created_at: stored.createdAt,
    completed_at: completedAt(stored),
    source_id: stored.sourceId || null,
  };
}

function listRow(entry) {
  if (!entry || typeof entry.id !== "string" || typeof entry.name !== "string" || typeof entry.color !== "string") {
    throw new Error("refusing to transform: a list record is incomplete");
  }
  if (typeof entry.createdAt !== "number" || typeof entry.updatedAt !== "number") {
    throw new Error("refusing to transform: a list record is incomplete");
  }
  return {
    id: entry.id,
    name: entry.name,
    color: entry.color,
    created_at: entry.createdAt,
    updated_at: entry.updatedAt,
  };
}

function unique(rows, label) {
  const seen = new Set();
  for (const row of rows) {
    if (seen.has(row.id)) throw new Error(`refusing to transform: duplicate ${label}`);
    seen.add(row.id);
  }
}

// Rows match web/lib/store-sqlite.mjs: the task JSON is the body, completed_at
// is set only for a numeric completedAt, and source_id is the Notion source id.
export function transformTasksSnapshot(snapshot) {
  assertSnapshot(snapshot);
  const tasks = snapshot.tasks.map(taskRow);
  const lists = snapshot.lists.map(listRow);
  unique(tasks, "task");
  unique(lists, "list");
  return { kind: "joehub-tasks-rows", version: 1, tasks, lists };
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
  return `tasks ${rows.tasks.length}\nlists ${rows.lists.length}\nsha256 ${sha256}\n`;
}

export async function runTransform(argv, io = {}) {
  const args = readArgs(argv);
  if (!args.input || !args.out) throw new Error("refusing to transform: input and output paths are required");
  let snapshot;
  try {
    snapshot = JSON.parse(await readFile(args.input, "utf8"));
  } catch {
    throw new Error("refusing to transform: snapshot is not a tasks export");
  }
  const rows = transformTasksSnapshot(snapshot);
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
