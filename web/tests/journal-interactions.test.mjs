import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { acquireBrowserLock, reservePort, spawnLogged, startChrome, stopProcess, waitForChrome, waitForHttp } from "./support/harness.mjs";

let port = 0;
let cdp = 0;
const base = () => `http://127.0.0.1:${port}`;
const ROOT = fileURLToPath(new URL("..", import.meta.url));
const chromeBin = ["google-chrome", "google-chrome-stable"].find((bin) => spawnSync("which", [bin]).status === 0);
const skip = chromeBin ? false : "google-chrome is not installed";

let child;
let chrome;
let release = async () => {};

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
      JOEHUB_SESSION_SECRET: "journal-test-secret-value",
    },
  });
  child = started.child;
  await waitForHttp(`${base()}/journal`, {
    child,
    log: started.log,
    accept: (response) => response.status === 200 && (response.headers.get("content-type") || "").includes("text/html"),
  });
  chrome = startChrome(chromeBin, cdp, `/tmp/chrome-journal-${process.pid}`);
  await waitForChrome(cdp, chrome);
}

async function openPage(path, width, height) {
  const created = await fetch(`http://127.0.0.1:${cdp}/json/new?${encodeURIComponent(`${base()}${path}`)}`, { method: "PUT" }).then((response) => response.json());
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
  const readyBy = Date.now() + 45000;
  let readyValue = "";
  while (Date.now() < readyBy) {
    const ready = await send("Runtime.evaluate", {
      expression: "(() => { const h1 = document.querySelector('h1'); return document.querySelector(\"[data-ready='true']\") && h1 && parseFloat(getComputedStyle(h1).fontSize) > 10 ? 'yes' : ''; })()",
      returnByValue: true,
    });
    readyValue = ready.result?.result?.value || "";
    if (readyValue === "yes") break;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  if (readyValue !== "yes") throw new Error(`journal page was not ready for ${path}`);
  return {
    send,
    async close() {
      ws.close();
      await fetch(`http://127.0.0.1:${cdp}/json/close/${created.id}`);
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

test.before(async () => {
  if (!chromeBin) return;
  await boot();
});

test.after(async () => {
  await stopProcess(chrome);
  await stopProcess(child);
  await release();
});

test("journal pages stay inside 320px and 200% text", { timeout: 180000, skip }, async () => {
  const cases = [
    ["/journal", 320, 800, false],
    ["/journal?view=loading", 320, 800, false],
    ["/journal?view=empty", 320, 800, false],
    ["/journal?view=error", 320, 800, false],
    ["/journal/nightly-win-nov-6", 320, 800, false],
    ["/journal?view=filtered", 320, 900, false],
    ["/journal", 390, 900, true],
    ["/journal?view=empty", 390, 900, true],
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
    assert.deepEqual(value.tabs, ["Home", "Finance", "Jobs", "Journal", "More"]);
    assert.equal(value.tabsInside, true, `${path} clips a primary tab`);
    if (enlarge && path === "/journal") {
      assert.ok(Math.abs(value.title - 44) < 0.6, `journal title computed ${value.title}px`);
    }
    if (path === "/journal" || path === "/journal?view=empty") {
      assert.equal(value.nav, true);
    }
    await page.close();
  }
});

test("journal filters are keyboard reachable and the composer is gone", { timeout: 120000, skip }, async () => {
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
  const gone = await evalValue(
    feed.send,
    `(() => ({
      composer: document.querySelector("#new-entry, a[href*='/journal/compose']") ? "yes" : "no",
      demo: document.body.innerText.includes("Demo only. Nothing was saved.") ? "yes" : "no",
      add: [...document.querySelectorAll("a, button")].some((el) => /^(New entry|Write your first entry|Add a date)$/.test((el.textContent || "").trim()) || (el.getAttribute("aria-label") || "") === "New entry") ? "yes" : "no",
    }))()`,
  );
  assert.equal(gone.composer, "no");
  assert.equal(gone.demo, "no");
  assert.equal(gone.add, "no");
  await feed.close();
});

function clickNamed(label, selector) {
  return `(() => {
    const nodes = [...document.querySelectorAll(${JSON.stringify(selector)})];
    const node = nodes.find((item) => (item.textContent || "").replace(/\\s+/g, " ").trim() === ${JSON.stringify(label)} || (item.textContent || "").includes(${JSON.stringify(label)}));
    if (!node) return "missing";
    node.click();
    return "ok";
  })()`;
}

async function journalState(send) {
  return evalValue(
    send,
    `(() => {
      const pressed = [...document.querySelectorAll("[aria-label='Journal filters'] button")].find((button) => button.getAttribute("aria-pressed") === "true");
      const text = document.body.innerText;
      return {
        ready: Boolean(document.querySelector("[data-ready='true']")),
        pressed: (pressed?.textContent || "").trim(),
        path: location.pathname + location.search,
        win: text.includes("Finished Globex take-home"),
        placesEmpty: text.includes("No places yet"),
        lilia: text.includes("Lilia"),
      };
    })()`,
  );
}

async function waitJournal(send, predicate, attempts = 30) {
  let state = null;
  for (let i = 0; i < attempts; i++) {
    state = await journalState(send);
    if (state && predicate(state)) return state;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  return state;
}

async function visitJournal(send) {
  assert.equal(await evalValue(send, clickNamed("Home", "nav[aria-label='Primary'] a")), "ok");
  let path = "";
  for (let i = 0; i < 30; i++) {
    path = await evalValue(send, "location.pathname");
    if (path === "/") break;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  assert.equal(path, "/");
  assert.equal(await evalValue(send, clickNamed("Journal", "nav[aria-label='Primary'] a")), "ok");
  return waitJournal(send, (state) => state.ready && state.path === "/journal");
}

test("show all entries and Feed leave the filtered preview", { timeout: 120000, skip }, async () => {
  const page = await openPage("/journal?view=filtered", 390, 844);
  const loaded = await waitJournal(page.send, (state) => state.ready && state.placesEmpty);
  assert.equal(loaded.pressed, "Places");
  assert.equal(loaded.win, false);
  assert.equal(loaded.path, "/journal?view=filtered");

  const persistedPlaces = await visitJournal(page.send);
  assert.equal(persistedPlaces.pressed, "Places", JSON.stringify(persistedPlaces));
  assert.equal(persistedPlaces.win, false, JSON.stringify(persistedPlaces));
  assert.equal(persistedPlaces.lilia, true, JSON.stringify(persistedPlaces));

  assert.equal(
    await evalValue(
      page.send,
      `(() => {
        const link = document.createElement("a");
        link.href = "/journal?view=filtered";
        link.textContent = "filtered preview";
        document.body.appendChild(link);
        link.click();
        return "ok";
      })()`,
    ),
    "ok",
  );
  const preview = await waitJournal(page.send, (state) => state.ready && state.placesEmpty && state.path.includes("view=filtered"));
  assert.equal(preview.pressed, "Places");

  assert.equal(await evalValue(page.send, clickNamed("Show all entries", "button")), "ok");
  const shown = await waitJournal(page.send, (state) => state.ready && state.win && state.pressed === "Feed" && !state.path.includes("view="));
  assert.equal(shown.placesEmpty, false, JSON.stringify(shown));
  assert.equal(shown.path, "/journal", JSON.stringify(shown));

  const afterShowAll = await visitJournal(page.send);
  assert.equal(afterShowAll.pressed, "Feed", JSON.stringify(afterShowAll));
  assert.equal(afterShowAll.win, true, JSON.stringify(afterShowAll));
  assert.equal(afterShowAll.placesEmpty, false, JSON.stringify(afterShowAll));
  await page.close();

  const feed = await openPage("/journal?view=filtered", 390, 844);
  const again = await waitJournal(feed.send, (state) => state.ready && state.placesEmpty && state.pressed === "Places");
  assert.equal(again.win, false);
  assert.equal(await evalValue(feed.send, clickNamed("Feed", "[aria-label='Journal filters'] button")), "ok");
  const selected = await waitJournal(feed.send, (state) => state.ready && state.win && state.pressed === "Feed" && !state.path.includes("view="));
  assert.equal(selected.placesEmpty, false, JSON.stringify(selected));
  assert.equal(selected.path, "/journal", JSON.stringify(selected));
  const afterFeed = await visitJournal(feed.send);
  assert.equal(afterFeed.pressed, "Feed", JSON.stringify(afterFeed));
  assert.equal(afterFeed.win, true, JSON.stringify(afterFeed));
  await feed.close();
});
