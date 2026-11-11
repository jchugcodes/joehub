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
  await waitForHttp(`${base}${production ? "/tasks" : "/"}`, {
    child: started.child,
    log: started.log,
    accept: (response) => response.status === 200 && (response.headers.get("content-type") || "").includes("text/html"),
  });
  const logged = await fetch(`${base}/api/session/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: "synthetic", password: "synthetic", device_label: "live-nav" }),
  });
  if (logged.status !== 200) throw new Error(`login ${logged.status}`);
  const raw = (typeof logged.headers.getSetCookie === "function" ? logged.headers.getSetCookie() : []).find((row) => row.startsWith("joehub_session=")) || logged.headers.get("set-cookie") || "";
  const cookie = raw.split(";", 1)[0].slice("joehub_session=".length);
  return { port, base, child: started.child, log: started.log, cookie };
}

async function withPage(cdp, url, width, cookie = "") {
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
  if (cookie) {
    const cooked = await send("Network.setCookie", { name: "joehub_session", value: cookie, url, httpOnly: true });
    if (!cooked.result?.success) throw new Error("cookie was not set");
  }
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
          example: document.body.innerText.includes("EXAMPLE DATA"),
          jobs: document.body.innerText.includes("JOBS"),
          journal: document.body.innerText.includes("JOURNAL"),
          chart: Boolean(document.querySelector("[aria-label='Net worth chart']")),
          net: (document.querySelector("[data-net-worth]") || {}).textContent || "",
          ytd: document.body.innerText.includes("YTD") || document.body.innerText.includes("no history"),
          active: (() => {
            const link = nav.querySelector("a[aria-current='page']");
            if (!link) return null;
            const icon = link.querySelector("span");
            return { color: getComputedStyle(link).color, bg: icon ? getComputedStyle(icon).backgroundColor : "" };
          })(),
        };
      })()`,
      returnByValue: true,
    });
    value = ready.result?.result?.value;
    const productionFinance = value && value.labels.join("|") === "Tasks|Grocery|Finance" && url.endsWith("/finance");
    const laidOut = value && value.labels.length > 0 && (url.endsWith("/finance") ? value.finance.length > 0 : true) && (url.endsWith("/grocery") ? value.title === "Grocery" : true);
    if (laidOut && !(productionFinance && !value.net)) break;
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

    const home = await withPage(cdp, `${server.base}/`, 390, server.cookie);
    assert.deepEqual(home.labels, ["Tasks", "Grocery", "Finance"]);
    assert.ok(home.heights.every((height) => height >= 44), JSON.stringify(home.heights));
    assert.ok(home.icons.every((count) => count === 1));
    assert.equal(home.title, "Tasks");
    assert.equal(home.example, false);
    assert.equal(home.jobs, false);
    assert.equal(home.journal, false);
    assert.equal(home.active.color, "rgb(46, 139, 106)");
    assert.match(home.active.bg, /rgba\(46,\s*139,\s*106/);
    const wide = await withPage(cdp, `${server.base}/`, 1280, server.cookie);
    assert.deepEqual(wide.labels, ["Tasks", "Grocery", "Finance"]);
    assert.equal(wide.active.color, "rgb(46, 139, 106)");
    assert.match(wide.active.bg, /rgba\(46,\s*139,\s*106/);
    const grocery = await withPage(cdp, `${server.base}/grocery`, 390, server.cookie);
    assert.equal(grocery.title, "Grocery");
    assert.deepEqual(grocery.labels, ["Tasks", "Grocery", "Finance"]);
    assert.equal(grocery.active.color, "rgb(46, 139, 106)");
    assert.match(grocery.active.bg, /rgba\(46,\s*139,\s*106/);
    const finance = await withPage(cdp, `${server.base}/finance`, 390, server.cookie);
    assert.deepEqual(finance.finance, ["Overview", "Categories", "Accounts", "Bills"]);
    assert.equal(finance.chart, false);
    assert.equal(finance.ytd, false);
    assert.match(finance.net, /\d/);
    assert.equal(finance.active.color, "rgb(46, 139, 106)");
    assert.match(finance.active.bg, /rgba\(46,\s*139,\s*106/);

    for (const path of ["/", "/jobs", "/journal", "/more", "/finance/goals", "/not-a-page"]) {
      const response = await fetch(`${server.base}${path}`, { redirect: "manual" });
      assert.equal(response.status, 307, path);
      assert.equal(new URL(response.headers.get("location"), server.base).pathname, "/tasks", path);
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
