import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createHash } from "node:crypto";
import {
  LIST_PALETTE,
  attachMemoryLists,
  createdLine,
  decryptBackup,
  encryptBackup,
  listIdForName,
  nextPaletteColor,
  planListMigration,
  resolveTaskList,
  sortByCreated,
} from "../lib/lists.mjs";

test("a list name maps to one id and the next swatch skips used colors", () => {
  const errands = listIdForName("Errands");
  assert.equal(listIdForName(" errands "), errands);
  assert.notEqual(listIdForName("Home"), errands);
  const next = nextPaletteColor([
    { color: LIST_PALETTE[0].light },
    { color: LIST_PALETTE[5].light },
  ]);
  assert.equal(next, LIST_PALETTE[1].light);
  assert.equal(resolveTaskList(null, []).label, "No list");
  assert.equal(resolveTaskList("Errands", []).label, "Errands");
  assert.equal(resolveTaskList("Errands", []).color, null);
  assert.equal(resolveTaskList(errands, [{ id: errands, name: "Errands", color: null }]).label, "Errands");
});

test("created line uses the stored timestamp and sort flips order", () => {
  assert.equal(createdLine(Date.UTC(2026, 10, 3, 18, 0, 0)), "Created Nov 3");
  assert.equal(createdLine(null), "");
  const rows = [
    { id: "b", createdAt: 20 },
    { id: "a", createdAt: 10 },
  ];
  assert.deepEqual(sortByCreated(rows, "newest").map((row) => row.id), ["b", "a"]);
  assert.deepEqual(sortByCreated(rows, "oldest").map((row) => row.id), ["a", "b"]);
});

test("memory lists create, rename, recolor, and clear project without deleting tasks", async () => {
  const tasks = new Map([
    ["t1", { id: "t1", title: "One", project: null, createdAt: 10, updatedAt: 10 }],
  ]);
  const lists = attachMemoryLists({ tasks });
  const created = await lists.createList({ name: "Errands", color: LIST_PALETTE[5].light }, 100);
  assert.equal(created.status, 201);
  tasks.set("t1", { ...tasks.get("t1"), project: created.body.id });
  const renamed = await lists.patchList(created.body.id, { name: "Out", color: null }, 200);
  assert.equal(renamed.status, 200);
  assert.equal(renamed.body.name, "Out");
  assert.equal(renamed.body.color, null);
  assert.equal(renamed.body.count, 1);
  const removed = await lists.deleteList(created.body.id);
  assert.equal(removed.body.moved, 1);
  assert.equal(tasks.get("t1").project, null);
  assert.equal(tasks.get("t1").title, "One");
  assert.equal(tasks.get("t1").createdAt, 10);
  assert.equal(tasks.get("t1").updatedAt, 10);
  assert.equal((await lists.listLists()).length, 0);
});

test("migration rewrites names to ids and leaves dates, indexes, grocery, and sessions alone", () => {
  const homeAt = 1_700_000_000_000;
  const fixture = [
    { key: "joehub:task:one", value: { id: "one", project: "Home", createdAt: homeAt, updatedAt: homeAt + 5 } },
    { key: "joehub:task:two", value: { id: "two", project: "Home", createdAt: homeAt + 9, updatedAt: homeAt + 9 } },
    { key: "joehub:task:three", value: { id: "three", project: null, createdAt: 3, updatedAt: 3 } },
    { key: "joehub:tasks:active", value: [{ member: "one", score: homeAt }] },
    { key: "joehub:grocery:item:milk", value: { name: "Milk", section: "Dairy" } },
    { key: "joehub:sess:abc", value: { token: "synthetic" } },
    { key: "joehub:device:phone", value: { name: "synthetic" } },
  ];
  const first = planListMigration(fixture);
  assert.equal(first.created.length, 1);
  assert.equal(first.created[0].color, null);
  assert.equal(first.created[0].id, listIdForName("Home"));
  assert.equal(first.rewritten.length, 2);
  const task = first.entries.find((entry) => entry.key === "joehub:task:one").value;
  assert.equal(task.project, listIdForName("Home"));
  assert.equal(task.createdAt, homeAt);
  assert.equal(task.updatedAt, homeAt + 5);
  assert.deepEqual(first.entries.find((entry) => entry.key === "joehub:tasks:active").value, fixture[3].value);
  assert.deepEqual(first.entries.find((entry) => entry.key === "joehub:grocery:item:milk").value, fixture[4].value);
  assert.deepEqual(first.entries.find((entry) => entry.key === "joehub:sess:abc").value, fixture[5].value);
  assert.deepEqual(first.entries.find((entry) => entry.key === "joehub:device:phone").value, fixture[6].value);
  const index = first.entries.find((entry) => entry.key === "joehub:lists").value;
  assert.deepEqual(index, [{ member: listIdForName("Home"), score: homeAt }]);
  const second = planListMigration(first.entries);
  assert.equal(second.created.length, 0);
  assert.equal(second.rewritten.length, 0);
  assert.equal(second.entries.find((entry) => entry.key === "joehub:task:one").value.project, listIdForName("Home"));
});

test("backup round-trips and the script refuses a live Redis URL", () => {
  const key = Buffer.alloc(32, 4);
  const backup = encryptBackup("{\"ok\":true}", key);
  assert.equal(decryptBackup(backup.ciphertext, key), "{\"ok\":true}");
  assert.equal(backup.sha256, createHash("sha256").update("{\"ok\":true}", "utf8").digest("hex"));
  const dir = mkdtempSync(join(tmpdir(), "joehub-lists-"));
  const fixture = join(dir, "fixture.json");
  writeFileSync(fixture, JSON.stringify([{ key: "joehub:task:one", value: { id: "one", project: "Shop", createdAt: 1, updatedAt: 1 } }]));
  const dry = spawnSync(process.execPath, ["scripts/migrate-lists.mjs", "--fixture", fixture, "--dry-run"], {
    cwd: fileURLToPath(new URL("../..", import.meta.url)),
    encoding: "utf8",
  });
  assert.equal(dry.status, 0, dry.stderr);
  assert.equal(JSON.parse(dry.stdout).rewritten, 1);
  assert.equal(readFileSync(fixture, "utf8").includes("\"Shop\""), true);
  const refused = spawnSync(process.execPath, ["scripts/migrate-lists.mjs", "--fixture", fixture, "--dry-run"], {
    cwd: fileURLToPath(new URL("../..", import.meta.url)),
    encoding: "utf8",
    env: { ...process.env, UPSTASH_REDIS_REST_URL: "https://example.invalid" },
  });
  assert.equal(refused.status, 2);
  assert.match(refused.stderr, /Refusing/);
  const applied = spawnSync(
    process.execPath,
    ["scripts/migrate-lists.mjs", "--fixture", fixture, "--backup-key", "44".repeat(32), "--out", join(dir, "out.json"), "--backup", join(dir, "backup.enc")],
    { cwd: fileURLToPath(new URL("../..", import.meta.url)), encoding: "utf8" },
  );
  assert.equal(applied.status, 0, applied.stderr);
  const out = JSON.parse(readFileSync(join(dir, "out.json"), "utf8"));
  assert.equal(out.find((entry) => entry.key === "joehub:task:one").value.project, listIdForName("Shop"));
  assert.equal(readFileSync(fixture, "utf8").includes("\"Shop\""), true);
});
