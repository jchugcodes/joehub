import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { acquireBrowserLock, reservePort, spawnLogged, startChrome, stopProcess, waitForChrome, waitForHttp } from "./support/harness.mjs";
import { pointerClick, pressLabel } from "./support/pointer.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const SHOTS = "/tmp/accounts-ui";
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
      JOEHUB_SESSION_SECRET: "accounts-browser-secret-value",
    },
  });
  child = started.child;
  await waitForHttp(`${base()}/finance/accounts`, {
    child,
    log: started.log,
    accept: (response) => response.status === 200 && (response.headers.get("content-type") || "").includes("text/html"),
  });
  chrome = startChrome(chromeBin, cdp, `/tmp/chrome-accounts-${process.pid}`);
  await waitForChrome(cdp, chrome);
  const logged = await fetch(`${base()}/api/session/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: "synthetic", password: "synthetic", device_label: "accounts-browser" }),
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
    body = await evalPage(send, "document.body ? document.body.innerText.slice(0, 600) : ''");
  } catch {
    body = last;
  }
  throw new Error(`timed out waiting for ${label}; last=${last}; body=${body}`);
}

async function shot(send, name) {
  await evalPage(send, "document.querySelectorAll('nextjs-portal').forEach((node) => node.style.setProperty('display', 'none', 'important')); 'yes'");
  await new Promise((resolve) => setTimeout(resolve, 200));
  const image = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true });
  mkdirSync(SHOTS, { recursive: true });
  writeFileSync(`${SHOTS}/${name}`, Buffer.from(image.result.data, "base64"));
}

async function open(send, path, width, height) {
  await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: width < 500 });
  await send("Page.navigate", { url: `${base()}${path}${path.includes("?") ? "&" : "?"}asOf=${encodeURIComponent(AS_OF)}` });
  await waitFor(send, "document.querySelector('[data-ready]') ? 'yes' : ''", path);
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

test("accounts list, ledger, manual edit, offline, and desktop panels", { skip }, async () => {
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

    await open(send, "/finance/accounts", 390, 1600);
    await waitFor(send, "document.body.innerText.includes('Everyday checking') && document.body.innerText.includes('Stale') && document.body.innerText.includes('$18,472') ? 'yes' : ''", "list");
    assert.equal(await evalPage(send, "document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1 ? 'yes' : 'no'"), "yes");
    await shot(send, "A01-app.png");

    await open(send, "/finance/accounts/acct-checking", 390, 1200);
    await waitFor(send, "document.body.innerText.includes('Joe\\'s Pizza') && document.body.innerText.includes('Nov 8, 2026') ? 'yes' : ''", "ledger");
    assert.equal(await evalPage(send, "[...document.querySelectorAll('button')].some((el) => (el.innerText || '').trim() === 'Edit') ? 'yes' : 'no'"), "no");
    await shot(send, "A02-app.png");
    await pressLabel(send, evalPage, "Hide from net worth");
    await waitFor(send, "document.querySelector(\"[role='switch']\")?.getAttribute('aria-checked') === 'true' ? 'yes' : ''", "hidden");
    await open(send, "/finance/accounts", 390, 1600);
    await waitFor(send, "document.body.innerText.includes('Hidden') && document.body.innerText.includes('$16,000') ? 'yes' : ''", "hidden rollup");
    await open(send, "/finance/accounts/acct-checking", 390, 1200);
    await pressLabel(send, evalPage, "Hide from net worth");
    await waitFor(send, "document.querySelector(\"[role='switch']\")?.getAttribute('aria-checked') === 'false' ? 'yes' : ''", "shown again");

    await open(send, "/finance/accounts/acct-cash", 390, 1100);
    await waitFor(send, "document.body.innerText.includes('Cash reserve') && document.body.innerText.includes('No transactions') ? 'yes' : ''", "manual");
    await shot(send, "A03-app.png");
    await pressLabel(send, evalPage, "Edit");
    await waitFor(send, "document.querySelector('[data-sheet]') && document.body.innerText.includes('Cash reserve') ? 'yes' : ''", "cash edit");
    await shot(send, "A05-app.png");
    await pointerClick(send, evalPage, "[...document.querySelectorAll('button')].filter((el) => (el.innerText || '').trim() === 'Delete').at(-1)");
    await waitFor(send, "document.body.innerText.includes('Delete this account?') ? 'yes' : ''", "cash confirm");
    await shot(send, "A09-app.png");
    await pointerClick(send, evalPage, "[...document.querySelectorAll('[role=alertdialog] button')].at(-1)");
    await waitFor(send, "document.body.innerText.includes('Delete this account?') ? '' : 'closed'", "confirm closed");

    await open(send, "/finance/accounts", 390, 1140);
    await pressLabel(send, evalPage, "Add a manual account");
    await waitFor(send, "document.querySelector('[data-sheet]') && document.querySelector('input') === document.activeElement ? 'yes' : ''", "add focus");
    assert.equal(await evalPage(send, "[...document.querySelectorAll('button')].find((el) => (el.innerText || '').trim() === 'Save')?.disabled ? 'yes' : 'no'"), "yes");
    await shot(send, "A04-app.png");
    await evalPage(send, setField("Name", ""));
    await evalPage(send, "document.querySelector('input')?.blur(); 'yes'");
    await waitFor(send, "document.body.innerText.includes('Name required.') ? 'yes' : ''", "name error");
    assert.equal(await evalPage(send, setField("Name", "Trip fund")), "Trip fund");
    assert.equal(await evalPage(send, setField("Balance", "12.345")), "12.345");
    await evalPage(
      send,
      `(() => {
        const el = [...document.querySelectorAll("label")].find((row) => (row.innerText || "").trim().startsWith("Balance"))?.querySelector("input");
        el?.focus();
        el?.blur();
        return el ? "yes" : "";
      })()`,
    );
    await waitFor(send, "document.body.innerText.includes('Enter a valid balance.') ? 'yes' : ''", "balance error");
    assert.equal(await evalPage(send, setField("Balance", "25.00")), "25.00");
    await evalPage(
      send,
      `(() => {
        const button = [...document.querySelectorAll("button")].find((el) => (el.innerText || "").trim() === "Save");
        button.click();
        button.click();
        return "yes";
      })()`,
    );
    await waitFor(send, "document.body.innerText.includes('Trip fund') && document.body.innerText.includes('$25.00') ? 'yes' : ''", "created");
    await open(send, "/finance/accounts", 390, 1600);
    await waitFor(send, "document.body.innerText.includes('Trip fund') ? 'yes' : ''", "listed once");
    assert.equal(await evalPage(send, "[...document.querySelectorAll('a')].filter((el) => (el.innerText || '').includes('Trip fund')).length"), 1);
    await pointerClick(send, evalPage, "[...document.querySelectorAll('a')].find((el) => (el.innerText || '').includes('Trip fund'))");
    await waitFor(send, "[...document.querySelectorAll('button')].some((el) => (el.innerText || '').trim() === 'Edit') ? 'yes' : ''", "trip detail");
    await pressLabel(send, evalPage, "Edit");
    await waitFor(send, "document.querySelector('[data-sheet]') ? 'yes' : ''", "edit sheet");
    assert.equal(await evalPage(send, setField("Name", "Trip cash")), "Trip cash");
    await pressLabel(send, evalPage, "Save");
    await waitFor(send, "document.body.innerText.includes('Trip cash') ? 'yes' : ''", "renamed");
    await pressLabel(send, evalPage, "Edit");
    await waitFor(send, "document.querySelector('[data-sheet]') ? 'yes' : ''", "edit again");
    await pointerClick(send, evalPage, "[...document.querySelectorAll('button')].filter((el) => (el.innerText || '').trim() === 'Delete').at(-1)");
    await waitFor(send, "document.body.innerText.includes('Delete this account?') ? 'yes' : ''", "confirm");
    await pointerClick(send, evalPage, "[...document.querySelectorAll('[role=alertdialog] button')].at(0)");
    await waitFor(send, "document.body.innerText.includes('Trip cash') ? '' : 'gone'", "deleted");

    await open(send, "/finance/accounts?view=empty", 390, 1000);
    await waitFor(send, "document.body.innerText.includes('No accounts yet') ? 'yes' : ''", "empty");
    assert.equal(await evalPage(send, "document.body.innerText.includes('Net worth') ? 'yes' : 'no'"), "no");
    await shot(send, "A06-app.png");

    await open(send, "/finance/accounts", 390, 1600);
    await waitFor(send, "document.body.innerText.includes('Everyday checking') ? 'yes' : ''", "restored list");
    await send("Network.emulateNetworkConditions", { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 });
    await evalPage(send, "window.dispatchEvent(new Event('offline')); 'yes'");
    await waitFor(send, "document.querySelector(\"[data-link='offline']\")?.textContent.includes('Nov 11, 2026') && document.body.innerText.includes('Can’t edit offline') ? 'yes' : ''", "offline banner");
    assert.equal(
      await evalPage(
        send,
        `(() => {
          const banner = document.querySelector("[data-link='offline']");
          const tabs = document.querySelector("[data-tabs]");
          const heading = document.querySelector("h1");
          const worth = [...document.querySelectorAll("p")].find((el) => (el.textContent || "").trim() === "Net worth");
          const notice = [...document.querySelectorAll("p")].find((el) => (el.textContent || "").trim() === "Can’t edit offline");
          const add = [...document.querySelectorAll("button")].find((el) => el.getAttribute("aria-label") === "Add a manual account");
          if (!banner || !tabs || !heading || !worth || !notice || !add) return "missing";
          const after = (earlier, later) => Boolean(earlier.compareDocumentPosition(later) & Node.DOCUMENT_POSITION_FOLLOWING);
          const faded = Number(getComputedStyle(add).opacity) < 1 && add.getAttribute("aria-disabled") === "true";
          return after(heading, tabs) && after(tabs, banner) && after(banner, worth) && after(worth, notice) && faded ? "yes" : "no";
        })()`,
      ),
      "yes",
    );
    await shot(send, "A07-app.png");
    await pressLabel(send, evalPage, "Add a manual account");
    await waitFor(send, "document.body.innerText.includes('Can’t edit offline') ? 'yes' : ''", "offline edit");
    await evalPage(send, "window.__realFetch = window.fetch; window.fetch = () => new Promise(() => {}); 'yes'");
    await send("Network.emulateNetworkConditions", { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
    await evalPage(send, "window.dispatchEvent(new Event('online')); 'yes'");
    await waitFor(send, "document.querySelector(\"[data-link='reconnecting']\") ? 'yes' : ''", "reconnecting");
    await shot(send, "A08-reconnecting.png");
    await evalPage(send, "window.fetch = window.__realFetch; 'yes'");
    await evalPage(send, "window.dispatchEvent(new Event('online')); 'yes'");
    await waitFor(send, "document.querySelector(\"[data-link='back']\") ? 'yes' : ''", "back online");
    await shot(send, "A08-back.png");
    await open(send, "/finance/accounts?link=offline", 390, 900);
    await waitFor(send, "document.querySelector(\"[data-link='offline']\") ? 'yes' : ''", "offline preview");
    await shot(send, "A08-offline.png");

    await open(send, "/finance/accounts", 1280, 1400);
    await waitFor(send, "document.body.innerText.includes('Select an account') && document.body.innerText.includes('Brokerage') ? 'yes' : ''", "desktop list");
    assert.equal(await evalPage(send, "document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1 ? 'yes' : 'no'"), "yes");
    await shot(send, "A10-app.png");
    await pointerClick(send, evalPage, "document.querySelector(\"a[href*='acct-checking']\")");
    await waitFor(send, "document.body.innerText.includes('Payroll (example)') && document.body.innerText.includes('Select an account') ? '' : document.body.innerText.includes('Payroll (example)') ? 'yes' : ''", "desktop detail");
    await shot(send, "A11-app.png");
    await pressLabel(send, evalPage, "Add a manual account");
    await waitFor(send, "document.body.innerText.includes('Add account') && document.querySelector('input') === document.activeElement ? 'yes' : ''", "desktop add");
    await shot(send, "A12-app.png");
    await pressLabel(send, evalPage, "Cancel");
    await waitFor(send, "document.body.innerText.includes('Add account') ? '' : document.body.innerText.includes('Payroll (example)') ? 'yes' : ''", "cancel add");
  } finally {
    if (chrome) await stopProcess(chrome);
    if (child) await stopProcess(child);
    await release();
  }
});
