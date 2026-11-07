import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

const PORT = 3700 + (process.pid % 200);
const CDP = 9700 + (process.pid % 200);
const BASE = `http://127.0.0.1:${PORT}`;
const ROOT = fileURLToPath(new URL("..", import.meta.url));
const chromeBin = ["google-chrome", "google-chrome-stable"].find((bin) => spawnSync("which", [bin]).status === 0);
const skip = chromeBin ? false : "google-chrome is not installed";

let child;
let chrome;
let output = "";

async function boot() {
  output = "";
  child = spawn(process.execPath, ["node_modules/next/dist/bin/next", "dev", "-H", "127.0.0.1", "-p", String(PORT)], {
    cwd: ROOT,
    env: {
      PATH: process.env.PATH,
      HOME: process.env.HOME || "/tmp",
      TMPDIR: process.env.TMPDIR || "/tmp",
      LANG: "C.UTF-8",
      NODE_ENV: "development",
      JOEHUB_DEV_AUTH: "1",
      JOEHUB_SESSION_SECRET: "journal-test-secret-value",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (chunk) => {
    output += chunk;
  });
  child.stderr.on("data", (chunk) => {
    output += chunk;
  });
  const deadline = Date.now() + 90000;
  while (Date.now() < deadline) {
    if (child.exitCode != null) throw new Error(`next dev exited\n${output.slice(-2000)}`);
    try {
      const response = await fetch(`${BASE}/journal`, { signal: AbortSignal.timeout(2000) });
      if (response.status === 200) break;
    } catch {
      // still booting
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  chrome = spawn(
    chromeBin,
    [
      "--headless=new",
      "--disable-gpu",
      "--no-sandbox",
      "--disable-dev-shm-usage",
      `--remote-debugging-port=${CDP}`,
      `--user-data-dir=/tmp/chrome-journal-${process.pid}`,
      "about:blank",
    ],
    { stdio: "ignore" },
  );
  for (let i = 0; i < 40; i++) {
    try {
      await fetch(`http://127.0.0.1:${CDP}/json/version`);
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }
  throw new Error("chrome did not open a debugging port");
}

async function openPage(path, width, height) {
  const created = await fetch(`http://127.0.0.1:${CDP}/json/new?${encodeURIComponent(`${BASE}${path}`)}`, { method: "PUT" }).then((response) => response.json());
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
  await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: width < 500 });
  for (let i = 0; i < 50; i++) {
    const ready = await send("Runtime.evaluate", {
      expression: "(() => { const h1 = document.querySelector('h1'); return document.querySelector(\"[data-ready='true']\") && h1 && parseFloat(getComputedStyle(h1).fontSize) > 10 ? 'yes' : ''; })()",
      returnByValue: true,
    });
    if (ready.result?.result?.value === "yes") break;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  return {
    send,
    async close() {
      ws.close();
      await fetch(`http://127.0.0.1:${CDP}/json/close/${created.id}`);
    },
  };
}

async function evalValue(send, expression) {
  const message = await send("Runtime.evaluate", { expression, returnByValue: true });
  return message.result?.result?.value;
}

async function tab(send) {
  await send("Input.dispatchKeyEvent", { type: "keyDown", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9, nativeVirtualKeyCode: 9 });
  await send("Input.dispatchKeyEvent", { type: "keyUp", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9, nativeVirtualKeyCode: 9 });
}

function setField(id, value) {
  return `(() => {
    const field = document.getElementById(${JSON.stringify(id)});
    const proto = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set;
    proto.call(field, ${JSON.stringify(value)});
    field.dispatchEvent(new Event("input", { bubbles: true }));
    return field.value;
  })()`;
}

test.before(async () => {
  if (!chromeBin) return;
  await boot();
});

test.after(() => {
  chrome?.kill();
  child?.kill();
});

test("journal pages stay inside 320px and 200% text", { timeout: 180000, skip }, async () => {
  const cases = [
    ["/journal", 320, 800, false],
    ["/journal?view=loading", 320, 800, false],
    ["/journal?view=empty", 320, 800, false],
    ["/journal?view=error", 320, 800, false],
    ["/journal/compose", 320, 800, false],
    ["/journal/compose?view=typing", 320, 800, false],
    ["/journal/compose?view=error", 320, 800, false],
    ["/journal/compose?view=saving", 320, 800, false],
    ["/journal/compose?view=saved", 320, 800, false],
    ["/journal/compose?mode=date", 320, 900, false],
    ["/journal/nightly-win-nov-6", 320, 800, false],
    ["/journal", 390, 900, true],
    ["/journal?view=empty", 390, 900, true],
    ["/journal/compose", 390, 900, true],
    ["/journal/nightly-win-nov-6", 390, 900, true],
  ];
  for (const [path, width, height, enlarge] of cases) {
    const page = await openPage(path, width, height);
    if (enlarge) {
      await page.send("Runtime.evaluate", { expression: "document.documentElement.style.fontSize = '200%'" });
      await page.send("Runtime.evaluate", {
        expression: "new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))",
        awaitPromise: true,
      });
    }
    const value = await evalValue(
      page.send,
      `(() => {
        const doc = document.documentElement;
        const primary = document.querySelector("nav[aria-label='Primary'] ul");
        const tabs = primary ? [...primary.querySelectorAll("a")] : [];
        const h1 = document.querySelector("h1");
        const action = document.querySelector(".action-link");
        return {
          overflow: doc.scrollWidth - doc.clientWidth,
          title: h1 ? parseFloat(getComputedStyle(h1).fontSize) : 0,
          action: action ? action.getBoundingClientRect().height : 0,
          tabs: tabs.map((tab) => (tab.textContent || "").replace(/\\s+/g, " ").trim()),
          tabsInside: tabs.every((tab) => {
            const box = tab.getBoundingClientRect();
            return box.width > 0 && box.left >= -1 && box.right <= window.innerWidth + 1 && box.bottom <= window.innerHeight + 1;
          }),
          nav: Boolean(primary),
        };
      })()`,
    );
    assert.ok(value, `no measurement for ${path}`);
    assert.ok(value.overflow <= 1, `${path} at ${width}${enlarge ? " text 200%" : ""} overflows by ${value.overflow}px`);
    if (path.startsWith("/journal/compose")) {
      assert.equal(value.nav, false, `${path} still shows the primary nav`);
    } else {
      assert.deepEqual(value.tabs, ["Home", "Finance", "Jobs", "Journal", "More"]);
      assert.equal(value.tabsInside, true, `${path} clips a primary tab`);
    }
    if (enlarge && path === "/journal") {
      assert.ok(Math.abs(value.title - 44) < 0.6, `journal title computed ${value.title}px`);
    }
    if (path === "/journal?view=empty") {
      assert.ok(value.action >= 48, `empty action height ${value.action}`);
    }
    await page.close();
  }
});

test("journal filters and the composer are keyboard reachable", { timeout: 120000, skip }, async () => {
  const feed = await openPage("/journal", 320, 800);
  await feed.send("Emulation.setFocusEmulationEnabled", { enabled: true });
  const expected = ["Feed", "Wins", "Dates", "Places"];
  let guard = 0;
  while ((await evalValue(feed.send, "(document.activeElement.textContent || '').trim()")) !== "Feed" && guard < 8) {
    await tab(feed.send);
    guard += 1;
  }
  for (const label of expected) {
    const focused = await evalValue(
      feed.send,
      `(() => {
        const el = document.activeElement;
        const scroller = document.querySelector("[aria-label='Journal filters']");
        const box = el.getBoundingClientRect();
        const view = scroller.getBoundingClientRect();
        return {
          text: (el.textContent || "").trim(),
          pressed: el.getAttribute("aria-pressed"),
          height: box.height,
          inScroller: box.width > 0 && box.left >= view.left - 2 && box.right <= view.right + 2,
          overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        };
      })()`,
    );
    assert.equal(focused.text, label, JSON.stringify(focused));
    assert.ok(focused.height >= 44, `${label} is ${focused.height}px tall`);
    assert.equal(focused.inScroller, true, `${label} is outside the filter strip`);
    assert.ok(focused.overflow <= 1, `${label} widened the page`);
    if (label !== "Places") await tab(feed.send);
  }
  assert.equal(await evalValue(feed.send, "document.querySelector(\"[aria-pressed='true']\").textContent.trim()"), "Feed");
  await feed.close();

  const compose = await openPage("/journal/compose?mode=date", 390, 900);
  await compose.send("Emulation.setFocusEmulationEnabled", { enabled: true });
  assert.equal(await evalValue(compose.send, "document.querySelector(\"[aria-modal='true']\")"), null);
  const order = [];
  for (let step = 0; step < 16; step += 1) {
    await tab(compose.send);
    order.push(await evalValue(compose.send, "(document.activeElement.innerText || document.activeElement.id || document.activeElement.getAttribute('aria-label') || '').trim()"));
  }
  assert.ok(order.includes("Nightly win"), JSON.stringify(order));
  assert.ok(order.includes("Date"), JSON.stringify(order));
  assert.ok(order.includes("Add to journal"), JSON.stringify(order));
  assert.ok(order.includes("Cancel"), JSON.stringify(order));
  const cancelAt = order.indexOf("Cancel");
  const addAt = order.indexOf("Add to journal");
  assert.ok(addAt >= 0 && cancelAt > addAt, JSON.stringify(order));
  await compose.close();
});

test("saving previews the demo sentence and cancel drops a pending save", { timeout: 120000, skip }, async () => {
  const compose = await openPage("/journal/compose", 390, 844);
  await evalValue(compose.send, "document.querySelector('form').requestSubmit()");
  const invalid = await evalValue(
    compose.send,
    `(() => ({
      error: document.getElementById("entry-error")?.textContent || "",
      focus: document.activeElement?.id || "",
      invalid: document.getElementById("win-text")?.getAttribute("aria-invalid"),
    }))()`,
  );
  assert.equal(invalid.error, "Write one thing that went well before adding your entry.");
  assert.equal(invalid.focus, "win-text");
  assert.equal(invalid.invalid, "true");

  const unique = "Wrote a synthetic line";
  await evalValue(compose.send, setField("win-text", unique));
  await evalValue(compose.send, "document.querySelector('form').requestSubmit()");
  let saved = "";
  for (let i = 0; i < 20; i++) {
    saved = await evalValue(compose.send, "document.body.innerText");
    if (saved.includes("Demo only. Nothing was saved.")) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.match(saved, /Demo only\. Nothing was saved\./);
  assert.match(saved, /Synthetic saved-state preview\. Nothing was written\./);
  assert.equal(await evalValue(compose.send, "JSON.stringify(localStorage).includes('Wrote a synthetic line')"), false);
  await compose.close();

  const feed = await openPage("/journal", 390, 844);
  const feedText = await evalValue(feed.send, "document.body.innerText");
  assert.equal(feedText.includes(unique), false);
  assert.equal(feedText.includes("Finished Globex take-home"), true);
  await feed.close();

  const pending = await openPage("/journal/compose", 390, 844);
  await evalValue(pending.send, setField("win-text", "Pending line to drop"));
  await evalValue(pending.send, "document.querySelector('form').requestSubmit()");
  let busy = "";
  for (let i = 0; i < 15; i++) {
    busy = await evalValue(pending.send, "document.querySelector('form')?.getAttribute('aria-busy') || ''");
    if (busy === "true") break;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.equal(busy, "true");
  await evalValue(pending.send, "[...document.querySelectorAll('button')].find((button) => button.textContent.trim() === 'Cancel').click()");
  let after = { path: "", text: "" };
  for (let i = 0; i < 25; i++) {
    after = await evalValue(
      pending.send,
      `(() => ({ path: location.pathname, text: document.body.innerText }))()`,
    );
    if (after.path === "/journal" && after.text.includes("Wins & dates")) break;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  assert.equal(after.path, "/journal");
  assert.equal(after.text.includes("Entry added"), false);
  assert.equal(after.text.includes("Pending line to drop"), false);
  assert.equal(after.text.includes("Demo only. Nothing was saved."), false);
  await pending.close();

  const date = await openPage("/journal/compose?mode=date", 390, 844);
  await evalValue(date.send, "document.querySelector('form').requestSubmit()");
  const place = await evalValue(
    date.send,
    `(() => ({
      error: document.getElementById("entry-error")?.textContent || "",
      focus: document.activeElement?.id || "",
    }))()`,
  );
  assert.equal(place.error, "Add a place before adding this date.");
  assert.equal(place.focus, "place");
  await date.close();
});
