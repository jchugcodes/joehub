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
      JOEHUB_SESSION_SECRET: "tasks-edit-browser-secret",
      JOEHUB_SCREENSHOTS: "1",
    },
  });
  child = started.child;
  await waitForHttp(`${base()}/tasks`, {
    child,
    log: started.log,
    accept: (response) => response.status === 200 && (response.headers.get("content-type") || "").includes("text/html"),
  });
  chrome = startChrome(chromeBin, cdp, `/tmp/chrome-tasks-edit-${process.pid}`);
  await waitForChrome(cdp, chrome);
  const logged = await fetch(`${base()}/api/session/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: "synthetic", password: "synthetic", device_label: "tasks-edit" }),
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

const fill = (fields) => `(() => {
  const set = (id, value) => {
    const el = document.getElementById(id);
    const desc = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), "value");
    desc.set.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  };
  ${Object.entries(fields)
    .map(([id, value]) => `set(${JSON.stringify(id)}, ${JSON.stringify(value)});`)
    .join("\n")}
  return document.getElementById("task-title").value;
})()`;

async function gotoTasks(send, width) {
  await size(send, width);
  await send("Page.navigate", { url: `${base()}/tasks` });
  await waitFor(send, "document.querySelector(\"[data-ready='true'] h1\")?.textContent === 'Tasks' ? 'yes' : ''", "tasks");
}

test.after(async () => {
  await stopProcess(chrome);
  await stopProcess(child);
  await release();
});

test("editing a task works at phone and desktop widths", { timeout: 300000, skip }, async () => {
  mkdirSync(ARTIFACTS, { recursive: true });
  const cookie = await boot();
  const created = await fetch(`${base()}/api/tasks`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: `joehub_session=${cookie}`, "idempotency-key": "edit-browser-1" },
    body: JSON.stringify({
      title: "Pack the sample box",
      notes: "A made-up note.",
      dueDate: "2026-11-20",
      priority: "High",
      status: "Doing",
      project: "Errands",
    }),
  });
  assert.equal(created.status, 201, await created.clone().text());
  const page = await openPage(cookie);
  const { send } = page;
  try {
    await gotoTasks(send, 390);
    await waitFor(send, "document.body.innerText.includes('Pack the sample box') ? 'yes' : ''", "seed 390");
    assert.equal(await evalPage(send, clickName("Edit Pack the sample box")), "yes");
    await waitFor(send, "document.querySelector(\"[role='dialog']\") ? 'yes' : ''", "edit sheet 390");
    const prefilled = await evalPage(
      send,
      `(() => ({
        title: document.getElementById("task-title").value,
        notes: document.getElementById("task-notes").value,
        due: document.getElementById("task-due").value,
        priority: document.getElementById("task-priority").value,
        status: document.getElementById("task-status").value,
        project: document.getElementById("task-project").value,
        done: [...document.querySelectorAll("#task-status option")].some((option) => option.textContent === "Done"),
        heading: document.querySelector("[role='dialog'] h2")?.textContent || "",
      }))()`,
    );
    assert.equal(prefilled.title, "Pack the sample box");
    assert.equal(prefilled.notes, "A made-up note.");
    assert.equal(prefilled.due, "2026-11-20");
    assert.equal(prefilled.priority, "High");
    assert.equal(prefilled.status, "Doing");
    assert.equal(prefilled.project, "Errands");
    assert.equal(prefilled.done, false);
    assert.equal(prefilled.heading, "Edit task");
    assert.ok((await evalPage(send, "document.documentElement.scrollWidth - document.documentElement.clientWidth")) <= 1);
    await shot(send, "tasks_edit_sheet_390.png");

    assert.equal(
      await evalPage(
        send,
        fill({
          "task-title": "Pack the sample crate",
          "task-notes": "",
          "task-due": "",
          "task-priority": "",
          "task-status": "Blocked",
          "task-project": "",
        }),
      ),
      "Pack the sample crate",
    );
    assert.equal(await evalPage(send, clickText("Save")), "yes");
    await waitFor(
      send,
      "document.body.innerText.includes('Pack the sample crate') && !document.querySelector(\"[role='dialog']\") ? 'yes' : ''",
      "saved 390",
    );
    assert.equal(await evalPage(send, "document.body.innerText.includes('A made-up note.') ? 'yes' : 'no'"), "no");
    assert.equal(await evalPage(send, "document.body.innerText.includes('2026-11-20') ? 'yes' : 'no'"), "no");
    assert.equal(await evalPage(send, "document.body.innerText.includes('Blocked') ? 'yes' : 'no'"), "yes");
    await evalPage(send, "localStorage.removeItem('joehub.tasks.unfinished'); 'yes'");
    await send("Page.reload", { ignoreCache: true });
    await waitFor(
      send,
      "document.querySelector(\"[data-ready='true']\") && document.body.innerText.includes('Pack the sample crate') ? 'yes' : ''",
      "reload 390",
    );
    assert.ok((await evalPage(send, "document.documentElement.scrollWidth - document.documentElement.clientWidth")) <= 1);
    await shot(send, "tasks_edit_saved_390.png");

    assert.equal(await evalPage(send, clickName("Edit Pack the sample crate")), "yes");
    await waitFor(send, "document.getElementById('task-title') ? 'yes' : ''", "cancel sheet");
    assert.equal(await evalPage(send, fill({ "task-title": "Do not keep edit" })), "Do not keep edit");
    assert.equal(await evalPage(send, clickText("Cancel")), "yes");
    await waitFor(send, "document.querySelector(\"[role='dialog']\") ? '' : 'closed'", "cancel closed");
    assert.equal(await evalPage(send, "document.body.innerText.includes('Do not keep edit') ? 'yes' : 'no'"), "no");
    assert.equal(await evalPage(send, "document.body.innerText.includes('Pack the sample crate') ? 'yes' : 'no'"), "yes");

    assert.equal(await evalPage(send, clickName("Edit Pack the sample crate")), "yes");
    await waitFor(send, "document.getElementById('task-title') ? 'yes' : ''", "escape sheet");
    assert.equal(await evalPage(send, fill({ "task-title": "Escape should not save" })), "Escape should not save");
    await evalPage(send, "document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); 'yes'");
    await waitFor(send, "document.querySelector(\"[role='dialog']\") ? '' : 'closed'", "escape closed");
    assert.equal(await evalPage(send, "document.body.innerText.includes('Escape should not save') ? 'yes' : 'no'"), "no");

    assert.equal(await evalPage(send, clickName("Edit Pack the sample crate")), "yes");
    await waitFor(send, "document.getElementById('task-title') ? 'yes' : ''", "blank sheet");
    assert.equal(await evalPage(send, fill({ "task-title": "   " })), "   ");
    assert.equal(await evalPage(send, clickText("Save")), "yes");
    await waitFor(send, "document.getElementById('task-title-error')?.textContent.includes('Enter a title') ? 'yes' : ''", "blank title");
    await shot(send, "tasks_edit_error_390.png");
    assert.equal(await evalPage(send, clickText("Cancel")), "yes");
    await waitFor(send, "document.querySelector(\"[role='dialog']\") ? '' : 'closed'", "blank closed");

    assert.equal(await evalPage(send, clickName("Edit Pack the sample crate")), "yes");
    await waitFor(send, "document.getElementById('task-title') ? 'yes' : ''", "failed sheet");
    assert.equal(await evalPage(send, fill({ "task-title": "Should not stick" })), "Should not stick");
    await evalPage(
      send,
      `(() => {
        const orig = window.fetch.bind(window);
        window.fetch = (input, init) => {
          const method = (init && init.method) || "GET";
          if (String(method).toUpperCase() === "PATCH") return Promise.reject(new TypeError("Failed to fetch"));
          return orig(input, init);
        };
        return "armed";
      })()`,
    );
    assert.equal(await evalPage(send, clickText("Save")), "yes");
    await waitFor(
      send,
      "document.body.innerText.includes('Your changes are still here') && document.getElementById('task-title').value === 'Should not stick' ? 'yes' : ''",
      "failed save",
    );
    assert.equal(await evalPage(send, clickText("Cancel")), "yes");
    await waitFor(send, "document.body.innerText.includes('Pack the sample crate') && !document.body.innerText.includes('Should not stick') ? 'yes' : ''", "server copy");

    assert.equal(await evalPage(send, clickName("Edit Pack the sample crate")), "yes");
    await waitFor(send, "document.getElementById('task-title') ? 'yes' : ''", "missing sheet");
    await evalPage(
      send,
      `(() => {
        const orig = window.fetch.bind(window);
        window.fetch = (input, init) => {
          const url = typeof input === "string" ? input : (input && input.url) || "";
          const method = (init && init.method) || "GET";
          if (String(method).toUpperCase() === "PATCH") {
            return Promise.resolve(new Response(JSON.stringify({ detail: "This task is no longer here." }), { status: 404, headers: { "content-type": "application/json" } }));
          }
          return orig(input, init);
        };
        return "armed";
      })()`,
    );
    assert.equal(await evalPage(send, fill({ "task-title": "Gone title" })), "Gone title");
    assert.equal(await evalPage(send, clickText("Save")), "yes");
    await waitFor(send, "document.querySelector(\"[data-missing='true']\")?.textContent.includes('no longer here') ? 'yes' : ''", "missing");
    await waitFor(send, "document.body.innerText.includes('Pack the sample crate') ? 'yes' : ''", "list refreshed");

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
    );
    await waitFor(send, "document.querySelector(\"[data-offline='true']\") ? 'yes' : ''", "offline");
    const offline = await evalPage(
      send,
      `(() => {
        const edit = document.querySelector("button[aria-label='Edit Pack the sample crate']");
        const add = [...document.querySelectorAll("button")].find((el) => (el.innerText || "").trim() === "Add a task");
        return { editDisabled: Boolean(edit && edit.disabled), addDisabled: Boolean(add && add.disabled), dialog: Boolean(document.querySelector("[role='dialog']")) };
      })()`,
    );
    assert.equal(offline.editDisabled, true);
    assert.equal(offline.addDisabled, true);
    assert.equal(offline.dialog, false);

    await gotoTasks(send, 1280);
    await waitFor(send, "document.body.innerText.includes('Pack the sample crate') ? 'yes' : ''", "seed 1280");
    assert.equal(await evalPage(send, clickName("Edit Pack the sample crate")), "yes");
    await waitFor(send, "document.getElementById('task-title')?.value === 'Pack the sample crate' ? 'yes' : ''", "edit sheet 1280");
    assert.ok((await evalPage(send, "document.documentElement.scrollWidth - document.documentElement.clientWidth")) <= 1);
    await shot(send, "tasks_edit_sheet_1280.png");
    assert.equal(await evalPage(send, fill({ "task-title": "Pack the sample trunk", "task-status": "To do" })), "Pack the sample trunk");
    assert.equal(await evalPage(send, clickText("Save")), "yes");
    await waitFor(
      send,
      "document.body.innerText.includes('Pack the sample trunk') && !document.querySelector(\"[role='dialog']\") ? 'yes' : ''",
      "saved 1280",
    );
    await shot(send, "tasks_edit_saved_1280.png");
    assert.equal(await evalPage(send, clickName("Edit Pack the sample trunk")), "yes");
    await waitFor(send, "document.getElementById('task-title') ? 'yes' : ''", "error sheet 1280");
    assert.equal(await evalPage(send, fill({ "task-title": "" })), "");
    assert.equal(await evalPage(send, clickText("Save")), "yes");
    await waitFor(send, "document.getElementById('task-title-error')?.textContent.includes('Enter a title') ? 'yes' : ''", "blank 1280");
    await shot(send, "tasks_edit_error_1280.png");
    assert.equal(await evalPage(send, "document.body.innerText.includes('Pack the sample trunk') ? 'yes' : 'no'"), "yes");
  } finally {
    await page.close();
  }
});
