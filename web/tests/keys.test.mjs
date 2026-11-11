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
    const finance = await store.financeOverview(now);
    await store.financeOverview(now);
    return { fake, session, created, listed, grocery, finance };
  } finally {
    fake.stop();
  }
}

test("an unset key prefix leaves every Redis key unchanged", async () => {
  assert.equal(readKeyPrefix({}).ok, true);
  assert.equal(readKeyPrefix({}).prefix, "joehub:");
  assert.equal(readKeyPrefix({ JOEHUB_KEY_PREFIX: "" }).prefix, "joehub:");
  assert.equal(applyKeyPrefix("joehub:", "joehub:sess:abc"), "joehub:sess:abc");
  const { fake, session, created, listed, grocery, finance } = await exercise();
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
  assert.ok(keys.includes("joehub:finance:caps"));
  assert.ok(keys.includes("joehub:finance:plan"));
  assert.ok(keys.includes("joehub:finance:txns"));
  assert.ok(keys.includes("joehub:finance:snapshots"));
  assert.ok(keys.includes("joehub:finance:accounts"));
  assert.ok(keys.includes("joehub:finance:goals"));
  assert.ok(keys.includes("joehub:finance:txn:fin-shell"));
  assert.ok(keys.includes("joehub:finance:seeded"));
  const financeFlag = fake.commands.filter((args) => args[0] === "SET" && args[1] === "joehub:finance:seeded");
  assert.equal(financeFlag.length, 1);
  assert.equal(financeFlag[0][2], "1");
  assert.equal(financeFlag[0].includes("EX"), false);
  const financeWrites = fake.commands.filter((args) => args[0] === "SET" && String(args[1]).startsWith("joehub:finance:") && args[1] !== "joehub:finance:seeded");
  assert.ok(financeWrites.length >= 7);
  for (const args of financeWrites) assert.equal(args.includes("EX"), false, args.join(" "));
  assert.equal(finance.body.caps.find((cap) => cap.slug === "dining-out").capCents, 8000);
  assert.equal(listed[0].title, "Prefixed sample");
  assert.equal(listed.some((task) => task.title === "Hold for the sample reply" && task.dueDate == null), true);
  assert.equal(listed.filter((task) => task.status === "Done").map((task) => task.title).join(","), "Ship the sample kit");
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
  assert.ok(keys.includes("joehub-preview:finance:caps"));
  assert.ok(keys.includes("joehub-preview:finance:plan"));
  assert.ok(keys.includes("joehub-preview:finance:txns"));
  assert.ok(keys.includes("joehub-preview:finance:snapshots"));
  assert.ok(keys.includes("joehub-preview:finance:accounts"));
  assert.ok(keys.includes("joehub-preview:finance:goals"));
  assert.ok(keys.includes("joehub-preview:finance:txn:fin-shell"));
  assert.ok(keys.includes("joehub-preview:finance:seeded"));
  assert.equal(keys.includes("joehub:finance:caps"), false);
  assert.equal(keys.includes("joehub:finance:seeded"), false);
  assert.equal(keys.includes("joehub:finance:txn:fin-shell"), false);
  const previewFlag = fake.commands.filter((args) => args[0] === "SET" && args[1] === "joehub-preview:finance:seeded");
  assert.equal(previewFlag.length, 1);
  assert.equal(previewFlag[0][2], "1");
  assert.equal(previewFlag[0].includes("EX"), false);
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

test("a legacy finance blob migrates once and keeps saved caps", async () => {
  const fake = await startFakeUpstash();
  const prefix = "joehub-preview:";
  const caps = { "dining-out": 9000, groceries: 11000, transport: 6000, subscriptions: 5500, shopping: 7500, utilities: 0 };
  await fetch(fake.url, {
    method: "POST",
    headers: { authorization: `Bearer ${fake.token}`, "content-type": "application/json" },
    body: JSON.stringify(["SET", `${prefix}finance:seeded`, JSON.stringify({ transactions: [{ id: "fin-kept", payee: "Kept", amountCents: -100, date: "2026-11-10", category: "dining-out", type: "expense", source: "manual", corrected: false, createdAt: 1 }], caps })]),
  });
  const store = createUpstashStore({ url: fake.url, token: fake.token, prefix });
  const first = await store.financeOverview(Date.parse("2026-11-10T15:00:00-05:00"));
  const second = await store.financeOverview(Date.parse("2026-11-10T15:00:00-05:00"));
  assert.equal(first.body.caps.find((cap) => cap.slug === "dining-out").capCents, 9000);
  assert.equal(second.body.caps.find((cap) => cap.slug === "dining-out").capCents, 9000);
  const flagWrites = fake.commands.filter((args) => args[0] === "SET" && args[1] === `${prefix}finance:seeded` && args[2] === "1");
  assert.equal(flagWrites.length, 1);
  const capWrites = fake.commands.filter((args) => args[0] === "SET" && args[1] === `${prefix}finance:caps`);
  assert.equal(capWrites.length, 1);
  assert.equal(JSON.parse(capWrites[0][2])["dining-out"], 9000);
  assert.ok(redisKeys(fake.commands).includes(`${prefix}finance:txn:fin-kept`));
  await fake.stop();
});

test("an existing caps key is kept when a legacy blob migrates", async () => {
  const fake = await startFakeUpstash();
  const prefix = "joehub-preview:";
  const saved = { "dining-out": 9100, groceries: 12000, transport: 6000, subscriptions: 5500, shopping: 7500, utilities: 0 };
  const send = (args) =>
    fetch(fake.url, {
      method: "POST",
      headers: { authorization: `Bearer ${fake.token}`, "content-type": "application/json" },
      body: JSON.stringify(args),
    });
  await send(["SET", `${prefix}finance:caps`, JSON.stringify(saved)]);
  await send(["SET", `${prefix}finance:seeded`, JSON.stringify({ transactions: [], caps: { ...saved, "dining-out": 1000 } })]);
  const store = createUpstashStore({ url: fake.url, token: fake.token, prefix });
  const view = await store.financeOverview(Date.parse("2026-11-10T15:00:00-05:00"));
  assert.equal(view.body.caps.find((cap) => cap.slug === "dining-out").capCents, 9100);
  await fake.stop();
});

test("saving caps writes the caps key and an expiring idempotency key", async () => {
  const fake = await startFakeUpstash();
  const store = createUpstashStore({ url: fake.url, token: fake.token, prefix: "joehub-preview:" });
  const caps = { "dining-out": 7000, groceries: 13000, transport: 6000, subscriptions: 5500, shopping: 7500, utilities: 0 };
  const saved = await store.financeSaveCaps({ caps }, "caps-idem-1");
  assert.equal(saved.status, 200);
  const again = await store.financeSaveCaps({ caps: { ...caps, "dining-out": 1000, groceries: 19000 } }, "caps-idem-1");
  assert.equal(again.body.caps["dining-out"], 7000);
  const overview = await store.financeOverview(Date.parse("2026-11-10T15:00:00-05:00"));
  assert.equal(overview.body.caps.find((cap) => cap.slug === "dining-out").capCents, 7000);
  const capWrites = fake.commands.filter((args) => args[0] === "SET" && args[1] === "joehub-preview:finance:caps");
  assert.equal(capWrites.length, 2);
  assert.equal(JSON.parse(capWrites.at(-1)[2])["dining-out"], 7000);
  const idem = fake.commands.find((args) => args[0] === "SET" && args[1] === "joehub-preview:finance:txn:idem:caps-idem-1");
  assert.ok(idem);
  assert.ok(idem.includes("EX"));
  assert.ok(idem.includes("86400"));
  assert.equal(fake.commands.some((args) => args[0] === "SET" && args[1] === "joehub-preview:finance:seeded" && String(args[2]).includes("transactions")), false);
  await fake.stop();
});
