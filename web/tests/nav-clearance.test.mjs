import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { acquireBrowserLock, reservePort, spawnLogged, startChrome, stopProcess, waitForChrome, waitForHttp } from "./support/harness.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const chromeBin = ["google-chrome", "google-chrome-stable"].find((bin) => spawnSync("which", [bin]).status === 0);
const skip = chromeBin ? false : "google-chrome is not installed";

const lastRowClear = `(() => {
  const nav = document.querySelector("nav[aria-label='Primary']");
  const main = document.getElementById("content");
  if (!nav || !main) return { ok: false, reason: "missing" };
  window.scrollTo(0, document.documentElement.scrollHeight);
  const navBox = nav.getBoundingClientRect();
  let best = null;
  let bottom = -Infinity;
  for (const node of main.querySelectorAll("li, h1, section, p, a")) {
    const style = getComputedStyle(node);
    const rect = node.getBoundingClientRect();
    if (style.display === "none" || style.visibility === "hidden" || style.position === "fixed") continue;
    if (rect.width < 8 || rect.height < 8) continue;
    if (rect.bottom > bottom) {
      bottom = rect.bottom;
      best = node;
    }
  }
  if (!best) return { ok: false, reason: "no row" };
  const rect = best.getBoundingClientRect();
  const x = Math.min(Math.max(rect.left + Math.min(rect.width / 2, 160), 8), window.innerWidth - 8);
  const y = Math.min(Math.max(rect.top + Math.min(rect.height / 2, rect.height - 4), 0), window.innerHeight - 1);
  const top = document.elementFromPoint(x, y);
  const onNav = Boolean(top && (top === nav || nav.contains(top)));
  const label = (best.innerText || best.getAttribute("aria-label") || best.tagName || "").replace(/\\s+/g, " ").trim().slice(0, 80);
  return {
    ok: !onNav && rect.bottom <= navBox.top + 1,
    onNav,
    label,
    bottom: Math.round(rect.bottom),
    navTop: Math.round(navBox.top),
    navWidth: Math.round(navBox.width),
    view: window.innerWidth,
  };
})()`;

test("the last row stays above the tab bar at 390 and 1280", { timeout: 180000, skip }, async () => {
  const release = await acquireBrowserLock();
  const port = await reservePort();
  const cdp = await reservePort();
  const base = `http://127.0.0.1:${port}`;
  const started = spawnLogged(["node_modules/next/dist/bin/next", "dev", "-H", "127.0.0.1", "-p", String(port)], {
    cwd: ROOT,
    env: {
      PATH: process.env.PATH,
      HOME: process.env.HOME || "/tmp",
      TMPDIR: process.env.TMPDIR || "/tmp",
      LANG: "C.UTF-8",
      NODE_ENV: "development",
      JOEHUB_DEV_AUTH: "1",
      JOEHUB_SESSION_SECRET: "nav-clearance-secret-value",
    },
  });
  let chrome = null;
  try {
    await waitForHttp(`${base}/tasks`, {
      child: started.child,
      log: started.log,
      accept: (response) => response.status === 200 && (response.headers.get("content-type") || "").includes("text/html"),
    });
    const logged = await fetch(`${base}/api/session/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "synthetic", password: "synthetic", device_label: "nav-clearance" }),
    });
    assert.equal(logged.status, 200);
    const rows = logged.headers.getSetCookie?.() || [];
    const cookie = (rows.find((row) => row.startsWith("joehub_session=")) || "").split(";", 1)[0].slice("joehub_session=".length);
    const headers = { "content-type": "application/json", cookie: `joehub_session=${cookie}`, "idempotency-key": crypto.randomUUID() };
    const task = await fetch(`${base}/api/tasks`, { method: "POST", headers, body: JSON.stringify({ title: "Nav clearance task" }) });
    assert.equal(task.status, 201, await task.text());
    const item = await fetch(`${base}/api/grocery`, {
      method: "POST",
      headers: { ...headers, "idempotency-key": crypto.randomUUID() },
      body: JSON.stringify({ name: "Nav clearance item" }),
    });
    assert.equal(item.status, 201, await item.text());

    chrome = startChrome(chromeBin, cdp, `/tmp/chrome-nav-${process.pid}`);
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
    const send = (method, params = {}) =>
      new Promise((resolve) => {
        const id = ++seq;
        pending.set(id, resolve);
        ws.send(JSON.stringify({ id, method, params }));
      });
    const evalPage = async (expression) => {
      const result = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
      if (result.result?.exceptionDetails) throw new Error(JSON.stringify(result.result.exceptionDetails));
      return result.result?.result?.value;
    };
    await send("Network.setCookie", { name: "joehub_session", value: cookie, url: `${base}/` });

    for (const width of [1280, 390]) {
      await send("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: width < 800 });
      for (const path of ["/tasks", "/grocery", "/finance"]) {
        await send("Page.navigate", { url: `${base}${path}` });
        const ready = path === "/tasks" ? "Nav clearance task" : path === "/grocery" ? "Nav clearance item" : "Net worth";
        const deadline = Date.now() + 20000;
        let seen = "";
        while (Date.now() < deadline) {
          seen = await evalPage(`document.body && document.body.innerText.includes(${JSON.stringify(ready)}) && document.querySelector("nav[aria-label='Primary']") ? "yes" : ""`);
          if (seen === "yes") break;
          await new Promise((resolve) => setTimeout(resolve, 150));
        }
        assert.equal(seen, "yes", `${path} at ${width}`);
        const hit = await evalPage(lastRowClear);
        assert.equal(hit.ok, true, `${path} at ${width} ${JSON.stringify(hit)}`);
        if (width === 1280) assert.ok(hit.navWidth >= 1200, `${path} nav is not full width ${JSON.stringify(hit)}`);
      }
    }
    ws.close();
  } finally {
    await stopProcess(chrome);
    await stopProcess(started.child);
    await release();
  }
});
