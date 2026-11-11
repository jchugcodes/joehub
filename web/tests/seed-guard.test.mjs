import assert from "node:assert/strict";
import test from "node:test";
import { syntheticSeedEnabled } from "../lib/seed.mjs";
import { createUpstashStore, StoreError } from "../lib/store-upstash.mjs";
import { startFakeUpstash } from "./support/fakes.mjs";

function writes(commands) {
  return commands.filter((args) => args[0] === "SET" || args[0] === "ZADD");
}

async function open(env) {
  const fake = await startFakeUpstash();
  const store = createUpstashStore({ url: fake.url, token: fake.token, env });
  return { fake, store };
}

test("synthetic seed is off only when VERCEL_ENV is production", () => {
  assert.equal(syntheticSeedEnabled({}), true);
  assert.equal(syntheticSeedEnabled({ NODE_ENV: "production" }), true);
  assert.equal(syntheticSeedEnabled({ VERCEL_ENV: "preview" }), true);
  assert.equal(syntheticSeedEnabled({ VERCEL_ENV: "development", NODE_ENV: "production" }), true);
  assert.equal(syntheticSeedEnabled({ VERCEL_ENV: "production" }), false);
});

test("production reads do not write task, grocery, or finance seeds", async () => {
  const { fake, store } = await open({ VERCEL_ENV: "production", NODE_ENV: "production" });
  try {
    const now = Date.parse("2026-11-10T17:00:00Z");
    const created = await store.createTask({ title: "Imported task" }, "import-task", now);
    assert.equal(created.status, 201);
    const listed = await store.listUnfinishedTasks(now);
    assert.deepEqual(listed.map((task) => task.title), ["Imported task"]);
    const grocery = await store.createGrocery({ name: "Imported oats" }, "import-grocery", now);
    assert.equal(grocery.status, 201);
    const items = await store.listGrocery();
    assert.deepEqual(items.map((item) => item.name), ["Imported oats"]);
    await assert.rejects(() => store.financeOverview(now), StoreError);
    const seeded = fake.commands.map((args) => args[1]).filter((key) => String(key).includes("seeded"));
    assert.deepEqual(seeded, []);
    const sampleIds = ["a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1", "g1g1g1g1-g1g1-4g1g-8g1g-g1g1g1g1g1g1", "fin-pizza"];
    const keys = fake.commands.map((args) => String(args[1] || ""));
    for (const id of sampleIds) assert.equal(keys.some((key) => key.includes(id)), false, id);
  } finally {
    fake.stop();
  }
});

test("preview and an unset VERCEL_ENV still seed every current version", async () => {
  for (const env of [{ VERCEL_ENV: "preview" }, {}]) {
    const { fake, store } = await open(env);
    try {
      const now = Date.parse("2026-11-10T17:00:00Z");
      const listed = await store.listUnfinishedTasks(now);
      assert.ok(listed.some((task) => task.title === "Ship the sample kit"));
      const items = await store.listGrocery();
      assert.ok(items.some((item) => item.name === "Bananas"));
      const overview = await store.financeOverview(now);
      assert.equal(overview.status, 200);
      assert.equal(overview.body.netWorthCents, 1_847_236);
      const flags = fake.commands.filter((args) => args[0] === "SET" && String(args[1]).includes(":seeded"));
      const names = flags.map((args) => args[1]).sort();
      assert.deepEqual(names, [
        "joehub:finance:seeded",
        "joehub:finance:seeded:v2",
        "joehub:grocery:seeded",
        "joehub:tasks:seeded",
        "joehub:tasks:seeded:v2",
        "joehub:tasks:seeded:v3",
        "joehub:tasks:seeded:v4",
      ]);
      for (const args of flags) assert.equal(args.includes("EX"), false, args.join(" "));
      assert.ok(writes(fake.commands).length > 0);
    } finally {
      fake.stop();
    }
  }
});
