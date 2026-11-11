import assert from "node:assert/strict";
import test from "node:test";
import { createStore, login } from "../lib/sessions.mjs";
import { createLimiter } from "../lib/ratelimit.mjs";
import {
  handleFinanceAccount,
  handleFinanceAccounts,
  handleFinanceCreateAccount,
  handleFinanceCreateTransaction,
  handleFinanceDeleteAccount,
  handleFinanceOverview,
  handleFinancePatchAccount,
  handleFinancePatchTransaction,
  handleFinanceTransactions,
} from "../lib/api.mjs";
import {
  ACCOUNTS,
  accountsSnapshot,
  installMemoryFinance,
  NET_WORTH_CENTS,
  parseAccount,
  rollUpAccounts,
  SEED_ACCOUNTS,
} from "../lib/finance.mjs";
import { createUpstashStore } from "../lib/store-upstash.mjs";
import { startFakeUpstash } from "./support/fakes.mjs";

const NOW = Date.parse("2026-11-10T17:00:00Z");
const env = { JOEHUB_DEV_AUTH: "1", JOEHUB_SESSION_SECRET: "accounts-unit-secret-value", NODE_ENV: "development" };

function sessionHeaders(store, extra = {}) {
  const session = login({ username: "synthetic", password: "synthetic", device_label: "accounts" }, env, store, NOW);
  const headers = new Headers(extra);
  headers.set("cookie", `joehub_session=${session.cookie}`);
  return headers;
}

function requestJson(body, url = "http://127.0.0.1/api/finance/accounts") {
  return { url, json: async () => body };
}

test("account roll-up treats credit cards and loans as liabilities", () => {
  assert.equal(parseAccount({ name: "  ", type: "cash", balanceCents: 1 }).detail, "Enter a name.");
  assert.equal(parseAccount({ name: "Wallet", type: "crypto", balanceCents: 1 }).field, "type");
  assert.equal(parseAccount({ name: "Wallet", type: "cash", balanceCents: 1.5 }).field, "balance");
  assert.equal(parseAccount({ name: "Wallet", type: "cash", balanceCents: 0 }).ok, true);
  const rolled = rollUpAccounts(SEED_ACCOUNTS);
  assert.equal(rolled.assetsCents, 2_647_236);
  assert.equal(rolled.liabilitiesCents, 800_000);
  assert.equal(rolled.netWorthCents, NET_WORTH_CENTS);
  assert.equal(accountsSnapshot([]).empty, true);
  assert.equal(accountsSnapshot([]).netWorthCents, null);
  assert.equal(accountsSnapshot([]).accounts.length, 0);
  const view = accountsSnapshot(SEED_ACCOUNTS, ACCOUNTS, Date.parse("2026-11-11T11:42:00.000Z"));
  assert.equal(view.netWorthCents, NET_WORTH_CENTS);
  assert.equal(view.accounts.find((account) => account.id === "acct-card").group, "Credit cards");
  assert.equal(view.accounts.find((account) => account.id === "acct-checking").group, "Checking");
  assert.equal(view.accounts.find((account) => account.id === "acct-checking").stale, true);
  assert.equal(view.accounts.find((account) => account.id === "acct-savings").stale, false);
  assert.equal(view.accounts.find((account) => account.id === "acct-old").group, "Hidden");
  assert.equal(view.accounts.some((account) => account.id === "acct-old" && account.hiddenFromNetWorth), true);
});

test("account API requires a session and validates create, update, and delete", async () => {
  const store = installMemoryFinance(createStore());
  const limiter = createLimiter(60);
  const denied = await handleFinanceAccounts(new Headers(), env, store, limiter, NOW, "direct");
  assert.equal(denied.status, 401);
  const headers = sessionHeaders(store);
  const listed = await handleFinanceAccounts(headers, env, store, limiter, NOW, "direct");
  assert.equal(listed.status, 200);
  assert.equal(listed.body.netWorthCents, NET_WORTH_CENTS);
  assert.equal(listed.body.accounts.length, 7);
  assert.equal(listed.body.accounts.find((account) => account.id === "acct-checking").source, "ledger");
  assert.equal(listed.body.accounts.find((account) => account.id === "acct-checking").stale, true);

  const missing = await handleFinanceCreateAccount(headers, env, store, limiter, NOW, "direct", requestJson(null));
  assert.equal(missing.status, 400);
  const badKey = await handleFinanceCreateAccount(
    sessionHeaders(store, { "idempotency-key": "bad key" }),
    env,
    store,
    limiter,
    NOW,
    "direct",
    requestJson({ name: "Example wallet", type: "cash", balanceCents: 2500 }),
  );
  assert.equal(badKey.status, 400);

  const auth = sessionHeaders(store, { "idempotency-key": "acct-1" });
  const created = await handleFinanceCreateAccount(
    auth,
    env,
    store,
    limiter,
    NOW,
    "direct",
    requestJson({ name: " Example wallet ", type: "cash", balanceCents: 2500 }),
  );
  assert.equal(created.status, 201);
  assert.equal(created.body.name, "Example wallet");
  assert.equal(created.body.type, "cash");
  assert.equal(created.body.balanceCents, 2500);
  assert.equal(typeof created.body.createdAt, "string");
  assert.equal(typeof created.body.updatedAt, "string");
  const replay = await handleFinanceCreateAccount(
    sessionHeaders(store, { "idempotency-key": "acct-1" }),
    env,
    store,
    limiter,
    NOW + 5,
    "direct",
    requestJson({ name: "Other wallet", type: "cash", balanceCents: 9 }),
  );
  assert.equal(replay.body.id, created.body.id);
  assert.equal(replay.body.name, "Example wallet");

  const renamed = await handleFinancePatchAccount(
    created.body.id,
    headers,
    env,
    store,
    limiter,
    NOW + 10,
    "direct",
    requestJson({ name: "Example cash tin", balanceCents: 2600 }),
  );
  assert.equal(renamed.status, 200);
  assert.equal(renamed.body.name, "Example cash tin");
  assert.equal(renamed.body.type, "cash");
  assert.equal((await handleFinanceAccount(created.body.id, headers, env, store, limiter, NOW, "direct")).body.balanceCents, 2600);
  assert.equal((await handleFinanceAccount("acct-missing", headers, env, store, limiter, NOW, "direct")).status, 404);

  const worth = await handleFinanceOverview(headers, env, store, limiter, NOW, "direct", "http://127.0.0.1/api/finance/overview?asOf=2026-11-10T17:00:00Z");
  assert.equal(worth.body.netWorthCents, NET_WORTH_CENTS + 2600);

  const removed = await handleFinanceDeleteAccount(created.body.id, headers, env, store, limiter, NOW, "direct");
  assert.equal(removed.status, 200);
  assert.equal(removed.body.deleted, true);
  const ledgerEdit = await handleFinancePatchAccount("acct-checking", headers, env, store, limiter, NOW, "direct", requestJson({ name: "Renamed checking" }));
  assert.equal(ledgerEdit.status, 403);
  const hidden = await handleFinancePatchAccount("acct-checking", headers, env, store, limiter, NOW, "direct", requestJson({ hiddenFromNetWorth: true }));
  assert.equal(hidden.status, 200);
  assert.equal(hidden.body.hiddenFromNetWorth, true);
  assert.equal(hidden.body.name, "Everyday checking");
  const shown = await handleFinancePatchAccount("acct-checking", headers, env, store, limiter, NOW, "direct", requestJson({ hiddenFromNetWorth: false }));
  assert.equal(shown.status, 200);
  const blocked = await handleFinanceDeleteAccount("acct-checking", headers, env, store, limiter, NOW, "direct");
  assert.equal(blocked.status, 403);
  const masked = await handleFinanceCreateAccount(
    sessionHeaders(store, { "idempotency-key": "acct-mask" }),
    env,
    store,
    limiter,
    NOW,
    "direct",
    requestJson({ name: "Masked wallet", type: "cash", balanceCents: 100, mask: "12" }),
  );
  assert.equal(masked.status, 400);
  assert.equal(masked.body.field, "mask");
  const after = await handleFinanceOverview(headers, env, store, limiter, NOW, "direct", "http://127.0.0.1/api/finance/overview?asOf=2026-11-10T17:00:00Z");
  assert.equal(after.body.netWorthCents, NET_WORTH_CENTS);
});

test("transactions keep working without an account and reject an unknown one", async () => {
  const store = installMemoryFinance(createStore());
  const limiter = createLimiter(60);
  const headers = sessionHeaders(store, { "idempotency-key": "txn-open" });
  const url = "http://127.0.0.1/api/finance/transactions?asOf=2026-11-10T17:00:00Z&week=2026-11-09";
  const open = await handleFinanceCreateTransaction(
    headers,
    env,
    store,
    limiter,
    NOW,
    "direct",
    requestJson({ payee: "Example kiosk", amountCents: 500, date: "2026-11-10", type: "expense", category: "shopping" }, url),
  );
  assert.equal(open.status, 201);
  assert.equal(open.body.accountId, null);
  const listed = await handleFinanceTransactions(headers, env, store, limiter, NOW, "direct", url);
  assert.equal(listed.body.rows.some((row) => row.payee === "Example kiosk" && row.accountId == null), true);
  assert.equal(listed.body.rows.some((row) => row.payee === "Joe's Pizza" && row.accountId === "acct-checking"), true);

  const filtered = await handleFinanceTransactions(headers, env, store, limiter, NOW, "direct", `${url}&accountId=acct-card`);
  assert.equal(filtered.status, 200);
  assert.equal(filtered.body.rows.every((row) => row.accountId === "acct-card"), true);
  assert.equal(filtered.body.rows.some((row) => row.payee === "Example kiosk"), false);
  assert.equal(filtered.body.rows.some((row) => row.payee === "Shell (example)"), true);

  const missing = await handleFinanceCreateTransaction(
    sessionHeaders(store, { "idempotency-key": "txn-missing" }),
    env,
    store,
    limiter,
    NOW,
    "direct",
    requestJson({ payee: "Nowhere", amountCents: 100, date: "2026-11-10", type: "expense", category: "shopping", accountId: "acct-missing" }, url),
  );
  assert.equal(missing.status, 400);
  assert.equal(missing.body.field, "accountId");
  const unknownFilter = await handleFinanceTransactions(headers, env, store, limiter, NOW, "direct", `${url}&accountId=acct-missing`);
  assert.equal(unknownFilter.status, 400);

  const linked = await handleFinancePatchTransaction(
    open.body.id,
    headers,
    env,
    store,
    limiter,
    NOW + 5,
    "direct",
    requestJson({ accountId: "acct-checking" }, url),
  );
  assert.equal(linked.status, 200);
  assert.equal(linked.body.accountId, "acct-checking");
  assert.equal(linked.body.payee, "Example kiosk");
  const cleared = await handleFinancePatchTransaction(
    open.body.id,
    headers,
    env,
    store,
    limiter,
    NOW + 6,
    "direct",
    requestJson({ accountId: "" }, url),
  );
  assert.equal(cleared.body.accountId, null);
});

test("the account seed is add-only under a new flag and does not rewrite the old seed key", async () => {
  const fake = await startFakeUpstash();
  try {
    const prefix = "joehub-preview:";
    const send = (args) =>
      fetch(fake.url, {
        method: "POST",
        headers: { authorization: `Bearer ${fake.token}`, "content-type": "application/json" },
        body: JSON.stringify(args),
      });
    const pizza = {
      id: "fin-pizza",
      payee: "Joe's Pizza",
      amountCents: -3240,
      date: "2026-11-10",
      category: "dining-out",
      type: "expense",
      source: "manual",
      createdAt: 1,
    };
    await send(["SET", `${prefix}finance:seeded`, "1"]);
    await send(["SET", `${prefix}finance:txn:fin-pizza`, JSON.stringify(pizza)]);
    await send(["ZADD", `${prefix}finance:txns`, "1", "fin-pizza"]);
    await send(["SET", `${prefix}finance:caps`, JSON.stringify({ "dining-out": 8000, groceries: 12000, transport: 6000, subscriptions: 5500, shopping: 7500, utilities: 0 })]);
    await send(["SET", `${prefix}finance:plan`, JSON.stringify({ cents: 420400 })]);
    await send(["SET", `${prefix}finance:accounts`, JSON.stringify(ACCOUNTS)]);
    await send(["SET", `${prefix}finance:goals`, "[]"]);
    await send(["SET", `${prefix}finance:snapshots`, JSON.stringify({ netWorthCents: NET_WORTH_CENTS, caption: "seed", points: [NET_WORTH_CENTS] })]);
    fake.commands.length = 0;

    const store = createUpstashStore({ url: fake.url, token: fake.token, prefix });
    const linked = await store.financeTransaction("fin-pizza");
    assert.equal(linked.body.accountId, "acct-checking");
    const view = await store.financeAccounts(NOW);
    assert.equal(view.netWorthCents, NET_WORTH_CENTS);
    assert.equal(view.accounts.some((account) => account.id === "acct-checking"), true);
    const moved = await store.financePatchTransaction("fin-pizza", { accountId: "acct-card" }, NOW);
    assert.equal(moved.body.accountId, "acct-card");
    const overview = await store.financeOverview(NOW);
    assert.equal(overview.body.netWorthCents, NET_WORTH_CENTS);
    const again = await store.financeTransaction("fin-pizza");
    assert.equal(again.body.accountId, "acct-card");

    const oldFlag = fake.commands.filter((args) => args[0] === "SET" && args[1] === `${prefix}finance:seeded`);
    assert.equal(oldFlag.length, 0);
    const versionFlag = fake.commands.filter((args) => args[0] === "SET" && args[1] === `${prefix}finance:seeded:v2`);
    assert.equal(versionFlag.length, 1);
    assert.equal(versionFlag[0][2], "1");
    assert.equal(versionFlag[0].includes("NX"), true);
    assert.equal(versionFlag[0].includes("EX"), false);
    const accountWrites = fake.commands.filter((args) => args[0] === "SET" && args[1] === `${prefix}finance:account:acct-checking`);
    assert.equal(accountWrites.length, 1);
    assert.equal(accountWrites[0].includes("NX"), true);
    const keys = fake.commands.map((args) => args[1]).filter((key) => typeof key === "string");
    assert.ok(keys.includes(`${prefix}finance:accounts:index`));
    assert.equal(keys.some((key) => key.startsWith("joehub:finance:")), false);
  } finally {
    await fake.stop();
  }
});

test("production does not write the account seed", async () => {
  const fake = await startFakeUpstash();
  try {
    const store = createUpstashStore({ url: fake.url, token: fake.token, env: { VERCEL_ENV: "production" } });
    const view = await store.financeAccounts(NOW);
    assert.equal(view.empty, true);
    assert.equal(view.netWorthCents, null);
    assert.equal(fake.commands.some((args) => args[0] === "SET" && String(args[1]).includes("finance:seeded")), false);
    assert.equal(fake.commands.some((args) => args[0] === "SET" && String(args[1]).includes("finance:account:")), false);
  } finally {
    await fake.stop();
  }
});
