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

async function evalPage(send, expression) {
  const result = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (result.result?.exceptionDetails) throw new Error(JSON.stringify(result.result.exceptionDetails));
  return result.result?.result?.value;
}

async function waitFor(send, expression, label) {
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    const value = await evalPage(send, expression);
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(`timed out waiting for ${label}`);
}

test("tasks can be grouped by status and project", { timeout: 180000, skip }, async () => {
  mkdirSync(ARTIFACTS, { recursive: true });
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
      JOEHUB_SESSION_SECRET: "tasks-group-secret-value",
      JOEHUB_SCREENSHOTS: "1",
    },
  });
  child = started.child;
  try {
    await waitForHttp(`${base()}/tasks`, {
      child,
      log: started.log,
      accept: (response) => response.status === 200,
    });
    const logged = await fetch(`${base()}/api/session/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "synthetic", password: "synthetic", device_label: "tasks-group" }),
    });
    assert.equal(logged.status, 200);
    const cookie = cookieValue(logged);
    for (const task of [
      { title: "Group the sample poster", status: "Doing", project: "Home", priority: "High" },
      { title: "Group the sample bag", status: "To do", project: "Errands" },
    ]) {
      const created = await fetch(`${base()}/api/tasks`, {
        method: "POST",
        headers: { "content-type": "application/json", cookie: `joehub_session=${cookie}`, "idempotency-key": crypto.randomUUID() },
        body: JSON.stringify(task),
      });
      assert.equal(created.status, 201);
    }
    chrome = startChrome(chromeBin, cdp, `/tmp/chrome-group-${process.pid}`);
    await waitForChrome(cdp, chrome);
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
    await send("Network.setCookie", { name: "joehub_session", value: cookie, url: `${base()}/` });
    for (const width of [390, 1280]) {
      await send("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: width < 500 });
      await send("Page.navigate", { url: `${base()}/tasks` });
      await waitFor(send, "document.body.innerText.includes('Group the sample poster') ? 'yes' : ''", "list");
      await evalPage(send, "[...document.querySelectorAll('button')].find((el) => el.innerText.trim() === 'Status').click(); 'yes'");
      await waitFor(send, "document.body.innerText.includes('Doing') && document.body.innerText.includes('To do') ? 'yes' : ''", "status groups");
      const shot = await send("Page.captureScreenshot", { format: "png" });
      writeFileSync(`${ARTIFACTS}/tasks_group_status_${width}.png`, Buffer.from(shot.result.data, "base64"));
      await evalPage(send, "[...document.querySelectorAll('button')].find((el) => el.innerText.trim() === 'Project').click(); 'yes'");
      await waitFor(send, "document.body.innerText.includes('Errands') && document.body.innerText.includes('Home') ? 'yes' : ''", "project groups");
      await evalPage(send, "[...document.querySelectorAll('button')].find((el) => el.innerText.trim() === 'Clear').click(); 'yes'");
      await waitFor(send, "[...document.querySelectorAll('button')].find((el) => el.innerText.trim() === 'All')?.getAttribute('aria-pressed') === 'true' ? 'yes' : ''", "cleared");
    }
    ws.close();
  } finally {
    await stopProcess(chrome);
    await stopProcess(child);
    await release();
  }
});
