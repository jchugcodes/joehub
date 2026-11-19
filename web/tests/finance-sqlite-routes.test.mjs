import assert from "node:assert/strict";
import test from "node:test";
import { createClient } from "@libsql/client";
import {
  handleFinanceAccount,
  handleFinanceAccounts,
  handleFinanceBill,
  handleFinanceBills,
  handleFinanceCategories,
  handleFinanceCategory,
  handleFinanceDebt,
  handleFinanceDebts,
  handleFinanceGoals,
  handleFinanceOverview,
  handleFinanceSpendingMonth,
  handleFinanceTransaction,
  handleFinanceTransactions,
} from "../lib/api.mjs";
import { createLimiter } from "../lib/ratelimit.mjs";
import { seal } from "../lib/sessions.mjs";
import { createRuntime } from "../lib/store.mjs";
import { migrateLibsql } from "../scripts/libsql-migrate.mjs";
import { startFakeUpstash } from "./support/fakes.mjs";

const NOW = Date.parse("2026-11-11T11:42:00.000Z");
const SECRET = "finance-route-secret-value";
const IP = "203.0.113.44";

function envFor(extra = {}) {
  return {
    NODE_ENV: "production",
    JOEHUB_SESSION_SECRET: SECRET,
    ...extra,
  };
}

function headersFor(cookie) {
  return {
    get(name) {
      if (String(name || "").toLowerCase() === "cookie") return cookie ? `joehub_session=${cookie}` : "";
      return "";
    },
  };
}

function financeHit(commands) {
  return commands.some((command) => command.some((part) => typeof part === "string" && part.includes("joehub:finance")));
}

async function openPair() {
  const fake = await startFakeUpstash();
  const base = await startFakeUpstash();
  const client = createClient({ url: ":memory:" });
  await migrateLibsql({ client, url: ":memory:", test: true });
  const session = {
    id: "session-finance-route",
    deviceId: "device-finance-route",
    createdAt: NOW,
    expiresAt: NOW + 14 * 24 * 60 * 60 * 1000,
    revoked: false,
    owner: "owner-subject",
    label: "browser",
  };
  const env = envFor();
  const upstash = createRuntime(envFor({ UPSTASH_REDIS_REST_URL: fake.url, UPSTASH_REDIS_REST_TOKEN: fake.token }));
  const sqlite = createRuntime(
    envFor({
      UPSTASH_REDIS_REST_URL: base.url,
      UPSTASH_REDIS_REST_TOKEN: base.token,
      JOEHUB_BACKEND_FINANCE: "sqlite",
      JOEHUB_LIBSQL_URL: "libsql://example.turso.io",
    }),
    { financeClient: client },
  );
  await upstash.store.putSession(session, NOW);
  await sqlite.store.putSession(session, NOW);
  return { fake, base, client, upstash, sqlite, cookie: seal(SECRET, session.id), env };
}

test("finance read routes match on sqlite and do not read redis", async () => {
  const pair = await openPair();
  const limiter = () => createLimiter(60);
  const asOf = "http://localhost/api/finance/overview?asOf=2026-11-11T11:42:00.000Z";
  try {
    const anonymous = headersFor("");
    const upAnon = await handleFinanceOverview(anonymous, pair.env, pair.upstash.store, limiter(), NOW, IP, asOf);
    const sqlAnon = await handleFinanceOverview(anonymous, pair.env, pair.sqlite.store, limiter(), NOW, IP, asOf);
    assert.deepEqual(sqlAnon, upAnon);
    assert.equal(sqlAnon.status, 401);

    const headers = headersFor(pair.cookie);
    const mark = pair.base.commands.length;
    const calls = [
      (store) => handleFinanceOverview(headers, pair.env, store, limiter(), NOW, IP, asOf),
      (store) => handleFinanceSpendingMonth(headers, pair.env, store, limiter(), NOW, IP, `${asOf}&month=2026-11`),
      (store) => handleFinanceSpendingMonth(headers, pair.env, store, limiter(), NOW, IP, `${asOf}&month=2026-13`),
      (store) => handleFinanceCategories(headers, pair.env, store, limiter(), NOW, IP, `${asOf}&period=month`),
      (store) => handleFinanceCategories(headers, pair.env, store, limiter(), NOW, IP, `${asOf}&period=week`),
      (store) => handleFinanceCategory(headers, pair.env, store, limiter(), NOW, IP, asOf, "2026-11-09", "groceries"),
      (store) => handleFinanceCategory(headers, pair.env, store, limiter(), NOW, IP, asOf, "2026-11-09", "missing-sample"),
      (store) => handleFinanceBills(headers, pair.env, store, limiter(), NOW, IP, asOf),
      (store) => handleFinanceBill("bill-water", headers, pair.env, store, limiter(), NOW, IP, asOf),
      (store) => handleFinanceBill("bill-missing", headers, pair.env, store, limiter(), NOW, IP, asOf),
      (store) => handleFinanceGoals(headers, pair.env, store, limiter(), NOW, IP),
      (store) => handleFinanceAccounts(headers, pair.env, store, limiter(), NOW, IP, asOf),
      (store) => handleFinanceAccount("acct-checking", headers, pair.env, store, limiter(), NOW, IP, asOf),
      (store) => handleFinanceAccount("acct-missing", headers, pair.env, store, limiter(), NOW, IP, asOf),
      (store) => handleFinanceDebts(headers, pair.env, store, limiter(), NOW, IP, asOf),
      (store) => handleFinanceDebt("acct-student-01", headers, pair.env, store, limiter(), NOW, IP, asOf),
      (store) => handleFinanceDebt("acct-missing", headers, pair.env, store, limiter(), NOW, IP, asOf),
      (store) => handleFinanceTransactions(headers, pair.env, store, limiter(), NOW, IP, asOf),
      (store) => handleFinanceTransactions(headers, pair.env, store, limiter(), NOW, IP, `${asOf}&accountId=acct-checking`),
      (store) => handleFinanceTransaction("fin-sweetgreen", headers, pair.env, store, limiter(), NOW, IP),
      (store) => handleFinanceTransaction("missing", headers, pair.env, store, limiter(), NOW, IP),
    ];
    for (const call of calls) {
      const sql = await call(pair.sqlite.store);
      const up = await call(pair.upstash.store);
      assert.deepEqual(sql, up);
    }
    assert.equal(financeHit(pair.base.commands.slice(mark)), false);
    const accounts = await handleFinanceAccounts(headers, pair.env, pair.sqlite.store, limiter(), NOW, IP, asOf);
    const names = accounts.body.accounts.map((account) => account.name);
    assert.equal(names.includes("Unassigned"), false);
  } finally {
    pair.client.close();
    pair.fake.stop();
    pair.base.stop();
  }
});
