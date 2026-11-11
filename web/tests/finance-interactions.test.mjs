import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { acquireBrowserLock, reservePort, spawnLogged, startChrome, stopProcess, waitForChrome, waitForHttp } from "./support/harness.mjs";
import { pointerClick, pressLabel } from "./support/pointer.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const chromeBin = ["google-chrome", "google-chrome-stable"].find((bin) => spawnSync("which", [bin]).status === 0);
const skip = chromeBin ? false : "google-chrome is not installed";
const AS_OF = "2026-11-10T15:00:00-05:00";

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
      JOEHUB_SESSION_SECRET: "finance-browser-secret-value",
    },
  });
  child = started.child;
  await waitForHttp(`${base()}/finance`, {
    child,
    log: started.log,
    accept: (response) => response.status === 200 && (response.headers.get("content-type") || "").includes("text/html"),
  });
  chrome = startChrome(chromeBin, cdp, `/tmp/chrome-finance-${process.pid}`);
  await waitForChrome(cdp, chrome);
  const logged = await fetch(`${base()}/api/session/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: "synthetic", password: "synthetic", device_label: "finance-browser" }),
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

async function replaceCap(send, id, value) {
  await pointerClick(send, evalPage, `document.getElementById(${JSON.stringify(id)})`);
  const written = await evalPage(
    send,
    `(() => {
      const el = document.getElementById(${JSON.stringify(id)});
      const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
      set.call(el, ${JSON.stringify(value)});
      el.dispatchEvent(new Event("input", { bubbles: true }));
      return el.value;
    })()`,
  );
  assert.equal(written, value);
}

test("finance week, chart, goals, caps, and offline reconnect at 390 and 1280", { skip }, async () => {
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
      await send("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: width < 500 });
      await send("Page.navigate", { url: `${base()}/finance?asOf=${encodeURIComponent(AS_OF)}` });
      await waitFor(send, "document.body && document.body.innerText.includes('Dining Out') && document.body.innerText.includes('This week') ? 'yes' : ''", `overview ${width}`);
      await pressLabel(send, evalPage, "Previous week");
      await waitFor(send, "document.body.innerText.includes('Nov 2–8') ? 'yes' : ''", `previous ${width}`);
      await pressLabel(send, evalPage, "Next week");
      await waitFor(send, "document.body.innerText.includes('This week') ? 'yes' : ''", `current ${width}`);
      await pointerClick(send, evalPage, "document.querySelector(\"a[href*='/finance/categories/dining-out']\")");
      await waitFor(send, "document.querySelector(\"[aria-label='Back to overview']\") && document.body.innerText.includes('over') && document.body.innerText.includes('This week’s transactions') ? 'yes' : ''", `dining ${width}`);
      if (width === 390) assert.equal(await evalPage(send, "document.body.innerText.includes('$12 over') ? 'yes' : 'no'"), "yes");
      const back = await evalPage(send, "document.querySelector(\"[aria-label='Back to overview']\")?.getAttribute('href') || ''");
      assert.match(String(back), /week=2026-11-09/);
      await pressLabel(send, evalPage, "Back to overview");
      await waitFor(send, "document.body.innerText.includes('Weekly caps') ? 'yes' : ''", `back ${width}`);
      await pressLabel(send, evalPage, "1W");
      await waitFor(send, "document.querySelector(\"[data-chart='1W']\") ? 'yes' : ''", `pill ${width}`);
      const weekPoints = String(await evalPage(send, "document.querySelector('[data-chart]')?.getAttribute('data-points') || ''"));
      assert.equal(weekPoints, "38543");
      await pressLabel(send, evalPage, "Choose chart period");
      await pointerClick(send, evalPage, "[...document.querySelectorAll('button')].filter((el) => (el.innerText || '').trim() === 'All').at(-1)");
      await waitFor(send, "document.querySelector(\"[data-chart='All']\") ? 'yes' : ''", `menu ${width}`);
      const allPoints = String(await evalPage(send, "document.querySelector('[data-chart]')?.getAttribute('data-points') || ''")).split(",");
      assert.equal(allPoints[0], "1500");
      assert.equal(allPoints.includes("0"), false);
      await pressLabel(send, evalPage, "Goals");
      await waitFor(send, "document.body.innerText.includes('Emergency fund') && document.body.innerText.includes('$4,100') ? 'yes' : ''", `goals ${width}`);
      await pressLabel(send, evalPage, "Open Emergency fund");
      await waitFor(send, "document.body.innerText.includes('$4,100 of $10,000') && document.body.innerText.includes('On track') ? 'yes' : ''", `goal ${width}`);
      await send("Page.navigate", { url: `${base()}/finance?asOf=${encodeURIComponent(AS_OF)}` });
      await waitFor(send, "document.body.innerText.includes('Edit caps') ? 'yes' : ''", `caps entry ${width}`);
      await pressLabel(send, evalPage, "Edit caps");
      await waitFor(send, "document.getElementById('cap-dining-out')?.value ? 'yes' : ''", `caps form ${width}`);
      const capsBack = String(await evalPage(send, "document.querySelector(\"[aria-label='Back to overview']\")?.getAttribute('href') || ''"));
      assert.match(capsBack, /week=/);
      const diningNow = Number(await evalPage(send, "document.getElementById('cap-dining-out').value"));
      const groceriesNow = Number(await evalPage(send, "document.getElementById('cap-groceries').value"));
      const movedDining = String(diningNow - 10);
      const movedGroceries = String(groceriesNow + 10);
      await replaceCap(send, "cap-dining-out", movedDining);
      await replaceCap(send, "cap-groceries", movedGroceries);
      await pressLabel(send, evalPage, "Save");
      const over = `$${92 - Number(movedDining)} over`;
      await waitFor(send, `document.body.innerText.includes(${JSON.stringify(over)}) ? 'yes' : ''`, `saved ${width}`);
      await send("Page.reload", { ignoreCache: true });
      await waitFor(send, `document.body.innerText.includes(${JSON.stringify(over)}) ? 'yes' : ''`, `reloaded ${width}`);
      await pressLabel(send, evalPage, "Edit caps");
      await waitFor(send, "document.getElementById('cap-dining-out')?.value ? 'yes' : ''", `caps again ${width}`);
      await replaceCap(send, "cap-dining-out", String(Number(movedDining) + 20));
      await pressLabel(send, evalPage, "Save");
      await waitFor(send, "document.body.innerText.includes('That total has to stay $390.') ? 'yes' : ''", `over move ${width}`);
      await replaceCap(send, "cap-dining-out", "nope");
      await pressLabel(send, evalPage, "Save");
      await waitFor(send, "document.body.innerText.includes('Enter an amount.') ? 'yes' : ''", `invalid ${width}`);
      await replaceCap(send, "cap-dining-out", "-5");
      await pressLabel(send, evalPage, "Save");
      await waitFor(send, "document.body.innerText.includes('Can’t be negative.') ? 'yes' : ''", `negative ${width}`);
      await pressLabel(send, evalPage, "Cancel");
      await waitFor(send, `document.body.innerText.includes(${JSON.stringify(over)}) ? 'yes' : ''`, `cancel ${width}`);
      await send("Page.navigate", { url: `${base()}/finance?asOf=${encodeURIComponent(AS_OF)}` });
      await waitFor(send, "document.body.innerText.includes('Dining Out') ? 'yes' : ''", `overview again ${width}`);
      await send("Network.emulateNetworkConditions", { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 });
      await evalPage(send, "window.dispatchEvent(new Event('offline')); 'yes'");
      await waitFor(send, "document.querySelector(\"[data-link='offline']\")?.textContent.includes('Offline') ? 'yes' : ''", `offline ${width}`);
      await evalPage(
        send,
        `(() => {
          const orig = window.fetch;
          window.fetch = (input, init) => {
            const url = String(input && input.url ? input.url : input);
            if (url.includes("/api/finance/overview")) return new Promise((resolve) => setTimeout(() => resolve(orig(input, init)), 1200));
            return orig(input, init);
          };
          return "yes";
        })()`,
      );
      await send("Network.emulateNetworkConditions", { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
      await evalPage(send, "window.dispatchEvent(new Event('online')); 'yes'");
      await waitFor(send, "document.querySelector(\"[data-link='reconnecting']\") ? 'yes' : ''", `reconnecting ${width}`, 20000);
      await waitFor(send, "document.querySelector(\"[data-link='back']\")?.innerText.includes('Back online') ? 'yes' : ''", `online ${width}`, 20000);
      assert.equal(await evalPage(send, "document.body.innerText.includes('Dining Out') ? 'yes' : 'no'"), "yes");
    }
    ws.close();
  } finally {
    await stopProcess(chrome);
    await stopProcess(child);
    await release();
  }
});

test("finance add, recategorize, transfer, income, and refund at 390 and 1280", { skip }, async () => {
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
      const layout = width === 390 ? "sheet" : "panel";
      const name = width === 390 ? "Corner cafe" : "Desk lunch";
      await send("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: width < 500 });
      await send("Page.navigate", { url: `${base()}/finance?week=2026-10-19&asOf=${encodeURIComponent(AS_OF)}` });
      await waitFor(send, "document.body && document.body.innerText.includes('No transactions this week') && document.body.innerText.includes('Add expense or income') ? 'yes' : ''", `empty ${width}`);
      await pressLabel(send, evalPage, "See all");
      await waitFor(send, `document.body.innerText.includes('No transactions this week') && document.querySelector('[data-layout]')?.getAttribute('data-layout') === '${layout}' ? 'yes' : ''`, `empty list ${width}`);
      await send("Page.navigate", { url: `${base()}/finance/transactions?week=2026-11-09&asOf=${encodeURIComponent(AS_OF)}` });
      await waitFor(send, `document.body.innerText.includes("Joe's Pizza") && document.querySelector('[data-layout]')?.getAttribute('data-layout') === '${layout}' ? 'yes' : ''`, `list ${width}`);
      await pressLabel(send, evalPage, "Add expense or income");
      await waitFor(send, "document.getElementById('txn-payee') ? 'yes' : ''", `add ${width}`);
      assert.equal(await evalPage(send, "document.querySelector('[role=dialog]')?.tagName"), width === 1280 ? "ASIDE" : "DIV");
      await pressLabel(send, evalPage, "Save");
      await waitFor(send, "document.body.innerText.includes('Enter a name.') ? 'yes' : ''", `invalid ${width}`);
      await replaceCap(send, "txn-payee", "Nope");
      await replaceCap(send, "txn-amount", "4.00");
      await pressLabel(send, evalPage, "Cancel");
      await waitFor(send, "document.getElementById('txn-payee') ? '' : 'closed'", `cancel ${width}`);
      assert.equal(await evalPage(send, "document.body.innerText.includes('Nope') ? 'yes' : 'no'"), "no");
      await pressLabel(send, evalPage, "Add expense or income");
      await waitFor(send, "document.getElementById('txn-payee') ? 'yes' : ''", `add again ${width}`);
      await replaceCap(send, "txn-payee", name);
      await replaceCap(send, "txn-amount", "12.50");
      await pressLabel(send, evalPage, "Uncategorized");
      await pressLabel(send, evalPage, "Save");
      await waitFor(send, `document.body.innerText.includes(${JSON.stringify(name)}) && document.body.innerText.includes('Uncategorized') && !document.querySelector('[role=dialog]') ? 'yes' : ''`, `saved ${width}`);
      await send("Page.reload", { ignoreCache: true });
      await waitFor(send, `document.body.innerText.includes(${JSON.stringify(name)}) ? 'yes' : ''`, `reloaded ${width}`);
      await pressLabel(send, evalPage, name);
      await waitFor(send, `document.getElementById('txn-payee')?.value === ${JSON.stringify(name)} ? 'yes' : ''`, `edit ${width}`);
      await pressLabel(send, evalPage, "Groceries");
      await pressLabel(send, evalPage, "Save");
      await waitFor(send, `document.body.innerText.includes(${JSON.stringify(name)}) && document.body.innerText.includes('Groceries') && !document.querySelector('[role=dialog]') ? 'yes' : ''`, `groceries ${width}`);
      if (width === 390) {
        await pressLabel(send, evalPage, "SQ *DEMO VENDOR");
        await waitFor(send, "document.getElementById('txn-payee') ? 'yes' : ''", "vendor");
        await pressLabel(send, evalPage, "Transfer");
        await pressLabel(send, evalPage, "Save");
        await waitFor(send, "document.body.innerText.includes('SQ *DEMO VENDOR') && document.body.innerText.includes('Transfer') && !document.querySelector('[role=dialog]') ? 'yes' : ''", "transfer");
        const before = await evalPage(send, `fetch('/api/finance/overview?asOf=${encodeURIComponent(AS_OF)}&week=2026-11-09').then((response) => response.json()).then((body) => body.month.spentCents)`);
        await pressLabel(send, evalPage, "Add expense or income");
        await waitFor(send, "document.getElementById('txn-payee') ? 'yes' : ''", "income form");
        await replaceCap(send, "txn-payee", "Side gig");
        await replaceCap(send, "txn-amount", "50.00");
        await pressLabel(send, evalPage, "Income");
        await pressLabel(send, evalPage, "Save");
        await waitFor(send, "document.body.innerText.includes('Side gig') && document.body.innerText.includes('Income') && !document.querySelector('[role=dialog]') ? 'yes' : ''", "income");
        const after = await evalPage(send, `fetch('/api/finance/overview?asOf=${encodeURIComponent(AS_OF)}&week=2026-11-09').then((response) => response.json()).then((body) => body.month.spentCents)`);
        assert.equal(after, before);
        await pressLabel(send, evalPage, "Add expense or income");
        await waitFor(send, "document.getElementById('txn-payee') ? 'yes' : ''", "refund form");
        await replaceCap(send, "txn-payee", "Mug return");
        await replaceCap(send, "txn-amount", "4.00");
        await pressLabel(send, evalPage, "Refund");
        await pressLabel(send, evalPage, "Dining Out");
        await pressLabel(send, evalPage, "Save");
        await waitFor(send, "document.body.innerText.includes('Mug return') && !document.querySelector('[role=dialog]') ? 'yes' : ''", "refund");
        await send("Network.emulateNetworkConditions", { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 });
        await evalPage(send, "window.dispatchEvent(new Event('offline')); 'yes'");
        await waitFor(send, "document.body.innerText.includes('Can’t edit offline') ? 'yes' : ''", "txn offline");
        assert.equal(await evalPage(send, "[...document.querySelectorAll('button')].some((el) => (el.innerText || '').includes('Add expense or income') && el.disabled) ? 'yes' : 'no'"), "yes");
        await send("Network.emulateNetworkConditions", { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
        await evalPage(send, "window.dispatchEvent(new Event('online')); 'yes'");
      }
    }
    ws.close();
  } finally {
    await stopProcess(chrome);
    await stopProcess(child);
    await release();
  }
});

test("finance corrections survive a ledger refresh until reset at 390 and 1280", { skip }, async () => {
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
    const shellButton = "[...document.querySelectorAll('button')].find((el) => el.getAttribute('aria-label') === 'Shell (example)' || el.getAttribute('aria-label') === 'Edit Shell (example)')";

    for (const width of [390, 1280]) {
      const layout = width === 390 ? "sheet" : "panel";
      await send("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: width < 500 });
      await send("Page.navigate", { url: `${base()}/finance/transactions?week=2026-11-09&asOf=${encodeURIComponent(AS_OF)}` });
      await waitFor(send, `document.body && document.body.innerText.includes("Joe's Pizza") && document.querySelector('[data-layout]')?.getAttribute('data-layout') === '${layout}' ? 'yes' : ''`, `list ${width}`);
      await pointerClick(send, evalPage, shellButton);
      await waitFor(send, "document.getElementById('txn-payee')?.value === 'Shell (example)' ? 'yes' : ''", `shell ${width}`);
      assert.equal(await evalPage(send, "document.querySelector('[role=dialog]')?.tagName"), width === 1280 ? "ASIDE" : "DIV");
      await replaceCap(send, "txn-amount", "22.18");
      await pressLabel(send, evalPage, "Gas & Transport");
      await pressLabel(send, evalPage, "Save correction");
      await waitFor(send, "document.body.innerText.includes('Corrected') && !document.getElementById('txn-payee') ? 'yes' : ''", `kept ${width}`);
      await pointerClick(send, evalPage, shellButton);
      await waitFor(send, "document.body.innerText.includes('Original from Ledger') && document.body.innerText.includes('Shopping · −$22.18') ? 'yes' : ''", `original ${width}`);
      await pressLabel(send, evalPage, "Cancel");
      await waitFor(send, "document.getElementById('txn-payee') ? '' : 'closed'", `closed ${width}`);
      const posted = await evalPage(send, "fetch('/api/finance/ledger/simulate-refresh', { method: 'POST' }).then((response) => response.status)");
      assert.equal(posted, 200);
      await send("Page.reload", { ignoreCache: true });
      await waitFor(send, "document.body.innerText.includes('Ledger updated') && document.body.innerText.includes('Latest Ledger import') && document.body.innerText.includes('Shopping · −$24.18') && document.body.innerText.includes('Gas & Transport · −$22.18') ? 'yes' : ''", `conflict ${width}`);
      await pressLabel(send, evalPage, "Reset to Ledger…");
      await waitFor(send, "document.body.innerText.includes('Reset to Ledger?') ? 'yes' : ''", `confirm ${width}`);
      await pressLabel(send, evalPage, "Cancel");
      await waitFor(send, "document.body.innerText.includes('Ledger updated') && !document.body.innerText.includes('Reset to Ledger?') ? 'yes' : ''", `canceled ${width}`);
      await pressLabel(send, evalPage, "Reset to Ledger…");
      await pressLabel(send, evalPage, "Reset");
      await waitFor(send, "document.body.innerText.includes('−$24.18') && !document.body.innerText.includes('Ledger updated') ? 'yes' : ''", `reset ${width}`);
      await send("Page.reload", { ignoreCache: true });
      await waitFor(send, "document.body.innerText.includes('Shell (example)') && document.body.innerText.includes('−$24.18') && !document.body.innerText.includes('Ledger updated') ? 'yes' : ''", `held ${width}`);
    }
    ws.close();
  } finally {
    await stopProcess(chrome);
    await stopProcess(child);
    await release();
  }
});
