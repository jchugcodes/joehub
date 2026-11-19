import assert from "node:assert/strict";
import test from "node:test";
import {
  handleFinanceAccounts,
  handleFinanceBills,
  handleFinanceBudgets,
  handleFinanceCaps,
  handleFinanceCreateAccount,
  handleFinanceCreateBill,
  handleFinanceCreateGoal,
  handleFinanceCreateTransaction,
  handleFinanceDeleteAccount,
  handleFinanceDeleteBill,
  handleFinanceDeleteGoal,
  handleFinanceDebts,
  handleFinanceGoals,
  handleFinanceImportTransaction,
  handleFinancePatchAccount,
  handleFinancePatchBill,
  handleFinancePatchGoal,
  handleFinancePatchTransaction,
  handleFinanceResetLedger,
  handleFinanceSimulateRefresh,
  handleFinanceTransactions,
} from "../lib/api.mjs";
import { defaultCaps } from "../lib/finance.mjs";
import { createLimiter } from "../lib/ratelimit.mjs";
import { seal } from "../lib/sessions.mjs";
import { createRuntime } from "../lib/store.mjs";
import { migrateLibsql } from "../scripts/libsql-migrate.mjs";
import { startFakeUpstash } from "./support/fakes.mjs";
import { createClient } from "@libsql/client";

const NOW = Date.parse("2026-11-11T11:42:00.000Z");
const SECRET = "finance-write-route-secret";
const IP = "203.0.113.45";
const BUDGET_SLUGS = ["dining-out", "groceries", "transport", "subscriptions", "shopping", "utilities", "health-fitness", "fun", "school", "other"];

function financeHit(commands) {
  return commands.some((command) => command.some((part) => typeof part === "string" && part.includes("joehub:finance")));
}

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

function request(body, url = "https://joehub.test/api/finance/transactions") {
  return { url, json: async () => body };
}

function budgets() {
  return Object.fromEntries(BUDGET_SLUGS.map((slug) => [slug, slug === "groceries" ? 11100 : null]));
}

async function openPair() {
  const fake = await startFakeUpstash();
  const base = await startFakeUpstash();
  const client = createClient({ url: ":memory:" });
  await migrateLibsql({ client, url: ":memory:", test: true });
  const session = {
    id: "session-finance-write",
    deviceId: "device-finance-write",
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
  return { fake, base, client, upstash, sqlite, cookie: seal(SECRET, session.id), env };
}

test("finance write routes match on sqlite and do not touch redis", async () => {
  const pair = await openPair();
  const limiter = createLimiter(200);
  const { env, cookie } = pair;
  try {
    const anonymous = await handleFinanceCreateGoal(headersFor(""), env, pair.sqlite.store, limiter, NOW, IP, request({ name: "Sample cabin" }));
    assert.equal(anonymous.status, 401);
    const badKey = await handleFinanceCaps(headersFor(cookie, "bad key"), env, pair.sqlite.store, limiter, NOW, IP, request({ caps: {} }, "https://joehub.test/api/finance/caps"));
    assert.equal(badKey.status, 400);
    assert.equal(badKey.body.detail, "Invalid Idempotency-Key");

    async function both(run) {
      const left = await run(pair.upstash.store);
      const right = await run(pair.sqlite.store);
      assert.deepEqual(right, left);
      return right;
    }

    const caps = { ...defaultCaps() };
    caps.groceries += 100;
    caps["dining-out"] -= 100;
    await both((store) => handleFinanceCaps(headersFor(cookie, "route-caps"), env, store, limiter, NOW, IP, request({ caps }, "https://joehub.test/api/finance/caps")));
    await both((store) => handleFinanceCaps(headersFor(cookie, "route-caps"), env, store, limiter, NOW, IP, request({ caps: {} }, "https://joehub.test/api/finance/caps")));
    await both((store) => handleFinanceBudgets(headersFor(cookie, "route-budgets"), env, store, limiter, NOW, IP, request({ budgets: budgets() }, "https://joehub.test/api/finance/budgets")));

    const account = await both((store) =>
      handleFinanceCreateAccount(
        headersFor(cookie, "route-acct"),
        env,
        store,
        limiter,
        NOW,
        IP,
        request({ name: "Sample jar", type: "cash", balanceCents: 11100 }, "https://joehub.test/api/finance/accounts"),
      ),
    );
    await both((store) =>
      handleFinancePatchAccount(
        account.body.id,
        headersFor(cookie),
        env,
        store,
        limiter,
        NOW,
        IP,
        request({ name: "Sample jar", type: "loan", balanceCents: 22200 }, "https://joehub.test/api/finance/accounts"),
      ),
    );
    const spare = await both((store) =>
      handleFinanceCreateAccount(
        headersFor(cookie, "route-spare"),
        env,
        store,
        limiter,
        NOW,
        IP,
        request({ name: "Sample empty", type: "cash", balanceCents: 100 }, "https://joehub.test/api/finance/accounts"),
      ),
    );
    await both((store) => handleFinanceDeleteAccount(spare.body.id, headersFor(cookie), env, store, limiter, NOW, IP));

    const bill = await both((store) =>
      handleFinanceCreateBill(
        headersFor(cookie, "route-bill"),
        env,
        store,
        limiter,
        NOW,
        IP,
        request(
          { name: "Synthetic power", amountCents: 111, dueDate: "2026-11-20", recurrence: "monthly", accountId: "acct-cash", category: "utilities" },
          "https://joehub.test/api/finance/bills",
        ),
      ),
    );
    await both((store) => handleFinancePatchBill(bill.body.id, headersFor(cookie), env, store, limiter, NOW, IP, request({ paid: true })));
    await both((store) => handleFinanceDeleteBill(bill.body.id, headersFor(cookie), env, store, limiter, NOW, IP));

    const goal = await both((store) =>
      handleFinanceCreateGoal(
        headersFor(cookie, "route-goal"),
        env,
        store,
        limiter,
        NOW,
        IP,
        request({ name: "Sample inactive", savedCents: 100, targetCents: 1000, kind: "Savings" }, "https://joehub.test/api/finance/goals"),
      ),
    );
    await both((store) => handleFinancePatchGoal(goal.body.slug, headersFor(cookie), env, store, limiter, NOW, IP, request({ status: "inactive" })));
    await both((store) => handleFinanceDeleteGoal("missing-goal", headersFor(cookie), env, store, limiter, NOW, IP));

    const txn = await both((store) =>
      handleFinanceCreateTransaction(
        headersFor(cookie, "route-txn"),
        env,
        store,
        limiter,
        NOW,
        IP,
        request({ payee: "Synthetic oats", amountCents: 111, date: "2026-11-11", type: "expense", category: "groceries", accountId: account.body.id }),
      ),
    );
    await both((store) =>
      handleFinanceCreateTransaction(
        headersFor(cookie, "route-txn"),
        env,
        store,
        limiter,
        NOW,
        IP,
        request({ payee: "Other", amountCents: 999, date: "2026-11-11", type: "expense", category: "groceries" }),
      ),
    );
    await both((store) =>
      handleFinancePatchTransaction(
        txn.body.id,
        headersFor(cookie),
        env,
        store,
        limiter,
        NOW,
        IP,
        request({ payee: "Synthetic oats renamed", amountCents: 222, date: "2026-11-11", type: "expense", category: "groceries", accountId: account.body.id }),
      ),
    );
    await both((store) =>
      handleFinanceImportTransaction(
        headersFor(cookie),
        env,
        store,
        limiter,
        NOW,
        IP,
        request({
          id: "fin-synthetic-import",
          payee: "Synthetic import",
          amountCents: -111,
          date: "2026-11-09",
          type: "expense",
          category: "groceries",
          sourceId: "notion:synthetic-import",
        }),
      ),
    );
    await both((store) => handleFinanceSimulateRefresh(headersFor(cookie), env, store, limiter, NOW, IP));
    await both((store) => handleFinanceResetLedger("fin-missing", headersFor(cookie), env, store, limiter, NOW, IP));
    await both((store) => handleFinanceGoals(headersFor(cookie), env, store, limiter, NOW, IP));
    await both((store) => handleFinanceAccounts(headersFor(cookie), env, store, limiter, NOW, IP, ""));
    await both((store) => handleFinanceBills(headersFor(cookie), env, store, limiter, NOW, IP));
    await both((store) => handleFinanceDebts(headersFor(cookie), env, store, limiter, NOW, IP));
    await both((store) => handleFinanceTransactions(headersFor(cookie), env, store, limiter, NOW, IP, "https://joehub.test/api/finance/transactions"));
    assert.equal(financeHit(pair.base.commands), false);
  } finally {
    pair.client.close();
    pair.fake.stop();
    pair.base.stop();
  }
});
