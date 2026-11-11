import assert from "node:assert/strict";
import test from "node:test";
import { createStore, login } from "../lib/sessions.mjs";
import { createLimiter } from "../lib/ratelimit.mjs";
import { handleFinanceDebt, handleFinanceDebts } from "../lib/api.mjs";
import { debtById, debtsSnapshot, installMemoryFinance, SEED_ACCOUNTS } from "../lib/finance.mjs";
import { createUpstashStore } from "../lib/store-upstash.mjs";
import { startFakeUpstash } from "./support/fakes.mjs";

const NOW = Date.parse("2026-11-11T13:30:00.000Z");
const env = { JOEHUB_DEV_AUTH: "1", JOEHUB_SESSION_SECRET: "debts-unit-secret-value", NODE_ENV: "development" };

test("debts collapse the student loans and keep the other liabilities", () => {
  const view = debtsSnapshot(SEED_ACCOUNTS, NOW);
  assert.equal(view.empty, false);
  assert.equal(view.totalCents, 15_566_400);
  assert.equal(view.asOf, "2026-11-11T13:30:00.000Z");
  assert.equal(view.student.count, 22);
  assert.equal(view.student.totalCents, 14_718_400);
  assert.deepEqual(view.debts.map((debt) => debt.name), ["Auto loan", "Everyday card", "Store installment"]);
  assert.equal(view.debts.find((debt) => debt.id === "acct-installment").paymentsLeft, 3);
  assert.equal(view.debts.find((debt) => debt.id === "acct-installment").nextDue, "2026-11-18");
  const loan = view.student.debts.find((debt) => debt.id === "acct-student-15");
  assert.equal(loan.name, "Federal loan 15");
  assert.equal(loan.loanKind, "Graduate");
  assert.equal(loan.rateBps, 373);
  assert.equal(loan.minimumCents, 8595);
  assert.equal(loan.balanceCents, 1_146_000);
  assert.equal(loan.institution, "Example Servicer");
  assert.equal(loan.nextDue, "2026-12-01");
  assert.equal(view.student.debts[0].name, "Federal loan 01");
  assert.equal(view.student.debts.at(-1).name, "Federal loan 22");
  assert.equal(debtsSnapshot([]).empty, true);
  assert.equal(debtById(SEED_ACCOUNTS, "acct-checking", NOW), null);
  assert.equal(debtById(SEED_ACCOUNTS, "acct-old", NOW), null);
});

test("the debts API is read-only and requires a session", async () => {
  const store = installMemoryFinance(createStore());
  const limiter = createLimiter(60);
  const denied = await handleFinanceDebts(new Headers(), env, store, limiter, NOW, "direct");
  assert.equal(denied.status, 401);
  const session = login({ username: "synthetic", password: "synthetic", device_label: "debts" }, env, store, NOW);
  const headers = new Headers({ cookie: `joehub_session=${session.cookie}` });
  const listed = await handleFinanceDebts(headers, env, store, limiter, NOW, "direct");
  assert.equal(listed.status, 200);
  assert.equal(listed.body.totalCents, 15_566_400);
  const one = await handleFinanceDebt("acct-student-15", headers, env, store, limiter, NOW, "direct");
  assert.equal(one.status, 200);
  assert.equal(one.body.minimumCents, 8595);
  assert.equal((await handleFinanceDebt("acct-checking", headers, env, store, limiter, NOW, "direct")).status, 404);
  assert.equal(typeof store.financeCreateDebt, "undefined");
});

test("production debts stay empty and write no seed", async () => {
  const fake = await startFakeUpstash();
  try {
    const store = createUpstashStore({ url: fake.url, token: fake.token, env: { VERCEL_ENV: "production" } });
    const view = await store.financeDebts(NOW);
    assert.equal(view.empty, true);
    assert.deepEqual(view.debts, []);
    assert.equal(fake.commands.some((args) => String(args[1] || "").includes("seeded")), false);
  } finally {
    fake.stop();
  }
});
