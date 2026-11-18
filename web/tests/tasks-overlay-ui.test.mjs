import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { acquireBrowserLock, reservePort, spawnLogged, startChrome, stopProcess, waitForChrome, waitForHttp } from "./support/harness.mjs";
import { pressLabel } from "./support/pointer.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const ARTIFACTS = "/opt/cursor/artifacts";
const chromeBin = ["google-chrome", "google-chrome-stable"].find((bin) => spawnSync("which", [bin]).status === 0);
const skip = chromeBin ? false : "google-chrome is not installed";
const TASK = "Pack the example bag";

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
      JOEHUB_SESSION_SECRET: "tasks-overlay-secret",
      JOEHUB_SCREENSHOTS: "1",
      JOEHUB_SEED_TASKS: "1",
    },
  });
  child = started.child;
  await waitForHttp(`${base()}/tasks`, {
    child,
    log: started.log,
    accept: (response) => response.status === 200 && (response.headers.get("content-type") || "").includes("text/html"),
  });
  chrome = startChrome(chromeBin, cdp, `/tmp/chrome-tasks-overlay-${process.pid}`);
  await waitForChrome(cdp, chrome);
  const logged = await fetch(`${base()}/api/session/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: "synthetic", password: "synthetic", device_label: "tasks-overlay" }),
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
    body = await evalPage(send, "document.body ? document.body.innerText.slice(0, 400) : ''");
  } catch {
    body = last;
  }
  throw new Error(`timed out waiting for ${label}; last=${last}; body=${body}`);
}

async function size(send, width, height) {
  await send("Emulation.setDeviceMetricsOverride", {
    width,
    height,
    deviceScaleFactor: 1,
    mobile: width < 500,
  });
}

test("task overlay shows the detail, marks done, and pushes edit", { skip, timeout: 240000 }, async () => {
  mkdirSync(ARTIFACTS, { recursive: true });
  let page = null;
  try {
  const secret = await boot();
  page = await openPage(secret);
    for (const viewport of [
      { width: 1280, height: 800, pin: true },
      { width: 390, height: 844, pin: false },
    ]) {
      await size(page.send, viewport.width, viewport.height);
      await page.send("Page.navigate", { url: `${base()}/tasks` });
      await waitFor(page.send, "document.querySelector(\"[data-ready='true'] h1\")?.textContent === 'Tasks' ? 'yes' : ''", "tasks");
      await waitFor(page.send, `document.body.innerText.includes(${JSON.stringify(TASK)}) ? 'yes' : ''`, "task list");
      assert.equal(await pressLabel(page.send, evalPage, `Edit ${TASK}`), "yes");
      await waitFor(page.send, `(() => {
        const panel = document.querySelector("[data-overlay='panel']");
        if (!panel || panel.getAttribute("data-state") !== "open" || !panel.querySelector("[data-task-detail='true']")) return "";
        return panel.getAnimations({ subtree: true }).some((animation) => animation.playState === "running") ? "" : "yes";
      })()`, "detail");
      const detail = JSON.parse(await evalPage(page.send, `(() => {
        const root = document.querySelector("[data-task-detail='true']");
        const panel = document.querySelector("[data-overlay='panel']");
        const mark = [...root.querySelectorAll("button")].find((button) => (button.innerText || "").trim() === "Mark done");
        return JSON.stringify({
          title: root.querySelector("h2")?.textContent || "",
          text: root.innerText,
          heading: document.querySelector("[role='dialog'] h2")?.textContent || "",
          mark: mark ? Math.round(mark.getBoundingClientRect().height) : 0,
          state: panel?.getAttribute("data-state") || "",
        });
      })()`));
      assert.equal(detail.title, TASK);
      assert.equal(detail.heading, TASK);
      assert.match(detail.text, /Errands/);
      assert.match(detail.text, /Due Nov 15/);
      assert.match(detail.text, /Synthetic task\. Not a real errand\./);
      assert.ok(detail.mark >= 44, `mark done height ${detail.mark}`);
      assert.equal(detail.state, "open");

      if (viewport.pin) {
        const pin = await evalPage(page.send, `(() => {
          const panel = document.querySelector("[data-overlay='desktop']");
          const bar = document.querySelector("nav[aria-label='Primary']");
          if (!panel || !bar) return "missing";
          const box = panel.getBoundingClientRect();
          const nav = bar.getBoundingClientRect();
          return box.bottom <= nav.top + 1 && box.bottom >= nav.top - 2 ? "clear" : JSON.stringify({ bottom: box.bottom, nav: nav.top });
        })()`);
        assert.equal(pin, "clear");
      }

      assert.equal(await pressLabel(page.send, evalPage, "Edit"), "yes");
      await waitFor(page.send, `(() => {
        const panel = document.querySelector("[data-overlay='panel']");
        if (!panel || !document.getElementById("task-title")) return "";
        return panel.getAnimations({ subtree: true }).some((animation) => animation.playState === "running") ? "" : "yes";
      })()`, "edit form");
      const opened = JSON.parse(await evalPage(page.send, `(() => {
        const input = document.getElementById("task-title");
        const panel = document.querySelector("[data-overlay='panel']");
        return JSON.stringify({
          value: input.value,
          mode: input.getAttribute("inputmode"),
          hint: input.getAttribute("enterkeyhint"),
          size: parseFloat(getComputedStyle(input).fontSize),
          heading: document.querySelector("[role='dialog'] h2")?.textContent || "",
          sheet: panel?.getAttribute("data-sheet") || "",
        });
      })()`));
      assert.equal(opened.value, TASK);
      assert.equal(opened.mode, "text");
      assert.equal(opened.hint, "next");
      assert.ok(opened.size >= 16, `input size ${opened.size}`);
      assert.equal(opened.heading, "Edit task");
      assert.equal(opened.sheet, "form");

      assert.equal(await pressLabel(page.send, evalPage, "Cancel"), "yes");
      await waitFor(page.send, `(() => {
        const panel = document.querySelector("[data-overlay='panel']");
        if (!panel || document.getElementById("task-title") || !panel.querySelector("[data-task-detail='true']")) return "";
        return panel.getAnimations({ subtree: true }).some((animation) => animation.playState === "running") ? "" : "detail";
      })()`, "back to detail");
    }

    assert.equal(await pressLabel(page.send, evalPage, "Mark done"), "yes");
    await waitFor(page.send, "[...document.querySelectorAll(\"[data-task-detail='true'] button\")].some((button) => (button.innerText || '').trim() === 'Reopen') ? 'yes' : ''", "marked done");
  } finally {
    if (page) await page.close();
    await stopProcess(chrome);
    await stopProcess(child);
    await release();
  }
});
