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
const stackSettled = `(() => { const panel = document.querySelector("[data-overlay='panel']"); if (!panel || panel.getAttribute("data-state") !== "open") return ""; const stack = panel.querySelector("[data-stack]"); if (!stack || stack.getAttribute("data-stack") === "idle") return ""; return panel.getAnimations({ subtree: true }).some((animation) => animation.playState === "running") ? "" : "yes"; })()`;

test("debts overlay detail, edit, and delete confirm", { timeout: 180000, skip }, async () => {
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
      const edit = panel?.querySelector("[data-primary='edit']");
      const row = document.querySelector("[data-debt='acct-student-15']");
      return JSON.stringify({
        title: heading ? heading.textContent : "",
        align: heading ? getComputedStyle(heading).textAlign : "",
        width: panel ? Math.round(panel.getBoundingClientRect().width) : 0,
        pad: body ? getComputedStyle(body).paddingLeft : "",
        padY: body ? getComputedStyle(body).paddingTop : "",
        pill: panel?.querySelector("[data-debt-type]")?.textContent || "",
        meta: panel?.querySelector("[data-item-meta]")?.textContent || "",
        notes: panel?.querySelector("[data-state='empty']")?.textContent || "",
        balance: panel?.querySelector("[data-debt-balance]")?.textContent || "",
        edit: edit ? Math.round(edit.getBoundingClientRect().height) : 0,
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
    assert.equal(detail.pill, "Graduate");
    assert.equal(detail.meta, "Graduate · 3.73%");
    assert.equal(detail.notes, "No notes.");
    assert.equal(detail.balance, "$11,460.00");
    assert.equal(detail.edit, 44);
    assert.equal(detail.focusRing, "no");
    assert.equal(detail.row, "yes");
    assert.ok(detail.rowH >= 44);

    await evalPage(send, "document.querySelector(\"[data-overlay='panel'] [data-primary='edit']\")?.click()");
    await waitFor(send, `${stackSettled} && document.getElementById("debt-name") ? "yes" : ""`, "edit form");
    await send("Emulation.setFocusEmulationEnabled", { enabled: true });
    const edit = JSON.parse(await evalPage(send, `(() => {
      const panel = document.querySelector("[data-overlay='panel']");
      const name = document.getElementById("debt-name");
      const style = name ? getComputedStyle(name) : null;
      const heading = panel?.querySelector("h2");
      const del = [...(panel?.querySelectorAll("button") || [])].find((el) => (el.innerText || "").trim() === "Delete");
      const nameBox = name?.getBoundingClientRect();
      const delBox = del?.getBoundingClientRect();
      return JSON.stringify({
        title: heading ? heading.textContent : "",
        focused: document.activeElement === name ? "yes" : "no",
        border: style ? style.borderTopWidth : "",
        color: style ? style.borderTopColor : "",
        below: Boolean(nameBox && delBox && delBox.top >= nameBox.bottom),
        value: name ? name.value : "",
      });
    })()`));
    assert.equal(edit.title, "Edit debt");
    assert.equal(edit.focused, "yes");
    assert.equal(edit.border, "2px");
    assert.equal(edit.color, "rgb(31, 42, 36)");
    assert.equal(edit.below, true);
    assert.equal(edit.value, "Federal loan 15");

    await evalPage(send, "document.querySelector(\"[data-overlay='panel'] button[type='submit']\")?.click()");
    await waitFor(send, "document.querySelector(\"[data-overlay='panel'] [role='alert']\")?.textContent?.includes('Ledger') ? 'yes' : ''", "ledger save");

    await evalPage(send, "[...document.querySelectorAll(\"[data-overlay='panel'] button\")].find((el) => (el.innerText || '').trim() === 'Delete')?.click()");
    await waitFor(send, "document.querySelector(\"[role='alertdialog']\") ? 'yes' : ''", "delete confirm");
    const confirm = JSON.parse(await evalPage(send, `(() => {
      const dialog = document.querySelector("[role='alertdialog']");
      const buttons = [...(dialog?.querySelectorAll("button") || [])];
      const del = buttons.find((el) => (el.innerText || "").trim() === "Delete");
      const style = del ? getComputedStyle(del) : null;
      return JSON.stringify({
        title: dialog?.querySelector("h2")?.textContent || "",
        detail: dialog?.querySelector("p")?.textContent || "",
        order: buttons.map((el) => (el.innerText || "").trim()),
        color: style ? style.color : "",
        background: style ? style.backgroundColor : "",
      });
    })()`));
    assert.equal(confirm.title, "Delete this debt?");
    assert.equal(confirm.detail, "Federal loan 15");
    assert.deepEqual(confirm.order, ["Delete", "Cancel"]);
    assert.equal(confirm.color, "rgb(255, 255, 255)");
    assert.equal(confirm.background, "rgb(224, 122, 95)");

    await evalPage(send, "[...document.querySelectorAll(\"[role='alertdialog'] button\")].find((el) => (el.innerText || '').trim() === 'Delete')?.click()");
    await waitFor(send, "document.querySelector(\"[role='alertdialog']\")?.innerText?.includes('Ledger') ? 'yes' : ''", "ledger delete");
    assert.match(await evalPage(send, "document.body.innerText"), /Federal loan 15/);
    assert.doesNotMatch(await evalPage(send, "document.body.innerText"), /4,204/);

    await size(send, 390, 844);
    await send("Page.navigate", { url: `${base()}/finance/debts/acct-student-15?xe=offline` });
    await waitFor(send, `${settled} && document.querySelector("[data-state='offline']") ? "yes" : ""`, "offline banner");
    const offline = JSON.parse(await evalPage(send, `(() => {
      const edit = document.querySelector("[data-primary='edit']");
      const banner = document.querySelector("[data-overlay='panel'] [data-state='offline']");
      return JSON.stringify({
        disabled: edit?.disabled ? "yes" : "no",
        banner: banner?.textContent?.trim() || "",
      });
    })()`));
    assert.equal(offline.disabled, "yes");
    assert.equal(offline.banner, "You are offline.");

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
