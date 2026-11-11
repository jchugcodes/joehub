import assert from "node:assert/strict";
import test from "node:test";
import { ACCOUNTS, GOALS, PLAN_CENTS, capsForWeek, createTransaction, patchTransaction, seedSnapshots, SEED_TRANSACTIONS } from "../lib/finance.mjs";
import { createUpstashStore } from "../lib/store-upstash.mjs";
import { startFakeUpstash } from "./support/fakes.mjs";

const NOW = Date.parse("2026-11-10T17:00:00Z");
const SOURCE = "notion:01234567-89ab-cdef-0123-456789abcdef";

function indexes(commands, key) {
  return commands.filter((args) => args[0] === "SET" && args[1] === key);
}

test("the envelope is the sum of weekly caps that are set", () => {
  const caps = capsForWeek(SEED_TRANSACTIONS, "2026-11-09");
  assert.deepEqual(
    caps.map((cap) => cap.slug),
    ["groceries", "dining-out", "transport", "utilities", "subscriptions", "shopping", "health-fitness", "fun", "school", "other"],
  );
  assert.equal(caps.find((cap) => cap.slug === "transport").name, "Gas & Transport");
  assert.equal(caps.find((cap) => cap.slug === "utilities").name, "Bills & Utilities");
  assert.equal(caps.find((cap) => cap.slug === "utilities").inEnvelope, true);
  assert.equal(caps.find((cap) => cap.slug === "health-fitness").inEnvelope, false);
  assert.equal(caps.find((cap) => cap.slug === "health-fitness").capCents, null);
  const envelope = caps.filter((cap) => cap.inEnvelope).reduce((sum, cap) => sum + cap.capCents, 0);
  assert.equal(envelope, 39000);
  assert.equal(caps.reduce((sum, cap) => sum + cap.spentCents, 0), 37603);
});

test("a caps-only database still supplies weekly caps and the extra categories", async () => {
  const fake = await startFakeUpstash();
  const send = (args) =>
    fetch(fake.url, {
      method: "POST",
      headers: { authorization: `Bearer ${fake.token}`, "content-type": "application/json" },
      body: JSON.stringify(args),
    });
  const caps = { "dining-out": 9100, groceries: 12000, transport: 6000, subscriptions: 5500, shopping: 7500, utilities: 0 };
  await send(["SET", "joehub:finance:seeded", "1"]);
  await send(["SET", "joehub:finance:caps", JSON.stringify(caps)]);
  await send(["SET", "joehub:finance:plan", JSON.stringify({ cents: PLAN_CENTS })]);
  await send(["SET", "joehub:finance:snapshots", JSON.stringify(seedSnapshots())]);
  await send(["SET", "joehub:finance:accounts", JSON.stringify(ACCOUNTS)]);
  await send(["SET", "joehub:finance:goals", JSON.stringify(GOALS)]);
  const store = createUpstashStore({ url: fake.url, token: fake.token, env: { VERCEL_ENV: "production" } });
  try {
    const before = fake.commands.length;
    const view = await store.financeOverview(NOW);
    assert.equal(view.body.caps.find((cap) => cap.slug === "dining-out").capCents, 9100);
    assert.equal(view.body.caps.find((cap) => cap.slug === "school").inEnvelope, false);
    const later = fake.commands.slice(before);
    assert.equal(later.some((args) => args[0] === "SET"), false);
  } finally {
    fake.stop();
  }
});

test("transactions keep mask and impulse and upsert on sourceId", async () => {
  const badMask = createTransaction([], { payee: "Market", amountCents: 1200, date: "2026-11-10", type: "expense", category: "groceries", accountMask: "12345" }, NOW, 1);
  assert.equal(badMask.status, 400);
  assert.equal(badMask.body.field, "accountMask");
  const badImpulse = createTransaction([], { payee: "Market", amountCents: 1200, date: "2026-11-10", type: "expense", category: "groceries", impulse: "yes" }, NOW, 1);
  assert.equal(badImpulse.body.field, "impulse");
  const created = createTransaction([], { payee: "Market", amountCents: 1200, date: "2026-11-10", type: "expense", category: "health-fitness", sourceId: SOURCE, accountMask: "4242", impulse: false }, NOW, 1);
  assert.equal(created.status, 201);
  assert.equal(created.body.accountMask, "4242");
  assert.equal(created.body.impulse, false);
  assert.equal(created.body.category, "health-fitness");
  const cleared = patchTransaction(created.rows, created.rows[0].id, { accountMask: "", impulse: null }, NOW + 1);
  assert.equal(cleared.body.accountMask, undefined);
  assert.equal(Object.hasOwn(cleared.body, "impulse"), false);

  const fake = await startFakeUpstash();
  const store = createUpstashStore({ url: fake.url, token: fake.token, env: { VERCEL_ENV: "preview" } });
  try {
    const first = await store.financeCreateTransaction({ payee: "Market", amountCents: 1200, date: "2026-11-10", type: "expense", category: "groceries", sourceId: "plaid:tx-1", accountMask: "4242", impulse: true }, NOW);
    assert.equal(first.status, 201);
    const second = await store.financeCreateTransaction({ payee: "Market renamed", amountCents: 1800, date: "2026-11-10", type: "expense", category: "groceries", sourceId: "plaid:tx-1" }, NOW + 5);
    assert.equal(second.status, 200);
    assert.equal(second.body.id, first.body.id);
    assert.equal(second.body.payee, "Market renamed");
    assert.equal(second.body.accountMask, "4242");
    assert.equal(second.body.impulse, true);
    const listed = await store.financeTransactions(NOW);
    assert.equal(listed.body.rows.filter((row) => row.sourceId === "plaid:tx-1").length, 1);
    const index = indexes(fake.commands, "joehub:finance:txn:bysource:plaid:tx-1");
    assert.ok(index.length >= 1);
    assert.equal(index.at(-1)[2], first.body.id);
    assert.equal(index.at(-1).includes("EX"), false);
  } finally {
    fake.stop();
  }
});

test("tasks and grocery items upsert through the bysource index", async () => {
  const fake = await startFakeUpstash();
  const store = createUpstashStore({ url: fake.url, token: fake.token, env: {} });
  try {
    const task = await store.createTask({ title: "Imported task", sourceId: SOURCE }, "task-1", NOW);
    assert.equal(task.status, 201);
    const taskAgain = await store.createTask({ title: "Imported task edited", sourceId: SOURCE }, "task-2", NOW + 10);
    assert.equal(taskAgain.status, 200);
    assert.equal(taskAgain.body.id, task.body.id);
    assert.equal(taskAgain.body.title, "Imported task edited");
    const taskIndex = indexes(fake.commands, `joehub:task:bysource:${SOURCE}`);
    assert.equal(taskIndex.at(-1)[2], task.body.id);

    const item = await store.createGrocery({ name: "Imported oats", sourceId: "notion:oats" }, "grocery-1", NOW);
    assert.equal(item.status, 201);
    const itemAgain = await store.createGrocery({ name: "Imported oats edited", quantity: "2", sourceId: "notion:oats" }, "grocery-2", NOW + 10);
    assert.equal(itemAgain.status, 200);
    assert.equal(itemAgain.body.id, item.body.id);
    assert.equal(itemAgain.body.name, "Imported oats edited");
    assert.equal(itemAgain.body.quantity, "2");
    const itemIndex = indexes(fake.commands, "joehub:grocery:item:bysource:notion:oats");
    assert.equal(itemIndex.at(-1)[2], item.body.id);
    const items = await store.listGrocery();
    assert.equal(items.filter((row) => row.sourceId === "notion:oats").length, 1);
  } finally {
    fake.stop();
  }
});
