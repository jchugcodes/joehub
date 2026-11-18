import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { acquireBrowserLock, reservePort, spawnLogged, startChrome, stopProcess, waitForChrome, waitForHttp } from "./support/harness.mjs";
import { pressLabel } from "./support/pointer.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const chromeBin = ["google-chrome", "google-chrome-stable"].find((bin) => spawnSync("which", [bin]).status === 0);
const skip = chromeBin ? false : "google-chrome is not installed";
const EMPTY = "2026-01-15T12:00:00-05:00";

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
      JOEHUB_SESSION_SECRET: "spending-states-secret-value",
    },
  });
  child = started.child;
  await waitForHttp(`${base()}/finance/spending`, {
    child,
    log: started.log,
    accept: (response) => response.status === 200 && (response.headers.get("content-type") || "").includes("text/html"),
  });
  chrome = startChrome(chromeBin, cdp, `/tmp/chrome-spending-states-${process.pid}`);
  await waitForChrome(cdp, chrome);
  const logged = await fetch(`${base()}/api/session/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: "synthetic", password: "synthetic", device_label: "spending-states" }),
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
    body = await evalPage(send, "document.body ? document.body.innerText.slice(0, 400) : ''");
  } catch {
    body = last;
  }
  throw new Error(`timed out waiting for ${label}; last=${last}; body=${body}`);
}

test("spending empty, error, offline, context line, and uncategorized clock mark", { skip }, async () => {
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

    for (const width of [390, 1280]) {
      await send("Emulation.setDeviceMetricsOverride", { width, height: 844, deviceScaleFactor: 1, mobile: width < 500 });
      await send("Page.navigate", { url: `${base()}/finance/spending` });
      await waitFor(send, "document.querySelector('[data-ready]') && document.querySelector('[data-txn=\"fin-vendor\"] [data-category-mark=\"uncategorized\"]') ? 'yes' : ''", `clock ${width}`);
      const mark = await evalPage(send, "document.querySelector('[data-txn=\"fin-vendor\"] [data-category-mark]')?.getAttribute('data-category-mark')");
      assert.equal(mark, "uncategorized");
      if (width === 390) {
        const tab = await evalPage(send, `(() => {
          const row = document.querySelector("nav[aria-label='Finance sections'] .finance-tab-row");
          const link = [...(row?.querySelectorAll("a") || [])].find((el) => (el.textContent || "").trim() === "Spending");
          if (!row || !link || link.getAttribute("aria-current") !== "page") return "missing";
          const view = row.getBoundingClientRect();
          const box = link.getBoundingClientRect();
          return box.left >= view.left - 1 && box.right <= view.right + 1 && window.scrollY < 2 ? "yes" : "no";
        })()`);
        assert.equal(tab, "yes");
      }
      const overflow = await evalPage(send, "document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1 ? 'fit' : String(document.documentElement.scrollWidth)");
      assert.equal(overflow, "fit");
    }

    await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    await send("Page.navigate", { url: `${base()}/finance/spending?txn=fin-pizza` });
    await waitFor(send, "document.body.innerText.includes(\"Joe's Pizza\") && [...document.querySelectorAll('button')].some((el) => (el.innerText || '').trim() === 'Edit') ? 'yes' : ''", "pizza");
    assert.equal(await pressLabel(send, evalPage, "Edit"), "yes");
    await waitFor(send, "document.querySelector('[data-edit-context]') ? 'yes' : ''", "context");
    const context = await evalPage(send, "document.querySelector('[data-edit-context]')?.innerText || ''");
    assert.match(context, /Joe's Pizza/);
    assert.match(context, /−\$32\.40/);
    const contextBeforeTransfer = await evalPage(send, "(() => { const form = document.querySelector('#spending-form'); const line = form?.querySelector('[data-edit-context]'); const transfer = form?.querySelector('button'); return line && transfer && (line.compareDocumentPosition(transfer) & Node.DOCUMENT_POSITION_FOLLOWING) ? 'above' : 'no'; })()");
    assert.equal(contextBeforeTransfer, "above");

    await send("Network.emulateNetworkConditions", { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 });
    await evalPage(send, "window.dispatchEvent(new Event('offline')); 'yes'");
    await waitFor(send, "document.body.innerText.includes('You are offline.') && document.querySelector('[data-month-spent]') ? 'yes' : ''", "offline keeps the month");
    assert.equal(await pressLabel(send, evalPage, "Category Groceries"), "yes");
    assert.equal(await evalPage(send, "[...document.querySelectorAll('button')].find((el) => (el.innerText || '').trim() === 'Save')?.disabled ? 'yes' : 'no'"), "yes");
    await send("Network.emulateNetworkConditions", { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
    await evalPage(send, "window.dispatchEvent(new Event('online')); 'yes'");

    await send("Page.navigate", { url: `${base()}/finance/spending?asOf=${encodeURIComponent(EMPTY)}` });
    await waitFor(send, "document.body.innerText.includes('No spending this month.') && document.querySelector('[data-spending=\"empty\"]') ? 'yes' : ''", "empty");
    assert.equal(await evalPage(send, "document.querySelector('[role=group][aria-label=Category]') || document.querySelector('h2')?.innerText === 'Transactions' ? 'shown' : 'hidden'"), "hidden");

    await send("Page.navigate", { url: `${base()}/finance/spending?xd=error` });
    await waitFor(send, "document.querySelector('[data-state=\"error\"]') && document.body.innerText.includes('Retry') ? 'yes' : ''", "error");

    await send("Page.navigate", { url: `${base()}/finance/spending?xd=skel` });
    await waitFor(send, "document.querySelector('[data-skeleton=\"spending\"]') ? 'yes' : ''", "skeleton");
    ws.close();
  } finally {
    await stopProcess(chrome);
    await stopProcess(child);
    await release();
  }
});
