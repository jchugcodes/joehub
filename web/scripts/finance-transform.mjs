import { createHash } from "node:crypto";
import { chmod, readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

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

function bodies(entries) {
  return (Array.isArray(entries) ? entries : []).map((entry) => entry.body);
}

export function transformFinanceSnapshot(snapshot) {
  if (!snapshot || snapshot.kind !== "joehub-finance-snapshot" || snapshot.version !== 1) {
    throw new Error("refusing to transform: snapshot is not a finance export");
  }
  if (!snapshot.plan || !Number.isInteger(snapshot.plan.cents)) throw new Error("refusing to transform: snapshot is not a finance export");
  if (!Array.isArray(snapshot.goals)) throw new Error("refusing to transform: snapshot is not a finance export");
  return {
    kind: "joehub-finance-rows",
    version: 1,
    bundle: {
      transactions: bodies(snapshot.transactions),
      accounts: bodies(snapshot.accounts),
      bills: bodies(snapshot.bills),
      categories: snapshot.categories,
      caps: snapshot.caps,
      plan: snapshot.plan,
      snapshot: snapshot.snapshots,
      legacyAccounts: snapshot.legacyAccounts,
      goals: snapshot.goals,
    },
  };
}

export function formatTransformReport(rows) {
  const bundle = rows.bundle;
  return `transactions ${bundle.transactions.length}\naccounts ${bundle.accounts.length}\nbills ${bundle.bills.length}\ngoals ${bundle.goals.length}\n`;
}

export async function runTransform(argv, io = {}) {
  const args = readArgs(argv);
  if (!args.input) throw new Error("refusing to transform: snapshot path is missing");
  if (!args.out) throw new Error("refusing to transform: rows path is missing");
  let snapshot;
  try {
    snapshot = JSON.parse(await readFile(args.input, "utf8"));
  } catch {
    throw new Error("refusing to transform: snapshot is not a finance export");
  }
  const rows = transformFinanceSnapshot(snapshot);
  const text = `${JSON.stringify(rows, null, 2)}\n`;
  await writeFile(args.out, text, { mode: 0o600, flag: "w" });
  await chmod(args.out, 0o600);
  const sha256 = createHash("sha256").update(text).digest("hex");
  const stdout = io.stdout || ((line) => process.stdout.write(line));
  stdout(`${formatTransformReport(rows)}sha256 ${sha256}\n`);
  return { ...rows, sha256 };
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
