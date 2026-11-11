import assert from "node:assert/strict";
import test from "node:test";
import { decide } from "../lib/gate.mjs";
import { financeTabs, isGatedPath, primaryTabs, productionNav } from "../lib/live-pages.mjs";

const open = { NODE_ENV: "development", JOEHUB_DEV_AUTH: "1", JOEHUB_SESSION_SECRET: "live-pages-test-secret" };

test("preview and dev keep the full nav", () => {
  assert.equal(productionNav({}), false);
  assert.equal(productionNav({ VERCEL_ENV: "preview" }), false);
  assert.equal(productionNav({ VERCEL_ENV: "development" }), false);
  assert.equal(productionNav({ NODE_ENV: "production" }), false);
  assert.deepEqual(
    primaryTabs({ VERCEL_ENV: "preview" }).map((tab) => tab.label),
    ["Home", "Finance", "Jobs", "Journal", "More"],
  );
  assert.deepEqual(
    financeTabs({}).map((tab) => tab.label),
    ["Overview", "Categories", "Goals", "Accounts", "Bills"],
  );
});

test("production keeps Tasks, Grocery, Finance and the live finance subtabs", () => {
  for (const env of [{ VERCEL_ENV: "production" }, { NEXT_PUBLIC_VERCEL_ENV: "production" }]) {
    assert.equal(productionNav(env), true);
    assert.deepEqual(
      primaryTabs(env).map((tab) => ({ href: tab.href, label: tab.label })),
      [
        { href: "/tasks", label: "Tasks" },
        { href: "/grocery", label: "Grocery" },
        { href: "/finance", label: "Finance" },
      ],
    );
    assert.deepEqual(
      financeTabs(env).map((tab) => tab.label),
      ["Overview", "Categories", "Accounts", "Bills"],
    );
  }
});

test("production middleware redirects gated pages and leaves auth and api alone", async () => {
  const env = { ...open, NEXT_PUBLIC_VERCEL_ENV: "production" };
  for (const path of ["/", "/jobs", "/jobs/one", "/journal", "/journal/compose", "/more", "/more/database", "/finance/goals", "/finance/goals/emergency-fund", "/finance/debts", "/not-a-page"]) {
    const decision = await decide(new Request(`http://127.0.0.1${path}`), env, Date.now());
    assert.equal(decision.type, "redirect", path);
    assert.equal(decision.location, "/tasks", path);
    assert.equal(isGatedPath(path), true);
  }
  for (const path of ["/tasks", "/grocery", "/finance", "/finance/categories", "/finance/accounts", "/finance/bills", "/finance/transactions", "/finance/caps"]) {
    const decision = await decide(new Request(`http://127.0.0.1${path}`), env, Date.now());
    assert.equal(decision.type, "next", path);
  }
  const health = await decide(new Request("http://127.0.0.1/api/health"), env, Date.now());
  assert.equal(health.type, "next");
  const login = await decide(new Request("http://127.0.0.1/api/auth/login"), env, Date.now());
  assert.equal(login.type, "next");
  const session = await decide(new Request("http://127.0.0.1/api/session/login"), env, Date.now());
  assert.equal(session.type, "next");
  const api = await decide(new Request("http://127.0.0.1/api/tasks"), env, Date.now());
  assert.equal(api.type, "json");
  assert.equal(api.status, 401);
  assert.equal(api.location, undefined);

  const preview = await decide(new Request("http://127.0.0.1/jobs"), open, Date.now());
  assert.equal(preview.type, "next");
  const vercelPreview = await decide(new Request("http://127.0.0.1/journal"), { ...open, VERCEL_ENV: "preview" }, Date.now());
  assert.notEqual(vercelPreview.location, "/");
});
