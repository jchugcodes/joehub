#!/usr/bin/env node
/**
 * Rewrite fixture task.project values from a list name to a deterministic list id.
 * This script only reads and writes the fixture file you pass. It does not open Redis.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { encryptBackup, planListMigration } from "../web/lib/lists.mjs";

function fail(message) {
  console.error(message);
  process.exit(2);
}

if (process.env.UPSTASH_REDIS_REST_URL || process.env.UPSTASH_REDIS_REST_TOKEN || process.env.REDIS_URL) {
  fail("Refusing to run while a Redis URL or token is set. Pass a local --fixture instead.");
}

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
function option(flag) {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] || "" : "";
}

const fixture = option("--fixture");
if (!fixture) fail("Pass --fixture <file>. This script does not connect to a store.");
const keyHex = option("--backup-key");
if (!dryRun && !/^[0-9a-fA-F]{64}$/.test(keyHex)) fail("Pass --backup-key as 64 hex characters, or use --dry-run.");

const original = readFileSync(fixture, "utf8");
let parsed;
try {
  parsed = JSON.parse(original);
} catch {
  fail("Fixture must be a JSON array of {key, value} records.");
}
if (!Array.isArray(parsed)) fail("Fixture must be a JSON array of {key, value} records.");

const plan = planListMigration(parsed);
const summary = { created: plan.created.length, rewritten: plan.rewritten.length, dryRun };
if (dryRun) {
  console.log(JSON.stringify(summary));
  process.exit(0);
}

const backup = encryptBackup(original, Buffer.from(keyHex, "hex"));
const out = option("--out") || `${fixture}.migrated.json`;
const backupPath = option("--backup") || `${fixture}.backup.enc`;
const shaPath = `${backupPath}.sha256`;
writeFileSync(backupPath, backup.ciphertext);
writeFileSync(shaPath, `${backup.sha256}  ${fixture}\n`);
writeFileSync(out, `${JSON.stringify(plan.entries, null, 2)}\n`);
const written = createHash("sha256").update(original, "utf8").digest("hex");
if (written !== backup.sha256) fail("Backup digest did not match the fixture.");
console.log(JSON.stringify({ ...summary, out, backup: backupPath, sha256: backup.sha256 }));
