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
      JOEHUB_SESSION_SECRET: "tasks-complete-browser-secret",
      JOEHUB_SCREENSHOTS: "1",
    },
  });
  child = started.child;
  await waitForHttp(`${base()}/tasks`, {
    child,
    log: started.log,
    accept: (response) => response.status === 200 && (response.headers.get("content-type") || "").includes("text/html"),
  });
  chrome = startChrome(chromeBin, cdp, `/tmp/chrome-tasks-complete-${process.pid}`);
  await waitForChrome(cdp, chrome);
  const logged = await fetch(`${base()}/api/session/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: "synthetic", password: "synthetic", device_label: "tasks-complete" }),
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
      last = error instanceof Error ? error.message.slice(0, 120) : "error";
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

async function size(send, width) {
  await send("Emulation.setDeviceMetricsOverride", {
    width,
    height: 900,
    deviceScaleFactor: 1,
    mobile: width < 500,
  });
}

async function shot(send, name) {
  await new Promise((resolve) => setTimeout(resolve, 150));
  const image = await send("Page.captureScreenshot", { format: "png" });
  writeFileSync(`${ARTIFACTS}/${name}`, Buffer.from(image.result.data, "base64"));
}

function clickName(label) {
  return `(() => {
    const node = document.querySelector(${JSON.stringify(`button[aria-label="${label}"]`)});
    if (!node || node.disabled) return "";
    node.click();
    return "yes";
  })()`;
}

function clickText(label) {
  return `(() => {
    const node = [...document.querySelectorAll("button")].find((el) => (el.innerText || "").trim() === ${JSON.stringify(label)});
    if (!node || node.disabled) return "";
    node.click();
    return "yes";
  })()`;
}

function setSearch(value) {
  return `(() => {
    const el = document.getElementById("task-search");
    const desc = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), "value");
    desc.set.call(el, ${JSON.stringify(value)});
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    return el.value;
  })()`;
}

async function gotoTasks(send, width) {
  await size(send, width);
  await send("Page.navigate", { url: `${base()}/tasks` });
  await waitFor(send, "document.querySelector(\"[data-ready='true'] h1\")?.textContent === 'Tasks' ? 'yes' : ''", "tasks");
}

async function search(send, value) {
  assert.equal(await evalPage(send, setSearch(value)), value);
  assert.equal(await evalPage(send, clickText("Search")), "yes");
}

async function goOffline(send) {
  assert.equal(
    await evalPage(
      send,
      `(() => {
        const orig = window.fetch.bind(window);
        window.fetch = (input, init) => {
          const url = typeof input === "string" ? input : (input && input.url) || "";
          const method = (init && init.method) || (input && input.method) || "GET";
          if (String(url).includes("/api/tasks") && String(method).toUpperCase() === "GET") {
            return Promise.reject(new TypeError("Failed to fetch"));
          }
          return orig(input, init);
        };
        window.dispatchEvent(new Event("focus"));
        return "armed";
      })()`,
    ),
    "armed",
  );
  await waitFor(
    send,
    "document.querySelector(\"[data-link='offline']\")?.textContent.includes('Offline') ? 'yes' : ''",
    "offline",
  );
}

test.after(async () => {
  await stopProcess(chrome);
  await stopProcess(child);
  await release();
});

test("complete, search, and reopen work at phone and desktop widths", { timeout: 300000, skip }, async () => {
  mkdirSync(ARTIFACTS, { recursive: true });
  const cookie = await boot();
  const auth = { "content-type": "application/json", cookie: `joehub_session=${cookie}` };
  const keep = await fetch(`${base()}/api/tasks`, {
    method: "POST",
    headers: { ...auth, "idempotency-key": "complete-browser-keep" },
    body: JSON.stringify({ title: "Pack the sample crate", project: "Home", status: "To do" }),
  });
  assert.equal(keep.status, 201, await keep.clone().text());
  const hold = await fetch(`${base()}/api/tasks`, {
    method: "POST",
    headers: { ...auth, "idempotency-key": "complete-browser-hold" },
    body: JSON.stringify({ title: "Hold the sample note", notes: "alpha needle", project: "Studio", status: "Doing" }),
  });
  assert.equal(hold.status, 201, await hold.clone().text());
  const page = await openPage(cookie);
  const { send } = page;
  try {
    async function completeHold(width, shotName) {
      await gotoTasks(send, width);
      await waitFor(
        send,
        "document.body.innerText.includes('Pack the sample crate') && document.body.innerText.includes('Hold the sample note') ? 'yes' : ''",
        `both ${width}`,
      );
      assert.equal(await evalPage(send, clickName("Complete Hold the sample note")), "yes");
      await waitFor(
        send,
        "document.body.innerText.includes('Pack the sample crate') && !document.body.innerText.includes('Hold the sample note') ? 'yes' : ''",
        `completed ${width}`,
      );
      assert.ok((await evalPage(send, "document.documentElement.scrollWidth - document.documentElement.clientWidth")) <= 1);
      await shot(send, shotName);
      await evalPage(send, "localStorage.removeItem('joehub.tasks.unfinished')");
      await send("Page.reload", { ignoreCache: true });
      await waitFor(
        send,
        "document.querySelector(\"[data-ready='true']\") && document.body.innerText.includes('Pack the sample crate') && !document.body.innerText.includes('Hold the sample note') ? 'yes' : ''",
        `reloaded ${width}`,
      );
    }

    async function findDone(width, shotName) {
      await search(send, "NEEDLE");
      await waitFor(
        send,
        "document.querySelector(\"[data-done='true']\") && document.body.innerText.includes('Hold the sample note') ? 'yes' : ''",
        `search ${width}`,
      );
      assert.ok((await evalPage(send, "document.documentElement.scrollWidth - document.documentElement.clientWidth")) <= 1);
      await shot(send, shotName);
    }

    async function emptySearch(width, shotName) {
      await search(send, "zzzz-no-such-task");
      await waitFor(send, "document.querySelector(\"[data-search-empty='true']\") ? 'yes' : ''", `empty ${width}`);
      assert.ok((await evalPage(send, "document.documentElement.scrollWidth - document.documentElement.clientWidth")) <= 1);
      await shot(send, shotName);
    }

    async function reopenHold(width, shotName) {
      await search(send, "needle");
      await waitFor(send, "document.querySelector(\"[data-reopen='true']\") ? 'yes' : ''", `reopen ready ${width}`);
      assert.equal(await evalPage(send, clickName("Reopen Hold the sample note")), "yes");
      await waitFor(
        send,
        "document.body.innerText.includes('Hold the sample note') && !document.querySelector(\"[data-done='true']\") ? 'yes' : ''",
        `reopened in search ${width}`,
      );
      assert.equal(await evalPage(send, clickText("Clear search")), "yes");
      await waitFor(
        send,
        "document.querySelector(\"[aria-label='Unfinished tasks']\") && document.body.innerText.includes('Hold the sample note') && document.body.innerText.includes('Pack the sample crate') && !document.querySelector(\"[data-done='true']\") ? 'yes' : ''",
        `default list ${width}`,
      );
      assert.ok((await evalPage(send, "document.documentElement.scrollWidth - document.documentElement.clientWidth")) <= 1);
      await shot(send, shotName);
    }

    await completeHold(390, "tasks_complete_390.png");
    await findDone(390, "tasks_search_390.png");
    await emptySearch(390, "tasks_search_empty_390.png");
    await reopenHold(390, "tasks_reopen_390.png");
    await goOffline(send);
    const offline = await evalPage(
      send,
      `(() => {
        const button = (label) => [...document.querySelectorAll("button")].find((el) => (el.innerText || "").trim() === label);
        const completes = [...document.querySelectorAll("[data-complete]")];
        const reopens = [...document.querySelectorAll("[data-reopen]")];
        return {
          banner: document.querySelector("[data-offline='true']")?.textContent || "",
          searchDisabled: Boolean(document.getElementById("task-search")?.disabled),
          searchButtonDisabled: Boolean(button("Search")?.disabled),
          completeCount: completes.length,
          completesDisabled: completes.length > 0 && completes.every((el) => el.disabled),
          reopenEnabled: reopens.some((el) => !el.disabled),
          crate: document.body.innerText.includes("Pack the sample crate"),
          hold: document.body.innerText.includes("Hold the sample note"),
        };
      })()`,
    );
    assert.match(offline.banner, /Offline/);
    assert.doesNotMatch(offline.banner, /read-only/);
    assert.match(offline.banner, /Last updated /);
    assert.match(offline.banner, /America\/Detroit/);
    assert.equal(offline.searchDisabled, true);
    assert.equal(offline.searchButtonDisabled, true);
    assert.equal(offline.completesDisabled, true);
    assert.equal(offline.reopenEnabled, false);
    assert.equal(offline.crate, true);
    assert.equal(offline.hold, true);
    await shot(send, "tasks_offline_controls_390.png");

    await completeHold(1280, "tasks_complete_1280.png");
    await findDone(1280, "tasks_search_1280.png");
    await emptySearch(1280, "tasks_search_empty_1280.png");
    await reopenHold(1280, "tasks_reopen_1280.png");
    await goOffline(send);
    await waitFor(send, "document.getElementById('task-search')?.disabled ? 'yes' : ''", "search disabled 1280");
    const desktop = await evalPage(
      send,
      `(() => {
        const completes = [...document.querySelectorAll("[data-complete]")];
        return {
          searchDisabled: Boolean(document.getElementById("task-search")?.disabled),
          completesDisabled: completes.length > 0 && completes.every((el) => el.disabled),
          hold: document.body.innerText.includes("Hold the sample note"),
        };
      })()`,
    );
    assert.equal(desktop.searchDisabled, true);
    assert.equal(desktop.completesDisabled, true);
    assert.equal(desktop.hold, true);
    assert.ok((await evalPage(send, "document.documentElement.scrollWidth - document.documentElement.clientWidth")) <= 1);
    await shot(send, "tasks_offline_controls_1280.png");
  } finally {
    await page.close();
  }
});
