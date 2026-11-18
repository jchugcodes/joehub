import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test, { after } from "node:test";
import { acquireBrowserLock, reservePort, spawnLogged, startChrome, stopProcess, waitForChrome, waitForHttp } from "./support/harness.mjs";

let port = 0;
let cdp = 0;
const base = () => `http://127.0.0.1:${port}`;
const ROOT = fileURLToPath(new URL("..", import.meta.url));
const chromeBin = ["google-chrome", "google-chrome-stable"].find((bin) => spawnSync("which", [bin]).status === 0);

let child = null;
let chrome = null;
let browser = null;
let release = async () => {};

async function ensureBrowser() {
  if (browser) return browser;
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
      JOEHUB_SESSION_SECRET: "jobs-interaction-secret-value",
    },
  });
  child = started.child;
  await waitForHttp(`${base()}/jobs`, {
    child,
    log: started.log,
    accept: (response) => response.status === 200 && (response.headers.get("content-type") || "").includes("text/html"),
  });
  chrome = startChrome(chromeBin, cdp, `/tmp/chrome-jobs-interactions-${process.pid}`);
  await waitForChrome(cdp, chrome);
  browser = true;
  return browser;
}

async function withPage(path, width, height, run) {
  await ensureBrowser();
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
  await send("Page.navigate", { url: `${base()}${path}` });
  await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: true });
  try {
    return await run(send);
  } finally {
    ws.close();
    await fetch(`http://127.0.0.1:${cdp}/json/close/${created.id}`);
  }
}

async function evalPage(send, expression) {
  const result = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (result.result?.exceptionDetails) {
    throw new Error(JSON.stringify(result.result.exceptionDetails));
  }
  return result.result?.result?.value;
}

after(async () => {
  await stopProcess(chrome);
  await stopProcess(child);
  await release();
});

test("the stage screen shows the fixture stage and does not offer a save", { timeout: 120000, skip: chromeBin ? false : "google-chrome is not installed" }, async () => {
  const value = await withPage("/jobs/globex/stage", 390, 800, async (send) => {
    for (let i = 0; i < 40; i++) {
      const ready = await evalPage(send, "document.querySelector(\"[data-ready='true'] h1\")?.textContent || ''");
      if (ready === "Globex") break;
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    return evalPage(send, `(() => {
      const labels = [...document.querySelectorAll("button, a")].map((el) => (el.textContent || "").replace(/\\s+/g, " ").trim());
      const stage = [...document.querySelectorAll("span")].find((el) => el.textContent === "Current stage");
      return {
        shown: stage?.nextElementSibling?.textContent?.trim() || "",
        change: labels.includes("Change stage"),
        save: labels.includes("Save stage"),
        undo: labels.includes("Undo"),
        dialog: Boolean(document.querySelector("[role='dialog']")),
        demo: document.body.innerText.includes("Demo only. Nothing was saved."),
      };
    })()`);
  });
  assert.equal(value.shown, "Interviewing");
  assert.equal(value.change, false);
  assert.equal(value.save, false);
  assert.equal(value.undo, false);
  assert.equal(value.dialog, false);
  assert.equal(value.demo, false);
});

test("the board scroller is a named region and arrow keys reveal off-screen columns", { timeout: 120000, skip: chromeBin ? false : "google-chrome is not installed" }, async () => {
  const value = await withPage("/jobs", 320, 800, async (send) => {
    for (let i = 0; i < 40; i++) {
      const ready = await evalPage(send, "document.querySelector(\"[aria-label='Pipeline columns']\") && document.querySelector(\"[aria-label='Jobs sections'] [data-hydrated='true']\") ? 'yes' : ''");
      if (ready === "yes") break;
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    return evalPage(send, `(() => {
      const scroller = document.querySelector("[aria-label='Pipeline columns']");
      const offer = [...scroller.querySelectorAll("section")].find((section) => (section.getAttribute("aria-label") || "") === "Offer");
      const view = () => scroller.getBoundingClientRect();
      const offerBox = () => offer.getBoundingClientRect();
      const before = offerBox().left > view().right - 1;
      const start = scroller.scrollLeft;
      scroller.focus();
      scroller.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true, cancelable: true }));
      const once = scroller.scrollLeft;
      scroller.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true, cancelable: true }));
      scroller.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true, cancelable: true }));
      const box = offerBox();
      const frame = view();
      return {
        tabIndex: scroller.tabIndex,
        name: scroller.getAttribute("aria-label"),
        before,
        start,
        once,
        offerVisible: box.left >= frame.left - 1 && box.right <= frame.right + 1,
      };
    })()`);
  });
  assert.equal(value.tabIndex, 0);
  assert.equal(value.name, "Pipeline columns");
  assert.equal(value.before, true, "Offer was already on screen before scrolling");
  assert.ok(value.once > value.start + 40, `arrow key did not scroll (${value.start} -> ${value.once})`);
  assert.equal(value.offerVisible, true, "Offer stayed off screen after arrow keys");
});

test("pipeline matches stay on the page without filter, save, or dismiss", { timeout: 120000, skip: chromeBin ? false : "google-chrome is not installed" }, async () => {
  const value = await withPage("/jobs", 390, 800, async (send) => {
    for (let i = 0; i < 40; i++) {
      const ready = await evalPage(send, "document.querySelector(\"h1\")?.textContent === 'Pipeline' && document.body.innerText.includes('Senior Product Analyst') ? 'yes' : ''");
      if (ready === "yes") break;
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    return evalPage(send, `(() => {
      const text = document.body.innerText;
      const labels = [...document.querySelectorAll("button, a")].map((el) => (el.getAttribute("aria-label") || el.textContent || "").replace(/\\s+/g, " ").trim());
      return {
        globex: text.includes("Senior Product Analyst"),
        hooli: text.includes("Strategy & Ops Lead"),
        filter: labels.includes("Filter pipeline"),
        save: labels.includes("Save to pipeline"),
        dismiss: labels.some((label) => label.startsWith("Dismiss ")),
        demo: text.includes("Demo only. Nothing was saved."),
      };
    })()`);
  });
  assert.equal(value.globex, true);
  assert.equal(value.hooli, true);
  assert.equal(value.filter, false);
  assert.equal(value.save, false);
  assert.equal(value.dismiss, false);
  assert.equal(value.demo, false);
});

test("empty and error cards are left aligned and the jobs header uses the shared inset", { timeout: 120000, skip: chromeBin ? false : "google-chrome is not installed" }, async () => {
  const empty = await withPage("/jobs?view=empty", 390, 800, async (send) => {
    for (let i = 0; i < 40; i++) {
      const ready = await evalPage(send, "(() => { const card = document.querySelector('.card'); return card && getComputedStyle(card).borderRadius === '20px' ? 'yes' : ''; })()");
      if (ready === "yes") break;
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    return evalPage(send, `(() => {
      const card = document.querySelector(".card");
      const heading = card.querySelector("h2");
      const action = [...document.querySelectorAll("a, button")].find((el) => (el.textContent || "").trim() === "Explore matches");
      const header = document.querySelector("header");
      const main = document.querySelector("main");
      return {
        align: getComputedStyle(heading).textAlign,
        radius: getComputedStyle(card).borderRadius,
        outside: !card.contains(action),
        gap: Math.round(action.getBoundingClientRect().top - card.getBoundingClientRect().bottom),
        addRole: [...document.querySelectorAll("button")].some((el) => (el.textContent || "").trim() === "Add a role"),
        headerPad: getComputedStyle(header).paddingTop,
        mainPad: getComputedStyle(main).paddingTop,
        headerTop: Math.round(header.getBoundingClientRect().top),
      };
    })()`);
  });
  assert.ok(empty.align === "left" || empty.align === "start", empty.align);
  assert.equal(empty.radius, "20px");
  assert.equal(empty.outside, true);
  assert.equal(empty.gap, 16);
  assert.equal(empty.addRole, false);
  assert.equal(empty.headerPad, "0px");
  assert.equal(empty.mainPad, "8px");
  assert.equal(empty.headerTop, 8);

  const error = await withPage("/jobs?view=error", 390, 800, async (send) => {
    for (let i = 0; i < 40; i++) {
      const ready = await evalPage(send, "(() => { const card = document.querySelector('.card'); return card && getComputedStyle(card).borderRadius === '20px' ? 'yes' : ''; })()");
      if (ready === "yes") break;
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    return evalPage(send, `(() => {
      const card = document.querySelector(".card");
      const action = [...document.querySelectorAll("button")].find((el) => (el.textContent || "").trim() === "Retry");
      const note = [...document.querySelectorAll("p")].find((el) => (el.textContent || "").includes("No cached"));
      return {
        align: getComputedStyle(card.querySelector("h2")).textAlign,
        radius: getComputedStyle(card).borderRadius,
        outside: !card.contains(action),
        gap: Math.round(action.getBoundingClientRect().top - card.getBoundingClientRect().bottom),
        noteGap: Math.round(note.getBoundingClientRect().top - action.getBoundingClientRect().bottom),
        noteInset: getComputedStyle(note).paddingLeft,
      };
    })()`);
  });
  assert.ok(error.align === "left" || error.align === "start", error.align);
  assert.equal(error.radius, "20px");
  assert.equal(error.outside, true);
  assert.equal(error.gap, 16);
  assert.equal(error.noteGap, 20);
  assert.equal(error.noteInset, "20px");
});
