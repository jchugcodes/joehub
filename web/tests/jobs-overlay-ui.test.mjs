import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { acquireBrowserLock, reservePort, spawnLogged, startChrome, stopProcess, waitForChrome, waitForHttp } from "./support/harness.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const chromeBin = ["google-chrome", "google-chrome-stable"].find((bin) => spawnSync("which", [bin]).status === 0);
const skip = chromeBin ? false : "google-chrome is not installed";

let port = 0;
let cdp = 0;
let child = null;
let chrome = null;
let release = async () => {};
const base = () => `http://127.0.0.1:${port}`;

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
      JOEHUB_SESSION_SECRET: "jobs-overlay-secret-value",
      JOEHUB_SCREENSHOTS: "1",
    },
  });
  child = started.child;
  await waitForHttp(`${base()}/jobs`, {
    child,
    log: started.log,
    accept: (response) => response.status === 200 && (response.headers.get("content-type") || "").includes("text/html"),
  });
  chrome = startChrome(chromeBin, cdp, `/tmp/chrome-jobs-overlay-${process.pid}`);
  await waitForChrome(cdp, chrome);
}

async function openPage() {
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
  await send("Runtime.enable");
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

async function size(send, width, height) {
  await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: width < 500 });
}

const settled = `(() => { const panel = document.querySelector("[data-overlay='panel']"); if (!panel) return ""; const box = panel.getBoundingClientRect(); const busy = panel.getAnimations({ subtree: true }).some((animation) => animation.playState === "running"); return !busy && panel.getAttribute("data-state") === "open" && box.width > 200 ? "yes" : ""; })()`;

test("jobs overlay is a read-only Globex detail", { timeout: 180000, skip }, async () => {
  let page = null;
  try {
    await boot();
    page = await openPage();
    const { send } = page;
    await size(send, 390, 844);
    await send("Page.navigate", { url: `${base()}/jobs` });
    await waitFor(send, "document.querySelector(\"[aria-label='Jobs sections'] [data-hydrated='true']\") && document.querySelector(\"h1\")?.textContent === \"Pipeline\" ? \"yes\" : \"\"", "jobs list");
    const listed = await evalPage(send, "document.body.innerText");
    assert.match(listed, /Globex · PM/);
    assert.match(listed, /Senior Product Analyst/);
    assert.doesNotMatch(listed, /4,204/);
    assert.equal(await evalPage(send, "document.querySelector(\"[data-job='globex']\")?.classList.contains('row-selected') ? 'yes' : 'no'"), "no");

    await evalPage(send, "document.querySelector(\"[data-job='globex']\")?.click()");
    await waitFor(send, `${settled} && document.querySelector("[data-job-detail]") ? "yes" : ""`, "job detail");
    const detail = JSON.parse(await evalPage(send, `(() => {
      const panel = document.querySelector("[data-overlay='panel']");
      const heading = panel?.querySelector("h2");
      const body = panel?.querySelector("[data-stack]")?.firstElementChild;
      const close = panel?.querySelector("[aria-label='Close']");
      const row = document.querySelector("[data-job='globex']");
      const controls = [...(panel?.querySelectorAll("button") || [])].map((el) => (el.getAttribute("aria-label") || el.innerText || "").replace(/\\s+/g, " ").trim());
      return JSON.stringify({
        title: heading ? heading.textContent : "",
        align: heading ? getComputedStyle(heading).textAlign : "",
        titleColor: heading ? getComputedStyle(heading).color : "",
        width: panel ? Math.round(panel.getBoundingClientRect().width) : 0,
        pad: body ? getComputedStyle(body).paddingLeft : "",
        padY: body ? getComputedStyle(body).paddingTop : "",
        controls,
        text: panel?.innerText || "",
        focusRing: close?.matches(":focus-visible") ? "yes" : "no",
        row: row?.classList.contains("row-selected") ? "yes" : "no",
        rowH: row ? Math.round(row.getBoundingClientRect().height) : 0,
        nameColor: row ? getComputedStyle(row).color : "",
        fit: panel?.querySelector("[data-fit-score]") ? getComputedStyle(panel.querySelector("[data-fit-score]")).color : "",
      });
    })()`));
    assert.equal(detail.title, "Senior Product Analyst");
    assert.equal(detail.align, "left");
    assert.equal(detail.titleColor, "rgb(31, 42, 36)");
    assert.equal(detail.width, 342);
    assert.equal(detail.pad, "20px");
    assert.equal(detail.padY, "16px");
    assert.deepEqual(detail.controls, ["Close"]);
    assert.match(detail.text, /Interviewing · Round 2/);
    assert.match(detail.text, /9\.1/);
    assert.match(detail.text, /Tue Nov 10/);
    assert.match(detail.text, /Team owns pricing analytics/);
    assert.doesNotMatch(detail.text, /Mark offer/);
    assert.doesNotMatch(detail.text, /Open posting/);
    assert.doesNotMatch(detail.text, /Demo only/);
    assert.doesNotMatch(detail.text, /4,204/);
    assert.equal(detail.focusRing, "no");
    assert.equal(detail.row, "yes");
    assert.ok(detail.rowH >= 44);
    assert.equal(detail.nameColor, "rgb(31, 42, 36)");
    assert.equal(detail.fit, "rgb(46, 139, 106)");

    await send("Page.navigate", { url: `${base()}/jobs/globex?xe=offline` });
    await waitFor(send, `${settled} && document.querySelector("[data-overlay='panel'] [data-state='offline']") ? "yes" : ""`, "offline banner");
    const offline = JSON.parse(await evalPage(send, `(() => {
      const panel = document.querySelector("[data-overlay='panel']");
      const banner = panel?.querySelector("[data-state='offline']");
      const controls = [...(panel?.querySelectorAll("button") || [])].map((el) => (el.innerText || el.getAttribute("aria-label") || "").trim());
      return JSON.stringify({ banner: banner?.textContent?.trim() || "", controls });
    })()`));
    assert.equal(offline.banner, "You are offline.");
    assert.deepEqual(offline.controls, ["Close"]);

    await size(send, 1280, 800);
    await send("Page.navigate", { url: `${base()}/jobs/globex` });
    await waitFor(send, `${settled} && document.querySelector("[data-overlay='desktop']") ? "yes" : ""`, "desktop pin");
    const desktop = JSON.parse(await evalPage(send, `(() => {
      const panel = document.querySelector("[data-overlay='panel']");
      const heading = panel?.querySelector("h2");
      const pin = document.querySelector("[data-overlay='desktop']");
      const row = document.querySelector("[data-job='globex']");
      const box = row ? row.getBoundingClientRect() : null;
      return JSON.stringify({
        title: heading ? heading.textContent : "",
        align: heading ? getComputedStyle(heading).textAlign : "",
        titleColor: heading ? getComputedStyle(heading).color : "",
        pin: pin ? "yes" : "",
        width: pin ? Math.round(pin.getBoundingClientRect().width) : 0,
        row: row ? getComputedStyle(row).color : "",
        x: box ? box.x + box.width / 2 : 0,
        y: box ? box.y + box.height / 2 : 0,
      });
    })()`));
    assert.equal(desktop.title, "Senior Product Analyst");
    assert.equal(desktop.align, "left");
    assert.equal(desktop.titleColor, "rgb(31, 42, 36)");
    assert.equal(desktop.pin, "yes");
    assert.equal(desktop.width, 440);
    assert.equal(desktop.row, "rgb(31, 42, 36)");
    await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: desktop.x, y: desktop.y });
    const afterHover = JSON.parse(await evalPage(send, `(() => {
      const title = document.querySelector("[data-overlay='panel'] h2");
      const row = document.querySelector("[data-job='globex']");
      return JSON.stringify({
        title: title ? getComputedStyle(title).color : "",
        row: row ? getComputedStyle(row).color : "",
      });
    })()`));
    assert.equal(afterHover.title, "rgb(31, 42, 36)");
    assert.equal(afterHover.row, "rgb(31, 42, 36)");
  } finally {
    if (page) await page.close();
    await stopProcess(chrome);
    await stopProcess(child);
    await release();
  }
});
