import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { acquireBrowserLock, reservePort, spawnLogged, startChrome, stopProcess, waitForChrome, waitForHttp } from "./support/harness.mjs";
import { pointerClick, controlFinder } from "./support/pointer.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const ARTIFACTS = "/opt/cursor/artifacts";
const chromeBin = ["google-chrome", "google-chrome-stable"].find((bin) => spawnSync("which", [bin]).status === 0);
const skip = chromeBin ? false : "google-chrome is not installed";
const baseOf = (port) => `http://127.0.0.1:${port}`;

test("delete asks first and then the task is gone", { timeout: 180000, skip }, async () => {
  mkdirSync(ARTIFACTS, { recursive: true });
  const release = await acquireBrowserLock();
  const port = await reservePort();
  const cdp = await reservePort();
  const started = spawnLogged(["node_modules/next/dist/bin/next", "dev", "-H", "127.0.0.1", "-p", String(port)], {
    cwd: ROOT,
    env: {
      PATH: process.env.PATH,
      HOME: process.env.HOME || "/tmp",
      TMPDIR: process.env.TMPDIR || "/tmp",
      LANG: "C.UTF-8",
      NODE_ENV: "development",
      JOEHUB_DEV_AUTH: "1",
      JOEHUB_SESSION_SECRET: "tasks-delete-secret-value",
      JOEHUB_SCREENSHOTS: "1",
    },
  });
  let chrome = null;
  try {
    await waitForHttp(`${baseOf(port)}/tasks`, { child: started.child, log: started.log, accept: (response) => response.status === 200 });
    const logged = await fetch(`${baseOf(port)}/api/session/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "synthetic", password: "synthetic", device_label: "tasks-delete" }),
    });
    const rows = logged.headers.getSetCookie?.() || [];
    const cookie = (rows.find((row) => row.startsWith("joehub_session=")) || "").split(";", 1)[0].slice("joehub_session=".length);
    const created = await fetch(`${baseOf(port)}/api/tasks`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: `joehub_session=${cookie}`, "idempotency-key": crypto.randomUUID() },
      body: JSON.stringify({ title: "Delete the sample bag" }),
    });
    assert.equal(created.status, 201);
    chrome = startChrome(chromeBin, cdp, `/tmp/chrome-delete-${process.pid}`);
    await waitForChrome(cdp, chrome);
    const page = await fetch(`http://127.0.0.1:${cdp}/json/new?about:blank`, { method: "PUT" }).then((response) => response.json());
    const ws = new WebSocket(page.webSocketDebuggerUrl);
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
    const send = (method, params = {}) => new Promise((resolve) => {
      const id = ++seq;
      pending.set(id, resolve);
      ws.send(JSON.stringify({ id, method, params }));
    });
    const evalPage = async (expression) => {
      const result = await send("Runtime.evaluate", { expression, returnByValue: true });
      return result.result?.result?.value;
    };
    const press = (label, scope) => pointerClick(send, (_send, expression) => evalPage(expression), controlFinder(label, scope));
    await send("Network.setCookie", { name: "joehub_session", value: cookie, url: `${baseOf(port)}/` });
    await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 900, deviceScaleFactor: 1, mobile: true });
    await send("Page.navigate", { url: `${baseOf(port)}/tasks` });
    const deadline = Date.now() + 20000;
    while (Date.now() < deadline && !(await evalPage("document.body.innerText.includes('Delete the sample bag') ? 'yes' : ''"))) {
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
    await press("Edit Delete the sample bag");
    while (Date.now() < deadline && !(await evalPage("[...document.querySelectorAll('button')].some((el) => el.innerText.trim() === 'Delete') ? 'yes' : ''"))) {
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
    await press("Delete");
    while (Date.now() < deadline && !(await evalPage("document.getElementById('delete-title') ? 'yes' : ''"))) {
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
    const shot = await send("Page.captureScreenshot", { format: "png" });
    writeFileSync(`${ARTIFACTS}/tasks_delete_confirm_390.png`, Buffer.from(shot.result.data, "base64"));
    assert.equal(
      await evalPage(`(() => {
        const el = [...document.querySelectorAll("#delete-dialog button")].find((button) => (button.innerText || "").trim() === "Cancel");
        if (!el) return "missing";
        const rect = el.getBoundingClientRect();
        const x = rect.left + rect.width / 2;
        const y = rect.top + rect.height / 2;
        const top = document.elementFromPoint(x, y);
        const nav = document.querySelector("nav[aria-label='Primary']");
        const navTop = nav ? nav.getBoundingClientRect().top : window.innerHeight;
        return top === el && rect.bottom <= navTop + 1 ? "yes" : (top ? (top.getAttribute("aria-label") || (top.innerText || "").replace(/\\s+/g, " ").trim().slice(0, 80) || top.tagName) : "none");
      })()`),
      "yes",
    );
    await send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
    await new Promise((resolve) => setTimeout(resolve, 400));
    const wide = await send("Page.captureScreenshot", { format: "png" });
    writeFileSync(`${ARTIFACTS}/tasks_delete_confirm_1280.png`, Buffer.from(wide.result.data, "base64"));
    await evalPage("document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))");
    await new Promise((resolve) => setTimeout(resolve, 200));
    assert.equal(await evalPage("document.getElementById('delete-title') ? 'yes' : 'no'"), "no");
    assert.equal(await evalPage("document.body.innerText.includes('Delete the sample bag') ? 'yes' : 'no'"), "yes");
    await press("Delete");
    const cancelBy = Date.now() + 5000;
    while (Date.now() < cancelBy && !(await evalPage("document.getElementById('delete-title') ? 'yes' : ''"))) {
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
    await press("Cancel", "document.querySelector(\"[role='alertdialog']\")");
    assert.equal(await evalPage("document.body.innerText.includes('Delete the sample bag') ? 'yes' : 'no'"), "yes");
    await press("Delete");
    const confirmBy = Date.now() + 5000;
    while (Date.now() < confirmBy && !(await evalPage("document.getElementById('delete-title') ? 'yes' : ''"))) {
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
    await press("Delete", "document.querySelector(\"[role='alertdialog']\")");
    const goneBy = Date.now() + 10000;
    while (Date.now() < goneBy && (await evalPage("document.body.innerText.includes('Delete the sample bag') ? 'yes' : ''"))) {
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
    assert.equal(await evalPage("document.body.innerText.includes('Delete the sample bag') ? 'yes' : 'no'"), "no");
    const listed = await fetch(`${baseOf(port)}/api/tasks`, { headers: { cookie: `joehub_session=${cookie}` } });
    const body = await listed.json();
    assert.equal(body.some((task) => task.title === "Delete the sample bag"), false);
    const finished = await fetch(`${baseOf(port)}/api/tasks`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: `joehub_session=${cookie}`, "idempotency-key": crypto.randomUUID() },
      body: JSON.stringify({ title: "Delete the finished sample" }),
    });
    assert.equal(finished.status, 201);
    const finishedId = (await finished.json()).id;
    const completed = await fetch(`${baseOf(port)}/api/tasks/${finishedId}/complete`, {
      method: "POST",
      headers: { cookie: `joehub_session=${cookie}` },
    });
    assert.equal(completed.status, 200);
    await evalPage(`(() => {
      const input = document.getElementById("task-search");
      const desc = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), "value");
      desc.set.call(input, "finished sample");
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.form.requestSubmit();
      return "yes";
    })()`);
    const rowBy = Date.now() + 10000;
    while (Date.now() < rowBy && !(await evalPage("document.querySelector(\"[aria-label='Edit Delete the finished sample']\") ? 'yes' : ''"))) {
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
    assert.equal(await evalPage("document.querySelector(\"[aria-label='Reopen Delete the finished sample']\") ? 'yes' : 'no'"), "yes");
    await press("Edit Delete the finished sample");
    const sheetBy = Date.now() + 5000;
    while (Date.now() < sheetBy && !(await evalPage("[...document.querySelectorAll('button')].some((el) => el.innerText.trim() === 'Delete') ? 'yes' : ''"))) {
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
    await press("Delete");
    const dialogBy = Date.now() + 5000;
    while (Date.now() < dialogBy && !(await evalPage("document.getElementById('delete-title')?.textContent === 'Delete this task?' ? 'yes' : ''"))) {
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
    assert.equal(await evalPage("document.getElementById('delete-dialog')?.innerText.includes('permanently removed') ? 'yes' : 'no'"), "no");
    await press("Delete", "document.querySelector(\"[role='alertdialog']\")");
    const removedBy = Date.now() + 10000;
    while (Date.now() < removedBy && (await evalPage("document.body.innerText.includes('Delete the finished sample') ? 'yes' : ''"))) {
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
    assert.equal(await evalPage("document.body.innerText.includes('Delete the finished sample') ? 'yes' : 'no'"), "no");
    const after = await fetch(`${baseOf(port)}/api/tasks/${finishedId}`, { headers: { cookie: `joehub_session=${cookie}` } });
    assert.equal(after.status, 404);
    ws.close();
  } finally {
    await stopProcess(chrome);
    await stopProcess(started.child);
    await release();
  }
});
