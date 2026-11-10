import assert from "node:assert/strict";
import test from "node:test";
import { decide } from "../lib/gate.mjs";
import { applyKeyPrefix, readKeyPrefix } from "../lib/keys.mjs";
import { createUpstashStore, StoreError } from "../lib/store-upstash.mjs";
import { startFakeUpstash } from "./support/fakes.mjs";

const SECRET = "keys-test-secret-value";

function redisKeys(commands) {
  return commands.map((args) => args[1]).filter((key) => typeof key === "string");
}

async function exercise(prefix) {
  const fake = await startFakeUpstash();
  const store = createUpstashStore({
    url: fake.url,
    token: fake.token,
    ...(prefix ? { prefix } : {}),
  });
  const now = Date.now();
  const session = {
    id: "c".repeat(64),
    deviceId: "device-9",
    createdAt: now,
    expiresAt: now + 60_000,
    revoked: false,
    owner: "owner-subject",
    label: "browser",
  };
  try {
    await store.putSession(session, now);
    await store.hit("api", "direct", 5, 60_000, now);
    await store.putTxn({ state: "state-1", binding: "bind-1", createdAt: now }, now);
    await store.revokeAll(session.owner, now);
    const created = await store.createTask({ title: "Prefixed sample" }, "idem-1", now + 50);
    const listed = await store.listUnfinishedTasks(now);
    await store.listUnfinishedTasks(now);
    await store.completeTask(created.body.id, now + 100);
    const grocery = await store.createGrocery({ name: "Prefixed oats", quantity: "1 bag" }, "grocery-idem-1", now + 60);
    return { fake, session, created, listed, grocery };
  } finally {
    fake.stop();
  }
}

test("an unset key prefix leaves every Redis key unchanged", async () => {
  assert.equal(readKeyPrefix({}).ok, true);
  assert.equal(readKeyPrefix({}).prefix, "joehub:");
  assert.equal(readKeyPrefix({ JOEHUB_KEY_PREFIX: "" }).prefix, "joehub:");
  assert.equal(applyKeyPrefix("joehub:", "joehub:sess:abc"), "joehub:sess:abc");
  const { fake, session, created, listed, grocery } = await exercise();
  const keys = redisKeys(fake.commands);
  for (const key of keys) {
    assert.equal(key.startsWith("joehub:"), true, key);
    assert.equal(key.startsWith("joehub-preview:"), false, key);
  }
  assert.ok(keys.includes(`joehub:sess:${session.id}`));
  assert.ok(keys.includes(`joehub:device:${session.deviceId}`));
  assert.ok(keys.includes("joehub:devices:owner-subject"));
  assert.ok(keys.includes("joehub:cut:owner-subject"));
  assert.ok(keys.some((key) => key.startsWith("joehub:rl:")));
  assert.ok(keys.some((key) => key.startsWith("joehub:txn:")));
  assert.ok(keys.includes(`joehub:task:${created.body.id}`));
  assert.ok(keys.includes("joehub:tasks:active"));
  assert.ok(keys.includes("joehub:tasks:done"));
  assert.ok(keys.includes("joehub:tasks:seeded"));
  assert.ok(keys.includes("joehub:task:idem:idem-1"));
  assert.ok(keys.includes(`joehub:grocery:item:${grocery.body.id}`));
  assert.ok(keys.includes("joehub:grocery:items:unchecked"));
  assert.ok(keys.includes("joehub:grocery:seeded"));
  assert.ok(keys.includes("joehub:grocery:item:idem:grocery-idem-1"));
  const groceryWrites = fake.commands.filter((args) => args[0] === "SET" && String(args[1]).startsWith("joehub:grocery:item:") && !String(args[1]).includes(":idem:"));
  assert.ok(groceryWrites.length >= 1);
  for (const args of groceryWrites) assert.equal(args.includes("EX"), false, args.join(" "));
  const groceryFlag = fake.commands.filter((args) => args[0] === "SET" && args[1] === "joehub:grocery:seeded");
  assert.equal(groceryFlag.length, 1);
  assert.equal(groceryFlag[0].includes("EX"), false);
  const taskWrites = fake.commands.filter((args) => args[0] === "SET" && String(args[1]).startsWith("joehub:task:") && !String(args[1]).includes(":idem:"));
  assert.ok(taskWrites.length >= 1);
  for (const args of taskWrites) assert.equal(args.includes("EX"), false, args.join(" "));
  const flag = fake.commands.filter((args) => args[0] === "SET" && args[1] === "joehub:tasks:seeded");
  assert.equal(flag.length, 1);
  assert.equal(flag[0].includes("EX"), false);
  const idem = fake.commands.find((args) => args[0] === "SET" && args[1] === "joehub:task:idem:idem-1" && String(args[2]).includes("Prefixed sample"));
  assert.ok(idem);
  assert.ok(idem.includes("EX"));
  assert.ok(idem.includes("86400"));
  assert.equal(listed[0].title, "Prefixed sample");
  assert.equal(listed.some((task) => task.title === "Hold for the sample reply" && task.dueDate == null), true);
  assert.equal(listed.some((task) => task.status === "Done"), false);
});

test("a preview prefix replaces the joehub namespace on session and task keys", async () => {
  assert.equal(readKeyPrefix({ JOEHUB_KEY_PREFIX: "joehub-preview:" }).prefix, "joehub-preview:");
  assert.equal(applyKeyPrefix("joehub-preview:", "joehub:task:abc"), "joehub-preview:task:abc");
  const { fake, session, created, grocery } = await exercise("joehub-preview:");
  const keys = redisKeys(fake.commands);
  assert.ok(keys.length > 0);
  for (const key of keys) assert.equal(key.startsWith("joehub-preview:"), true, key);
  assert.ok(keys.includes(`joehub-preview:sess:${session.id}`));
  assert.ok(keys.includes(`joehub-preview:device:${session.deviceId}`));
  assert.ok(keys.includes("joehub-preview:devices:owner-subject"));
  assert.ok(keys.includes("joehub-preview:cut:owner-subject"));
  assert.ok(keys.some((key) => key.startsWith("joehub-preview:rl:")));
  assert.ok(keys.some((key) => key.startsWith("joehub-preview:txn:")));
  assert.ok(keys.includes(`joehub-preview:task:${created.body.id}`));
  assert.ok(keys.includes("joehub-preview:tasks:active"));
  assert.ok(keys.includes("joehub-preview:tasks:done"));
  assert.equal(keys.includes("joehub:tasks:done"), false);
  assert.ok(keys.includes("joehub-preview:tasks:seeded"));
  assert.ok(keys.includes("joehub-preview:tasks:seeded:v2"));
  assert.equal(keys.includes("joehub:tasks:seeded:v2"), false);
  assert.equal(keys.includes(`joehub:sess:${session.id}`), false);
  assert.equal(keys.includes(`joehub:task:${created.body.id}`), false);
  assert.ok(keys.includes(`joehub-preview:grocery:item:${grocery.body.id}`));
  assert.ok(keys.includes("joehub-preview:grocery:items:unchecked"));
  assert.ok(keys.includes("joehub-preview:grocery:seeded"));
  assert.ok(keys.includes("joehub-preview:grocery:item:idem:grocery-idem-1"));
  assert.equal(keys.includes("joehub:grocery:seeded"), false);
  assert.equal(keys.includes(`joehub:grocery:item:${grocery.body.id}`), false);
});

test("an invalid key prefix fails closed", async () => {
  assert.equal(readKeyPrefix({ JOEHUB_KEY_PREFIX: "Preview:" }).ok, false);
  assert.equal(readKeyPrefix({ JOEHUB_KEY_PREFIX: "joehub-preview" }).ok, false);
  assert.equal(readKeyPrefix({ JOEHUB_KEY_PREFIX: " " }).ok, false);
  assert.throws(() => createUpstashStore({ url: "http://127.0.0.1", token: "t", prefix: "Preview:" }), StoreError);
  const dev = { NODE_ENV: "development", JOEHUB_DEV_AUTH: "1", JOEHUB_SESSION_SECRET: SECRET };
  const api = await decide(new Request("http://127.0.0.1/api/tasks"), { ...dev, JOEHUB_KEY_PREFIX: "Preview:" }, Date.now());
  assert.equal(api.status, 503);
  assert.equal(api.body.detail, "unavailable");
  assert.equal(JSON.stringify(api).includes("Preview:"), false);
  const page = await decide(new Request("http://127.0.0.1/tasks"), { ...dev, JOEHUB_KEY_PREFIX: "no-colon" }, Date.now());
  assert.equal(page.status, 503);
  const health = await decide(new Request("http://127.0.0.1/api/health"), { JOEHUB_KEY_PREFIX: "Preview:" }, Date.now());
  assert.equal(health.type, "next");
  const allowed = await decide(new Request("http://127.0.0.1/tasks"), { ...dev, JOEHUB_KEY_PREFIX: "joehub-preview:" }, Date.now());
  assert.equal(allowed.type, "next");
});
