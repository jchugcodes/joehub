import assert from "node:assert/strict";
import test from "node:test";
import { CATEGORY_NAMES, SEED_BILLS, billGroup, billMoney, billsSnapshot, createBill, deleteBill, importLedgerTransaction, linkOrInsertImportedTxn, projectBills, rollBill, setBillPaid } from "../lib/bills.mjs";
import { SEED_ACCOUNTS, SEED_TRANSACTIONS, installMemoryFinance, patchTransaction } from "../lib/finance.mjs";
import { createUpstashStore } from "../lib/store-upstash.mjs";
import { startFakeUpstash } from "./support/fakes.mjs";

const NOW = Date.parse("2026-11-11T11:42:00.000Z");

function payment(id, date) {
  return {
    id,
    payee: "Streaming Club (example)",
    date,
    category: "subscriptions",
    type: "expense",
    amountCents: -4675,
    source: "bill",
    billId: id,
    periodDue: date,
    accountId: "acct-checking",
    accountMask: "3816",
    createdAt: NOW,
    updatedAt: NOW,
  };
}

test("bills group by the Detroit week and keep the streaming payment", () => {
  const view = billsSnapshot(SEED_BILLS, SEED_TRANSACTIONS, SEED_ACCOUNTS, NOW);
  const groups = Object.fromEntries(view.bills.map((bill) => [bill.name, bill.group]));
  assert.equal(groups["City Water (example)"], "Overdue");
  assert.equal(groups["Streaming Club (example)"], "This week");
  assert.equal(groups["Phone (example)"], "This week");
  assert.equal(groups["Lawn service (example)"], "This week");
  assert.equal(groups["Internet (example)"], "Later");
  assert.equal(groups["Rent (example)"], "Later");
  assert.equal(groups["Annual membership (example)"], "Later");
  const water = view.bills.find((bill) => bill.id === "bill-water");
  assert.equal(water.dueLabel, "Due Nov 9 · Monthly · 2 days overdue");
  assert.equal(water.overdueDays, 2);
  assert.equal(water.payments.length, 1);
  assert.equal(water.payments[0].amountCents, -4820);
  assert.equal(water.payments[0].accountName, "Everyday checking");
  const stream = view.bills.find((bill) => bill.id === "bill-stream");
  assert.equal(stream.paid, true);
  assert.equal(stream.payments.length, 1);
  assert.equal(stream.payments[0].id, "fin-stream");
  assert.equal(SEED_TRANSACTIONS.filter((row) => row.payee === "Streaming Club (example)" && row.date.startsWith("2026-11")).length, 1);
  assert.equal(billGroup(stream, view.today), "This week");
  assert.equal(projectBills(SEED_BILLS, NOW).changed, false);
});

test("paying and unpaying does not leave an orphan payment", () => {
  const paid = setBillPaid(SEED_BILLS, SEED_TRANSACTIONS, SEED_ACCOUNTS, "bill-phone", true, NOW);
  const created = paid.rows.filter((row) => row.billId === "bill-phone" && row.source === "bill");
  assert.equal(created.length, 1);
  assert.equal(created[0].accountMask, "3816");
  assert.equal(created[0].amountCents, -5500);
  assert.equal(created[0].date, "2026-11-11");
  const again = setBillPaid(paid.bills, paid.rows, SEED_ACCOUNTS, "bill-phone", true, NOW);
  assert.equal(again.rows.filter((row) => row.billId === "bill-phone").length, 1);
  const unpaid = setBillPaid(again.bills, again.rows, SEED_ACCOUNTS, "bill-phone", false, NOW);
  assert.equal(unpaid.body.paid, false);
  assert.equal(unpaid.rows.some((row) => row.billId === "bill-phone"), false);
  assert.equal(unpaid.rows.length, SEED_TRANSACTIONS.length);
  const edited = patchTransaction(created, created[0].id, { payee: "Phone bill", amountCents: 5500, date: "2026-11-11", type: "expense", category: "subscriptions" }, NOW);
  const kept = setBillPaid(paid.bills, edited.rows, SEED_ACCOUNTS, "bill-phone", false, NOW);
  assert.equal(kept.status, 409);
  assert.equal(kept.rows.some((row) => row.id === created[0].id), true);
  assert.equal(kept.bills.find((bill) => bill.id === "bill-phone").paid, true);
  const removed = deleteBill(paid.bills, "bill-phone");
  assert.equal(removed.status, 200);
  assert.equal(removed.bills.some((bill) => bill.id === "bill-phone"), false);
  assert.equal(paid.rows.some((row) => row.billId === "bill-phone"), true);
});

test("linkOrInsertImportedTxn matches, misses, and picks the closest date", () => {
  const matched = linkOrInsertImportedTxn(SEED_TRANSACTIONS, {
    sourceId: "plaid-stream-1",
    payee: "STREAMING CLUB POS",
    amountCents: -4675,
    date: "2026-11-11",
    accountMask: "3816",
  });
  assert.equal(matched.linked, true);
  assert.equal(matched.rows.length, SEED_TRANSACTIONS.length);
  assert.equal(matched.transaction.id, "fin-stream");
  assert.equal(matched.transaction.source, "bill");
  assert.equal(matched.transaction.sourceId, "plaid-stream-1");
  assert.equal(matched.transaction.ledger.accountMask, "3816");
  assert.equal(matched.transaction.amountCents, -4675);

  const missed = linkOrInsertImportedTxn(SEED_TRANSACTIONS, {
    sourceId: "plaid-power-1",
    payee: "CITY POWER POS",
    amountCents: -6410,
    date: "2026-11-09",
    accountMask: "3816",
  });
  assert.equal(missed.linked, false);
  assert.equal(missed.rows.length, SEED_TRANSACTIONS.length + 1);
  assert.equal(missed.transaction.source, "ledger");
  assert.equal(missed.rows.filter((row) => row.amountCents === -6410).length, 2);

  const candidates = [payment("fin-early", "2026-11-08"), payment("fin-later", "2026-11-11")];
  const closest = linkOrInsertImportedTxn(candidates, {
    sourceId: "plaid-closest",
    payee: "Streaming Club purchase",
    amountCents: -4675,
    date: "2026-11-10",
    accountMask: "3816",
  });
  assert.equal(closest.linked, true);
  assert.equal(closest.rows.length, 2);
  assert.equal(closest.transaction.id, "fin-later");
  assert.equal(closest.rows.find((row) => row.id === "fin-early").sourceId, undefined);

  const replay = importLedgerTransaction(matched.rows, {
    sourceId: "plaid-stream-1",
    payee: "STREAMING CLUB POS",
    amountCents: -4675,
    date: "2026-11-11",
    accountMask: "3816",
  });
  assert.equal(replay.rows.length, matched.rows.length);
  assert.equal(replay.transaction.id, "fin-stream");
});

test("the bill seed is gated in production and links the streaming payment once", async () => {
  const fake = await startFakeUpstash();
  try {
    const store = createUpstashStore({ url: fake.url, token: fake.token, env: { VERCEL_ENV: "preview" } });
    const view = await store.financeBills(NOW);
    assert.equal(view.bills.length, 7);
    assert.equal(view.bills.find((bill) => bill.id === "bill-stream").payments[0].id, "fin-stream");
    const imported = await store.financeImportTransaction({
      sourceId: "plaid-stream-1",
      payee: "STREAMING CLUB POS",
      amountCents: -4675,
      date: "2026-11-11",
      accountMask: "3816",
    });
    assert.equal(imported.body.linked, true);
    assert.equal(imported.body.id, "fin-stream");
    const rows = await store.financeRows();
    assert.equal(rows.filter((row) => row.payee === "Streaming Club (example)" && String(row.date).startsWith("2026-11")).length, 1);
    assert.equal(fake.commands.some((args) => args[0] === "SET" && String(args[1]).endsWith("finance:seeded:v3") && args.includes("EX")), false);
  } finally {
    await fake.stop();
  }

  const production = await startFakeUpstash();
  try {
    const store = createUpstashStore({ url: production.url, token: production.token, env: { VERCEL_ENV: "production" } });
    const view = await store.financeBills(NOW);
    assert.equal(view.empty, true);
    assert.equal(view.bills.length, 0);
    assert.equal(production.commands.some((args) => args[0] === "SET" && String(args[1]).includes("finance:bill:")), false);
    assert.equal(production.commands.some((args) => args[0] === "SET" && String(args[1]).includes("finance:seeded:v3")), false);
  } finally {
    await production.stop();
  }

  const memory = installMemoryFinance({});
  const paid = await memory.financePatchBill("bill-phone", { paid: true }, NOW);
  assert.equal(paid.status, 200);
  assert.equal(paid.body.paid, true);
  const again = await memory.financePatchBill("bill-phone", { paid: true }, NOW);
  assert.equal(again.body.payments.length, 1);
  const cleared = await memory.financePatchBill("bill-phone", { paid: false }, NOW);
  assert.equal(cleared.body.paid, false);
  assert.equal(cleared.body.payments.length, 0);
});

test("planned bills and blank amounts stay out of the upcoming list", () => {
  const planned = { id: "bill-planned", name: "Future rent", status: "planned", dueDate: null, amountCents: null, recurrence: "monthly", category: "health-fitness", accountId: "acct-checking", paid: false, sort: 8 };
  const undated = { id: "bill-undated", name: "No date", dueDate: null, amountCents: 1000, recurrence: "monthly", category: "fun", accountId: "acct-checking", paid: false, sort: 9 };
  const blank = { id: "bill-blank", name: "Open amount", dueDate: "2026-11-18", amountCents: null, recurrence: "monthly", category: "school", accountId: "acct-checking", paid: false, sort: 10 };
  assert.doesNotThrow(() => rollBill(planned, "2026-11-11"));
  assert.doesNotThrow(() => rollBill(undated, "2026-11-11"));
  const projected = projectBills([...SEED_BILLS, planned, undated], NOW);
  assert.equal(projected.changed, false);
  assert.equal(projected.bills.some((bill) => bill.id === "bill-planned"), true);
  const view = billsSnapshot([...SEED_BILLS, planned, undated, blank], SEED_TRANSACTIONS, SEED_ACCOUNTS, NOW);
  assert.equal(view.bills.some((bill) => bill.status === "planned" || bill.id === "bill-planned" || bill.id === "bill-undated"), false);
  const open = view.bills.find((bill) => bill.id === "bill-blank");
  assert.equal(open.amountCents, null);
  assert.equal(billMoney(null), "—");
  assert.equal(billMoney(undefined), "—");
  assert.equal(billMoney(open.amountCents), "—");
  assert.equal(billMoney(4820), "$48.20");
  const before = SEED_TRANSACTIONS.length;
  const toggled = setBillPaid([...SEED_BILLS, blank], SEED_TRANSACTIONS, SEED_ACCOUNTS, "bill-blank", true, NOW);
  assert.equal(toggled.rows.length, before);
  assert.equal(toggled.rows.some((row) => row.billId === "bill-blank"), false);
  assert.equal(toggled.bills.find((bill) => bill.id === "bill-blank").paid, false);
  const created = createBill(SEED_BILLS, SEED_ACCOUNTS, { name: "Gym (example)", amountCents: 2500, dueDate: "2026-11-21", recurrence: "monthly", category: "health-fitness", accountId: "acct-checking" }, NOW, 1);
  assert.equal(created.status, 201);
  assert.equal(created.body.category, "health-fitness");
  assert.equal(created.body.categoryName, "Health & Fitness");
  assert.equal(CATEGORY_NAMES["health-fitness"], "Health & Fitness");
  assert.equal(CATEGORY_NAMES.fun, "Fun");
  assert.equal(CATEGORY_NAMES.school, "School");
  assert.equal(CATEGORY_NAMES.other, "Other");
  assert.equal(CATEGORY_NAMES.utilities, "Utilities");
  assert.equal(CATEGORY_NAMES.transport, "Transport");
  for (const category of ["fun", "school", "other"]) {
    const saved = createBill(SEED_BILLS, SEED_ACCOUNTS, { name: `${category} bill`, amountCents: 100, dueDate: "2026-11-21", recurrence: "weekly", category, accountId: "acct-checking" }, NOW, 2);
    assert.equal(saved.status, 201, category);
    assert.equal(saved.body.categoryName, CATEGORY_NAMES[category]);
  }
});
