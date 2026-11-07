import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

const PORT = 3400 + (process.pid % 200);
const CDP = 9400 + (process.pid % 200);
const BASE = `http://127.0.0.1:${PORT}`;
const ROOT = fileURLToPath(new URL("..", import.meta.url));
const chromeBin = ["google-chrome", "google-chrome-stable"].find((bin) => spawnSync("which", [bin]).status === 0);

function measureSource() {
  return `(() => {
    const doc = document.documentElement;
    const nav = document.querySelector("nav[aria-label='Finance sections']");
    const scroller = nav ? nav.querySelector(":scope > div") : null;
    const hint = nav ? [...nav.children].find((el) => (el.textContent || "").includes("swipe")) : null;
    return {
      overflow: doc.scrollWidth - doc.clientWidth,
      hintOutside: hint ? !scroller.contains(hint) && nav.contains(hint) : null,
      contained: nav ? nav.dataset.tabs || "" : "",
    };
  })()`;
}

async function waitForPage(child, log) {
  const deadline = Date.now() + 90000;
  while (Date.now() < deadline) {
    if (child.exitCode != null) throw new Error(`next dev exited\n${log()}`);
    try {
      const response = await fetch(`${BASE}/finance/goals`);
      if (response.status === 200 && (response.headers.get("content-type") || "").includes("text/html")) return;
    } catch {
      // still booting
    }
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  throw new Error(`next dev did not serve the goals page\n${log()}`);
}

test("finance tabs do not widen the page", { timeout: 120000, skip: chromeBin ? false : "google-chrome is not installed" }, async () => {
  let output = "";
  const child = spawn(process.execPath, ["node_modules/next/dist/bin/next", "dev", "-H", "127.0.0.1", "-p", String(PORT)], {
    cwd: ROOT,
    env: {
      PATH: process.env.PATH,
      HOME: process.env.HOME || "/tmp",
      TMPDIR: process.env.TMPDIR || "/tmp",
      LANG: "C.UTF-8",
      NODE_ENV: "development",
      JOEHUB_DEV_AUTH: "1",
      JOEHUB_SESSION_SECRET: "overflow-test-secret-value",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (chunk) => {
    output += chunk;
  });
  child.stderr.on("data", (chunk) => {
    output += chunk;
  });
  const log = () => output.slice(-4000);
  const udd = `/tmp/chrome-overflow-test-${process.pid}`;
  const chrome = spawn(chromeBin, [
    "--headless=new",
    "--disable-gpu",
    "--no-sandbox",
    "--disable-dev-shm-usage",
    `--remote-debugging-port=${CDP}`,
    `--user-data-dir=${udd}`,
    "about:blank",
  ], { stdio: "ignore" });
  try {
    await waitForPage(child, log);
    for (let i = 0; i < 40; i++) {
      try {
        await fetch(`http://127.0.0.1:${CDP}/json/version`);
        break;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
    }
    const cases = [
      ["/finance/goals", 320, 700, false],
      ["/finance/accounts", 320, 700, false],
      ["/finance", 320, 700, false],
      ["/finance/goals", 390, 844, true],
      ["/finance", 390, 844, true],
    ];
    for (const [path, width, height, enlarge] of cases) {
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
      for (let i = 0; i < 40; i++) {
        const ready = await send("Runtime.evaluate", {
          expression: "document.querySelector(\"[aria-label='Finance sections'] [data-hydrated='true']\") ? 'yes' : document.readyState",
          returnByValue: true,
        });
        if (ready.result?.result?.value === "yes" || (path === "/finance" && ready.result?.result?.value === "complete" && i > 4)) break;
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
      if (enlarge) {
        await send("Runtime.evaluate", { expression: "document.documentElement.style.fontSize = '200%'" });
      }
      const measured = await send("Runtime.evaluate", { expression: measureSource(), returnByValue: true });
      const value = measured.result?.result?.value;
      assert.ok(value, `no measurement for ${path} at ${width}`);
      assert.ok(value.overflow <= 1, `${path} at ${width}${enlarge ? " text 200%" : ""} overflows by ${value.overflow}px`);
      if (path === "/finance/goals") {
        assert.equal(value.contained, "contained", `served an old tab row ${JSON.stringify(value)}`);
        assert.equal(value.hintOutside, true);
        await send("Emulation.setFocusEmulationEnabled", { enabled: true });
        await send("Runtime.evaluate", {
          expression: "document.querySelector(\"[aria-label='Finance sections'] a\").focus()",
        });
        const expected = ["Overview", "Categories", "Goals", "Accounts"];
        for (let step = 0; step < expected.length; step += 1) {
          if (step > 0) {
            await send("Input.dispatchKeyEvent", {
              type: "keyDown",
              key: "Tab",
              code: "Tab",
              windowsVirtualKeyCode: 9,
              nativeVirtualKeyCode: 9,
            });
            await send("Input.dispatchKeyEvent", {
              type: "keyUp",
              key: "Tab",
              code: "Tab",
              windowsVirtualKeyCode: 9,
              nativeVirtualKeyCode: 9,
            });
          }
          const focused = await send("Runtime.evaluate", {
            expression: `(() => {
              const el = document.activeElement;
              const scroller = document.querySelector("[aria-label='Finance sections'] > div");
              const box = el.getBoundingClientRect();
              const view = scroller.getBoundingClientRect();
              const doc = document.documentElement;
              return {
                text: (el.textContent || "").trim(),
                inScroller: box.width > 0 && box.left >= view.left - 2 && box.right <= view.right + 2,
                inPage: box.left >= -2 && box.right <= window.innerWidth + 2,
                pageOverflow: doc.scrollWidth - doc.clientWidth,
              };
            })()`,
            returnByValue: true,
          });
          const link = focused.result?.result?.value;
          assert.equal(link.text, expected[step], `Tab did not reach ${expected[step]} ${JSON.stringify(link)}`);
          assert.equal(link.inScroller, true, `keyboard focus on ${link?.text} is outside the tab scroller ${JSON.stringify(link)}`);
          assert.equal(link.inPage, true, `keyboard focus on ${link?.text} is outside the page`);
          assert.ok(link.pageOverflow <= 1, `keyboard focus on ${link?.text} widened the page`);
        }
      }
      ws.close();
      await fetch(`http://127.0.0.1:${CDP}/json/close/${created.id}`);
    }
  } finally {
    chrome.kill();
    child.kill();
  }
});
