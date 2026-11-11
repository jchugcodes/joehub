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
const baseOf = (port) => `http://127.0.0.1:${port}`;

test("bot progress is visible and read-only, and other tabs stay on DM Sans", { timeout: 180000, skip }, async () => {
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
      JOEHUB_SESSION_SECRET: "tasks-bot-secret-value",
      JOEHUB_SCREENSHOTS: "1",
      JOEHUB_SEED_TASKS: "1",
    },
  });
  let chrome = null;
  try {
    await waitForHttp(`${baseOf(port)}/tasks`, { child: started.child, log: started.log, accept: (response) => response.status === 200 });
    const logged = await fetch(`${baseOf(port)}/api/session/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "synthetic", password: "synthetic", device_label: "tasks-bot" }),
    });
    const rows = logged.headers.getSetCookie?.() || [];
    const cookie = (rows.find((row) => row.startsWith("joehub_session=")) || "").split(";", 1)[0].slice("joehub_session=".length);
    const rejected = await fetch(`${baseOf(port)}/api/tasks`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: `joehub_session=${cookie}`, "idempotency-key": crypto.randomUUID() },
      body: JSON.stringify({ title: "Assign the sample", assignee: "Scout" }),
    });
    assert.equal(rejected.status, 400);
    chrome = startChrome(chromeBin, cdp, `/tmp/chrome-bot-${process.pid}`);
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
      const result = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
      return result.result?.result?.value;
    };
    await send("Network.setCookie", { name: "joehub_session", value: cookie, url: `${baseOf(port)}/` });
    const shoot = async (width, name) => {
      await send("Emulation.setDeviceMetricsOverride", { width, height: 1200, deviceScaleFactor: 1, mobile: width < 800 });
      await send("Page.navigate", { url: `${baseOf(port)}/tasks` });
      const deadline = Date.now() + 20000;
      while (Date.now() < deadline && (await evalPage("document.body.innerText.includes('Scout') && document.body.innerText.includes('Cela') ? 'yes' : ''")) !== "yes") {
        await new Promise((resolve) => setTimeout(resolve, 150));
      }
      assert.equal(await evalPage("document.querySelector(\"[name='assignee'], #task-assignee\") ? 'yes' : 'no'"), "no");
      const shot = await send("Page.captureScreenshot", { format: "png" });
      writeFileSync(`${ARTIFACTS}/${name}`, Buffer.from(shot.result.data, "base64"));
    };
    await shoot(390, "tasks_bot_390.png");
    const type = await evalPage(`(() => {
      const heading = document.querySelector("h1");
      const style = getComputedStyle(heading);
      return { family: style.fontFamily, size: style.fontSize, weight: style.fontWeight, optical: style.fontOpticalSizing };
    })()`);
    assert.match(type.family, /Outfit|__Outfit/i, JSON.stringify(type));
    assert.equal(type.size, "24px");
    assert.equal(type.weight, "500");
    assert.equal(type.optical, "none");
    await shoot(1280, "tasks_bot_1280.png");
    await evalPage("document.querySelector(\"[aria-label='Edit Hold for the sample reply']\").click()");
    const editBy = Date.now() + 5000;
    while (Date.now() < editBy && (await evalPage("document.querySelector(\"[role='dialog'] [data-bot='Scout']\") ? 'yes' : ''")) !== "yes") {
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
    assert.equal(await evalPage("document.querySelector(\"[role='dialog'] [data-bot='Scout']\") ? 'yes' : 'no'"), "yes");
    assert.equal(await evalPage("document.getElementById('task-title') ? 'yes' : 'no'"), "yes");
    const editWide = await send("Page.captureScreenshot", { format: "png" });
    writeFileSync(`${ARTIFACTS}/tasks_bot_edit_1280.png`, Buffer.from(editWide.result.data, "base64"));
    await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 900, deviceScaleFactor: 1, mobile: true });
    const editPhone = await send("Page.captureScreenshot", { format: "png" });
    writeFileSync(`${ARTIFACTS}/tasks_bot_edit_390.png`, Buffer.from(editPhone.result.data, "base64"));
    for (const path of ["/", "/finance", "/jobs", "/journal", "/more"]) {
      await send("Page.navigate", { url: `${baseOf(port)}${path}` });
      const readyBy = Date.now() + 15000;
      while (Date.now() < readyBy && (await evalPage("(() => { const heading = document.querySelector('h1'); if (!heading) return ''; const family = getComputedStyle(heading).fontFamily; return /DM Sans|dmSans|__DM_Sans/i.test(family) ? 'yes' : ''; })()")) !== "yes") {
        await new Promise((resolve) => setTimeout(resolve, 150));
      }
      const face = await evalPage(`(() => {
        const heading = document.querySelector("h1");
        const style = getComputedStyle(heading);
        const card = document.querySelector("a.tasks-type");
        const nav = document.querySelector("nav[aria-label='Primary'] a");
        return {
          family: style.fontFamily,
          weight: style.fontWeight,
          card: card ? getComputedStyle(card).fontFamily : "",
          nav: nav ? getComputedStyle(nav).fontFamily : "",
        };
      })()`);
      assert.match(face.family, /DM Sans|__DM_Sans/i, `${path} ${JSON.stringify(face)}`);
      assert.doesNotMatch(face.family, /Outfit/i, path);
      assert.match(face.nav, /DM Sans|__DM_Sans/i, `${path} nav ${JSON.stringify(face)}`);
      if (path === "/") {
        assert.match(face.card, /Outfit|__Outfit/i, JSON.stringify(face));
        const cardShot = await send("Page.captureScreenshot", { format: "png" });
        writeFileSync(`${ARTIFACTS}/tasks_home_card_390.png`, Buffer.from(cardShot.result.data, "base64"));
      } else {
        assert.equal(face.card, "", `${path} leaked the tasks font`);
        const other = await send("Page.captureScreenshot", { format: "png" });
        writeFileSync(`${ARTIFACTS}/unchanged_${path.slice(1)}_390.png`, Buffer.from(other.result.data, "base64"));
      }
    }
    ws.close();
  } finally {
    await stopProcess(chrome);
    await stopProcess(started.child);
    await release();
  }
});
