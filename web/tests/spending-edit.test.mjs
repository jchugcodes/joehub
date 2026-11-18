import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { acquireBrowserLock, reservePort, spawnLogged, startChrome, stopProcess, waitForChrome, waitForHttp } from "./support/harness.mjs";
import { pressLabel } from "./support/pointer.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const chromeBin = ["google-chrome", "google-chrome-stable"].find((bin) => spawnSync("which", [bin]).status === 0);
const skip = chromeBin ? false : "google-chrome is not installed";
const AS_OF = "2026-11-18T12:00:00-05:00";

let port = 0;
let cdp = 0;
let child = null;
let chrome = null;
let release = async () => {};
const base = () => `http://127.0.0.1:${port}`;

function cookieValue(response) {
  const rows = typeof response.headers.getSetCookie === "function" ? response.headers.getSetCookie() : [];
  const raw = rows.find((row) => row.startsWith("joehub_session=")) || response.headers.get("set-cookie") || "";
  return raw.split(";", 1)[0].slice("joehub_session=".length);
}

async function boot() {
  release = await acquireBrowserLock();
  port = await reservePort();
  cdp = await reservePort();
  const started = spawnLogged(["node_modules/next/dist/bin/next", "dev", "-H", "127.0.0.1", "-p", String(port)], {
    cwd: ROOT,
    env: {
      PATH: process.env.PATH,
      HOME: process.env.HOME || "/tmp",
      TMPDIR: process.env.TMPDIR || "/tmp",
      LANG: "C.UTF-8",
      NODE_ENV: "development",
      JOEHUB_DEV_AUTH: "1",
      JOEHUB_SESSION_SECRET: "spending-edit-secret-value",
    },
  });
  child = started.child;
  await waitForHttp(`${base()}/finance/spending`, {
    child,
    log: started.log,
    accept: (response) => response.status === 200 && (response.headers.get("content-type") || "").includes("text/html"),
  });
  chrome = startChrome(chromeBin, cdp, `/tmp/chrome-spending-edit-${process.pid}`);
  await waitForChrome(cdp, chrome);
  const logged = await fetch(`${base()}/api/session/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: "synthetic", password: "synthetic", device_label: "spending-edit" }),
  });
  assert.equal(logged.status, 200);
  return cookieValue(logged);
}

async function evalPage(send, expression) {
  const result = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (result.result?.exceptionDetails) throw new Error(JSON.stringify(result.result.exceptionDetails));
  return result.result?.result?.value;
}

async function waitFor(send, expression, label, budget = 45000) {
  const deadline = Date.now() + budget;
  let last = "";
  while (Date.now() < deadline) {
    try {
      const value = await evalPage(send, expression);
      last = value == null ? "" : String(value);
      if (value) return value;
    } catch (error) {
      last = error instanceof Error ? error.message.slice(0, 120) : "error";
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  let body = "";
  try {
    body = await evalPage(send, "document.body ? document.body.innerText.slice(0, 500) : ''");
  } catch {
    body = last;
  }
  throw new Error(`timed out waiting for ${label}; last=${last}; body=${body}`);
}

function saveDisabled() {
  return `[...document.querySelectorAll('button')].find((el) => (el.innerText || '').trim() === 'Save')?.disabled ? 'yes' : ''`;
}

test("spending edit keeps Save disabled until a change, and Cancel or Escape discards", { skip }, async () => {
  const cookie = await boot();
  try {
    const created = await fetch(`http://127.0.0.1:${cdp}/json/new?about:blank`, { method: "PUT" }).then((response) => response.json());
    const ws = new WebSocket(created.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      ws.addEventListener("open", resolve);
      ws.addEventListener("error", reject);
    });
    let seq = 0;
    const pending = new Map();
    ws.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (message.id && pending.has(message.id)) pending.get(message.id)(message);
    });
    const send = (method, params = {}) =>
      new Promise((resolve) => {
        const id = ++seq;
        pending.set(id, resolve);
        ws.send(JSON.stringify({ id, method, params }));
      });
    await send("Page.enable");
    await send("Network.enable");
    await send("Runtime.enable");
    const cooked = await send("Network.setCookie", { name: "joehub_session", value: cookie, url: `${base()}/`, httpOnly: true });
    assert.equal(cooked.result?.success, true);
    const clock = encodeURIComponent(AS_OF);

    await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    await send("Page.navigate", { url: `${base()}/finance/spending?asOf=${clock}&txn=fin-shell` });
    await waitFor(send, "document.querySelector('[data-txn-detail]') && document.body.innerText.includes('Shell (example)') && document.body.innerText.includes('Gas & Transport') ? 'yes' : ''", "panel");
    assert.equal(await pressLabel(send, evalPage, "Edit"), "yes");
    await waitFor(send, "document.querySelector('[data-edit=\"open\"]') && document.body.innerText.includes('Edit transaction') ? 'yes' : ''", "edit");
    assert.equal(await evalPage(send, saveDisabled()), "yes");
    assert.equal(await pressLabel(send, evalPage, "Category Groceries"), "yes");
    await waitFor(send, `${saveDisabled()} ? '' : 'enabled'`, "save enabled");
    assert.equal(await pressLabel(send, evalPage, "Cancel"), "yes");
    await waitFor(send, "document.querySelector('[data-edit]') ? '' : (document.body.innerText.includes('Gas & Transport') ? 'discarded' : '')", "cancel");
    const afterCancel = await evalPage(send, `fetch('/api/finance/transactions/fin-shell?asOf=${clock}').then((response) => response.json()).then((body) => body.category)`);
    assert.equal(afterCancel, "transport");

    assert.equal(await pressLabel(send, evalPage, "Edit"), "yes");
    await waitFor(send, "document.querySelector('[data-edit=\"open\"]') ? 'yes' : ''", "edit again");
    assert.equal(await pressLabel(send, evalPage, "Category Groceries"), "yes");
    await evalPage(send, "document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); 'yes'");
    await waitFor(send, "document.querySelector('[data-edit]') ? '' : (document.body.innerText.includes('Gas & Transport') ? 'discarded' : '')", "escape");
    const afterEscape = await evalPage(send, `fetch('/api/finance/transactions/fin-shell?asOf=${clock}').then((response) => response.json()).then((body) => body.category)`);
    assert.equal(afterEscape, "transport");

    const before = await evalPage(
      send,
      `fetch('/api/finance/categories?period=month&asOf=${clock}').then((response) => response.json()).then((body) => ({ spent: body.spentCents, groceries: body.categories.find((item) => item.slug === 'groceries').spentCents, transport: body.categories.find((item) => item.slug === 'transport').spentCents }))`,
    );
    assert.equal(await pressLabel(send, evalPage, "Edit"), "yes");
    await waitFor(send, "document.querySelector('[data-edit=\"open\"]') ? 'yes' : ''", "edit to save");
    assert.equal(await pressLabel(send, evalPage, "Category Groceries"), "yes");
    await waitFor(send, `${saveDisabled()} ? '' : 'enabled'`, "save ready");
    assert.equal(await pressLabel(send, evalPage, "Save"), "yes");
    await waitFor(send, "document.querySelector('[data-txn=\"fin-shell\"]')?.innerText.includes('Groceries') && document.querySelector('[data-txn=\"fin-shell\"]')?.innerText.includes('Corrected') && document.querySelector('[data-txn-detail]')?.innerText.includes('Groceries') ? 'yes' : ''", "recategorized");
    const moved = await evalPage(
      send,
      `fetch('/api/finance/categories?period=month&asOf=${clock}').then((response) => response.json()).then((body) => ({ spent: body.spentCents, groceries: body.categories.find((item) => item.slug === 'groceries').spentCents, transport: body.categories.find((item) => item.slug === 'transport').spentCents }))`,
    );
    assert.equal(moved.spent, before.spent);
    assert.equal(moved.groceries, before.groceries + 2218);
    assert.equal(moved.transport, before.transport - 2218);
    assert.equal(await evalPage(send, "document.querySelector('[data-list-spent]')?.getAttribute('data-list-spent') === document.querySelector('[data-month-spent]')?.getAttribute('data-month-spent') ? 'yes' : ''"), "yes");

    const spentBefore = Number(await evalPage(send, "document.querySelector('[data-month-spent]')?.getAttribute('data-month-spent')"));
    await send("Page.navigate", { url: `${base()}/finance/spending?asOf=${clock}&txn=fin-pizza` });
    await waitFor(send, "document.querySelector('[data-txn-detail]') && document.body.innerText.includes(\"Joe's Pizza\") ? 'yes' : ''", "pizza");
    assert.equal(await pressLabel(send, evalPage, "Edit"), "yes");
    await waitFor(send, "document.querySelector('[data-edit=\"open\"]') ? 'yes' : ''", "pizza edit");
    assert.equal(await evalPage(send, saveDisabled()), "yes");
    assert.equal(await pressLabel(send, evalPage, "Transfer"), "yes");
    await waitFor(send, `${saveDisabled()} ? '' : 'enabled'`, "transfer enables save");
    assert.equal(await pressLabel(send, evalPage, "Save"), "yes");
    await waitFor(send, `!document.querySelector('[data-txn="fin-pizza"]') && Number(document.querySelector('[data-month-spent]')?.getAttribute('data-month-spent')) === ${spentBefore - 3240} ? 'gone' : ''`, "pizza left");
    const spentAfter = Number(await evalPage(send, "document.querySelector('[data-month-spent]')?.getAttribute('data-month-spent')"));
    assert.equal(spentAfter, spentBefore - 3240);
    assert.equal(await evalPage(send, "document.querySelector('[data-list-spent]')?.getAttribute('data-list-spent')"), String(spentAfter));
    const vendor = await evalPage(send, "document.querySelector('[data-txn=\"fin-vendor\"]')?.innerText || ''");
    assert.match(vendor, /Uncategorized/);
    assert.doesNotMatch(vendor, /Uncategorized[\s\S]*Uncategorized/);
    ws.close();
  } finally {
    await stopProcess(chrome);
    await stopProcess(child);
    await release();
  }
});
