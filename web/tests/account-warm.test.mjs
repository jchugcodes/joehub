import assert from "node:assert/strict";
import test from "node:test";
import { clearAccountWarm, prefetchAccount } from "../lib/account-warm.mjs";

test("prefetch starts the account list and that account's transactions together", async () => {
  const seen = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url) => {
    seen.push(String(url));
    return { ok: true, json: async () => ({ rows: [], accounts: [] }) };
  };
  try {
    prefetchAccount("acct-checking", "2026-11-11T15:00:00-05:00");
    prefetchAccount("acct-checking", "2026-11-11T15:00:00-05:00");
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.deepEqual(seen, [
      "/api/finance/accounts?asOf=2026-11-11T15%3A00%3A00-05%3A00",
      "/api/finance/transactions?accountId=acct-checking&asOf=2026-11-11T15%3A00%3A00-05%3A00",
    ]);
    clearAccountWarm();
    prefetchAccount("acct-checking", "2026-11-11T15:00:00-05:00");
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(seen.length, 4);
  } finally {
    clearAccountWarm();
    globalThis.fetch = original;
  }
});
