import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import http from "node:http";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { acquireBrowserLock, reservePort, spawnLogged, startChrome, stopProcess, waitForChrome, waitForHttp } from "./support/harness.mjs";
import { pointerClick, pressLabel } from "./support/pointer.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const chromeBin = ["google-chrome", "google-chrome-stable"].find((bin) => spawnSync("which", [bin]).status === 0);
const skip = chromeBin ? false : "google-chrome is not installed";
const AS_OF = "2026-11-11T15:00:00-05:00";

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
      JOEHUB_SESSION_SECRET: "categories-overlay-secret",
      JOEHUB_SCREENSHOTS: "1",
    },
  });
  child = started.child;
  await waitForHttp(`${base()}/finance/spending`, {
    child,
    log: started.log,
    accept: (response) => response.status === 200 && (response.headers.get("content-type") || "").includes("text/html"),
  });
  chrome = startChrome(chromeBin, cdp, `/tmp/chrome-categories-overlay-${process.pid}`);
  await waitForChrome(cdp, chrome);
  const logged = await fetch(`${base()}/api/session/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: "synthetic", password: "synthetic", device_label: "categories-overlay" }),
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

async function waitFor(send, expression, label) {
  const deadline = Date.now() + 45000;
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
  let body = "";
  try {
    body = await evalPage(send, "document.body ? document.body.innerText.slice(0, 500) : ''");
  } catch {
    body = last;
  }
  throw new Error(`timed out waiting for ${label}; last=${last}; body=${body}`);
}

async function size(send, width, height) {
  await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: width < 500 });
}

function redirected(path) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port,
        path,
        method: "GET",
        headers: { host: "evil.example", "x-forwarded-host": "spoofed.example" },
      },
      (res) => {
        res.resume();
        resolve({ status: res.statusCode, location: res.headers.location || "" });
      },
    );
    req.on("error", reject);
    req.end();
  });
}

function assertSameOrigin(location, path) {
  assert.equal(location.toLowerCase().includes("evil.example"), false, `${path} ${location}`);
  assert.equal(location.toLowerCase().includes("spoofed.example"), false, `${path} ${location}`);
  assert.equal(/^https?:\/\//i.test(location), false, `${path} ${location}`);
  const target = new URL(location, base());
  assert.equal(target.origin, new URL(base()).origin, location);
  assert.equal(target.pathname, "/finance/spending");
  return target;
}

const barRows = `(() => {
  const rows = [...document.querySelectorAll("a[href*='cat=']")].map((link) => {
    const fill = link.querySelector("[data-bar]");
    const style = fill ? getComputedStyle(fill) : null;
    return {
      name: link.querySelector(".truncate")?.textContent || "",
      text: (link.innerText || "").replace(/\\s+/g, " "),
      mode: fill?.getAttribute("data-bar") || "",
      over: fill?.getAttribute("data-over") || "",
      width: fill?.style.width || "",
      color: style ? style.backgroundColor : "",
      meta: link.querySelector("[data-row-meta]") ? getComputedStyle(link.querySelector("[data-row-meta]")).color : "",
    };
  });
  return JSON.stringify(rows);
})()`;

const settled = `(() => {
  const panel = document.querySelector("[data-overlay='panel']");
  if (!panel || panel.getAttribute("data-state") !== "open") return "";
  return panel.getAnimations({ subtree: true }).some((animation) => animation.playState === "running") ? "" : "yes";
})()`;

test("categories overlay shows the budget, a transaction, and the monthly form", { skip, timeout: 240000 }, async () => {
  let page = null;
  try {
    const secret = await boot();
    const listed = await fetch(`${base()}/finance/categories?period=month&panel=1&asOf=${encodeURIComponent(AS_OF)}`, { redirect: "manual" });
    assert.ok(listed.status === 307 || listed.status === 308, `list status ${listed.status}`);
    const listLocation = listed.headers.get("location") || "";
    const listUrl = new URL(listLocation, base());
    assert.equal(listUrl.pathname, "/finance/spending");
    assert.equal(listUrl.searchParams.get("period"), "month");
    assert.equal(listUrl.searchParams.get("panel"), "1");
    assert.equal(listUrl.searchParams.get("asOf"), AS_OF);
    const slugged = await fetch(`${base()}/finance/categories/dining-out?period=month&xe=offline&asOf=${encodeURIComponent(AS_OF)}`, { redirect: "manual" });
    assert.ok(slugged.status === 307 || slugged.status === 308, `slug status ${slugged.status}`);
    const slugUrl = new URL(slugged.headers.get("location") || "", base());
    assert.equal(slugUrl.pathname, "/finance/spending");
    assert.equal(slugUrl.searchParams.get("cat"), "dining-out");
    assert.equal(slugUrl.searchParams.get("period"), "month");
    assert.equal(slugUrl.searchParams.get("xe"), "offline");
    assert.equal(slugUrl.searchParams.get("asOf"), AS_OF);
    const query = await redirected("/finance/categories?x=1");
    assert.equal(query.status, 308);
    const queryTarget = assertSameOrigin(query.location, "/finance/categories?x=1");
    assert.equal(queryTarget.searchParams.get("x"), "1");
    assert.equal(queryTarget.searchParams.get("cat"), null);
    const groceries = await redirected("/finance/categories/groceries");
    assert.equal(groceries.status, 308);
    const groceriesTarget = assertSameOrigin(groceries.location, "/finance/categories/groceries");
    assert.equal(groceriesTarget.searchParams.get("cat"), "groceries");
    page = await openPage(secret);
    for (const viewport of [
      { width: 1280, height: 800, pin: true },
      { width: 390, height: 844, pin: false },
    ]) {
      await size(page.send, viewport.width, viewport.height);
      await page.send("Page.navigate", { url: `${base()}/finance/spending?period=month&asOf=${encodeURIComponent(AS_OF)}` });
      await waitFor(page.send, "document.body.innerText.includes('Dining Out') ? 'yes' : ''", "categories");
      const monthBars = JSON.parse(await evalPage(page.send, barRows));
      const over = monthBars.find((row) => row.name === "Groceries");
      const under = monthBars.find((row) => row.name === "Dining Out");
      const share = monthBars.find((row) => row.name === "Bills & Utilities");
      assert.equal(over.mode, "estimate");
      assert.equal(over.over, "true");
      assert.equal(over.width, "100%");
      assert.match(over.text, /120%/);
      const negative = await evalPage(page.send, `(() => { const probe = document.createElement("i"); probe.style.color = "var(--chart-negative)"; document.body.appendChild(probe); const color = getComputedStyle(probe).color; probe.remove(); return color; })()`);
      const categoryColors = JSON.parse(await evalPage(page.send, `(() => { const names = ["--cat-groceries","--cat-dining","--cat-transport","--cat-subscriptions","--cat-shopping","--cat-utilities","--cat-loan","--cat-income","--chart-negative","--warn"]; const probe = document.createElement("i"); document.body.appendChild(probe); const colors = names.map((name) => { probe.style.backgroundColor = "var(" + name + ")"; return getComputedStyle(probe).backgroundColor; }); probe.remove(); return JSON.stringify(colors); })()`));
      assert.equal(over.meta, negative);
      assert.notEqual(under.meta, negative);
      assert.equal(categoryColors.includes(over.color), false);
      assert.equal(under.mode, "estimate");
      assert.equal(under.over, "false");
      assert.equal(under.width, "72%");
      assert.match(under.text, /72%/);
      assert.equal(share.mode, "share");
      assert.equal(share.over, "false");
      assert.equal(share.width, "10%");
      assert.notEqual(share.color, "rgb(224, 122, 95)");
      if (viewport.pin) {
        await page.send("Page.navigate", { url: `${base()}/finance/spending?period=week&asOf=${encodeURIComponent(AS_OF)}` });
        await waitFor(page.send, "document.body.innerText.includes('Dining Out') && document.querySelector(\"[data-bar][data-over='true']\") ? 'yes' : ''", "week bars");
        const weekBars = JSON.parse(await evalPage(page.send, barRows));
        const weekOver = weekBars.find((row) => row.name === "Dining Out");
        const weekShare = weekBars.find((row) => row.name === "Bills & Utilities");
        assert.equal(weekOver.mode, "estimate");
        assert.equal(weekOver.over, "true");
        assert.equal(weekOver.width, "100%");
        assert.match(weekOver.text, /115%/);
        assert.equal(weekOver.meta, negative);
        assert.equal(categoryColors.includes(weekOver.color), false);
        assert.equal(weekShare.mode, "share");
        assert.equal(weekShare.over, "false");
        assert.notEqual(weekShare.color, "rgb(224, 122, 95)");
        await page.send("Page.navigate", { url: `${base()}/finance/spending?period=month&asOf=${encodeURIComponent(AS_OF)}` });
        await waitFor(page.send, "document.body.innerText.includes('Groceries') ? 'yes' : ''", "month again");
      }
      assert.equal(await pointerClick(page.send, evalPage, "document.querySelector(\"a[href*='cat=dining-out']\")"), "yes");
      await waitFor(page.send, `${settled} && document.querySelector("[data-category-detail='true'] button")?.innerText.includes("Joe's Pizza") ? 'yes' : ''`, "detail");
      const detail = JSON.parse(await evalPage(page.send, `(() => {
        const root = document.querySelector("[data-category-detail='true']");
        const meta = root?.querySelector("[data-item-meta]")?.textContent || "";
        const first = root?.querySelector("button");
        const when = first?.querySelector(".text-muted")?.textContent || "";
        return JSON.stringify({
          title: document.querySelector("[role='dialog'] h2")?.textContent || "",
          meta,
          payee: (first?.innerText || "").replace(/\\s+/g, " ").trim(),
          when,
          edit: [...document.querySelectorAll("[data-overlay='panel'] button")].some((button) => (button.innerText || "").trim() === "Edit" && !button.disabled),
        });
      })()`));
      assert.equal(detail.title, "Dining Out");
      assert.match(detail.meta, /\$248 of \$346\.67 estimate/);
      assert.equal(detail.meta.includes("4,204"), false);
      assert.match(detail.payee, /Joe's Pizza/);
      assert.equal(detail.when, "Tue Nov 10");
      assert.equal(detail.edit, true);
      if (viewport.pin) {
        const row = await evalPage(page.send, `(() => {
          const current = document.querySelector("[data-selected='true']");
          return current ? getComputedStyle(current).backgroundColor : "";
        })()`);
        assert.match(String(row), /46,\s*139,\s*106/);
      }
      assert.equal(await pointerClick(page.send, evalPage, "document.querySelector(\"[data-category-detail='true'] button\")"), "yes");
      await waitFor(page.send, `${settled} && document.querySelector("[data-txn-detail='true']") && document.querySelector("[role='dialog'] h2")?.textContent === "Joe's Pizza" ? 'yes' : ''`, "transaction");
      const txnDate = await evalPage(page.send, `(() => {
        const row = [...document.querySelectorAll("[data-txn-detail='true'] div")].find((item) => item.querySelector("dt")?.textContent === "Date");
        return row?.querySelector("dd")?.textContent || "";
      })()`);
      assert.equal(txnDate, "Tue Nov 10");
      assert.equal(await pressLabel(page.send, evalPage, "Back"), "yes");
      await waitFor(page.send, `${settled} && document.querySelector("[data-category-detail='true']") ? 'yes' : ''`, "back to category");
      assert.equal(await pressLabel(page.send, evalPage, "Edit"), "yes");
      await waitFor(page.send, `${settled} && document.getElementById("budget-dining-out") ? 'yes' : ''`, "edit form");
      const form = JSON.parse(await evalPage(page.send, `(() => {
        const input = document.getElementById("budget-dining-out");
        return JSON.stringify({
          heading: document.querySelector("[role='dialog'] h2")?.textContent || "",
          mode: input.getAttribute("inputmode"),
          hint: input.getAttribute("enterkeyhint"),
          size: parseFloat(getComputedStyle(input).fontSize),
          sheet: document.querySelector("[data-overlay='panel']")?.getAttribute("data-sheet") || "",
          deleted: document.body.innerText.includes("Delete this category"),
        });
      })()`));
      assert.equal(form.heading, "Monthly budgets");
      assert.equal(form.mode, "decimal");
      assert.equal(form.hint, "done");
      assert.ok(form.size >= 16, `input size ${form.size}`);
      assert.equal(form.sheet, "form");
      assert.equal(form.deleted, false);
      assert.equal(await evalPage(page.send, "document.activeElement?.id || ''"), "budget-dining-out");
      const formClosed = `${settled} && document.querySelector("[data-category-detail='true']") && !document.getElementById("budget-dining-out") ? "yes" : ""`;
      let closedForm = false;
      for (let attempt = 0; attempt < 4 && !closedForm; attempt += 1) {
        await evalPage(page.send, `(() => {
          const button = [...document.querySelectorAll("[data-overlay='panel'] button")].find((el) => (el.innerText || "").replace(/\\s+/g, " ").trim() === "Cancel");
          if (button) button.click();
        })()`);
        const started = Date.now();
        while (Date.now() - started < 2000) {
          if (await evalPage(page.send, formClosed)) {
            closedForm = true;
            break;
          }
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
      }
      if (!closedForm) {
        const info = await evalPage(page.send, `JSON.stringify({
          budget: Boolean(document.getElementById("budget-dining-out")),
          state: document.querySelector("[data-overlay='panel']")?.getAttribute("data-state") || "",
          stack: document.querySelector("[data-stack]")?.getAttribute("data-stack") || "",
          title: document.querySelector("[role='dialog'] h2")?.textContent || "",
          detail: Boolean(document.querySelector("[data-category-detail='true']")),
        })`);
        throw new Error(`form stayed open ${info}`);
      }

      await page.send("Page.navigate", { url: `${base()}/finance/spending?cat=utilities&period=month&asOf=${encodeURIComponent(AS_OF)}` });
      await waitFor(page.send, `${settled} && document.querySelector("[role='dialog'] h2")?.textContent === "Bills & Utilities" ? 'yes' : ''`, "utilities");
      const utilities = await evalPage(page.send, "document.querySelector(\"[data-item-meta]\")?.textContent || ''");
      assert.equal(String(utilities).includes(" of "), false);
      assert.equal(String(utilities).includes("4,204"), false);

      await page.send("Page.navigate", { url: `${base()}/finance/spending?cat=school&period=month&asOf=${encodeURIComponent(AS_OF)}` });
      await waitFor(page.send, `${settled} && document.querySelector("[role='dialog'] h2")?.textContent === "School" ? 'yes' : ''`, "school");
      assert.equal(await pressLabel(page.send, evalPage, "Edit"), "yes");
      await waitFor(page.send, `${settled} && document.activeElement?.id === "budget-school" ? 'yes' : ''`, "school focus");
      const focused = JSON.parse(await evalPage(page.send, `(() => {
        const input = document.getElementById("budget-school");
        const scroller = input?.closest("[data-stack]");
        const field = input?.getBoundingClientRect();
        const view = scroller?.getBoundingClientRect();
        const seen = Boolean(field && view && field.top >= view.top - 1 && field.bottom <= view.bottom + 1 && field.height > 20);
        const style = input ? getComputedStyle(input) : null;
        return JSON.stringify({
          id: document.activeElement?.id || "",
          seen,
          whole: Boolean(document.getElementById("budget-dining-out") && document.getElementById("budget-other")),
          width: style ? style.borderTopWidth : "",
          color: style ? style.borderTopColor : "",
        });
      })()`));
      assert.equal(focused.id, "budget-school");
      assert.equal(focused.seen, true);
      assert.equal(focused.whole, true);
      assert.equal(focused.width, "2px");
      assert.equal(focused.color, "rgb(31, 42, 36)");
    }

    await size(page.send, 390, 844);
    await page.send("Page.navigate", { url: `${base()}/finance/spending?cat=dining-out&period=month&xe=offline&asOf=${encodeURIComponent(AS_OF)}` });
    await waitFor(page.send, `${settled} && document.querySelector("[data-state='offline']")?.textContent.includes("You are offline.") ? 'yes' : ''`, "offline");
    assert.equal(await evalPage(page.send, "[...document.querySelectorAll('[data-overlay=panel] button')].some((button) => (button.innerText || '').trim() === 'Edit' && button.disabled) ? 'yes' : 'no'"), "yes");

    await page.send("Page.addScriptToEvaluateOnNewDocument", {
      source: `(() => {
        window.__stalls = 0;
        const real = window.fetch.bind(window);
        window.fetch = (input, init) => {
          const url = String(input && input.url ? input.url : input);
          if (url.includes("/weeks/") && url.includes("/categories/")) {
            window.__stalls += 1;
            return new Promise(() => {});
          }
          return real(input, init);
        };
      })();`,
    });
    await page.send("Page.navigate", { url: `${base()}/finance/spending?cat=groceries&period=month&asOf=${encodeURIComponent(AS_OF)}` });
    const loading = await waitFor(page.send, "document.querySelector('[data-ready]') ? JSON.stringify({ stalls: window.__stalls || 0, title: document.querySelector('[role=dialog] h2')?.textContent || '' }) : ''", "category state");
    assert.equal(JSON.parse(String(loading)).stalls >= 1, true, loading);
    assert.equal(JSON.parse(String(loading)).title, "Groceries");
    await evalPage(page.send, "window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })); 'yes'");
    await waitFor(page.send, "!document.querySelector('[role=dialog]') && !location.search.includes('cat=') ? 'closed' : ''", "escape while loading");
  } finally {
    if (page) await page.close();
    await stopProcess(chrome);
    await stopProcess(child);
    await release();
  }
});
