import assert from "node:assert/strict";
import test from "node:test";
import { createClient } from "@libsql/client";
import {
  handleFinanceBuckets,
  handleFinanceCreateCategory,
  handleFinanceDeleteCategory,
  handleFinancePatchCategory,
} from "../lib/api.mjs";
import { chartFor, installMemoryFinance, SEED_CATEGORIES, SEED_TRANSACTIONS } from "../lib/finance.mjs";
import { createLimiter } from "../lib/ratelimit.mjs";
import { seal } from "../lib/sessions.mjs";
import { createRuntime } from "../lib/store.mjs";
import { migrateLibsql } from "../scripts/libsql-migrate.mjs";
import { startFakeUpstash } from "./support/fakes.mjs";

const NOW = Date.parse("2026-11-11T11:42:00.000Z");
const SECRET = "finance-bucket-route-secret";
const IP = "203.0.113.46";

function financeHit(commands) {
  return commands.some((command) => command.some((part) => typeof part === "string" && part.includes("joehub:finance")));
}

function spent(body, slug) {
  return body.categories.find((item) => item.slug === slug)?.spentCents || 0;
}

async function editSequence(store) {
  const before = {
    month: await store.financeSpendingMonth(NOW),
    week: await store.financeCategories(NOW, "week"),
    overview: await store.financeOverview(NOW),
  };
  const hidden = await store.financePatchCategory("groceries", { hidden: true });
  const afterHide = {
    buckets: await store.financeBuckets(),
    month: await store.financeSpendingMonth(NOW),
    week: await store.financeCategories(NOW, "week"),
    overview: await store.financeOverview(NOW),
  };
  const shown = await store.financePatchCategory("groceries", { hidden: false });
  const restored = await store.financeSpendingMonth(NOW);
  const renamed = await store.financePatchCategory("groceries", { name: "Sample market" });
  const named = await store.financeCategories(NOW, "month");
  const duplicate = await store.financeCreateCategory({ name: "sample market" }, "bucket-dup");
  const blank = await store.financeCreateCategory({ name: "  " }, "bucket-blank");
  const badHidden = await store.financePatchCategory("transport", { hidden: "yes" });
  const missing = await store.financeDeleteCategory("missing-bucket");
  const added = await store.financeCreateCategory({ name: "Sample oats" }, "bucket-oats");
  const replay = await store.financeCreateCategory({ name: "Sample other" }, "bucket-oats");
  const removed = await store.financeDeleteCategory("dining-out");
  const removedAgain = await store.financeDeleteCategory("dining-out");
  const after = {
    buckets: await store.financeBuckets(),
    month: await store.financeSpendingMonth(NOW),
    week: await store.financeCategories(NOW, "week"),
    overview: await store.financeOverview(NOW),
  };
  return { before, hidden, afterHide, shown, restored, renamed, named, duplicate, blank, badHidden, missing, added, replay, removed, removedAgain, after };
}

test("hiding a bucket drops its spend from every total and unhide puts it back", async () => {
  const store = installMemoryFinance({});
  const before = await store.financeSpendingMonth(NOW);
  const groceries = spent(before.body, "groceries");
  const plan = before.body.month.planCents;
  assert.ok(groceries > 0);
  assert.equal((await store.financePatchCategory("groceries", { hidden: true })).status, 200);
  const hidden = await store.financeSpendingMonth(NOW);
  const week = await store.financeCategories(NOW, "week");
  const overview = await store.financeOverview(NOW);
  assert.equal(hidden.body.categories.some((item) => item.slug === "groceries"), false);
  assert.equal(hidden.body.transactions.some((row) => row.category === "groceries"), false);
  assert.equal(hidden.body.spentCents, before.body.spentCents - groceries);
  assert.equal(hidden.body.month.spentCents, before.body.month.spentCents - groceries);
  assert.ok(hidden.body.month.planCents < plan);
  assert.equal(week.categories.some((item) => item.slug === "groceries"), false);
  assert.equal(overview.body.month.spentCents, hidden.body.month.spentCents);
  assert.equal(overview.body.month.planCents, hidden.body.month.planCents);
  assert.equal(overview.body.caps.some((item) => item.slug === "groceries"), false);
  assert.ok(overview.body.flow.Month.find((row) => row.current).spentCents < before.body.month.spentCents);
  const buckets = await store.financeBuckets();
  assert.equal(buckets.buckets.find((item) => item.slug === "groceries").hidden, true);
  assert.equal((await store.financePatchCategory("groceries", { hidden: false })).status, 200);
  const restored = await store.financeSpendingMonth(NOW);
  assert.equal(restored.body.spentCents, before.body.spentCents);
  assert.equal(restored.body.month.planCents, plan);
});

test("rename keeps the slug, add is idempotent, and remove moves spend to Uncategorized", async () => {
  const store = installMemoryFinance({});
  const before = await store.financeSpendingMonth(NOW);
  const dining = spent(before.body, "dining-out");
  const renamed = await store.financePatchCategory("groceries", { name: "Sample market" });
  assert.equal(renamed.status, 200);
  assert.equal(renamed.body.bucket.slug, "groceries");
  assert.equal(renamed.body.bucket.name, "Sample market");
  const named = await store.financeCategories(NOW, "month");
  assert.equal(named.categories.find((item) => item.slug === "groceries").name, "Sample market");
  assert.equal(named.categories.find((item) => item.slug === "groceries").spentCents, spent(before.body, "groceries"));
  assert.equal((await store.financeCreateCategory({ name: "sample market" })).status, 409);
  assert.deepEqual((await store.financeCreateCategory({ name: " " })).body, { detail: "Enter a name.", field: "name" });
  const added = await store.financeCreateCategory({ name: "Sample oats" }, "oats");
  const replay = await store.financeCreateCategory({ name: "Sample other" }, "oats");
  assert.equal(added.status, 201);
  assert.deepEqual(replay, added);
  assert.equal((await store.financeDeleteCategory("dining-out")).status, 200);
  assert.equal((await store.financeDeleteCategory("dining-out")).status, 404);
  const after = await store.financeSpendingMonth(NOW);
  assert.equal(after.body.categories.some((item) => item.slug === "dining-out"), false);
  assert.equal(after.body.transactions.some((row) => row.category === "dining-out"), false);
  assert.equal(spent(after.body, "uncategorized"), spent(before.body, "uncategorized") + dining);
  assert.equal(after.body.spentCents, before.body.spentCents);
  const again = await store.financeCreateCategory({ name: "Dining Out" });
  assert.equal(again.status, 201);
  assert.equal(again.body.bucket.slug, "dining-out");
  const revived = await store.financeCategories(NOW, "month");
  assert.equal(spent(revived, "dining-out"), 0);
  assert.equal(spent(revived, "uncategorized"), spent(before.body, "uncategorized") + dining);
});

test("a weekly spend chart leaves out a hidden bucket", () => {
  const hidden = SEED_CATEGORIES.map((category) => (category.slug === "groceries" ? { ...category, hidden: true } : category));
  const open = chartFor(SEED_TRANSACTIONS, "2026-11-10", "1W", {});
  const closed = chartFor(SEED_TRANSACTIONS, "2026-11-10", "1W", {}, hidden);
  const sum = (chart) => chart.points.reduce((total, point) => total + point, 0);
  assert.equal(open.kind, "weekly");
  assert.ok(sum(closed) < sum(open));
});

test("bucket edits match on upstash and libsql", async () => {
  const fake = await startFakeUpstash();
  const client = createClient({ url: ":memory:" });
  await migrateLibsql({ client, url: ":memory:", test: true });
  const env = { NODE_ENV: "production" };
  const upstash = createRuntime({ ...env, UPSTASH_REDIS_REST_URL: fake.url, UPSTASH_REDIS_REST_TOKEN: fake.token });
  const sqlite = createRuntime(
    { ...env, JOEHUB_BACKEND_FINANCE: "sqlite", JOEHUB_LIBSQL_URL: "libsql://example.turso.io" },
    { financeClient: client },
  );
  try {
    const left = await editSequence(upstash.store);
    const right = await editSequence(sqlite.store);
    assert.deepEqual(right, left);
    assert.equal(left.hidden.status, 200);
    assert.equal(left.afterHide.month.body.categories.some((item) => item.slug === "groceries"), false);
    assert.equal(left.added.status, 201);
    assert.deepEqual(left.replay, left.added);
    assert.equal(left.removed.status, 200);
    assert.equal(left.after.month.body.transactions.some((row) => row.category === "dining-out"), false);
    const box = await client.execute("SELECT COUNT(*) AS n FROM categories WHERE name = 'Dining Out'");
    assert.equal(Number(box.rows[0].n), 0);
  } finally {
    fake.stop();
    client.close();
  }
});

function headersFor(cookie, idem = "") {
  return {
    get(name) {
      const key = String(name || "").toLowerCase();
      if (key === "cookie") return cookie ? `joehub_session=${cookie}` : "";
      if (key === "idempotency-key") return idem;
      return "";
    },
  };
}

function request(body) {
  return { json: async () => body };
}

test("bucket routes match on sqlite and do not touch redis", async () => {
  const fake = await startFakeUpstash();
  const base = await startFakeUpstash();
  const client = createClient({ url: ":memory:" });
  await migrateLibsql({ client, url: ":memory:", test: true });
  const session = {
    id: "session-finance-buckets",
    deviceId: "device-finance-buckets",
    createdAt: NOW,
    expiresAt: NOW + 14 * 24 * 60 * 60 * 1000,
    revoked: false,
    owner: "owner-subject",
    label: "browser",
  };
  const env = { NODE_ENV: "production", JOEHUB_SESSION_SECRET: SECRET };
  const upstash = createRuntime({ ...env, UPSTASH_REDIS_REST_URL: fake.url, UPSTASH_REDIS_REST_TOKEN: fake.token });
  const sqlite = createRuntime(
    {
      ...env,
      UPSTASH_REDIS_REST_URL: base.url,
      UPSTASH_REDIS_REST_TOKEN: base.token,
      JOEHUB_BACKEND_FINANCE: "sqlite",
      JOEHUB_LIBSQL_URL: "libsql://example.turso.io",
    },
    { financeClient: client },
  );
  await upstash.store.putSession(session, NOW);
  await sqlite.store.putSession(session, NOW);
  const cookie = seal(SECRET, session.id);
  const limiter = createLimiter(200);
  try {
    const anonymous = await handleFinanceCreateCategory(headersFor(""), env, sqlite.store, limiter, NOW, IP, request({ name: "Sample oats" }));
    assert.equal(anonymous.status, 401);
    const badKey = await handleFinanceCreateCategory(headersFor(cookie, "bad key"), env, sqlite.store, limiter, NOW, IP, request({ name: "Sample oats" }));
    assert.equal(badKey.status, 400);
    assert.equal(badKey.body.detail, "Invalid Idempotency-Key");

    async function both(run) {
      const left = await run(upstash.store);
      const right = await run(sqlite.store);
      assert.deepEqual(right, left);
      return right;
    }

    const created = await both((store) => handleFinanceCreateCategory(headersFor(cookie, "route-bucket"), env, store, limiter, NOW, IP, request({ name: "Sample oats" })));
    assert.equal(created.status, 201);
    await both((store) => handleFinanceCreateCategory(headersFor(cookie, "route-bucket"), env, store, limiter, NOW, IP, request({ name: "Sample other" })));
    const blank = await both((store) => handleFinanceCreateCategory(headersFor(cookie, "route-blank"), env, store, limiter, NOW, IP, request({ name: "" })));
    assert.deepEqual(blank.body, { detail: "Enter a name.", field: "name" });
    const clash = await both((store) => handleFinancePatchCategory("groceries", headersFor(cookie), env, store, limiter, NOW, IP, request({ name: "Sample oats" })));
    assert.equal(clash.status, 409);
    assert.equal(clash.body.field, "name");
    const hidden = await both((store) => handleFinancePatchCategory("groceries", headersFor(cookie), env, store, limiter, NOW, IP, request({ hidden: true })));
    assert.equal(hidden.status, 200);
    assert.equal(hidden.body.bucket.hidden, true);
    const missing = await both((store) => handleFinanceDeleteCategory("missing-bucket", headersFor(cookie), env, store, limiter, NOW, IP));
    assert.equal(missing.status, 404);
    assert.equal(missing.body.detail, "That bucket is not here.");
    const removed = await both((store) => handleFinanceDeleteCategory("dining-out", headersFor(cookie), env, store, limiter, NOW, IP));
    assert.equal(removed.status, 200);
    assert.deepEqual(removed.body, { removed: true });
    const listed = await both((store) => handleFinanceBuckets(headersFor(cookie), env, store, limiter, NOW, IP));
    assert.equal(listed.status, 200);
    assert.equal(listed.body.buckets.some((item) => item.slug === "dining-out"), false);
    assert.equal(listed.body.buckets.find((item) => item.slug === "groceries").hidden, true);
    assert.equal(financeHit(base.commands), false);
  } finally {
    fake.stop();
    base.stop();
    client.close();
  }
});
