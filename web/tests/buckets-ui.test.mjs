import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { acquireBrowserLock, reservePort, spawnLogged, startChrome, stopProcess, waitForChrome, waitForHttp } from "./support/harness.mjs";
import { pointerClick } from "./support/pointer.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const SHOTS = fileURLToPath(new URL("../../artifacts/vFN7", import.meta.url));
const chromeBin = ["google-chrome", "google-chrome-stable"].find((bin) => spawnSync("which", [bin]).status === 0);
const skip = chromeBin ? false : "google-chrome is not installed";

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
      JOEHUB_SESSION_SECRET: "bucket-browser-secret-value",
    },
  });
  child = started.child;
  await waitForHttp(`${base()}/finance/spending`, {
    child,
    log: started.log,
    accept: (response) => response.status === 200 && (response.headers.get("content-type") || "").includes("text/html"),
  });
  chrome = startChrome(chromeBin, cdp, `/tmp/chrome-buckets-${process.pid}`);
  await waitForChrome(cdp, chrome);
  const logged = await fetch(`${base()}/api/session/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: "synthetic", password: "synthetic", device_label: "bucket-browser" }),
  });
  assert.equal(logged.status, 200);
  return cookieValue(logged);
}

async function shutdown() {
  await stopProcess(chrome);
  await stopProcess(child);
  chrome = null;
  child = null;
  await release();
  release = async () => {};
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
      last = error instanceof Error ? error.message.slice(0, 160) : "error";
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  let body = "";
  try {
    body = await evalPage(send, "document.body ? document.body.innerText.slice(0, 700) : ''");
  } catch {
    body = last;
  }
  throw new Error(`timed out waiting for ${label}; last=${last}; body=${body}`);
}

async function onScreen(send, finder, label) {
  await waitFor(
    send,
    `(() => {
      const el = ${finder};
      if (!el) return "";
      const box = el.getBoundingClientRect();
      const on = box.width >= 44 && box.height >= 44 && box.left >= -1 && box.top >= -1 && box.right <= window.innerWidth + 1 && box.bottom <= window.innerHeight + 1;
      return on ? "yes" : "";
    })()`,
    label,
  );
}

async function shot(send, name) {
  await new Promise((resolve) => setTimeout(resolve, 200));
  const image = await send("Page.captureScreenshot", { format: "png" });
  mkdirSync(SHOTS, { recursive: true });
  writeFileSync(`${SHOTS}/${name}`, Buffer.from(image.result.data, "base64"));
}

async function fit(send, width, height) {
  await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: width < 500 });
  await waitFor(send, `document.querySelector('[data-layout]')?.getAttribute('data-layout') === '${width >= 1024 ? "panel" : "sheet"}' ? 'yes' : ''`, `layout ${width}`);
  const overflow = await evalPage(send, "document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1 ? 'yes' : 'no'");
  assert.equal(overflow, "yes", `horizontal overflow at ${width}`);
}

function setField(id, value) {
  return `(() => {
    const el = document.getElementById(${JSON.stringify(id)});
    if (!el) return "";
    const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    set.call(el, ${JSON.stringify(value)});
    el.dispatchEvent(new Event("input", { bubbles: true }));
    return el.value;
  })()`;
}

async function attach(cookie) {
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
  return { send, ws };
}

test("bucket sheets hide, rename, add, and remove on the spending tab", { timeout: 180000, skip }, async () => {
  const cookie = await boot();
  try {
    const { send, ws } = await attach(cookie);
    await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    await send("Page.navigate", { url: `${base()}/finance/spending` });
    await waitFor(send, "document.querySelector('[data-ready=\"true\"]') && document.querySelector('[data-month-spent]') ? 'yes' : ''", "spending");
    await evalPage(send, "document.querySelectorAll('nextjs-portal').forEach((node) => node.style.setProperty('display', 'none', 'important')); 'yes'");
    const before = Number(await evalPage(send, "document.querySelector('[data-month-spent]')?.getAttribute('data-month-spent')"));
    assert.ok(before > 0);
    await fit(send, 390, 844);
    await shot(send, "390-totals-before.png");
    await fit(send, 1280, 900);
    await shot(send, "1280-totals-before.png");

    await fit(send, 390, 844);
    const openBuckets = "document.querySelector('[data-open-buckets]')";
    await onScreen(send, openBuckets, "buckets");
    await pointerClick(send, evalPage, openBuckets);
    await waitFor(send, "document.querySelector('[data-buckets=\"list\"]') && document.querySelector(\"[data-overlay='panel'][data-state='open']\") ? 'yes' : ''", "bucket list");
    const hideGroceries = "document.querySelector(\"[data-bucket='groceries'] [data-bucket-action='hide']\")";
    await onScreen(send, hideGroceries, "hide control");
    await pointerClick(send, evalPage, hideGroceries);
    await waitFor(send, "document.querySelector(\"[data-bucket='groceries']\")?.getAttribute('data-hidden') === 'true' && document.querySelector(\"[data-bucket='groceries']\")?.innerText.includes('Hidden') ? 'yes' : ''", "hidden groceries");
    const hiddenSpent = Number(await evalPage(send, "document.querySelector('[data-month-spent]')?.getAttribute('data-month-spent')"));
    assert.ok(hiddenSpent < before, `spent ${hiddenSpent} should be under ${before}`);
    await fit(send, 390, 844);
    await shot(send, "390-bucket-list-hidden.png");
    await fit(send, 1280, 900);
    await shot(send, "1280-bucket-list-hidden.png");

    const closeList = "document.querySelector(\"[data-overlay='panel'] [aria-label='Close']\")";
    await onScreen(send, closeList, "close");
    await pointerClick(send, evalPage, closeList);
    await waitFor(send, "!document.querySelector(\"[data-overlay='panel']\") ? 'yes' : ''", "list closed");
    await fit(send, 390, 844);
    await shot(send, "390-totals-after.png");
    await fit(send, 1280, 900);
    await shot(send, "1280-totals-after.png");

    await fit(send, 390, 844);
    await onScreen(send, openBuckets, "buckets again");
    await pointerClick(send, evalPage, openBuckets);
    await waitFor(send, "document.querySelector('[data-buckets=\"list\"]') ? 'yes' : ''", "list again");
    const renameGroceries = "document.querySelector(\"[data-bucket='groceries'] [data-bucket-action='rename']\")";
    await onScreen(send, renameGroceries, "rename control");
    await pointerClick(send, evalPage, renameGroceries);
    await waitFor(send, "document.querySelector('[data-buckets=\"rename\"]') && document.getElementById('bucket-name') ? 'yes' : ''", "rename");
    assert.equal(await evalPage(send, setField("bucket-name", "Sample market")), "Sample market");
    const inputSize = Number(await evalPage(send, "parseFloat(getComputedStyle(document.getElementById('bucket-name')).fontSize)"));
    assert.ok(inputSize >= 16, `input font ${inputSize}`);
    const inputMode = await evalPage(send, "document.getElementById('bucket-name').getAttribute('inputmode') + ' ' + document.getElementById('bucket-name').getAttribute('enterkeyhint')");
    assert.equal(inputMode, "text done");
    await fit(send, 390, 844);
    await shot(send, "390-rename.png");
    await fit(send, 1280, 900);
    await shot(send, "1280-rename.png");
    const saveButton = "[...document.querySelectorAll('button')].find((el) => (el.innerText || '').trim() === 'Save')";
    await onScreen(send, saveButton, "save");
    await pointerClick(send, evalPage, saveButton);
    await waitFor(send, "document.querySelector('[data-buckets=\"list\"]') && document.body.innerText.includes('Sample market') ? 'yes' : ''", "renamed");

    const addButton = "[...document.querySelectorAll('button')].find((el) => (el.innerText || '').trim() === 'Add')";
    await onScreen(send, addButton, "add control");
    await pointerClick(send, evalPage, addButton);
    await waitFor(send, "document.querySelector('[data-buckets=\"add\"]') ? 'yes' : ''", "add");
    assert.equal(await evalPage(send, setField("bucket-name", "Sample oats")), "Sample oats");
    await fit(send, 390, 844);
    await shot(send, "390-add.png");
    await fit(send, 1280, 900);
    await shot(send, "1280-add.png");
    await onScreen(send, saveButton, "save add");
    await pointerClick(send, evalPage, saveButton);
    await waitFor(send, "document.querySelector('[data-buckets=\"list\"]') && document.body.innerText.includes('Sample oats') ? 'yes' : ''", "added");

    const removeFun = "document.querySelector(\"[data-bucket='fun'] [data-bucket-action='remove']\")";
    await evalPage(send, `(() => {
      const row = document.querySelector("[data-bucket='fun']");
      const scroller = document.querySelector("[data-overlay='panel'] [data-stack]");
      if (!row || !scroller) return "";
      const rowBox = row.getBoundingClientRect();
      const box = scroller.getBoundingClientRect();
      scroller.scrollTop += rowBox.bottom - box.bottom + 12;
      return "yes";
    })()`);
    await onScreen(send, removeFun, "remove control");
    await pointerClick(send, evalPage, removeFun);
    await waitFor(send, "document.querySelector('[data-buckets=\"remove\"]') && document.body.innerText.includes('Uncategorized') ? 'yes' : ''", "remove");
    await fit(send, 390, 844);
    await shot(send, "390-remove.png");
    await fit(send, 1280, 900);
    await shot(send, "1280-remove.png");
    const removeButton = "[...document.querySelectorAll('button')].find((el) => (el.innerText || '').trim() === 'Remove')";
    await onScreen(send, removeButton, "remove confirm");
    await pointerClick(send, evalPage, removeButton);
    await waitFor(send, "document.querySelector('[data-buckets=\"list\"]') && !document.querySelector(\"[data-bucket='fun']\") ? 'yes' : ''", "removed");

    await onScreen(send, hideGroceries, "show control");
    await pointerClick(send, evalPage, hideGroceries);
    await waitFor(send, "document.querySelector(\"[data-bucket='groceries']\")?.getAttribute('data-hidden') === 'false' ? 'yes' : ''", "shown");
    const restored = Number(await evalPage(send, "document.querySelector('[data-month-spent]')?.getAttribute('data-month-spent')"));
    assert.equal(restored, before);
    ws.close();
  } finally {
    await shutdown();
  }
});
