import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { acquireBrowserLock, reservePort, spawnLogged, startChrome, stopProcess, waitForChrome, waitForHttp } from "./support/harness.mjs";
import { pressLabel } from "./support/pointer.mjs";

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
      JOEHUB_SESSION_SECRET: "lists-browser-secret-value",
      JOEHUB_SCREENSHOTS: "1",
    },
  });
  child = started.child;
  await waitForHttp(`${base()}/tasks`, {
    child,
    log: started.log,
    accept: (response) => response.status === 200 && (response.headers.get("content-type") || "").includes("text/html"),
  });
  chrome = startChrome(chromeBin, cdp, `/tmp/chrome-lists-${process.pid}`);
  await waitForChrome(cdp, chrome);
  const logged = await fetch(`${base()}/api/session/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: "synthetic", password: "synthetic", device_label: "lists-browser" }),
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

function press(send, label) {
  return pressLabel(send, evalPage, label);
}

async function pressStarts(send, name) {
  const label = await evalPage(
    send,
    `(() => {
      const node = [...document.querySelectorAll("button")].find((el) => (el.innerText || "").replace(/\\s+/g, " ").trim().startsWith(${JSON.stringify(name)}));
      return node ? (node.innerText || "").replace(/\\s+/g, " ").trim() : "";
    })()`,
  );
  assert.ok(label, `missing ${name}`);
  assert.equal(await press(send, label), "yes");
}

test("list create, rename, color, and delete keep the tasks", { timeout: 180000, skip }, async () => {
  let page = null;
  try {
    const cookie = await boot();
    const auth = { cookie: `joehub_session=${cookie}`, "content-type": "application/json" };
    const createdList = await fetch(`${base()}/api/lists`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ name: "Route", color: "#227777" }),
    });
    assert.equal(createdList.status, 201, await createdList.clone().text());
    const list = await createdList.json();
    for (const [index, title] of ["Carry the sample bag", "Hold the sample tag"].entries()) {
      const created = await fetch(`${base()}/api/tasks`, {
        method: "POST",
        headers: { ...auth, "idempotency-key": `lists-browser-${index}` },
        body: JSON.stringify({ title, project: list.id, status: "To do" }),
      });
      assert.equal(created.status, 201, await created.clone().text());
    }
    page = await openPage(cookie);
    const { send } = page;
    await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    await send("Page.navigate", { url: `${base()}/tasks` });
    await waitFor(send, "document.querySelector(\"[data-ready='true'] h1\")?.textContent === 'Tasks' ? 'yes' : ''", "tasks");
    await waitFor(send, "document.body.innerText.includes('Carry the sample bag') && document.body.innerText.includes('Home') ? 'yes' : ''", "legacy name");

    assert.equal(await press(send, "Edit Carry the sample bag"), "yes");
    await waitFor(send, "document.getElementById('task-project') ? 'yes' : ''", "list field");
    assert.equal(await press(send, "task-project"), "yes");
    await waitFor(send, "document.body.innerText.includes('New list') ? 'yes' : ''", "new list row");
    assert.equal(await press(send, "New list"), "yes");
    await waitFor(send, "document.getElementById('new-list-name') ? 'yes' : ''", "new list row");
    const nextColor = await evalPage(
      send,
      `(() => getComputedStyle(document.querySelector("[aria-label='List color'] span")).backgroundColor)()`,
    );
    assert.equal(nextColor, "rgb(91, 69, 181)");
    assert.equal(await press(send, "Manage lists"), "yes");
    await waitFor(send, "document.body.innerText.includes('Route') ? 'yes' : ''", "manage home");
    await pressStarts(send, "Route");
    await waitFor(send, "document.getElementById('list-name') ? 'yes' : ''", "edit list");
    assert.equal(
      await evalPage(
        send,
        `(() => {
          const el = document.getElementById("list-name");
          const desc = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), "value");
          desc.set.call(el, "Parcel run");
          el.dispatchEvent(new Event("input", { bubbles: true }));
          return el.value;
        })()`,
      ),
      "Parcel run",
    );
    assert.equal(await press(send, "Berry"), "yes");
    assert.equal(await press(send, "Save"), "yes");
    await waitFor(send, "document.body.innerText.includes('Parcel run') && !document.getElementById('list-name') ? 'yes' : ''", "renamed");
    assert.equal(await press(send, "Cancel"), "yes");
    await waitFor(send, "document.getElementById('task-title') ? 'yes' : ''", "back to task");
    assert.equal(await press(send, "Cancel"), "yes");
    await waitFor(send, "document.querySelector(\"[role='dialog']\") ? '' : 'closed'", "sheets closed");
    assert.equal(await press(send, "List"), "yes");
    await waitFor(send, "document.querySelector(\"[aria-label='Parcel run']\") ? 'yes' : ''", "list group");
    const tint = await evalPage(
      send,
      `(() => {
        const row = [...document.querySelectorAll("[aria-label='Parcel run'] li")].find((el) => el.innerText.includes("Carry the sample bag"));
        return row ? getComputedStyle(row).boxShadow : "";
      })()`,
    );
    assert.match(tint, /181,\s*69,\s*136/);

    assert.equal(await press(send, "Edit Carry the sample bag"), "yes");
    await waitFor(send, "document.getElementById('task-project') ? 'yes' : ''", "list field again");
    assert.equal(await press(send, "task-project"), "yes");
    await waitFor(send, "document.body.innerText.includes('Manage lists') ? 'yes' : ''", "menu");
    assert.equal(await press(send, "Manage lists"), "yes");
    await waitFor(send, "document.body.innerText.includes('Parcel run') ? 'yes' : ''", "manage again");
    await pressStarts(send, "Parcel run");
    await waitFor(send, "document.body.innerText.includes('Delete list') ? 'yes' : ''", "delete control");
    assert.equal(await press(send, "Delete list"), "yes");
    await waitFor(send, "document.body.innerText.includes('2 tasks move to No list.') ? 'yes' : ''", "delete copy");
    assert.equal(await press(send, "Delete"), "yes");
    await waitFor(send, "document.body.innerText.includes('No lists yet.') ? 'yes' : ''", "empty lists");
    assert.equal(await press(send, "Cancel"), "yes");
    await waitFor(send, "document.getElementById('task-title') ? 'yes' : ''", "task still open");
    assert.equal(await press(send, "Cancel"), "yes");
    await waitFor(send, "document.querySelector(\"[role='dialog']\") ? '' : 'closed'", "closed after delete");
    await waitFor(send, "document.querySelector(\"[aria-label='No list']\")?.innerText.includes('Carry the sample bag') ? 'yes' : ''", "moved");
    const plain = await evalPage(
      send,
      `(() => {
        const row = [...document.querySelectorAll("li")].find((el) => el.innerText.includes("Carry the sample bag"));
        return row ? getComputedStyle(row).boxShadow : "missing";
      })()`,
    );
    assert.equal(plain, "none");
    const tasks = await fetch(`${base()}/api/tasks`, { headers: { cookie: auth.cookie } }).then((response) => response.json());
    const kept = tasks.filter((task) => task.title === "Carry the sample bag" || task.title === "Hold the sample tag");
    assert.equal(kept.length, 2);
    assert.deepEqual(kept.map((task) => task.project), [null, null]);
    const lists = await fetch(`${base()}/api/lists`, { headers: { cookie: auth.cookie } }).then((response) => response.json());
    assert.equal(lists.length, 0);
  } finally {
    if (page) await page.close();
    await stopProcess(chrome);
    await stopProcess(child);
    await release();
    chrome = null;
    child = null;
  }
});
