import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { acquireBrowserLock, reservePort, spawnLogged, startChrome, stopProcess, waitForChrome, waitForHttp } from "./support/harness.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
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
      JOEHUB_SESSION_SECRET: "debts-overlay-secret-value",
      JOEHUB_SCREENSHOTS: "1",
    },
  });
  child = started.child;
  await waitForHttp(`${base()}/finance/debts`, {
    child,
    log: started.log,
    accept: (response) => response.status === 200 && (response.headers.get("content-type") || "").includes("text/html"),
  });
  chrome = startChrome(chromeBin, cdp, `/tmp/chrome-debts-overlay-${process.pid}`);
  await waitForChrome(cdp, chrome);
  const logged = await fetch(`${base()}/api/session/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: "synthetic", password: "synthetic", device_label: "debts-overlay" }),
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
  await send("Runtime.enable");
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
  const deadline = Date.now() + 20000;
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
  const body = await evalPage(send, "document.body ? document.body.innerText.slice(0, 500) : ''").catch(() => last);
  throw new Error(`timed out waiting for ${label}; last=${last}; body=${body}`);
}

async function size(send, width, height) {
  await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: width < 500 });
}

const settled = `(() => { const panel = document.querySelector("[data-overlay='panel']"); if (!panel) return ""; const box = panel.getBoundingClientRect(); const busy = panel.getAnimations({ subtree: true }).some((animation) => animation.playState === "running"); return !busy && panel.getAttribute("data-state") === "open" && box.width > 200 ? "yes" : ""; })()`;

test("debts overlay is a read-only detail", { timeout: 180000, skip }, async () => {
  let page = null;
  try {
    const cookie = await boot();
    page = await openPage(cookie);
    const { send } = page;
    await size(send, 390, 844);
    await send("Page.navigate", { url: `${base()}/finance/debts` });
    await waitFor(send, "document.querySelector(\"[data-ready='true'] h1\")?.textContent === 'Finance' ? 'yes' : ''", "debts");
    await waitFor(send, "document.body.innerText.includes('Student loans') ? 'yes' : ''", "student group");
    await evalPage(send, "[...document.querySelectorAll('button')].find((el) => (el.innerText || '').includes('Student loans'))?.click()");
    await waitFor(send, "document.querySelector(\"[data-debt='acct-student-15']\") ? 'yes' : ''", "loan row");
    const listed = await evalPage(send, "document.body.innerText");
    assert.match(listed, /\$155,664\.00/);
    assert.doesNotMatch(listed, /4,204/);
    assert.equal(await evalPage(send, "document.querySelector(\"[data-debt='acct-student-15']\")?.classList.contains('row-selected') ? 'yes' : 'no'"), "no");

    await evalPage(send, "document.querySelector(\"[data-debt='acct-student-15']\")?.scrollIntoView({ block: 'center' })");
    await evalPage(send, "document.querySelector(\"[data-debt='acct-student-15']\")?.click()");
    await waitFor(send, `${settled} && document.querySelector("[data-debt-detail]") ? "yes" : ""`, "debt detail");
    const detail = JSON.parse(await evalPage(send, `(() => {
      const panel = document.querySelector("[data-overlay='panel']");
      const heading = panel?.querySelector("h2");
      const body = panel?.querySelector("[data-stack]")?.firstElementChild;
      const close = panel?.querySelector("[aria-label='Close']");
      const row = document.querySelector("[data-debt='acct-student-15']");
      const rows = [...(panel?.querySelectorAll("dl div") || [])].map((el) => (el.innerText || "").replace(/\\s+/g, " ").trim());
      const controls = [...(panel?.querySelectorAll("button") || [])].map((el) => (el.getAttribute("aria-label") || el.innerText || "").replace(/\\s+/g, " ").trim());
      return JSON.stringify({
        title: heading ? heading.textContent : "",
        align: heading ? getComputedStyle(heading).textAlign : "",
        width: panel ? Math.round(panel.getBoundingClientRect().width) : 0,
        pad: body ? getComputedStyle(body).paddingLeft : "",
        padY: body ? getComputedStyle(body).paddingTop : "",
        balance: panel?.querySelector("[data-debt-balance]")?.textContent || "",
        asOf: panel?.innerText?.includes("As of Nov 11, 2026, 8:30 AM") ? "yes" : "no",
        rows,
        controls,
        text: panel?.innerText || "",
        focusRing: close?.matches(":focus-visible") ? "yes" : "no",
        row: row?.classList.contains("row-selected") ? "yes" : "no",
        rowH: row ? Math.round(row.getBoundingClientRect().height) : 0,
      });
    })()`));
    assert.equal(detail.title, "Federal loan 15");
    assert.equal(detail.align, "left");
    assert.equal(detail.width, 342);
    assert.equal(detail.pad, "20px");
    assert.equal(detail.padY, "16px");
    assert.equal(detail.balance, "$11,460.00");
    assert.equal(detail.asOf, "yes");
    assert.deepEqual(detail.rows, ["Type Graduate", "Interest rate 3.73%", "Minimum payment $85.95", "Next due Dec 1, 2026", "Servicer Example Servicer"]);
    assert.deepEqual(detail.controls, ["Close"]);
    assert.doesNotMatch(detail.text, /No notes/);
    assert.doesNotMatch(detail.text, /4,204/);
    assert.equal(detail.focusRing, "no");
    assert.equal(detail.row, "yes");
    assert.ok(detail.rowH >= 44);

    await size(send, 390, 844);
    await send("Page.navigate", { url: `${base()}/finance/debts/acct-student-15?xe=offline` });
    await waitFor(send, `${settled} && document.querySelector("[data-overlay='panel'] [data-state='offline']") ? "yes" : ""`, "offline banner");
    const offline = await evalPage(send, `(() => {
      const panel = document.querySelector("[data-overlay='panel']");
      const banner = panel?.querySelector("[data-state='offline']");
      const controls = [...(panel?.querySelectorAll("button") || [])].map((el) => (el.innerText || el.getAttribute("aria-label") || "").trim());
      return JSON.stringify({ banner: banner?.textContent?.trim() || "", controls });
    })()`);
    const offlineBody = JSON.parse(offline);
    assert.equal(offlineBody.banner, "You are offline.");
    assert.deepEqual(offlineBody.controls, ["Close"]);

    await size(send, 1280, 800);
    await send("Page.navigate", { url: `${base()}/finance/debts/acct-student-15` });
    await waitFor(send, `${settled} && document.querySelector("[data-overlay='desktop']") ? "yes" : ""`, "desktop pin");
    const desktop = JSON.parse(await evalPage(send, `(() => {
      const panel = document.querySelector("[data-overlay='panel']");
      const heading = panel?.querySelector("h2");
      const pin = document.querySelector("[data-overlay='desktop']");
      return JSON.stringify({
        title: heading ? heading.textContent : "",
        align: heading ? getComputedStyle(heading).textAlign : "",
        pin: pin ? "yes" : "",
      });
    })()`));
    assert.equal(desktop.title, "Federal loan 15");
    assert.equal(desktop.align, "left");
    assert.equal(desktop.pin, "yes");
  } finally {
    if (page) await page.close();
    await stopProcess(chrome);
    await stopProcess(child);
    await release();
  }
});
