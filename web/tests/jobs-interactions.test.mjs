import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test, { after } from "node:test";

const PORT = 3600 + (process.pid % 200);
const CDP = 9600 + (process.pid % 200);
const BASE = `http://127.0.0.1:${PORT}`;
const ROOT = fileURLToPath(new URL("..", import.meta.url));
const chromeBin = ["google-chrome", "google-chrome-stable"].find((bin) => spawnSync("which", [bin]).status === 0);

let child = null;
let chrome = null;
let browser = null;

async function waitForServer(log) {
  const deadline = Date.now() + 90000;
  while (Date.now() < deadline) {
    if (child.exitCode != null) throw new Error(`next dev exited\n${log()}`);
    try {
      const response = await fetch(`${BASE}/jobs`, { signal: AbortSignal.timeout(2000) });
      if (response.status === 200 && (response.headers.get("content-type") || "").includes("text/html")) return;
    } catch {
      // still booting
    }
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  throw new Error(`next dev did not serve jobs\n${log()}`);
}

async function ensureBrowser() {
  if (browser) return browser;
  let output = "";
  child = spawn(process.execPath, ["node_modules/next/dist/bin/next", "dev", "-H", "127.0.0.1", "-p", String(PORT)], {
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
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (chunk) => {
    output += chunk;
  });
  child.stderr.on("data", (chunk) => {
    output += chunk;
  });
  chrome = spawn(chromeBin, [
    "--headless=new",
    "--disable-gpu",
    "--no-sandbox",
    "--disable-dev-shm-usage",
    `--remote-debugging-port=${CDP}`,
    `--user-data-dir=/tmp/chrome-jobs-interactions-${process.pid}`,
    "about:blank",
  ], { stdio: "ignore" });
  await waitForServer(() => output.slice(-4000));
  for (let i = 0; i < 40; i++) {
    try {
      await fetch(`http://127.0.0.1:${CDP}/json/version`);
      break;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }
  browser = true;
  return browser;
}

async function withPage(path, width, height, run) {
  await ensureBrowser();
  const created = await fetch(`http://127.0.0.1:${CDP}/json/new?about:blank`, { method: "PUT" }).then((response) => response.json());
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
  await send("Page.navigate", { url: `${BASE}${path}` });
  await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: true });
  try {
    return await run(send);
  } finally {
    ws.close();
    await fetch(`http://127.0.0.1:${CDP}/json/close/${created.id}`);
  }
}

async function evalPage(send, expression) {
  const result = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (result.result?.exceptionDetails) {
    throw new Error(JSON.stringify(result.result.exceptionDetails));
  }
  return result.result?.result?.value;
}

after(() => {
  chrome?.kill();
  child?.kill();
});

test("save previews the stage the user picked", { timeout: 120000, skip: chromeBin ? false : "google-chrome is not installed" }, async () => {
  const value = await withPage("/jobs/globex/stage", 390, 800, async (send) => {
    for (let i = 0; i < 40; i++) {
      const ready = await evalPage(send, "document.querySelector(\"[data-ready='true'] h1\")?.textContent || ''");
      if (ready === "Globex") break;
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    return evalPage(send, `(() => {
      const click = (label) => {
        const node = [...document.querySelectorAll("button, a")].find((el) => (el.textContent || "").trim() === label);
        if (!node) throw new Error("missing " + label);
        node.click();
      };
      const stage = () => {
        const label = [...document.querySelectorAll("span")].find((el) => el.textContent === "Current stage");
        return label?.nextElementSibling?.textContent?.trim() || "";
      };
      click("Change stage");
      return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => {
        click("Offer");
        requestAnimationFrame(() => requestAnimationFrame(() => {
          const picked = document.querySelector("[role='radio'][aria-checked='true']")?.textContent?.trim();
          click("Save stage");
          setTimeout(() => resolve({
            picked,
            shown: stage(),
            notice: document.querySelector("[role='status']")?.textContent?.trim() || "",
            open: Boolean(document.querySelector("[role='dialog']")),
          }), 500);
        }));
      })));
    })()`);
  });
  assert.equal(value.picked, "Offer");
  assert.equal(value.shown, "Offer");
  assert.equal(value.notice, "Demo only. Nothing was saved.");
  assert.equal(value.open, false);
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

test("escape and the backdrop cancel a pending stage preview", { timeout: 120000, skip: chromeBin ? false : "google-chrome is not installed" }, async () => {
  const value = await withPage("/jobs/globex/stage", 390, 800, async (send) => {
    for (let i = 0; i < 40; i++) {
      const ready = await evalPage(send, "document.querySelector(\"[data-ready='true'] h1\")?.textContent || ''");
      if (ready === "Globex") break;
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    return evalPage(send, `(() => {
      const click = (label) => {
        const node = [...document.querySelectorAll("button, a")].find((el) => (el.textContent || "").trim() === label);
        if (!node) throw new Error("missing " + label);
        node.click();
      };
      const stage = () => {
        const label = [...document.querySelectorAll("span")].find((el) => el.textContent === "Current stage");
        return label?.nextElementSibling?.textContent?.trim() || "";
      };
      const frame = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const arm = async () => {
        click("Change stage");
        await frame();
        click("Offer");
        await frame();
        click("Save stage");
      };
      return (async () => {
        await arm();
        document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
        await new Promise((resolve) => setTimeout(resolve, 500));
        const afterEscape = { shown: stage(), notice: document.querySelector("[role='status']")?.textContent?.trim() || "", open: Boolean(document.querySelector("[role='dialog']")) };
        await arm();
        const overlay = document.querySelector(".fixed.inset-0");
        overlay.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
        await new Promise((resolve) => setTimeout(resolve, 500));
        return {
          afterEscape,
          afterBackdrop: { shown: stage(), notice: document.querySelector("[role='status']")?.textContent?.trim() || "", open: Boolean(document.querySelector("[role='dialog']")) },
        };
      })();
    })()`);
  });
  assert.equal(value.afterEscape.shown, "Applied");
  assert.equal(value.afterEscape.notice, "");
  assert.equal(value.afterEscape.open, false);
  assert.equal(value.afterBackdrop.shown, "Applied");
  assert.equal(value.afterBackdrop.notice, "");
  assert.equal(value.afterBackdrop.open, false);
});

test("empty and error cards are left aligned and the jobs header uses the shared inset", { timeout: 120000, skip: chromeBin ? false : "google-chrome is not installed" }, async () => {
  const empty = await withPage("/jobs?view=empty", 390, 800, async (send) => {
    for (let i = 0; i < 40; i++) {
      const ready = await evalPage(send, "(() => { const card = document.querySelector('.jobs-state'); return card && getComputedStyle(card).borderRadius === '16px' ? 'yes' : ''; })()");
      if (ready === "yes") break;
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    return evalPage(send, `(() => {
      const card = document.querySelector(".jobs-state");
      const heading = card.querySelector("h2");
      const action = [...document.querySelectorAll("a, button")].find((el) => (el.textContent || "").trim() === "Explore matches");
      const header = document.querySelector("header");
      const main = document.querySelector("main");
      return {
        align: getComputedStyle(heading).textAlign,
        radius: getComputedStyle(card).borderRadius,
        outside: !card.contains(action),
        gap: Math.round(action.getBoundingClientRect().top - card.getBoundingClientRect().bottom),
        headerPad: getComputedStyle(header).paddingTop,
        mainPad: getComputedStyle(main).paddingTop,
        headerTop: Math.round(header.getBoundingClientRect().top),
      };
    })()`);
  });
  assert.ok(empty.align === "left" || empty.align === "start", empty.align);
  assert.equal(empty.radius, "16px");
  assert.equal(empty.outside, true);
  assert.equal(empty.gap, 12);
  assert.equal(empty.headerPad, "0px");
  assert.equal(empty.mainPad, "8px");
  assert.equal(empty.headerTop, 8);

  const error = await withPage("/jobs?view=error", 390, 800, async (send) => {
    for (let i = 0; i < 40; i++) {
      const ready = await evalPage(send, "(() => { const card = document.querySelector('.jobs-state'); return card && getComputedStyle(card).borderRadius === '16px' ? 'yes' : ''; })()");
      if (ready === "yes") break;
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    return evalPage(send, `(() => {
      const card = document.querySelector(".jobs-state");
      const action = [...document.querySelectorAll("button")].find((el) => (el.textContent || "").trim() === "Retry");
      return {
        align: getComputedStyle(card.querySelector("h2")).textAlign,
        radius: getComputedStyle(card).borderRadius,
        outside: !card.contains(action),
        gap: Math.round(action.getBoundingClientRect().top - card.getBoundingClientRect().bottom),
      };
    })()`);
  });
  assert.ok(error.align === "left" || error.align === "start", error.align);
  assert.equal(error.radius, "16px");
  assert.equal(error.outside, true);
  assert.equal(error.gap, 12);
});
