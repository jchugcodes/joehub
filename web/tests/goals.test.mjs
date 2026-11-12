import assert from "node:assert/strict";
import test from "node:test";
import { GOALS, createGoal, goalMonthlyCents, installMemoryFinance, money } from "../lib/finance.mjs";
import { FINANCE_TABS, isGatedPath } from "../lib/live-pages.mjs";
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
    assert.equal(fake.commands.some((args) => args[0] === "SET" && String(args[1]).includes("finance:goal")), false);
  } finally {
    await fake.stop();
  }
});
