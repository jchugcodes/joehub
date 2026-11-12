import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { acquireBrowserLock, reservePort, spawnLogged, startChrome, stopProcess, waitForChrome, waitForHttp } from "./support/harness.mjs";
import { pointerClick, pressLabel } from "./support/pointer.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const SHOTS = "/tmp/goals-ui";
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

async function boot(extra = {}) {
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
      JOEHUB_SESSION_SECRET: "goals-browser-secret-value",
      JOEHUB_SCREENSHOTS: "1",
      ...extra,
    },
  });
  child = started.child;
  await waitForHttp(`${base()}/finance/goals`, {
    child,
    log: started.log,
    accept: (response) => response.status === 200 && (response.headers.get("content-type") || "").includes("text/html"),
  });
  chrome = startChrome(chromeBin, cdp, `/tmp/chrome-goals-${process.pid}`);
  await waitForChrome(cdp, chrome);
  const logged = await fetch(`${base()}/api/session/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: "synthetic", password: "synthetic", device_label: "goals-browser" }),
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

async function shot(send, name) {
  await new Promise((resolve) => setTimeout(resolve, 150));
  const image = await send("Page.captureScreenshot", { format: "png" });
  mkdirSync(SHOTS, { recursive: true });
  writeFileSync(`${SHOTS}/${name}`, Buffer.from(image.result.data, "base64"));
}

async function open(send, path, width, height) {
  await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: width < 500 });
  await send("Page.navigate", { url: `${base()}${path}` });
  await waitFor(send, "document.querySelector('[data-ready]') ? 'yes' : ''", path);
  await waitFor(send, "document.querySelector('[data-hydrated]') ? 'yes' : ''", `${path} hydrated`);
  await evalPage(send, "document.querySelectorAll('nextjs-portal').forEach((node) => node.style.setProperty('display', 'none', 'important')); 'yes'");
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

test("goals list, detail, add, and the desktop split match the frames", { skip }, async () => {
  const cookie = await boot();
  try {
    const { send, ws } = await attach(cookie);
    await open(send, "/finance/goals", 390, 900);
    await waitFor(send, "document.body.innerText.includes('$740 / mo') && document.body.innerText.includes('Loan payoff') && document.body.innerText.includes('$12,400') && document.body.innerText.includes('Extra payments') && document.body.innerText.includes('$8,400') && document.body.innerText.includes('3 months of expenses') && document.body.innerText.includes('NYC move') && document.body.innerText.includes('Aug 2027') && document.body.innerText.includes('Travel — Japan') && document.body.innerText.includes('Paused') ? 'yes' : ''", "list");
    assert.equal(await evalPage(send, "document.querySelector('[data-goals]')?.getAttribute('data-goals')"), "list");
    assert.equal(await evalPage(send, "[...document.querySelectorAll('nav[aria-label=\"Finance sections\"] a')].map((el) => el.textContent.trim()).join(',')"), "Overview,Categories,Goals,Accounts,Debts,Bills");
    assert.equal(await evalPage(send, "(() => { const row = document.querySelector('.finance-tab-row'); return row && row.scrollWidth <= row.clientWidth + 1 ? 'yes' : 'no'; })()"), "yes");
    assert.equal(await evalPage(send, "document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1 ? 'yes' : 'no'"), "yes");
    await shot(send, "G01-app.png");

    await pointerClick(send, evalPage, "document.querySelector(\"a[data-goal='emergency-fund']\")");
    await waitFor(send, "document.body.innerText.includes('Type') && document.body.innerText.includes('Savings') && document.body.innerText.includes('Target') && document.body.innerText.includes('$12,600') && document.body.innerText.includes('In account') && document.body.innerText.includes('Emergency savings') && document.body.innerText.includes('Monthly') && document.body.innerText.includes('$220') ? 'yes' : ''", "detail");
    assert.equal(await evalPage(send, "document.body.innerText.includes('Transfer') || document.body.innerText.includes('Mark complete') ? 'yes' : 'no'"), "no");
    await shot(send, "G03-app.png");
    await pressLabel(send, evalPage, "Back");
    await waitFor(send, "document.body.innerText.includes('$740 / mo') && document.querySelector('[data-goals]')?.getAttribute('data-goals') === 'list' ? 'yes' : ''", "back");

    await open(send, "/finance/goals", 1280, 900);
    await waitFor(send, "document.body.innerText.includes('Select a goal') && document.body.innerText.includes('$740 / mo') ? 'yes' : ''", "desktop empty panel");
    assert.equal(await evalPage(send, "(() => { const row = document.querySelector('.finance-tab-row'); return row && row.scrollWidth <= row.clientWidth + 1 ? 'yes' : 'no'; })()"), "yes");
    assert.equal(await evalPage(send, "document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1 ? 'yes' : 'no'"), "yes");
    await shot(send, "G04-empty-app.png");
    await pointerClick(send, evalPage, "document.querySelector(\"a[data-goal='emergency-fund']\")");
    await waitFor(send, "document.body.innerText.includes('Emergency fund') && document.body.innerText.includes('Emergency savings') && document.body.innerText.includes('$220') && !document.body.innerText.includes('Select a goal') ? 'yes' : ''", "desktop detail");
    assert.equal(await evalPage(send, "document.body.innerText.includes('Target') ? 'yes' : 'no'"), "no");
    await shot(send, "G04-app.png");
    ws.close();
  } finally {
    await shutdown();
  }
});

test("an empty goals response shows the add action and not the seed", { skip }, async () => {
  const cookie = await boot({ JOEHUB_SEED_GOALS: "0" });
  try {
    const { send, ws } = await attach(cookie);
    await open(send, "/finance/goals", 390, 900);
    await waitFor(send, "document.body.innerText.includes('No goals yet') ? 'yes' : ''", "empty");
    assert.equal(await evalPage(send, "document.querySelector('[data-goals]')?.getAttribute('data-goals')"), "empty");
    assert.equal(await evalPage(send, "document.body.innerText.includes('$740') || document.body.innerText.includes('Emergency fund') ? 'yes' : 'no'"), "no");
    const height = await evalPage(send, "document.querySelector('[data-empty] button')?.getBoundingClientRect().height || 0");
    assert.ok(height >= 44);
    await shot(send, "G02-app.png");
    await pressLabel(send, evalPage, "Add a goal");
    await waitFor(send, "document.querySelector('[data-sheet]') && document.getElementById('goal-name') ? 'yes' : ''", "add sheet");
    const header = await evalPage(send, `(() => {
      const sheet = document.querySelector('[data-sheet]');
      const buttons = [...sheet.querySelectorAll('button')].filter((el) => ['Cancel', 'Save'].includes((el.innerText || '').trim()));
      const name = document.getElementById('goal-name');
      const saved = document.getElementById('goal-saved');
      const tops = buttons.map((el) => Math.round(el.getBoundingClientRect().top));
      return {
        labels: buttons.map((el) => (el.innerText || '').trim()),
        sameRow: Math.max(...tops) - Math.min(...tops) < 8,
        nameSize: name ? parseFloat(getComputedStyle(name).fontSize) : 0,
        savedMode: saved ? saved.getAttribute('inputmode') : '',
        savedHint: saved ? saved.getAttribute('enterkeyhint') : '',
        monthlyHint: document.getElementById('goal-monthly')?.getAttribute('enterkeyhint') || '',
      };
    })()`);
    assert.deepEqual(header.labels, ["Cancel", "Save"]);
    assert.equal(header.sameRow, true);
    assert.ok(header.nameSize >= 16);
    assert.equal(header.savedMode, "decimal");
    assert.equal(header.savedHint, "next");
    assert.equal(header.monthlyHint, "done");
    await pressLabel(send, evalPage, "Save");
    await waitFor(send, "document.body.innerText.includes('Enter an amount.') ? 'yes' : ''", "blank amount");
    await evalPage(send, setField("goal-name", "Cabin fund"));
    await evalPage(send, setField("goal-saved", "100"));
    await evalPage(send, setField("goal-target", "500"));
    await evalPage(send, setField("goal-note", "Later"));
    await evalPage(send, setField("goal-monthly", "10"));
    await shot(send, "G02-add-app.png");
    await pressLabel(send, evalPage, "Save");
    await waitFor(send, "document.body.innerText.includes('Cabin fund') && document.body.innerText.includes('$100') && document.body.innerText.includes('$10 / mo') && !document.querySelector('[data-sheet]') ? 'yes' : ''", "saved");
    ws.close();
  } finally {
    await shutdown();
  }
});
