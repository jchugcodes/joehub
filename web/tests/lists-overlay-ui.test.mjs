import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { acquireBrowserLock, reservePort, spawnLogged, startChrome, stopProcess, waitForChrome, waitForHttp } from "./support/harness.mjs";
import { pointerClick, pressLabel } from "./support/pointer.mjs";

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
      JOEHUB_SESSION_SECRET: "lists-overlay-secret-value",
      JOEHUB_SCREENSHOTS: "1",
    },
  });
  child = started.child;
  await waitForHttp(`${base()}/tasks`, {
    child,
    log: started.log,
    accept: (response) => response.status === 200 && (response.headers.get("content-type") || "").includes("text/html"),
  });
  chrome = startChrome(chromeBin, cdp, `/tmp/chrome-lists-overlay-${process.pid}`);
  await waitForChrome(cdp, chrome);
  const logged = await fetch(`${base()}/api/session/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: "synthetic", password: "synthetic", device_label: "lists-overlay" }),
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

async function press(send, label) {
  if (typeof label === "string" && label.startsWith("Edit ")) {
    if ((await evalPage(send, "document.querySelector(\"[data-overlay='panel']\") ? 'yes' : ''")) !== "yes") {
      assert.equal(await pressLabel(send, evalPage, label), "yes");
      if ((await evalPage(send, "document.getElementById('task-title') ? 'yes' : ''")) === "yes") return "yes";
    }
    await waitFor(send, settled, "task detail");
    if ((await evalPage(send, "document.getElementById('task-title') ? 'yes' : ''")) === "yes") return "yes";
    assert.equal(await pressLabel(send, evalPage, "Edit"), "yes");
    await waitFor(send, "document.getElementById('task-title') ? 'yes' : ''", "edit form");
    return "yes";
  }
  return pressLabel(send, evalPage, label);
}

async function pressStarts(send, name) {
  const label = await evalPage(
    send,
    `(() => {
      const node = [...document.querySelectorAll("[data-overlay='panel'] button")].find((el) => (el.innerText || "").replace(/\\s+/g, " ").trim().startsWith(${JSON.stringify(name)}));
      return node ? (node.innerText || "").replace(/\\s+/g, " ").trim() : "";
    })()`,
  );
  assert.ok(label, `missing ${name}`);
  assert.equal(await press(send, label), "yes");
}

test("manage lists overlay, colorless ring, and primary delete", { timeout: 180000, skip }, async () => {
  let page = null;
  try {
    const cookie = await boot();
    const auth = { cookie: `joehub_session=${cookie}`, "content-type": "application/json" };
    const parcel = await fetch(`${base()}/api/lists`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ name: "Parcel", color: "#227777" }),
    });
    assert.equal(parcel.status, 201, await parcel.clone().text());
    const inboxResponse = await fetch(`${base()}/api/lists`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ name: "Inbox", color: "#5B45B5" }),
    });
    assert.equal(inboxResponse.status, 201, await inboxResponse.clone().text());
    const inbox = await inboxResponse.json();
    const cleared = await fetch(`${base()}/api/lists/${inbox.id}`, {
      method: "PATCH",
      headers: auth,
      body: JSON.stringify({ color: null }),
    });
    assert.equal(cleared.status, 200, await cleared.clone().text());
    const created = await fetch(`${base()}/api/tasks`, {
      method: "POST",
      headers: { ...auth, "idempotency-key": "lists-overlay-task" },
      body: JSON.stringify({ title: "File the sample note", project: inbox.id, status: "To do" }),
    });
    assert.equal(created.status, 201, await created.clone().text());

    page = await openPage(cookie);
    const { send } = page;
    await size(send, 390, 844);
    await send("Page.navigate", { url: `${base()}/tasks` });
    await waitFor(send, "document.querySelector(\"[data-ready='true'] h1\")?.textContent === 'Tasks' ? 'yes' : ''", "tasks");
    await waitFor(send, "document.body.innerText.includes('File the sample note') ? 'yes' : ''", "sample task");

    assert.equal(await press(send, "Edit File the sample note"), "yes");
    await waitFor(send, "document.getElementById('task-project') ? 'yes' : ''", "list field");
    assert.equal(await press(send, "task-project"), "yes");
    await waitFor(send, "document.body.innerText.includes('Manage lists') && document.querySelector(\"[data-swatch='ring']\") ? 'yes' : ''", "list menu");
    const menu = JSON.parse(await evalPage(send, `(() => {
      const row = [...document.querySelectorAll("[role='listbox'] button")].find((el) => (el.innerText || "").trim().startsWith("Inbox"));
      const ring = row?.querySelector("[data-swatch='ring']");
      const fill = [...document.querySelectorAll("[role='listbox'] [data-swatch='fill']")][0];
      const ringStyle = ring ? getComputedStyle(ring) : null;
      const fillStyle = fill ? getComputedStyle(fill) : null;
      return JSON.stringify({
        ring: ringStyle ? ringStyle.backgroundColor : "",
        shadow: ringStyle ? ringStyle.boxShadow : "",
        fill: fillStyle ? fillStyle.backgroundColor : "",
      });
    })()`));
    assert.equal(menu.ring, "rgba(0, 0, 0, 0)");
    assert.match(menu.shadow, /1\.5px/);
    assert.match(menu.shadow, /201,\s*206,\s*200/);
    assert.notEqual(menu.fill, "rgba(0, 0, 0, 0)");

    assert.equal(await press(send, "Manage lists"), "yes");
    await waitFor(send, `${settled} && document.querySelector("[data-overlay='panel'] h2")?.textContent === "Lists" ? 'yes' : ''`, "lists home");
    const home = JSON.parse(await evalPage(send, `(() => {
      const heading = document.querySelector("[data-overlay='panel'] h2");
      const ring = document.querySelector("[data-overlay='panel'] [data-swatch='ring']");
      const style = ring ? getComputedStyle(ring) : null;
      return JSON.stringify({
        align: heading ? getComputedStyle(heading).textAlign : "",
        close: document.querySelector("[data-overlay='panel'] [aria-label='Close']") ? "yes" : "",
        shadow: style ? style.boxShadow : "",
        fill: style ? style.backgroundColor : "",
      });
    })()`));
    assert.equal(home.align, "left");
    assert.equal(home.close, "yes");
    assert.equal(home.fill, "rgba(0, 0, 0, 0)");
    assert.match(home.shadow, /1\.5px/);
    assert.match(home.shadow, /201,\s*206,\s*200/);

    await pressStarts(send, "Inbox");
    await waitFor(send, `${stackSettled} && document.getElementById("list-name") && document.querySelector("[data-overlay='panel'] h2")?.textContent === "Edit list" ? 'yes' : ''`, "edit list");
    const edit = JSON.parse(await evalPage(send, `(() => {
      const input = document.getElementById("list-name");
      const style = input ? getComputedStyle(input) : null;
      const ring = document.querySelector("[data-list-color='none'] [data-swatch='ring']");
      const ringStyle = ring ? getComputedStyle(ring) : null;
      return JSON.stringify({
        id: document.activeElement?.id || "",
        sheet: document.querySelector("[data-overlay='panel']")?.getAttribute("data-sheet") || "",
        width: style ? style.borderTopWidth : "",
        color: style ? style.borderTopColor : "",
        ring: ringStyle ? ringStyle.backgroundColor : "",
        shadow: ringStyle ? ringStyle.boxShadow : "",
      });
    })()`));
    assert.equal(edit.id, "list-name");
    assert.equal(edit.sheet, "form");
    assert.equal(edit.width, "2px");
    assert.equal(edit.color, "rgb(31, 42, 36)");
    assert.equal(edit.ring, "rgba(0, 0, 0, 0)");
    assert.match(edit.shadow, /1\.5px/);

    assert.equal(await press(send, "Delete list"), "yes");
    if ((await evalPage(send, "document.querySelector(\"[role='alertdialog']\") ? 'yes' : ''")) !== "yes") {
      await new Promise((resolve) => setTimeout(resolve, 300));
      if ((await evalPage(send, "document.querySelector(\"[role='alertdialog']\") ? 'yes' : ''")) !== "yes") {
        assert.equal(await press(send, "Delete list"), "yes");
      }
    }
    await waitFor(send, "document.querySelector(\"[role='alertdialog']\")?.innerText.includes('Delete this list?') && document.body.innerText.includes('moves to No list.') ? 'yes' : ''", "delete confirm");
    const confirm = JSON.parse(await evalPage(send, `(() => {
      const dialog = document.querySelector("[role='alertdialog']");
      const button = [...dialog.querySelectorAll("button")].find((el) => (el.innerText || "").trim() === "Delete");
      const style = button ? getComputedStyle(button) : null;
      const order = [...dialog.querySelectorAll("button")].map((el) => (el.innerText || "").trim());
      return JSON.stringify({
        copy: dialog?.innerText || "",
        color: style ? style.color : "",
        background: style ? style.backgroundColor : "",
        order,
      });
    })()`));
    assert.match(confirm.copy, /moves to No list\./);
    assert.equal(confirm.color, "rgb(46, 139, 106)");
    assert.equal(confirm.background, "rgba(0, 0, 0, 0)");
    assert.deepEqual(confirm.order, ["Delete", "Cancel"]);
    assert.equal(await pressLabel(send, evalPage, "Cancel", "document.querySelector(\"[role='alertdialog']\")"), "yes");
    await waitFor(send, "document.querySelector(\"[role='alertdialog']\") ? '' : 'edit'", "dialog closed");
    assert.equal(await press(send, "Cancel"), "yes");
    await waitFor(send, `${settled} && document.querySelector("[data-overlay='panel'] h2")?.textContent === "Lists" ? 'yes' : ''`, "back to lists");
    const selected = JSON.parse(await evalPage(send, `(() => {
      const row = document.querySelector("[data-overlay='panel'] [data-selected='true']");
      const style = row ? getComputedStyle(row) : null;
      return JSON.stringify({
        name: row ? (row.innerText || "").replace(/\\s+/g, " ").trim() : "",
        background: style ? style.backgroundColor : "",
      });
    })()`));
    assert.match(selected.name, /^Inbox/);
    assert.match(selected.background, /46,\s*139,\s*106/);
    await evalPage(send, "history.pushState(null, '', '/tasks?xe=offline'); 'yes'");
    await waitFor(send, `${settled} && document.querySelector("[data-overlay='panel'] [data-state='offline']")?.textContent.includes("You are offline.") ? 'yes' : ''`, "offline banner");
    assert.equal(await evalPage(send, "[...document.querySelectorAll(\"[data-overlay='panel'] button\")].some((button) => (button.innerText || \"\").trim().startsWith(\"Inbox\") && button.disabled) ? 'yes' : 'no'"), "yes");
    await evalPage(send, "history.pushState(null, '', '/tasks'); 'yes'");
    await waitFor(send, `${settled} && !document.querySelector("[data-overlay='panel'] [data-state='offline']") ? 'yes' : ''`, "back online");

    assert.equal(await pressLabel(send, evalPage, "Close"), "yes");
    await waitFor(send, `${settled} && document.getElementById('task-title') ? 'yes' : ''`, "task form");
    assert.equal(await press(send, "Cancel"), "yes");
    if ((await evalPage(send, "document.querySelector(\"[data-overlay='panel']\") ? 'yes' : ''")) === "yes") {
      await waitFor(send, settled, "task detail");
      assert.equal(await pressLabel(send, evalPage, "Close"), "yes");
    }
    await waitFor(send, "document.querySelector(\"[role='dialog']\") ? '' : 'closed'", "closed");

    assert.equal(await press(send, "List"), "yes");
    await waitFor(send, "document.querySelector(\"[aria-label='Inbox']\") ? 'yes' : ''", "list group");
    const plain = JSON.parse(await evalPage(send, `(() => {
      const row = [...document.querySelectorAll("[aria-label='Inbox'] li")].find((el) => el.innerText.includes("File the sample note"));
      const style = row ? getComputedStyle(row) : null;
      return JSON.stringify({
        shadow: style ? style.boxShadow : "missing",
        inline: row ? row.getAttribute("style") || "" : "missing",
      });
    })()`));
    assert.equal(plain.shadow, "none");
    assert.equal(plain.inline.includes("inset 4px"), false);
    assert.equal(plain.inline.includes("color-mix"), false);

    await size(send, 1280, 860);
    await send("Page.navigate", { url: `${base()}/tasks` });
    await waitFor(send, "document.querySelector(\"[data-ready='true'] h1\")?.textContent === 'Tasks' ? 'yes' : ''", "desk tasks");
    assert.equal(await press(send, "Edit File the sample note"), "yes");
    await waitFor(send, `${settled} && document.getElementById('task-project') ? 'yes' : ''`, "desk edit");
    assert.equal(await press(send, "task-project"), "yes");
    assert.equal(await press(send, "Manage lists"), "yes");
    await waitFor(send, `${settled} && document.querySelector("[data-overlay='desktop']") && document.querySelector("[data-overlay='panel'] h2")?.textContent === "Lists" ? 'yes' : ''`, "desk lists");
  } finally {
    if (page) await page.close();
    await stopProcess(chrome);
    await stopProcess(child);
    await release();
  }
});
