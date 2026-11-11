import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { acquireBrowserLock, reservePort, spawnLogged, startChrome, stopProcess, waitForChrome, waitForHttp } from "./support/harness.mjs";
import { pointerClick, pressLabel } from "./support/pointer.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const SHOTS = "/tmp/bills-ui";
const chromeBin = ["google-chrome", "google-chrome-stable"].find((bin) => spawnSync("which", [bin]).status === 0);
const skip = chromeBin ? false : "google-chrome is not installed";
const AS_OF = "2026-11-11T11:42:00.000Z";

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
      JOEHUB_SESSION_SECRET: "bills-browser-secret-value",
      JOEHUB_SCREENSHOTS: "1",
    },
  });
  child = started.child;
  await waitForHttp(`${base()}/finance/bills`, {
    child,
    log: started.log,
    accept: (response) => response.status === 200 && (response.headers.get("content-type") || "").includes("text/html"),
  });
  chrome = startChrome(chromeBin, cdp, `/tmp/chrome-bills-${process.pid}`);
  await waitForChrome(cdp, chrome);
  const logged = await fetch(`${base()}/api/session/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: "synthetic", password: "synthetic", device_label: "bills-browser" }),
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

async function shot(send, name) {
  await new Promise((resolve) => setTimeout(resolve, 120));
  const image = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true });
  mkdirSync(SHOTS, { recursive: true });
  writeFileSync(`${SHOTS}/${name}`, Buffer.from(image.result.data, "base64"));
}

async function open(send, path, width, height) {
  await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: width < 500 });
  await send("Page.navigate", { url: `${base()}${path}${path.includes("?") ? "&" : "?"}asOf=${encodeURIComponent(AS_OF)}` });
  await waitFor(send, "document.querySelector('[data-ready]') ? 'yes' : ''", path);
  await evalPage(send, "document.querySelectorAll('nextjs-portal').forEach((node) => node.style.setProperty('display', 'none', 'important')); 'yes'");
}

function setField(label, value) {
  return `(() => {
    const row = [...document.querySelectorAll("label")].find((el) => (el.innerText || "").trim().startsWith(${JSON.stringify(label)}));
    const el = row && row.querySelector("input");
    if (!el) return "";
    const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    set.call(el, ${JSON.stringify(value)});
    el.dispatchEvent(new Event("input", { bubbles: true }));
    return el.value;
  })()`;
}

test("bills list, paid toggle, add, offline, and desktop panels", { skip }, async () => {
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

    await open(send, "/finance/bills", 390, 1400);
    await waitFor(send, "document.body.innerText.includes('City Water (example)') && document.body.innerText.includes('2 days overdue') && document.body.innerText.includes('This week') && document.body.innerText.includes('Later') && document.body.innerText.includes('Annual membership (example)') ? 'yes' : ''", "list");
    assert.equal(await evalPage(send, "document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1 ? 'yes' : 'no'"), "yes");
    assert.equal(await evalPage(send, "[...document.querySelectorAll('[role=switch]')].filter((el) => el.getAttribute('aria-checked') === 'true').length"), 1);
    await shot(send, "B01-app.png");

    await open(send, "/finance/bills/bill-water", 390, 1100);
    await waitFor(send, "document.body.innerText.includes('Recent payments') && document.body.innerText.includes('Everyday checking') && document.body.innerText.includes('Oct 9') && document.body.innerText.includes('$48.20') ? 'yes' : ''", "water detail");
    await shot(send, "B02-app.png");

    await open(send, "/finance/bills/bill-phone", 390, 1100);
    await waitFor(send, "document.body.innerText.includes('Phone (example)') && document.body.innerText.includes('$55.00') ? 'yes' : ''", "phone");
    await pressLabel(send, evalPage, "Edit");
    await waitFor(send, "document.querySelector('[data-sheet]') && document.body.innerText.includes('Subscriptions') && document.body.innerText.includes('Delete') ? 'yes' : ''", "edit sheet");
    await shot(send, "B04-app.png");
    await pointerClick(send, evalPage, "[...document.querySelectorAll('button')].filter((el) => (el.innerText || '').trim() === 'Delete').at(-1)");
    await waitFor(send, "document.body.innerText.includes('Delete this bill?') ? 'yes' : ''", "confirm");
    await shot(send, "B08-app.png");
    await pointerClick(send, evalPage, "[...document.querySelectorAll('[role=alertdialog] button')].at(-1)");
    await waitFor(send, "document.body.innerText.includes('Delete this bill?') ? '' : 'closed'", "confirm closed");

    await open(send, "/finance/bills", 390, 1400);
    await pressLabel(send, evalPage, "Add");
    await waitFor(send, "document.querySelector('[data-sheet]') && document.querySelector('[data-autofocus]') === document.activeElement ? 'yes' : ''", "add focus");
    assert.equal(await evalPage(send, "[...document.querySelectorAll('button')].find((el) => (el.innerText || '').trim() === 'Save')?.disabled ? 'yes' : 'no'"), "yes");
    await shot(send, "B03-app.png");
    await evalPage(send, "document.querySelector('[data-autofocus]')?.blur(); 'yes'");
    await waitFor(send, "document.body.innerText.includes('Name required.') ? 'yes' : ''", "name error");
    assert.equal(await evalPage(send, setField("Name", "Gym (example)")), "Gym (example)");
    assert.equal(await evalPage(send, setField("Amount", "12.345")), "12.345");
    await evalPage(
      send,
      `(() => {
        const el = [...document.querySelectorAll("label")].find((row) => (row.innerText || "").trim().startsWith("Amount"))?.querySelector("input");
        el?.focus();
        el?.blur();
        return el ? "yes" : "";
      })()`,
    );
    await waitFor(send, "document.body.innerText.includes('Enter a valid amount.') ? 'yes' : ''", "amount error");
    assert.equal(await evalPage(send, setField("Amount", "12.00")), "12.00");
    assert.equal(await evalPage(send, setField("Due", "2026-11-18")), "2026-11-18");
    await evalPage(
      send,
      `(() => {
        const button = [...document.querySelectorAll("button")].find((el) => (el.innerText || "").trim() === "Save");
        button.click();
        button.click();
        return "yes";
      })()`,
    );
    await waitFor(send, "document.body.innerText.includes('Gym (example)') && document.body.innerText.includes('$12.00') ? 'yes' : ''", "created");
    await open(send, "/finance/bills", 390, 1500);
    await waitFor(send, "document.body.innerText.includes('Gym (example)') ? 'yes' : ''", "listed");
    assert.equal(await evalPage(send, "[...document.querySelectorAll('a')].filter((el) => (el.innerText || '').includes('Gym (example)')).length"), 1);
    await pointerClick(send, evalPage, "[...document.querySelectorAll('a')].find((el) => (el.innerText || '').includes('Gym (example)'))");
    await waitFor(send, "[...document.querySelectorAll('button')].some((el) => (el.innerText || '').trim() === 'Edit') ? 'yes' : ''", "gym detail");
    await pressLabel(send, evalPage, "Edit");
    await waitFor(send, "document.querySelector('[data-sheet]') ? 'yes' : ''", "gym edit");
    await pointerClick(send, evalPage, "[...document.querySelectorAll('button')].filter((el) => (el.innerText || '').trim() === 'Delete').at(-1)");
    await waitFor(send, "document.body.innerText.includes('Delete this bill?') ? 'yes' : ''", "gym confirm");
    await pointerClick(send, evalPage, "[...document.querySelectorAll('[role=alertdialog] button')].at(0)");
    await waitFor(send, "document.body.innerText.includes('Gym (example)') ? '' : 'gone'", "deleted");

    await open(send, "/finance/bills?view=empty", 390, 1000);
    await waitFor(send, "document.body.innerText.includes('No upcoming bills') && document.body.innerText.includes('Add a bill') ? 'yes' : ''", "empty");
    await shot(send, "B05-app.png");

    await open(send, "/finance/bills", 390, 1500);
    await waitFor(send, "document.body.innerText.includes('City Water (example)') ? 'yes' : ''", "restored");
    await send("Network.emulateNetworkConditions", { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 });
    await evalPage(send, "window.dispatchEvent(new Event('offline')); 'yes'");
    await waitFor(send, "document.querySelector(\"[data-link='offline']\")?.textContent.includes('Nov 11, 2026') ? 'yes' : ''", "offline banner");
    await shot(send, "B06-app.png");
    await pressLabel(send, evalPage, "Add");
    await waitFor(send, "document.body.innerText.includes('Can’t edit offline') ? 'yes' : ''", "offline edit");
    await evalPage(send, "document.querySelector(\"[role='switch']\")?.click(); 'yes'");
    await waitFor(send, "document.body.innerText.includes('Can’t edit offline') ? 'yes' : ''", "offline paid");
    await evalPage(send, "window.__realFetch = window.fetch; window.fetch = () => new Promise(() => {}); 'yes'");
    await send("Network.emulateNetworkConditions", { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
    await evalPage(send, "window.dispatchEvent(new Event('online')); 'yes'");
    await waitFor(send, "document.querySelector(\"[data-link='reconnecting']\") ? 'yes' : ''", "reconnecting");
    await shot(send, "B07-reconnecting.png");
    await evalPage(send, "window.fetch = window.__realFetch; 'yes'");
    await evalPage(send, "window.dispatchEvent(new Event('online')); 'yes'");
    await waitFor(send, "document.querySelector(\"[data-link='back']\") ? 'yes' : ''", "back online");
    await shot(send, "B07-back.png");
    await open(send, "/finance/bills?link=offline", 390, 1400);
    await waitFor(send, "document.querySelector(\"[data-link='offline']\") ? 'yes' : ''", "offline preview");
    await shot(send, "B07-offline.png");

    await open(send, "/finance/bills", 1280, 1200);
    await waitFor(send, "document.body.innerText.includes('Select a bill') && document.body.innerText.includes('City Water (example)') ? 'yes' : ''", "desktop list");
    assert.equal(await evalPage(send, "document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1 ? 'yes' : 'no'"), "yes");
    await shot(send, "B09-app.png");
    await pointerClick(send, evalPage, "document.querySelector(\"a[href*='bill-water']\")");
    await waitFor(send, "document.body.innerText.includes('Recent payments') && document.body.innerText.includes('Select a bill') ? '' : document.body.innerText.includes('Recent payments') ? 'yes' : ''", "desktop detail");
    await shot(send, "B10-app.png");
    await pressLabel(send, evalPage, "Add");
    await waitFor(send, "document.body.innerText.includes('Add a bill') && document.querySelector('[data-autofocus]') === document.activeElement ? 'yes' : ''", "desktop add");
    await shot(send, "B11-app.png");
    await pressLabel(send, evalPage, "Cancel");
    await waitFor(send, "document.body.innerText.includes('Add a bill') ? '' : document.body.innerText.includes('Recent payments') ? 'yes' : ''", "cancel add");

    const headers = { cookie: `joehub_session=${cookie}`, "content-type": "application/json" };
    const pay = async (paid) => {
      const response = await fetch(`${base()}/api/finance/bills/bill-phone?asOf=${encodeURIComponent(AS_OF)}`, {
        method: "PATCH",
        headers,
        body: JSON.stringify({ paid }),
      });
      assert.equal(response.status, 200);
      return response.json();
    };
    const first = await pay(true);
    assert.equal(first.paid, true);
    assert.equal(first.payments.length, 1);
    const second = await pay(true);
    assert.equal(second.payments.length, 1);
    const cleared = await pay(false);
    assert.equal(cleared.paid, false);
    assert.equal(cleared.payments.length, 0);
  } finally {
    if (chrome) await stopProcess(chrome);
    if (child) await stopProcess(child);
    await release();
  }
});
