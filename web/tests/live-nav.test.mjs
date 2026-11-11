import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { acquireBrowserLock, reservePort, spawnLogged, startChrome, stopProcess, waitForChrome, waitForHttp } from "./support/harness.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const chromeBin = ["google-chrome", "google-chrome-stable"].find((bin) => spawnSync("which", [bin]).status === 0);

function serverEnv(port, production) {
  return {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    LANG: "C.UTF-8",
    NODE_ENV: "development",
    JOEHUB_DEV_AUTH: "1",
    JOEHUB_SESSION_SECRET: "live-nav-test-secret-value",
    ...(production ? { NEXT_PUBLIC_VERCEL_ENV: "production" } : {}),
    PORT: String(port),
  };
}

async function boot(production) {
  const port = await reservePort();
  const started = spawnLogged(["node_modules/next/dist/bin/next", "dev", "-p", String(port)], {
    cwd: ROOT,
    env: serverEnv(port, production),
  });
  const base = `http://127.0.0.1:${port}`;
  await waitForHttp(`${base}/`, {
    child: started.child,
    log: started.log,
    accept: (response) => response.status === 200 && (response.headers.get("content-type") || "").includes("text/html"),
  });
  return { port, base, child: started.child, log: started.log };
}

async function withPage(cdp, url, width, run) {
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
  await send("Emulation.setDeviceMetricsOverride", { width, height: 844, deviceScaleFactor: 1, mobile: width < 500 });
  await send("Page.navigate", { url });
  let value = null;
  for (let i = 0; i < 40; i += 1) {
    const ready = await send("Runtime.evaluate", {
      expression: `(() => {
        const nav = document.querySelector("nav[aria-label='Primary']");
        const links = nav ? [...nav.querySelectorAll("a")] : [];
        if (!nav || links.length < 3) return null;
        const heights = links.map((link) => Math.round(link.getBoundingClientRect().height));
        if (heights.some((height) => height < 44)) return null;
        return {
          labels: links.map((link) => (link.textContent || "").replace(/\\s+/g, " ").trim()),
          heights: links.map((link) => Math.round(link.getBoundingClientRect().height)),
          icons: links.map((link) => link.querySelector("svg") ? 1 : 0),
          finance: [...document.querySelectorAll("nav[aria-label='Finance sections'] a")].map((link) => (link.textContent || "").trim()),
          title: (document.querySelector("h1") || {}).textContent || "",
          jobs: document.body.innerText.includes("JOBS"),
          journal: document.body.innerText.includes("JOURNAL"),
        };
      })()`,
      returnByValue: true,
    });
    value = ready.result?.result?.value;
    if (value && value.labels.length > 0 && (url.endsWith("/finance") ? value.finance.length > 0 : true) && (url.endsWith("/grocery") ? value.title === "Grocery" : true)) break;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  ws.close();
  await fetch(`http://127.0.0.1:${cdp}/json/close/${created.id}`);
  return value;
}

test("production hides gated nav and preview shows the full bar", { skip: chromeBin ? false : "chrome is not installed" }, async () => {
  const release = await acquireBrowserLock();
  const cdp = await reservePort();
  const chrome = startChrome(chromeBin, cdp, mkdtempSync(`${tmpdir()}/chrome-live-nav-`));
  let server;
  try {
    await waitForChrome(cdp, chrome);
    server = await boot(false);
    const full = await withPage(cdp, `${server.base}/`, 390);
    assert.deepEqual(full.labels, ["Home", "Finance", "Jobs", "Journal", "More"]);
    const previewFinance = await withPage(cdp, `${server.base}/finance`, 390);
    assert.deepEqual(previewFinance.finance, ["Overview", "Categories", "Goals", "Accounts", "Bills"]);
    await stopProcess(server.child);
    server = await boot(true);

    const home = await withPage(cdp, `${server.base}/`, 390);
    assert.deepEqual(home.labels, ["Tasks", "Grocery", "Finance"]);
    assert.ok(home.heights.every((height) => height >= 44), JSON.stringify(home.heights));
    assert.ok(home.icons.every((count) => count === 1));
    assert.equal(home.jobs, false);
    assert.equal(home.journal, false);
    const wide = await withPage(cdp, `${server.base}/`, 1280);
    assert.deepEqual(wide.labels, ["Tasks", "Grocery", "Finance"]);
    const grocery = await withPage(cdp, `${server.base}/grocery`, 390);
    assert.equal(grocery.title, "Grocery");
    assert.deepEqual(grocery.labels, ["Tasks", "Grocery", "Finance"]);
    const finance = await withPage(cdp, `${server.base}/finance`, 390);
    assert.deepEqual(finance.finance, ["Overview", "Categories", "Accounts", "Bills"]);

    for (const path of ["/jobs", "/journal", "/more", "/finance/goals"]) {
      const response = await fetch(`${server.base}${path}`, { redirect: "manual" });
      assert.equal(response.status, 307, path);
      assert.equal(new URL(response.headers.get("location"), server.base).pathname, "/", path);
    }
    const health = await fetch(`${server.base}/api/health`);
    assert.equal(health.status, 200);
    const login = await fetch(`${server.base}/api/auth/login`, { redirect: "manual" });
    const loginPath = login.headers.get("location") ? new URL(login.headers.get("location"), server.base).pathname : "";
    assert.notEqual(loginPath, "/");
  } finally {
    if (server) await stopProcess(server.child);
    await stopProcess(chrome);
    await release();
  }
});
