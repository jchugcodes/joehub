import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { acquireBrowserLock, reservePort, spawnLogged, startChrome, stopProcess, waitForChrome, waitForHttp } from "./support/harness.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const ARTIFACTS = "/opt/cursor/artifacts";
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
      JOEHUB_SESSION_SECRET: "tasks-browser-secret-value",
      JOEHUB_SCREENSHOTS: "1",
    },
  });
  child = started.child;
  await waitForHttp(`${base()}/tasks`, {
    child,
    log: started.log,
    accept: (response) => response.status === 200 && (response.headers.get("content-type") || "").includes("text/html"),
  });
  const health = await fetch(`${base()}/api/health`, { cache: "no-store" });
  assert.equal(health.status, 200);
  chrome = startChrome(chromeBin, cdp, `/tmp/chrome-tasks-${process.pid}`);
  await waitForChrome(cdp, chrome);
  const logged = await fetch(`${base()}/api/session/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: "synthetic", password: "synthetic", device_label: "tasks-browser" }),
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
  await send("Page.addScriptToEvaluateOnNewDocument", {
    source: `(() => {
      const orig = EventTarget.prototype.addEventListener;
      EventTarget.prototype.addEventListener = function (type, listener, options) {
        if (type === "online") {
        window.__joehubIgnoredOnline = (window.__joehubIgnoredOnline || 0) + 1;
        return;
      }
        return orig.call(this, type, listener, options);
      };
    })();`,
  });
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
    body = await evalPage(send, "document.body ? document.body.innerText.slice(0, 400) : ''");
  } catch {
    body = last;
  }
  throw new Error(`timed out waiting for ${label}; last=${last}; body=${body}`);
}

async function size(send, width, height = 900) {
  await send("Emulation.setDeviceMetricsOverride", {
    width,
    height,
    deviceScaleFactor: 1,
    mobile: width < 500,
  });
  const onTasks = await evalPage(send, "document.querySelector('[data-layout]') ? 'yes' : ''");
  if (onTasks) {
    await waitFor(
      send,
      `document.querySelector("[data-layout='${width >= 1024 ? "panel" : "sheet"}']") ? 'yes' : ''`,
      `layout ${width}`,
    );
  }
}

async function shot(send, name) {
  await new Promise((resolve) => setTimeout(resolve, 100));
  const image = await send("Page.captureScreenshot", { format: "png" });
  writeFileSync(`${ARTIFACTS}/${name}`, Buffer.from(image.result.data, "base64"));
}

function click(label) {
  return `(() => {
    const node = [...document.querySelectorAll("button")].find((el) => (el.innerText || "").trim() === ${JSON.stringify(label)});
    if (!node) return "";
    node.click();
    return "yes";
  })()`;
}

async function gotoTasks(send, width, height = 900) {
  await size(send, width, height);
  await send("Page.navigate", { url: `${base()}/tasks` });
  await waitFor(send, "document.querySelector(\"[data-ready='true'] h1\")?.textContent === 'Tasks' ? 'yes' : ''", "tasks");
}

function buttonInView(label) {
  return `(() => {
    const node = [...document.querySelectorAll("button")].find((el) => (el.innerText || "").trim() === ${JSON.stringify(label)});
    if (!node) return "";
    const rect = node.getBoundingClientRect();
    const inside = rect.top >= 0 && rect.bottom <= window.innerHeight && rect.left >= 0 && rect.right <= window.innerWidth && rect.height > 0;
    return inside ? "yes" : JSON.stringify({ top: rect.top, bottom: rect.bottom, height: window.innerHeight });
  })()`;
}

test.after(async () => {
  await stopProcess(chrome);
  await stopProcess(child);
  await release();
});

test("tasks add and the unfinished list work at phone and desktop widths", { timeout: 300000, skip }, async () => {
  mkdirSync(ARTIFACTS, { recursive: true });
  const cookie = await boot();
  const icon = await fetch(`${base()}/favicon.ico`);
  assert.equal(icon.status, 200);
  assert.ok((await icon.arrayBuffer()).byteLength > 0);
  const page = await openPage(cookie);
  const { send } = page;
  try {
    await gotoTasks(send, 390);
    await waitFor(send, "document.querySelector(\"[data-empty='true']\") ? 'yes' : ''", "empty 390");
    assert.ok((await evalPage(send, "document.documentElement.scrollWidth - document.documentElement.clientWidth")) <= 1);
    await shot(send, "tasks_empty_390.png");
    assert.equal(await evalPage(send, click("Add a task")), "yes");
    await waitFor(send, "document.querySelector(\"[role='dialog']\") ? 'yes' : ''", "sheet 390");
    await shot(send, "tasks_add_sheet_390.png");
    assert.equal(await evalPage(send, click("Cancel")), "yes");
    await waitFor(send, "document.querySelector(\"[role='dialog']\") ? '' : 'closed'", "cancel 390");

    await size(send, 1280);
    await waitFor(send, "document.querySelector(\"[data-empty='true']\") ? 'yes' : ''", "empty 1280");
    assert.ok((await evalPage(send, "document.documentElement.scrollWidth - document.documentElement.clientWidth")) <= 1);
    await shot(send, "tasks_empty_1280.png");
    assert.equal(await evalPage(send, click("Add a task")), "yes");
    await waitFor(send, "document.querySelector(\"[role='dialog']\") ? 'yes' : ''", "sheet 1280");
    await shot(send, "tasks_add_sheet_1280.png");
    assert.equal(await evalPage(send, click("Cancel")), "yes");
    await waitFor(send, "document.querySelector(\"[role='dialog']\") ? '' : 'closed'", "cancel 1280");

    async function titleThenEnter(width, title) {
      await size(send, width);
      assert.equal(await evalPage(send, click("Add a task")), "yes");
      await waitFor(send, "document.activeElement?.id === 'task-title' ? 'yes' : ''", `title focused ${width}`);
      const hit = await evalPage(
        send,
        `(() => {
          const el = document.getElementById("task-title");
          el.blur();
          const rect = el.getBoundingClientRect();
          const x = rect.left + rect.width / 2;
          const y = rect.top + rect.height / 2;
          const top = document.elementFromPoint(x, y);
          return { x, y, id: top && (top.id || top.getAttribute("aria-label") || top.tagName) };
        })()`,
      );
      assert.equal(hit.id, "task-title", JSON.stringify(hit));
      await send("Input.dispatchMouseEvent", { type: "mousePressed", x: hit.x, y: hit.y, button: "left", clickCount: 1 });
      await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: hit.x, y: hit.y, button: "left", clickCount: 1 });
      assert.equal(await evalPage(send, "document.activeElement?.id"), "task-title");
      await send("Input.insertText", { text: title });
      await send("Input.dispatchKeyEvent", {
        type: "keyDown",
        key: "Enter",
        code: "Enter",
        windowsVirtualKeyCode: 13,
        nativeVirtualKeyCode: 13,
        text: "\r",
      });
      await send("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 });
      await waitFor(
        send,
        `document.body.innerText.includes(${JSON.stringify(title)}) && !document.querySelector("[role='dialog']") ? 'yes' : ''`,
        `enter created ${width}`,
      );
    }

    await titleThenEnter(390, "Phone sample task");
    await titleThenEnter(1280, "Desk sample task");

    await size(send, 390, 685);
    assert.equal(await evalPage(send, click("Add a task")), "yes");
    await waitFor(send, "document.getElementById('task-title') ? 'yes' : ''", "short sheet");
    assert.equal(await evalPage(send, buttonInView("Save")), "yes");
    assert.equal(await evalPage(send, buttonInView("Cancel")), "yes");
    assert.equal(
      await evalPage(
        send,
        `(() => {
          const el = document.getElementById("task-title");
          const desc = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), "value");
          desc.set.call(el, "   ");
          el.dispatchEvent(new Event("input", { bubbles: true }));
          return "yes";
        })()`,
      ),
      "yes",
    );
    assert.equal(await evalPage(send, click("Save")), "yes");
    await waitFor(send, "document.getElementById('task-title-error')?.textContent.includes('Enter a title') ? 'yes' : ''", "short error");
    assert.equal(await evalPage(send, buttonInView("Save")), "yes");
    assert.equal(await evalPage(send, buttonInView("Cancel")), "yes");
    await shot(send, "tasks_add_error_390.png");
    assert.equal(await evalPage(send, click("Cancel")), "yes");
    await waitFor(send, "document.querySelector(\"[role='dialog']\") ? '' : 'closed'", "short closed");

    await size(send, 390);
    assert.equal(await evalPage(send, click("Add a task")), "yes");
    await waitFor(send, "document.getElementById('task-title') ? 'yes' : ''", "title field");
    assert.equal(
      await evalPage(
        send,
        `(() => {
          const set = (id, value) => {
            const el = document.getElementById(id);
            const desc = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), "value");
            desc.set.call(el, value);
            el.dispatchEvent(new Event("input", { bubbles: true }));
            el.dispatchEvent(new Event("change", { bubbles: true }));
          };
          set("task-title", "Buy synthetic oats");
          set("task-notes", "A made-up reminder.");
          set("task-due", "2026-11-20");
          set("task-priority", "High");
          set("task-status", "Doing");
          set("task-project", "Errands");
          return document.getElementById("task-title").value;
        })()`,
      ),
      "Buy synthetic oats",
    );
    assert.equal(await evalPage(send, click("Save")), "yes");
    await waitFor(
      send,
      "document.body.innerText.includes('Buy synthetic oats') && !document.querySelector(\"[role='dialog']\") ? 'yes' : ''",
      "saved",
    );
    const shown = await evalPage(
      send,
      `(() => ({
        doing: document.body.innerText.includes("Doing"),
        due: document.body.innerText.includes("2026-11-20"),
        project: document.body.innerText.includes("Errands"),
        notes: document.body.innerText.includes("A made-up reminder."),
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      }))()`,
    );
    assert.equal(shown.doing, true);
    assert.equal(shown.due, true);
    assert.equal(shown.project, true);
    assert.equal(shown.notes, true);
    assert.ok(shown.overflow <= 1);
    await shot(send, "tasks_list_390.png");

    await evalPage(send, "localStorage.removeItem('joehub.tasks.unfinished'); 'yes'");
    await send("Page.reload", { ignoreCache: true });
    await waitFor(
      send,
      "document.querySelector(\"[data-ready='true']\") && document.body.innerText.includes('Buy synthetic oats') ? 'yes' : ''",
      "reload",
    );

    async function guards() {
      assert.equal(await evalPage(send, click("Add a task")), "yes");
      await waitFor(send, "document.getElementById('task-title') ? 'yes' : ''", "blank sheet");
      assert.equal(await evalPage(send, click("Save")), "yes");
      await waitFor(send, "document.getElementById('task-title-error')?.textContent.includes('Enter a title') ? 'yes' : ''", "blank title");
      assert.equal(await evalPage(send, "document.activeElement?.id === 'task-title' ? 'yes' : document.activeElement?.id || 'none'"), "yes");
      assert.equal(
        await evalPage(
          send,
          `(() => {
            const set = (value) => {
              const el = document.getElementById("task-title");
              const desc = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), "value");
              desc.set.call(el, value);
              el.dispatchEvent(new Event("input", { bubbles: true }));
            };
            set("Do not keep this");
            return "yes";
          })()`,
        ),
        "yes",
      );
      assert.equal(await evalPage(send, click("Cancel")), "yes");
      await waitFor(send, "document.querySelector(\"[role='dialog']\") ? '' : 'closed'", "cancel closed");
      assert.equal(await evalPage(send, "document.body.innerText.includes('Do not keep this') ? 'yes' : 'no'"), "no");

      assert.equal(await evalPage(send, click("Add a task")), "yes");
      await waitFor(send, "document.getElementById('task-title') ? 'yes' : ''", "escape sheet");
      await evalPage(
        send,
        `(() => {
          const el = document.getElementById("task-title");
          const desc = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), "value");
          desc.set.call(el, "Escape should not save");
          el.dispatchEvent(new Event("input", { bubbles: true }));
          return "yes";
        })()`,
      );
      await evalPage(send, "document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); 'yes'");
      await waitFor(send, "document.querySelector(\"[role='dialog']\") ? '' : 'closed'", "escape closed");
      assert.equal(await evalPage(send, "document.body.innerText.includes('Escape should not save') ? 'yes' : 'no'"), "no");
    }

    await guards();

    async function firstRowTop() {
      const value = await evalPage(
        send,
        `(() => {
          const row = document.querySelector("ul[aria-label='Unfinished tasks'] li");
          if (!row) return "";
          return String(Math.round(row.getBoundingClientRect().top));
        })()`,
      );
      assert.match(String(value), /^\d+$/);
      return Number(value);
    }

    async function devtoolsOffline() {
      await send("Network.emulateNetworkConditions", {
        offline: true,
        latency: 0,
        downloadThroughput: 0,
        uploadThroughput: 0,
      });
      const started = Date.now();
      let banner = "";
      while (Date.now() - started < 1500) {
        banner = await evalPage(send, "document.querySelector(\"[data-offline='true']\") ? 'yes' : ''");
        if (banner) return;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      await evalPage(send, "window.dispatchEvent(new Event('focus')); 'yes'");
    }

    async function backFromDevtoolsOffline(width) {
      const onlineAt = Date.now();
      await send("Network.emulateNetworkConditions", {
        offline: false,
        latency: 0,
        downloadThroughput: -1,
        uploadThroughput: -1,
      });
      await waitFor(
        send,
        `(() => {
          const banner = document.querySelector("[data-offline='true']");
          const add = [...document.querySelectorAll("button")].find((el) => (el.innerText || "").trim() === "Add a task");
          return !banner && add && !add.disabled ? "yes" : "";
        })()`,
        `devtools online ${width}`,
        10000,
      );
      assert.ok(Date.now() - onlineAt < 10000, `banner stayed for ${Date.now() - onlineAt}ms at ${width}`);
      await shot(send, `tasks_online_${width}.png`);
    }

    const rowBefore390 = await firstRowTop();
    assert.equal(await evalPage(send, click("Add a task")), "yes");
    await waitFor(send, "document.querySelector(\"[role='dialog'] button\") ? 'yes' : ''", "offline sheet");
    await devtoolsOffline();
    await waitFor(
      send,
      "document.querySelector(\"[data-link='offline']\")?.textContent.includes('Offline') ? 'yes' : ''",
      "offline 390",
    );
    const offline = await evalPage(
      send,
      `(() => {
        const button = (label) => [...document.querySelectorAll("button")].find((el) => (el.innerText || "").trim() === label);
        return {
          banner: document.querySelector("[data-offline='true']")?.textContent || "",
          saveDisabled: Boolean(button("Save") && button("Save").disabled),
          addDisabled: Boolean(button("Add a task") && button("Add a task").disabled),
          kept: document.body.innerText.includes("Buy synthetic oats"),
        };
      })()`,
    );
    assert.match(offline.banner, /Offline/);
    assert.doesNotMatch(offline.banner, /read-only/);
    assert.match(offline.banner, /Last updated /);
    assert.match(offline.banner, /America\/Detroit/);
    assert.equal(offline.saveDisabled, true);
    assert.equal(offline.addDisabled, true);
    assert.equal(offline.kept, true);
    assert.equal(await evalPage(send, click("Cancel")), "yes");
    await waitFor(send, "document.querySelector(\"[data-offline='true']\") && !document.querySelector(\"[role='dialog']\") ? 'yes' : ''", "offline visible");
    assert.equal(await firstRowTop(), rowBefore390);
    await shot(send, "tasks_offline_390.png");
    await backFromDevtoolsOffline(390);
    assert.equal(await firstRowTop(), rowBefore390);

    await gotoTasks(send, 1280);
    await waitFor(send, "document.body.innerText.includes('Buy synthetic oats') ? 'yes' : ''", "list 1280");
    assert.ok((await evalPage(send, "document.documentElement.scrollWidth - document.documentElement.clientWidth")) <= 1);
    await shot(send, "tasks_list_1280.png");
    await guards();
    const rowBefore1280 = await firstRowTop();
    assert.equal(await evalPage(send, click("Add a task")), "yes");
    await waitFor(send, "document.querySelector(\"[role='dialog']\") ? 'yes' : ''", "offline sheet 1280");
    await devtoolsOffline();
    await waitFor(
      send,
      "document.querySelector(\"[data-link='offline']\")?.textContent.includes('Offline') ? 'yes' : ''",
      "offline 1280",
    );
    assert.equal(await evalPage(send, "[...document.querySelectorAll('button')].find((el) => (el.innerText || '').trim() === 'Save')?.disabled === true ? 'yes' : 'no'"), "yes");
    assert.equal(await evalPage(send, click("Cancel")), "yes");
    await waitFor(send, "!document.querySelector(\"[role='dialog']\") && document.querySelector(\"[data-offline='true']\") ? 'yes' : ''", "offline banner 1280");
    assert.equal(await firstRowTop(), rowBefore1280);
    await shot(send, "tasks_offline_1280.png");
    assert.equal(await evalPage(send, "typeof window.__joehubIgnoredOnline === 'number' ? 'yes' : 'no'"), "yes");
    await backFromDevtoolsOffline(1280);
    assert.equal(await firstRowTop(), rowBefore1280);
  } finally {
    await page.close();
    await stopProcess(chrome);
    await stopProcess(child);
    await release();
    chrome = null;
    child = null;
    release = async () => {};
  }
});
