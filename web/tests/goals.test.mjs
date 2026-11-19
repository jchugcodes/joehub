import assert from "node:assert/strict";
import test from "node:test";
import { handleFinanceDeleteGoal, handleFinancePatchGoal } from "../lib/api.mjs";
import { GOALS, createGoal, deleteGoal, goalIsHidden, goalMonthlyCents, goalStatus, installMemoryFinance, money, patchGoal } from "../lib/finance.mjs";
import { FINANCE_TABS, isGatedPath } from "../lib/live-pages.mjs";
import { createStore, login } from "../lib/sessions.mjs";
import { createUpstashStore, StoreError } from "../lib/store-upstash.mjs";
import { startFakeUpstash } from "./support/fakes.mjs";

test("the Artie seed is four goals that add up to $740 a month", () => {
  assert.deepEqual(GOALS.map((goal) => goal.name), ["Loan payoff", "Emergency fund", "NYC move", "Travel — Japan"]);
  const emergency = GOALS.find((goal) => goal.slug === "emergency-fund");
  assert.equal(emergency.amount, "$8,400");
  assert.equal(emergency.target, "$12,600");
  assert.equal(emergency.value, 67);
  assert.equal(emergency.note, "3 months of expenses");
  assert.equal(emergency.account, "Emergency savings");
  assert.equal(emergency.kind, "Savings");
  assert.equal(emergency.monthlyCents, 22_000);
  assert.equal(money(emergency.monthlyCents), "$220");
  assert.equal(goalMonthlyCents(GOALS), 74_000);
  assert.equal(money(goalMonthlyCents(GOALS)), "$740");
  assert.equal(GOALS.find((goal) => goal.slug === "travel-japan").monthlyCents, 0);
  assert.equal(goalMonthlyCents([{ slug: "old", name: "Old", value: 41, amount: "$4,100", target: "$10,000", note: "On track" }]), null);
});

test("createGoal stores a new goal and leaves an existing name alone", () => {
  const created = createGoal(GOALS, {
    name: "Cabin fund",
    kind: "Savings",
    savedCents: 10_000,
    targetCents: 50_000,
    monthlyCents: 1_000,
    note: "Later",
    account: "",
  });
  assert.equal(created.status, 201);
  assert.equal(created.body.slug, "cabin-fund");
  assert.equal(created.body.value, 20);
  assert.equal(created.body.amount, "$100");
  assert.equal(created.body.target, "$500");
  assert.equal(created.body.color, "#2E8B6A");
  assert.equal(created.goals.length, GOALS.length + 1);
  assert.equal(createGoal(GOALS, { name: "Emergency fund", kind: "Savings", savedCents: 1, targetCents: 2 }).status, 409);
  assert.equal(createGoal(GOALS, { name: "  ", kind: "Savings", savedCents: 1, targetCents: 2 }).status, 400);
  assert.equal(createGoal(GOALS, { name: "Cabin", kind: "Other", savedCents: 1, targetCents: 2 }).body.field, "kind");
  assert.equal(createGoal(GOALS, { name: "Cabin", kind: "Savings", savedCents: -1, targetCents: 2 }).body.field, "saved");
});

test("memory goals can start empty and a repeated create does not add a second row", async () => {
  const previous = process.env.JOEHUB_SEED_GOALS;
  process.env.JOEHUB_SEED_GOALS = "0";
  try {
    const store = installMemoryFinance({});
    assert.deepEqual(await store.financeGoals(), []);
    const body = { name: "Cabin fund", kind: "Savings", savedCents: 100, targetCents: 500, note: "Later" };
    const first = await store.financeCreateGoal(body, "goal-1");
    const second = await store.financeCreateGoal(body, "goal-1");
    assert.equal(first.status, 201);
    assert.equal(second.status, 201);
    assert.equal(second.body.slug, first.body.slug);
    assert.equal((await store.financeGoals()).length, 1);
  } finally {
    if (previous == null) delete process.env.JOEHUB_SEED_GOALS;
    else process.env.JOEHUB_SEED_GOALS = previous;
  }
});

test("production does not seed or write goals", async () => {
  assert.equal(FINANCE_TABS.find((tab) => tab.href === "/finance/goals").live, false);
  assert.equal(isGatedPath("/finance/goals"), true);
  const fake = await startFakeUpstash();
  try {
    const store = createUpstashStore({ url: fake.url, token: fake.token, env: { VERCEL_ENV: "production" } });
    await assert.rejects(() => store.financeGoals(), StoreError);
    await assert.rejects(() => store.financeCreateGoal({ name: "Cabin", kind: "Savings", savedCents: 1, targetCents: 2 }, "nope"), StoreError);
    await assert.rejects(() => store.financePatchGoal("emergency-fund", { name: "Cabin" }), StoreError);
    await assert.rejects(() => store.financeDeleteGoal("emergency-fund"), StoreError);
    assert.equal(fake.commands.some((args) => args[0] === "SET" && String(args[1]).includes("finance:goal")), false);
  } finally {
    await fake.stop();
  }
});

test("status on the goal wins, and the note is only a fallback", () => {
  assert.equal(goalStatus(GOALS.find((goal) => goal.slug === "travel-japan")), "paused");
  assert.equal(goalIsHidden(GOALS.find((goal) => goal.slug === "travel-japan")), true);
  assert.equal(goalStatus({ note: "Not started" }), "not_started");
  assert.equal(goalIsHidden({ note: "Not started" }), false);
  assert.equal(goalStatus({ note: "Active · extra payments" }), "active");
  assert.equal(goalStatus({ note: "Superseded by the cabin" }), "inactive");
  assert.equal(goalIsHidden({ note: "Superseded by the cabin" }), true);
  assert.equal(goalStatus({ note: "Extra payments" }), "active");
  assert.equal(goalStatus({ note: "Aug 2027" }), "active");
  assert.equal(goalStatus({ note: "3 months of expenses" }), "active");
  assert.equal(goalStatus({ status: "active", note: "Paused" }), "active");
  assert.equal(goalIsHidden({ status: "inactive", note: "Extra payments" }), true);
  assert.equal(GOALS.some((goal) => goal.status || goal.period || goal.targetDate), false);
  const paused = { ...GOALS[0], status: "paused", monthlyCents: 50_000 };
  assert.equal(goalMonthlyCents([paused, GOALS[1]]), 22_000);
});

test("patch writes only the fields Joe edits, and delete removes the goal", () => {
  const created = createGoal([], { name: "Cabin fund", kind: "Savings", savedCents: 10_000, targetCents: 50_000, note: "Later" });
  assert.equal(created.body.status, undefined);
  assert.equal(created.body.period, undefined);
  assert.equal(created.body.targetDate, undefined);
  const renamed = patchGoal(created.goals, "cabin-fund", { name: "Lake cabin" });
  assert.equal(renamed.status, 200);
  assert.equal(renamed.body.slug, "cabin-fund");
  assert.equal(renamed.body.name, "Lake cabin");
  assert.equal(renamed.body.status, undefined);
  assert.equal(renamed.body.period, undefined);
  assert.equal(renamed.body.targetDate, undefined);
  const dated = patchGoal(renamed.goals, "cabin-fund", { period: "yearly", targetDate: "2027-08-01", status: "not_started", monthlyCents: 2_500 });
  assert.equal(dated.body.period, "yearly");
  assert.equal(dated.body.targetDate, "2027-08-01");
  assert.equal(dated.body.status, "not_started");
  assert.equal(dated.body.monthlyCents, 2_500);
  assert.equal(dated.body.amount, "$100");
  const cleared = patchGoal(dated.goals, "cabin-fund", { period: "none", targetDate: "", monthlyCents: null });
  assert.equal(cleared.body.period, undefined);
  assert.equal(cleared.body.targetDate, undefined);
  assert.equal(cleared.body.monthlyCents, undefined);
  assert.equal(cleared.body.status, "not_started");
  assert.equal(patchGoal(cleared.goals, "missing", { name: "Nope" }).status, 404);
  assert.equal(patchGoal(cleared.goals, "cabin-fund", { targetDate: "2027-02-31" }).status, 400);
  assert.equal(deleteGoal(cleared.goals, "missing").status, 404);
  const removed = deleteGoal(cleared.goals, "cabin-fund");
  assert.equal(removed.status, 200);
  assert.equal(removed.goals.length, 0);
});

test("goal patch and delete require the owner and 404 an unknown slug", async () => {
  const store = installMemoryFinance(createStore());
  const env = { JOEHUB_DEV_AUTH: "1", JOEHUB_SESSION_SECRET: "goals-overlay-secret-value" };
  const limiter = { allow: async () => true };
  const now = Date.UTC(2026, 10, 19);
  const request = { json: async () => ({ period: "yearly" }), url: "http://127.0.0.1/api/finance/goals/emergency-fund" };
  assert.equal((await handleFinancePatchGoal("emergency-fund", new Headers(), env, store, limiter, now, "127.0.0.1", request)).status, 401);
  assert.equal((await handleFinanceDeleteGoal("emergency-fund", new Headers(), env, store, limiter, now, "127.0.0.1")).status, 401);
  const signed = login({ username: "synthetic", password: "synthetic" }, env, store, now);
  const headers = new Headers({ cookie: `joehub_session=${signed.cookie}` });
  assert.equal((await handleFinancePatchGoal("no-such-goal", headers, env, store, limiter, now, "127.0.0.1", request)).status, 404);
  assert.equal((await handleFinanceDeleteGoal("no-such-goal", headers, env, store, limiter, now, "127.0.0.1")).status, 404);
  const patched = await handleFinancePatchGoal("emergency-fund", headers, env, store, limiter, now, "127.0.0.1", request);
  assert.equal(patched.status, 200);
  assert.equal(patched.body.period, "yearly");
  assert.equal(patched.body.note, "3 months of expenses");
  assert.equal((await store.financeGoals()).find((goal) => goal.slug === "student-loan-payoff").period, undefined);
});
