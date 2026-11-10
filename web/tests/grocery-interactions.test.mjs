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

let port = 0;
let cdp = 0;
let child = null;
let chrome = null;
let release = async () => {};
const base = () => `http://127.0.0.1:${port}`;

function cookieValue(response) {
  const rows = typeof response.headers.getSetCookie === "function" ? response.headers.getSetCookie() : [];
  const raw = rows.find((row) => row.startsWith("joehub_session=")) || response.headers.get("set-cookie") || "";
  return raw.split(";", 1)[0].slice("joehub_session=".length);
}

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
      JOEHUB_SESSION_SECRET: "grocery-browser-secret-value",
    },
  });
  child = started.child;
  await waitForHttp(`${base()}/grocery`, {
    child,
    log: started.log,
    accept: (response) => response.status === 200 && (response.headers.get("content-type") || "").includes("text/html"),
  });
  chrome = startChrome(chromeBin, cdp, `/tmp/chrome-grocery-${process.pid}`);
  await waitForChrome(cdp, chrome);
  const logged = await fetch(`${base()}/api/session/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: "synthetic", password: "synthetic", device_label: "grocery-browser" }),
  });
  assert.equal(logged.status, 200);
  return cookieValue(logged);
}

async function openPage(cookie) {
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
  await send("Page.addScriptToEvaluateOnNewDocument", {
    source: `(() => {
      const orig = EventTarget.prototype.addEventListener;
      EventTarget.prototype.addEventListener = function (type, listener, options) {
        if (type === "online") {
          window.__joehubIgnoredOnline = (window.__joehubIgnoredOnline || 0) + 1;
          return;
        }
        return orig.call(this, type, listener, options);
      };
    })();`,
  });
  const cooked = await send("Network.setCookie", {
    name: "joehub_session",
    value: cookie,
    url: `${base()}/`,
    httpOnly: true,
  });
  assert.equal(cooked.result?.success, true);
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

async function waitFor(send, expression, label, budget = 45000) {
  const deadline = Date.now() + budget;
  let last = "";
  while (Date.now() < deadline) {
    try {
      const value = await evalPage(send, expression);
      last = value == null ? "" : String(value);
      if (value) return value;
    } catch (error) {
      last = error instanceof Error ? error.message.slice(0, 120) : "error";
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  let body = "";
  try {
    body = await evalPage(send, "document.body ? document.body.innerText.slice(0, 500) : ''");
  } catch {
    body = last;
  }
  throw new Error(`timed out waiting for ${label}; last=${last}; body=${body}`);
}

async function size(send, width, height = 844) {
  await send("Emulation.setDeviceMetricsOverride", {
    width,
    height,
    deviceScaleFactor: 1,
    mobile: width < 500,
  });
  const onGrocery = await evalPage(send, "document.querySelector('[data-layout]') ? 'yes' : ''");
  if (onGrocery) {
    await waitFor(send, `document.querySelector("[data-layout='${width >= 1024 ? "panel" : "sheet"}']") ? 'yes' : ''`, `layout ${width}`);
  }
}

async function shot(send, name) {
  await new Promise((resolve) => setTimeout(resolve, 150));
  const image = await send("Page.captureScreenshot", { format: "png" });
  mkdirSync(ARTIFACTS, { recursive: true });
  writeFileSync(`${ARTIFACTS}/${name}`, Buffer.from(image.result.data, "base64"));
}

function click(label) {
  return `(() => {
    const node = [...document.querySelectorAll("button")].find((el) => (el.innerText || "").trim() === ${JSON.stringify(label)} || el.getAttribute("aria-label") === ${JSON.stringify(label)});
    if (!node || node.disabled) return "";
    node.click();
    return "yes";
  })()`;
}

function fill(id, value) {
  return `(() => {
    const el = document.getElementById(${JSON.stringify(id)});
    if (!el) return "";
    const set = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), "value").set;
    set.call(el, ${JSON.stringify(value)});
    el.dispatchEvent(new Event("input", { bubbles: true }));
    return "yes";
  })()`;
}

async function clickBox(send, selector) {
  const box = await evalPage(
    send,
    `(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      const rect = el.getBoundingClientRect();
      return { x: Math.round(rect.x + rect.width / 2), y: Math.round(rect.y + Math.min(rect.height / 2, 12)) };
    })()`,
  );
  await send("Input.dispatchMouseEvent", { type: "mousePressed", x: box.x, y: box.y, button: "left", clickCount: 1 });
  await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: box.x, y: box.y, button: "left", clickCount: 1 });
}

async function gotoGrocery(send, width, height = 844) {
  await size(send, width, height);
  await send("Page.navigate", { url: `${base()}/grocery` });
  await waitFor(send, "document.querySelector(\"[data-ready='true'] h1\")?.textContent === 'Grocery' ? 'yes' : ''", "grocery");
}

test("grocery add, validation, cancel, reload, and offline reconnect", { timeout: 240000, skip }, async () => {
  const cookie = await boot();
  const page = await openPage(cookie);
  const { send } = page;
  const auth = { cookie: `joehub_session=${cookie}`, "content-type": "application/json" };
  try {
    await gotoGrocery(send, 390);
    const titlePaint = await evalPage(
      send,
      `(() => {
        const h1 = document.querySelector("h1");
        const theme = document.querySelector("[data-theme]");
        const title = getComputedStyle(h1);
        const ink = getComputedStyle(theme);
        const readable = title.color === ink.color && title.color !== ink.backgroundColor;
        const sized = Math.round(parseFloat(title.fontSize)) === 24;
        return readable && sized ? "yes" : JSON.stringify({ color: title.color, ink: ink.color, bg: ink.backgroundColor, size: title.fontSize });
      })()`,
    );
    assert.equal(titlePaint, "yes");
    await waitFor(send, "document.body.innerText.includes('The list is empty') ? 'yes' : ''", "empty");
    const nav = await evalPage(
      send,
      `(() => {
        const links = [...document.querySelectorAll("nav[aria-label='Primary'] a")];
        return {
          labels: links.map((link) => link.innerText.replace(/\\s+/g, " ").trim()),
          home: links.find((link) => link.innerText.includes("Home"))?.getAttribute("aria-current") || "",
          jobs: links.find((link) => link.innerText.includes("Jobs"))?.getAttribute("aria-current") || "",
          font: getComputedStyle(document.querySelector("h1")).fontFamily,
          outfit: getComputedStyle(document.documentElement).getPropertyValue("--font-outfit").trim(),
          body: getComputedStyle(document.body).fontFamily,
        };
      })()`,
    );
    assert.deepEqual(nav.labels.map((label) => label.split(" ").pop()), ["Home", "Finance", "Jobs", "Journal", "More"]);
    assert.equal(nav.home, "page");
    assert.equal(nav.jobs, "");
    const outfitName = nav.outfit.replaceAll(/['"]/g, "").trim();
    assert.ok(outfitName.length > 0, JSON.stringify(nav));
    assert.ok(nav.font.toLowerCase().includes(outfitName.toLowerCase()), JSON.stringify(nav));
    assert.notEqual(nav.font, nav.body, JSON.stringify(nav));
    assert.equal(await evalPage(send, "document.querySelector(\"[role='checkbox'], input[type=checkbox]\") ? 'yes' : 'no'"), "no");
    await shot(send, "grocery_g02_390.png");
    await gotoGrocery(send, 1280);
    await waitFor(send, "document.body.innerText.includes('The list is empty') && document.body.innerText.includes('Select an item') ? 'yes' : ''", "empty desktop");
    await shot(send, "grocery_g02_1280.png");

    await gotoGrocery(send, 390, 685);
    assert.equal(await evalPage(send, click("Add an item")), "yes");
    await waitFor(send, "document.querySelector('#grocery-name') ? 'yes' : ''", "add sheet");
    const focused = await evalPage(send, "document.activeElement?.id || ''");
    assert.equal(focused, "grocery-name");
    await clickBox(send, "#grocery-quantity");
    await waitFor(send, "(document.getElementById('grocery-name-error')?.textContent || '').trim() === 'Enter a name.' ? 'yes' : ''", "blank name");
    assert.equal(await evalPage(send, "[...document.querySelectorAll('button')].find((el) => (el.innerText || '').trim() === 'Save')?.disabled === false ? 'yes' : 'no'"), "yes");
    assert.equal(await evalPage(send, click("Save")), "yes");
    assert.equal(await evalPage(send, "document.activeElement?.id || ''"), "grocery-name");
    const footer = await evalPage(
      send,
      `(() => {
        const button = [...document.querySelectorAll("button")].find((el) => (el.innerText || "").trim() === "Save");
        const box = button.getBoundingClientRect();
        const nav = document.querySelector("nav[aria-label='Primary']");
        const navTop = nav ? nav.getBoundingClientRect().top : window.innerHeight;
        return box.top >= 0 && box.bottom <= navTop + 1 && box.height >= 44 ? "yes" : JSON.stringify({ top: box.top, bottom: box.bottom, height: box.height, navTop, inner: window.innerHeight });
      })()`,
    );
    assert.equal(footer, "yes");
    assert.equal(await evalPage(send, fill("grocery-name", "Apples")), "yes");
    assert.equal(await evalPage(send, fill("grocery-quantity", "-1")), "yes");
    await waitFor(send, "[...document.querySelectorAll('button')].find((el) => (el.innerText || '').trim() === 'Save')?.disabled === false ? 'yes' : ''", "save enabled");
    assert.equal(await evalPage(send, click("Save")), "yes");
    await waitFor(send, "document.getElementById('grocery-quantity-error')?.textContent === 'Enter a valid quantity.' ? 'yes' : ''", "bad quantity");
    assert.equal(await evalPage(send, click("Cancel")), "yes");
    await waitFor(send, "!document.querySelector('[role=dialog]') && document.body.innerText.includes('The list is empty') ? 'yes' : ''", "cancel empty");
    const listed = await fetch(`${base()}/api/grocery`, { headers: { cookie: auth.cookie } });
    assert.deepEqual(await listed.json(), []);

    const samples = [
      { name: "Bananas", quantity: "6", section: "Produce" },
      { name: "Organic gluten-free rolled oats, family size", quantity: "1 bag", section: "Produce" },
      { name: "Oat milk", quantity: "1 carton", section: "Dairy", notes: "Barista style if they have it" },
      { name: "Eggs", quantity: "1 dozen", section: "Dairy" },
      { name: "Paper towels", quantity: "2" },
    ];
    for (const sample of samples) {
      const created = await fetch(`${base()}/api/grocery`, { method: "POST", headers: auth, body: JSON.stringify(sample) });
      assert.equal(created.status, 201);
    }
    await gotoGrocery(send, 390);
    await waitFor(send, "document.body.innerText.includes('Paper towels') ? 'yes' : ''", "seeded list");
    const sections = await evalPage(send, "[...document.querySelectorAll('section h2 span:first-child')].map((el) => el.textContent).join('|')");
    assert.equal(sections, "Produce|Dairy|No section");
    const wrapped = await evalPage(
      send,
      `(() => {
        const row = [...document.querySelectorAll("p")].find((el) => el.textContent.includes("Organic gluten-free"));
        return row && row.scrollWidth <= row.clientWidth + 1 && document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1 ? "yes" : "no";
      })()`,
    );
    assert.equal(wrapped, "yes");
    assert.match(await evalPage(send, "document.body.innerText"), /6 · Produce/);
    assert.match(await evalPage(send, "document.body.innerText"), /Barista style if they have it/);
    assert.equal(await evalPage(send, "document.body.innerText.includes('2') && !document.body.innerText.includes('2 ·') ? 'yes' : 'no'"), "yes");
    await shot(send, "grocery_g01_390.png");
    await gotoGrocery(send, 1280);
    await waitFor(send, "document.body.innerText.includes('Select an item') && document.body.innerText.includes('Bananas') ? 'yes' : ''", "desktop list");
    await shot(send, "grocery_g09_1280.png");

    await gotoGrocery(send, 390);
    assert.equal(await evalPage(send, click("Add an item")), "yes");
    await waitFor(send, "document.querySelector('#grocery-name') ? 'yes' : ''", "sheet over list");
    const suggestions = await evalPage(send, "[...document.querySelectorAll('#grocery-sections option')].map((el) => el.value).join('|')");
    assert.equal(suggestions, "Produce|Dairy");
    await shot(send, "grocery_g03_390.png");
    assert.equal(await evalPage(send, fill("grocery-name", "Oat milk")), "yes");
    await waitFor(send, "document.getElementById('grocery-duplicate')?.textContent === 'Oat milk is already on the list' ? 'yes' : ''", "duplicate hint");
    assert.equal(await evalPage(send, "[...document.querySelectorAll('button')].find((el) => (el.innerText || '').trim() === 'Save')?.disabled === false ? 'yes' : 'no'"), "yes");
    assert.equal(await evalPage(send, click("Cancel")), "yes");
    await send("Page.reload", { ignoreCache: true });
    await waitFor(send, "document.body.innerText.includes('Oat milk') ? 'yes' : ''", "reloaded");
    assert.equal(await evalPage(send, "(document.body.innerText.match(/Oat milk/g) || []).length === 1 ? 'yes' : 'no'"), "yes");

    await gotoGrocery(send, 1280);
    assert.equal(await evalPage(send, click("Add an item")), "yes");
    await waitFor(send, "document.querySelector(\"[data-layout='panel'] [role='dialog']\") ? 'yes' : ''", "desktop add");
    const headerSave = await evalPage(
      send,
      `(() => {
        const dialog = document.querySelector("[role='dialog']");
        const save = [...dialog.querySelectorAll("button")].find((el) => (el.innerText || "").trim() === "Save");
        const box = save.getBoundingClientRect();
        const title = dialog.querySelector("h2")?.getBoundingClientRect();
        return box.top < 120 && Math.abs(box.top - title.top) < 40 ? "yes" : "no";
      })()`,
    );
    assert.equal(headerSave, "yes");
    await shot(send, "grocery_g10_1280.png");
    assert.equal(await evalPage(send, click("Cancel")), "yes");

    async function devtoolsOffline() {
      await send("Network.emulateNetworkConditions", { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 });
      const started = Date.now();
      let banner = "";
      while (Date.now() - started < 1500) {
        banner = await evalPage(send, "document.querySelector(\"[data-link='offline']\") ? 'yes' : ''");
        if (banner) return;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      await evalPage(send, "window.dispatchEvent(new Event('focus')); 'yes'");
    }

    async function firstItemTop() {
      const value = await evalPage(
        send,
        `(() => {
          const row = document.querySelector("section li");
          if (!row) return "";
          return String(Math.round(row.getBoundingClientRect().top));
        })()`,
      );
      assert.match(String(value), /^\d+$/);
      return Number(value);
    }

    async function bannerCycle(width, offlineName, reconnectName, backName) {
      await gotoGrocery(send, width);
      await waitFor(send, "document.body.innerText.includes('Bananas') ? 'yes' : ''", `list ${width}`);
      const rowBefore = await firstItemTop();
      await devtoolsOffline();
      await waitFor(send, "document.querySelector(\"[data-link='offline']\")?.textContent.includes('Offline') && document.querySelector(\"[data-link='offline']\")?.textContent.includes('Last updated') ? 'yes' : ''", `offline ${width}`);
      assert.equal(await evalPage(send, "document.body.innerText.includes('Bananas') ? 'yes' : 'no'"), "yes");
      assert.equal(await evalPage(send, "document.querySelector(\"[data-link='offline']\")?.textContent.includes('America/Detroit') && !document.querySelector(\"[data-link='offline']\")?.textContent.includes('read-only') ? 'yes' : 'no'"), "yes");
      const add = await evalPage(
        send,
        `(() => {
          const node = [...document.querySelectorAll("button")].find((el) => (el.innerText || "").trim() === "Add an item" || el.getAttribute("aria-label") === "Add an item");
          return node && node.disabled ? "yes" : "no";
        })()`,
      );
      assert.equal(add, "yes");
      assert.equal(await firstItemTop(), rowBefore);
      await shot(send, offlineName);
      await evalPage(
        send,
        `(() => {
          const orig = window.fetch;
          window.fetch = (input, init) => {
            const url = String(input && input.url ? input.url : input);
            if (url.includes("/api/health")) return new Promise((resolve) => setTimeout(() => resolve(orig(input, init)), 2500));
            return orig(input, init);
          };
          return "yes";
        })()`,
      );
      await send("Network.emulateNetworkConditions", { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
      await waitFor(send, "document.querySelector(\"[data-link='reconnecting']\")?.textContent.trim() === 'Reconnecting…' ? 'yes' : ''", `reconnecting ${width}`, 20000);
      await shot(send, reconnectName);
      await waitFor(send, "document.querySelector(\"[data-link='back']\")?.innerText.includes('Back online') ? 'yes' : ''", `back ${width}`, 20000);
      assert.equal(await evalPage(send, "document.body.innerText.includes('Bananas') ? 'yes' : 'no'"), "yes");
      await shot(send, backName);
      if (width === 1280) {
        assert.equal(await evalPage(send, click("Dismiss")), "yes");
        await waitFor(send, "!document.querySelector('[data-link]') ? 'yes' : ''", "dismissed");
      } else {
        await waitFor(send, "!document.querySelector('[data-link]') ? 'yes' : ''", "auto dismiss", 5000);
      }
      assert.equal(await evalPage(send, "[...document.querySelectorAll('button')].find((el) => el.getAttribute('aria-label') === 'Add an item' || (el.innerText || '').trim() === 'Add an item')?.disabled === false ? 'yes' : 'no'"), "yes");
    }

    await bannerCycle(390, "grocery_g07_390.png", "grocery_g08_reconnecting_390.png", "grocery_g08_back_390.png");
    await bannerCycle(1280, "grocery_g07_1280.png", "grocery_g08_reconnecting_1280.png", "grocery_g08_back_1280.png");
    assert.equal(await evalPage(send, "typeof window.__joehubIgnoredOnline === 'number' ? 'yes' : 'no'"), "yes");

    await gotoGrocery(send, 390);
    assert.equal(await evalPage(send, click("Add an item")), "yes");
    await waitFor(send, "document.querySelector('#grocery-name') ? 'yes' : ''", "enter sheet");
    await clickBox(send, "#grocery-name");
    assert.equal(await evalPage(send, fill("grocery-name", "Lemons")), "yes");
    await waitFor(send, "[...document.querySelectorAll('button')].find((el) => (el.innerText || '').trim() === 'Save')?.disabled === false ? 'yes' : ''", "lemons save");
    assert.equal(await evalPage(send, "document.getElementById('grocery-form').requestSubmit(); 'yes'"), "yes");
    await waitFor(send, "!document.querySelector('[role=dialog]') && document.body.innerText.includes('Lemons') ? 'yes' : ''", "enter saved", 20000);
    await send("Page.reload", { ignoreCache: true });
    await waitFor(send, "document.body.innerText.includes('Lemons') && document.body.innerText.includes('Produce') ? 'yes' : ''", "lemons held");

    await gotoGrocery(send, 1280);
    assert.equal(await evalPage(send, click("Add an item")), "yes");
    await waitFor(send, "document.querySelector('#grocery-name') ? 'yes' : ''", "double sheet");
    assert.equal(await evalPage(send, fill("grocery-name", "Limes")), "yes");
    assert.equal(await evalPage(send, fill("grocery-section", "Produce")), "yes");
    assert.equal(
      await evalPage(
        send,
        `(() => {
          const button = [...document.querySelectorAll("button")].find((el) => (el.innerText || "").trim() === "Save");
          button.click();
          button.click();
          return "yes";
        })()`,
      ),
      "yes",
    );
    await waitFor(send, "!document.querySelector('[role=dialog]') && document.body.innerText.includes('Limes') ? 'yes' : ''", "one lime", 20000);
    const after = await fetch(`${base()}/api/grocery`, { headers: { cookie: auth.cookie } });
    const names = (await after.json()).map((item) => item.name);
    assert.equal(names.filter((name) => name === "Limes").length, 1);
    assert.equal(names.filter((name) => name === "Lemons").length, 1);

    await send("Page.navigate", { url: `${base()}/finance` });
    await waitFor(send, "document.body.innerText.includes('Finance') ? 'yes' : ''", "finance");
    const financeFont = await evalPage(
      send,
      `(() => {
        const outfit = getComputedStyle(document.documentElement).getPropertyValue("--font-outfit");
        const body = getComputedStyle(document.body).fontFamily;
        return { outfit, body, grocery: document.querySelector(".grocery-type") ? "yes" : "no", tasks: document.querySelector(".tasks-type") ? "yes" : "no" };
      })()`,
    );
    assert.equal(financeFont.grocery, "no");
    assert.equal(financeFont.tasks, "no");
    const financeOutfit = financeFont.outfit.replaceAll(/['"]/g, "").trim().toLowerCase();
    assert.equal(financeFont.body.toLowerCase().includes(financeOutfit), false);
  } finally {
    await page.close();
    await stopProcess(chrome);
    await stopProcess(child);
    await release();
    chrome = null;
    child = null;
  }
});

test("grocery edit, cancel, delete, and a failed save leave the item", { timeout: 240000, skip }, async () => {
  const cookie = await boot();
  const page = await openPage(cookie);
  const { send } = page;
  const auth = { cookie: `joehub_session=${cookie}`, "content-type": "application/json" };
  const milk = { name: "Oat milk", quantity: "1 carton", section: "Dairy", notes: "Barista style if they have it" };
  try {
    const created = await fetch(`${base()}/api/grocery`, { method: "POST", headers: auth, body: JSON.stringify(milk) });
    assert.equal(created.status, 201);
    const bananas = await fetch(`${base()}/api/grocery`, { method: "POST", headers: auth, body: JSON.stringify({ name: "Bananas", quantity: "6", section: "Produce" }) });
    assert.equal(bananas.status, 201);
    const id = (await created.json()).id;

    await gotoGrocery(send, 390);
    await waitFor(send, "document.body.innerText.includes('Oat milk') ? 'yes' : ''", "list");
    assert.equal(await evalPage(send, click("Edit Oat milk")), "yes");
    await waitFor(send, "document.querySelector('[role=dialog] h2')?.textContent === 'Edit item' ? 'yes' : ''", "edit sheet");
    const prefilled = await evalPage(
      send,
      `(() => ({
        name: document.getElementById("grocery-name")?.value,
        quantity: document.getElementById("grocery-quantity")?.value,
        section: document.getElementById("grocery-section")?.value,
        notes: document.getElementById("grocery-notes")?.value,
        hint: document.getElementById("grocery-duplicate") ? "yes" : "no",
        suggestions: [...document.querySelectorAll("#grocery-sections option")].map((el) => el.value).join("|"),
      }))()`,
    );
    assert.deepEqual(
      { name: prefilled.name, quantity: prefilled.quantity, section: prefilled.section, notes: prefilled.notes, hint: prefilled.hint },
      { name: "Oat milk", quantity: "1 carton", section: "Dairy", notes: "Barista style if they have it", hint: "no" },
    );
    assert.equal(prefilled.suggestions, "Dairy|Produce");
    await shot(send, "grocery_g04_390.png");

    assert.equal(await evalPage(send, fill("grocery-name", "Whole milk")), "yes");
    assert.equal(await evalPage(send, fill("grocery-quantity", "")), "yes");
    assert.equal(await evalPage(send, click("Cancel")), "yes");
    await waitFor(send, "!document.querySelector('[role=dialog]') ? 'yes' : ''", "cancelled");
    await send("Page.reload", { ignoreCache: true });
    await waitFor(send, "document.body.innerText.includes('1 carton · Dairy') && document.body.innerText.includes('Barista style if they have it') ? 'yes' : ''", "cancel restored");
    assert.equal(await evalPage(send, "document.body.innerText.includes('Whole milk') ? 'yes' : 'no'"), "no");

    assert.equal(await evalPage(send, click("Edit Oat milk")), "yes");
    await waitFor(send, "document.getElementById('grocery-name')?.value === 'Oat milk' ? 'yes' : ''", "reopened");
    assert.equal(await evalPage(send, fill("grocery-quantity", "-2 bags")), "yes");
    assert.equal(await evalPage(send, click("Save")), "yes");
    await waitFor(send, "document.getElementById('grocery-quantity-error')?.textContent === 'Enter a valid quantity.' ? 'yes' : ''", "edit quantity");
    assert.equal(await evalPage(send, fill("grocery-name", "")), "yes");
    assert.equal(await evalPage(send, "[...document.querySelectorAll('button')].find((el) => (el.innerText || '').trim() === 'Save')?.disabled === true ? 'yes' : 'no'"), "yes");
    assert.equal(await evalPage(send, fill("grocery-name", "Oat milk")), "yes");
    assert.equal(await evalPage(send, fill("grocery-quantity", "")), "yes");
    assert.equal(await evalPage(send, fill("grocery-notes", "")), "yes");
    assert.equal(await evalPage(send, fill("grocery-section", "Produce")), "yes");
    assert.equal(await evalPage(send, click("Save")), "yes");
    await waitFor(send, "!document.querySelector('[role=dialog]') && !document.body.innerText.includes('1 carton') && !document.body.innerText.includes('Barista') ? 'yes' : ''", "cleared fields", 20000);
    await send("Page.reload", { ignoreCache: true });
    await waitFor(send, "document.body.innerText.includes('Oat milk') && !document.body.innerText.includes('Barista') ? 'yes' : ''", "edits held");
    const stored = await fetch(`${base()}/api/grocery/${id}`, { headers: { cookie: auth.cookie } });
    const saved = await stored.json();
    assert.equal(saved.name, "Oat milk");
    assert.equal(saved.section, "Produce");
    assert.equal(saved.quantity, undefined);
    assert.equal(saved.notes, undefined);

    assert.equal(await evalPage(send, click("Edit Oat milk")), "yes");
    await waitFor(send, "document.querySelector('[role=dialog] h2')?.textContent === 'Edit item' ? 'yes' : ''", "edit again");
    assert.equal(await evalPage(send, fill("grocery-name", "Lost milk")), "yes");
    await evalPage(
      send,
      `(() => {
        const orig = window.fetch;
        window.fetch = (input, init) => {
          const url = String(input && input.url ? input.url : input);
          const method = String((init && init.method) || (input && input.method) || "GET").toUpperCase();
          if (method === "PATCH" && url.includes("/api/grocery/")) {
            window.fetch = orig;
            return Promise.resolve(new Response(JSON.stringify({ detail: "unavailable" }), { status: 500, headers: { "content-type": "application/json" } }));
          }
          return orig(input, init);
        };
        return "yes";
      })()`,
    );
    assert.equal(await evalPage(send, click("Save")), "yes");
    await waitFor(send, "document.body.innerText.includes('Couldn\\'t save these edits.') ? 'yes' : ''", "save failed");
    assert.equal(await evalPage(send, "document.getElementById('grocery-name')?.value"), "Lost milk");
    const unchanged = await fetch(`${base()}/api/grocery/${id}`, { headers: { cookie: auth.cookie } });
    assert.equal((await unchanged.json()).name, "Oat milk");
    assert.equal(await evalPage(send, click("Cancel")), "yes");

    assert.equal(await evalPage(send, click("Edit Oat milk")), "yes");
    assert.equal(await evalPage(send, "document.body.innerText.includes('Delete this item?') ? 'yes' : 'no'"), "no");
    assert.equal(await evalPage(send, click("Delete")), "yes");
    await waitFor(send, "document.getElementById('grocery-delete-dialog')?.innerText.includes('Delete this item?') && document.getElementById('grocery-delete-dialog')?.innerText.includes('Oat milk') ? 'yes' : ''", "confirm");
    await shot(send, "grocery_g04_delete_390.png");
    await evalPage(send, "document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); 'yes'");
    await waitFor(send, "!document.getElementById('grocery-delete-dialog') && document.querySelector('[role=dialog] h2')?.textContent === 'Edit item' ? 'yes' : ''", "escape confirm");
    assert.equal(await evalPage(send, click("Delete")), "yes");
    await waitFor(send, "document.getElementById('grocery-delete-dialog') ? 'yes' : ''", "confirm again");
    assert.equal(
      await evalPage(
        send,
        `(() => {
          const button = [...document.querySelectorAll("#grocery-delete-dialog button")].find((el) => (el.innerText || "").trim() === "Cancel");
          if (!button) return "";
          button.click();
          return "yes";
        })()`,
      ),
      "yes",
    );
    await waitFor(send, "!document.getElementById('grocery-delete-dialog') ? 'yes' : ''", "cancel confirm");
    assert.equal(await evalPage(send, click("Delete")), "yes");
    await waitFor(send, "document.getElementById('grocery-delete-dialog') ? 'yes' : ''", "confirm delete");
    await evalPage(
      send,
      `(() => {
        const orig = window.fetch;
        window.fetch = (input, init) => {
          const url = String(input && input.url ? input.url : input);
          const method = String((init && init.method) || (input && input.method) || "GET").toUpperCase();
          if (method === "DELETE" && url.includes("/api/grocery/")) {
            window.fetch = orig;
            return Promise.resolve(new Response(JSON.stringify({ detail: "unavailable" }), { status: 500, headers: { "content-type": "application/json" } }));
          }
          return orig(input, init);
        };
        return "yes";
      })()`,
    );
    assert.equal(
      await evalPage(
        send,
        `(() => {
          const button = [...document.querySelectorAll("#grocery-delete-dialog button")].find((el) => (el.innerText || "").trim() === "Delete");
          button.click();
          return "yes";
        })()`,
      ),
      "yes",
    );
    await waitFor(send, "document.getElementById('grocery-delete-dialog')?.innerText.includes('Couldn\\'t delete this item.') ? 'yes' : ''", "delete failed");
    assert.equal((await (await fetch(`${base()}/api/grocery/${id}`, { headers: { cookie: auth.cookie } })).json()).name, "Oat milk");
    assert.equal(
      await evalPage(
        send,
        `(() => {
          const button = [...document.querySelectorAll("#grocery-delete-dialog button")].find((el) => (el.innerText || "").trim() === "Delete");
          button.click();
          return "yes";
        })()`,
      ),
      "yes",
    );
    await waitFor(send, "!document.querySelector('[role=dialog]') && !document.body.innerText.includes('Oat milk') && document.body.innerText.includes('Bananas') ? 'yes' : ''", "deleted", 20000);
    await send("Page.reload", { ignoreCache: true });
    await waitFor(send, "document.body.innerText.includes('Bananas') && !document.body.innerText.includes('Oat milk') ? 'yes' : ''", "delete held");

    const again = await fetch(`${base()}/api/grocery`, { method: "POST", headers: auth, body: JSON.stringify(milk) });
    assert.equal(again.status, 201);
    await gotoGrocery(send, 390);
    await waitFor(send, "document.body.innerText.includes('Oat milk') ? 'yes' : ''", "restored item");
    await send("Network.emulateNetworkConditions", { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 });
    await evalPage(send, "window.dispatchEvent(new Event('focus')); 'yes'");
    await waitFor(send, "document.querySelector(\"[data-link='offline']\") ? 'yes' : ''", "offline edit");
    assert.equal(
      await evalPage(
        send,
        `(() => {
          const node = [...document.querySelectorAll("button")].find((el) => el.getAttribute("aria-label") === "Edit Oat milk");
          return node && node.disabled ? "yes" : "no";
        })()`,
      ),
      "yes",
    );
    await send("Network.emulateNetworkConditions", { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
    await evalPage(send, "window.dispatchEvent(new Event('focus')); 'yes'");
    await waitFor(send, "!document.querySelector('[data-link]') && document.body.innerText.includes('Oat milk') ? 'yes' : ''", "back for desktop", 20000);

    await gotoGrocery(send, 1280);
    assert.equal(await evalPage(send, click("Edit Oat milk")), "yes");
    await waitFor(send, "document.querySelector(\"[data-layout='panel'] [role='dialog'] h2\")?.textContent === 'Edit item' ? 'yes' : ''", "desktop edit");
    const header = await evalPage(
      send,
      `(() => {
        const dialog = document.querySelector("[role='dialog']");
        const labels = [...dialog.querySelectorAll("button")].map((el) => (el.innerText || "").trim()).filter(Boolean);
        return labels.join("|");
      })()`,
    );
    assert.match(header, /Delete/);
    assert.match(header, /Cancel/);
    assert.match(header, /Save/);
    await shot(send, "grocery_g04_1280.png");
    assert.equal(await evalPage(send, click("Cancel")), "yes");
  } finally {
    await page.close();
    await stopProcess(chrome);
    await stopProcess(child);
    await release();
    chrome = null;
    child = null;
  }
});
