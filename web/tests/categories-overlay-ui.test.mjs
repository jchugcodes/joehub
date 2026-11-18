import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { acquireBrowserLock, reservePort, spawnLogged, startChrome, stopProcess, waitForChrome, waitForHttp } from "./support/harness.mjs";
import { pointerClick, pressLabel } from "./support/pointer.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const chromeBin = ["google-chrome", "google-chrome-stable"].find((bin) => spawnSync("which", [bin]).status === 0);
const skip = chromeBin ? false : "google-chrome is not installed";
const AS_OF = "2026-11-11T15:00:00-05:00";

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
      JOEHUB_SESSION_SECRET: "categories-overlay-secret",
      JOEHUB_SCREENSHOTS: "1",
    },
  });
  child = started.child;
  await waitForHttp(`${base()}/finance/categories`, {
    child,
    log: started.log,
    accept: (response) => response.status === 200 && (response.headers.get("content-type") || "").includes("text/html"),
  });
  chrome = startChrome(chromeBin, cdp, `/tmp/chrome-categories-overlay-${process.pid}`);
  await waitForChrome(cdp, chrome);
  const logged = await fetch(`${base()}/api/session/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: "synthetic", password: "synthetic", device_label: "categories-overlay" }),
  });
  assert.equal(logged.status, 200);
  return cookieValue(logged);
}

async function openPage(cookie) {
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
    if (message.id && pending.has(message.id)) {
      pending.get(message.id)(message);
      pending.delete(message.id);
    }
  });
  const send = (method, params = {}) =>
    new Promise((resolve) => {
      const id = ++seq;
      pending.set(id, resolve);
      ws.send(JSON.stringify({ id, method, params }));
    });
  await send("Page.enable");
  await send("Network.enable");
  const cooked = await send("Network.setCookie", {
    name: "joehub_session",
    value: cookie,
    url: `${base()}/`,
    httpOnly: true,
  });
  assert.equal(cooked.result?.success, true);
  return {
    send,
    async close() {
      ws.close();
      await fetch(`http://127.0.0.1:${cdp}/json/close/${created.id}`);
    },
  };
}

async function evalPage(send, expression) {
  const result = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (result.result?.exceptionDetails) throw new Error(JSON.stringify(result.result.exceptionDetails));
  return result.result?.result?.value;
}

async function waitFor(send, expression, label) {
  const deadline = Date.now() + 45000;
  let last = "";
  while (Date.now() < deadline) {
    try {
      const value = await evalPage(send, expression);
      last = value == null ? "" : String(value);
      if (value) return value;
    } catch (error) {
      last = error instanceof Error ? error.message.slice(0, 160) : "error";
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

async function size(send, width, height) {
  await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: width < 500 });
}

const settled = `(() => {
  const panel = document.querySelector("[data-overlay='panel']");
  if (!panel || panel.getAttribute("data-state") !== "open") return "";
  return panel.getAnimations({ subtree: true }).some((animation) => animation.playState === "running") ? "" : "yes";
})()`;

test("categories overlay shows the budget, a transaction, and the monthly form", { skip, timeout: 240000 }, async () => {
  let page = null;
  try {
    const secret = await boot();
    page = await openPage(secret);
    for (const viewport of [
      { width: 1280, height: 800, pin: true },
      { width: 390, height: 844, pin: false },
    ]) {
      await size(page.send, viewport.width, viewport.height);
      await page.send("Page.navigate", { url: `${base()}/finance/categories?period=month&asOf=${encodeURIComponent(AS_OF)}` });
      await waitFor(page.send, "document.body.innerText.includes('Dining Out') ? 'yes' : ''", "categories");
      assert.equal(await pointerClick(page.send, evalPage, "document.querySelector(\"a[href*='/finance/categories/dining-out']\")"), "yes");
      await waitFor(page.send, `${settled} && document.querySelector("[data-category-detail='true'] button")?.innerText.includes("Joe's Pizza") ? 'yes' : ''`, "detail");
      const detail = JSON.parse(await evalPage(page.send, `(() => {
        const root = document.querySelector("[data-category-detail='true']");
        const meta = root?.querySelector("[data-item-meta]")?.textContent || "";
        const first = root?.querySelector("button");
        return JSON.stringify({
          title: document.querySelector("[role='dialog'] h2")?.textContent || "",
          meta,
          payee: (first?.innerText || "").replace(/\\s+/g, " ").trim(),
          edit: [...document.querySelectorAll("[data-overlay='panel'] button")].some((button) => (button.innerText || "").trim() === "Edit" && !button.disabled),
        });
      })()`));
      assert.equal(detail.title, "Dining Out");
      assert.match(detail.meta, /\$248 of \$346\.67 estimate/);
      assert.equal(detail.meta.includes("4,204"), false);
      assert.match(detail.payee, /Joe's Pizza/);
      assert.equal(detail.edit, true);
      if (viewport.pin) {
        const row = await evalPage(page.send, `(() => {
          const current = document.querySelector("[data-selected='true']");
          return current ? getComputedStyle(current).backgroundColor : "";
        })()`);
        assert.match(String(row), /46,\s*139,\s*106/);
      }
      assert.equal(await pointerClick(page.send, evalPage, "document.querySelector(\"[data-category-detail='true'] button\")"), "yes");
      await waitFor(page.send, `${settled} && document.querySelector("[data-txn-detail='true']") && document.querySelector("[role='dialog'] h2")?.textContent === "Joe's Pizza" ? 'yes' : ''`, "transaction");
      assert.equal(await pressLabel(page.send, evalPage, "Back"), "yes");
      await waitFor(page.send, `${settled} && document.querySelector("[data-category-detail='true']") ? 'yes' : ''`, "back to category");
      assert.equal(await pressLabel(page.send, evalPage, "Edit"), "yes");
      await waitFor(page.send, `${settled} && document.getElementById("budget-dining-out") ? 'yes' : ''`, "edit form");
      const form = JSON.parse(await evalPage(page.send, `(() => {
        const input = document.getElementById("budget-dining-out");
        return JSON.stringify({
          heading: document.querySelector("[role='dialog'] h2")?.textContent || "",
          mode: input.getAttribute("inputmode"),
          hint: input.getAttribute("enterkeyhint"),
          size: parseFloat(getComputedStyle(input).fontSize),
          sheet: document.querySelector("[data-overlay='panel']")?.getAttribute("data-sheet") || "",
          deleted: document.body.innerText.includes("Delete this category"),
        });
      })()`));
      assert.equal(form.heading, "Monthly budgets");
      assert.equal(form.mode, "decimal");
      assert.equal(form.hint, "done");
      assert.ok(form.size >= 16, `input size ${form.size}`);
      assert.equal(form.sheet, "form");
      assert.equal(form.deleted, false);
      assert.equal(await pressLabel(page.send, evalPage, "Cancel"), "yes");
      await waitFor(page.send, `${settled} && document.querySelector("[data-category-detail='true']") && !document.getElementById("budget-dining-out") ? 'yes' : ''`, "form closed");

      await page.send("Page.navigate", { url: `${base()}/finance/categories/utilities?period=month&asOf=${encodeURIComponent(AS_OF)}` });
      await waitFor(page.send, `${settled} && document.querySelector("[role='dialog'] h2")?.textContent === "Bills & Utilities" ? 'yes' : ''`, "utilities");
      const utilities = await evalPage(page.send, "document.querySelector(\"[data-item-meta]\")?.textContent || ''");
      assert.equal(String(utilities).includes(" of "), false);
      assert.equal(String(utilities).includes("4,204"), false);
    }

    await size(page.send, 390, 844);
    await page.send("Page.navigate", { url: `${base()}/finance/categories/dining-out?period=month&xe=offline&asOf=${encodeURIComponent(AS_OF)}` });
    await waitFor(page.send, `${settled} && document.querySelector("[data-state='offline']")?.textContent.includes("You are offline.") ? 'yes' : ''`, "offline");
    assert.equal(await evalPage(page.send, "[...document.querySelectorAll('[data-overlay=panel] button')].some((button) => (button.innerText || '').trim() === 'Edit' && button.disabled) ? 'yes' : 'no'"), "yes");
  } finally {
    if (page) await page.close();
    await stopProcess(chrome);
    await stopProcess(child);
    await release();
  }
});
