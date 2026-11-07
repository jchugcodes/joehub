import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

const PORT = 3800 + (process.pid % 200);
const CDP = 9800 + (process.pid % 200);
const BASE = `http://127.0.0.1:${PORT}`;
const ROOT = fileURLToPath(new URL("..", import.meta.url));
const ARTIFACTS = "/opt/cursor/artifacts";
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
      JOEHUB_SESSION_SECRET: "more-test-secret-value",
      JOEHUB_SCREENSHOTS: "1",
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
      const response = await fetch(`${BASE}/more`, { signal: AbortSignal.timeout(2000) });
      if (response.status === 200) break;
    } catch {
      // still booting
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  let chromeError = "chrome did not open a debugging port";
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    chrome = spawn(
      chromeBin,
      ["--headless=new", "--disable-gpu", "--no-sandbox", "--disable-dev-shm-usage", `--remote-debugging-port=${CDP}`, `--user-data-dir=/tmp/chrome-more-${process.pid}-${attempt}`, "about:blank"],
      { stdio: ["ignore", "ignore", "pipe"] },
    );
    let chromeLog = "";
    chrome.stderr.on("data", (chunk) => {
      chromeLog += chunk;
    });
    for (let i = 0; i < 80; i += 1) {
      if (chrome.exitCode != null) break;
      try {
        await fetch(`http://127.0.0.1:${CDP}/json/version`, { signal: AbortSignal.timeout(1000) });
        return;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
    }
    chromeError = `chrome did not open a debugging port (attempt ${attempt}, exit ${chrome.exitCode})\n${chromeLog.slice(-500)}`;
    chrome.kill();
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error(chromeError);
}

async function openPage() {
  const created = await fetch(`http://127.0.0.1:${CDP}/json/new?${encodeURIComponent(`${BASE}/more`)}`, { method: "PUT" }).then((response) => response.json());
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
  await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 900, deviceScaleFactor: 1, mobile: true });
  return { send, async close() { ws.close(); await fetch(`http://127.0.0.1:${CDP}/json/close/${created.id}`); } };
}

async function evalValue(send, expression) {
  const message = await send("Runtime.evaluate", { expression, returnByValue: true });
  if (message.result?.exceptionDetails) throw new Error(JSON.stringify(message.result.exceptionDetails));
  return message.result?.result?.value;
}

async function waitFor(send, expression) {
  for (let i = 0; i < 60; i += 1) {
    const value = await evalValue(send, expression);
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`timed out waiting for ${expression}`);
}

async function go(send, path, width = 390) {
  await send("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: width < 500 });
  await send("Page.navigate", { url: `${BASE}${path}` });
  await waitFor(send, "document.querySelector(\"[data-ready='true']\") && document.querySelector('h1') ? 'yes' : ''");
  await waitFor(send, "parseFloat(getComputedStyle(document.querySelector('h1')).fontSize) > 10 ? 'yes' : ''");
}

async function click(send, expression) {
  const clicked = await evalValue(send, `(() => { ${expression} return 'yes'; })()`);
  assert.equal(clicked, "yes");
}

async function capture(send, width, name, full, prepare) {
  await send("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: width < 500 });
  if (full) {
    const metrics = await send("Page.getLayoutMetrics");
    const height = Math.max(900, Math.ceil(metrics.result.cssContentSize.height));
    await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: width < 500 });
  }
  if (prepare) await evalValue(send, prepare);
  await new Promise((resolve) => setTimeout(resolve, 80));
  const shot = await send("Page.captureScreenshot", { format: "png" });
  writeFileSync(`${ARTIFACTS}/${name}`, Buffer.from(shot.result.data, "base64"));
}

test.before(async () => {
  if (!chromeBin) return;
  mkdirSync(ARTIFACTS, { recursive: true });
  await boot();
});

test.after(() => {
  chrome?.kill();
  child?.kill();
});

test("more menu routes into the transactions table and finance accounts", { timeout: 240000, skip }, async () => {
  const page = await openPage();
  const { send } = page;
  try {
    await go(send, "/more");
    const menu = await evalValue(
      send,
      `(() => {
        const links = [...document.querySelectorAll("a")].map((node) => ({ text: node.innerText.trim(), href: node.getAttribute("href") }));
        const buttons = [...document.querySelectorAll("button")].map((node) => node.innerText.trim());
        return {
          database: links.find((link) => link.text.startsWith("Database"))?.href,
          accounts: links.find((link) => link.text.startsWith("Accounts"))?.href,
          plannedButtons: buttons.filter((text) => text.includes("Appearance") || text.includes("Sync")),
          search: document.querySelector("input") ? "yes" : "",
        };
      })()`,
    );
    assert.equal(menu.database, "/more/database");
    assert.equal(menu.accounts, "/finance/accounts?from=more");
    assert.deepEqual(menu.plannedButtons, []);
    assert.equal(menu.search, "");

    await click(send, `document.querySelector("#more-accounts").click();`);
    await waitFor(send, "document.querySelector('h1')?.textContent === 'Accounts' && document.querySelector('[data-from=\"more\"]') ? 'yes' : ''");
    const accounts = await evalValue(
      send,
      `(() => ({
        finance: [...document.querySelectorAll('nav a')].find((node) => node.innerText.includes('Finance'))?.getAttribute('aria-current'),
        back: [...document.querySelectorAll('a')].some((node) => node.innerText.includes('More') && node.getAttribute('href') === '/more#accounts'),
      }))()`,
    );
    assert.equal(accounts.finance, "page");
    assert.equal(accounts.back, true);
    await click(send, `document.querySelector('a[href="/more#accounts"]').click();`);
    await waitFor(send, "document.activeElement?.id === 'more-accounts' ? 'yes' : ''");

    await go(send, "/more/database");
    const table = await evalValue(
      send,
      `(() => {
        const merchants = [...document.querySelectorAll('tbody th button')].map((node) => node.textContent.trim());
        const amount = document.querySelector('tbody tr td:nth-child(3)');
        return {
          count: merchants.length,
          first: merchants[0],
          fifthSameDay: merchants[2],
          payroll: document.body.innerText.includes('+2,350.00'),
          search: document.querySelector('input') ? 'yes' : '',
          sort: document.querySelector('th[aria-sort]')?.innerText.trim(),
          width: document.querySelector('table').getBoundingClientRect().width,
          hint: document.getElementById('table-hint')?.innerText || '',
        };
      })()`,
    );
    assert.equal(table.count, 14);
    assert.equal(table.first, "Joe's Pizza");
    assert.equal(table.fifthSameDay, "MTA");
    assert.equal(table.payroll, true);
    assert.equal(table.search, "");
    assert.match(table.sort, /Date/);
    assert.ok(table.width > 540 && table.width < 590);
    assert.match(table.hint, /Swipe horizontally for more columns/);

    await click(send, `document.querySelector('button[aria-label^="Sort"]').click();`);
    await waitFor(send, "document.querySelector('tbody th button')?.textContent.trim() === 'Loan pmt' ? 'yes' : ''");
    assert.match(await evalValue(send, "document.querySelector('th[aria-sort]')?.innerText || ''"), /Amount/);
    assert.equal(await evalValue(send, "document.querySelector('th[aria-sort]')?.getAttribute('aria-sort')"), "ascending");
    await click(send, `document.querySelector('button[aria-label^="Sort"]').click();`);
    await waitFor(send, "document.querySelector('tbody th button')?.textContent.trim() === 'Payroll' ? 'yes' : ''");
    await click(send, `document.querySelector('button[aria-label^="Sort"]').click();`);
    await waitFor(send, "document.querySelector('tbody th button')?.textContent.trim() === \"Joe's Pizza\" ? 'yes' : ''");

    await click(send, `document.querySelector('#filter-month').click();`);
    await click(send, `[...document.querySelectorAll('button')].find((node) => node.textContent.trim() === 'All amounts').click();`);
    await waitFor(send, "document.body.innerText.includes('6 example rows') ? 'yes' : ''");
    assert.equal(await evalValue(send, "document.body.innerText.includes('Payroll')"), false);
    await click(send, `document.querySelector('[aria-label="Remove November 2026 filter"]').click();`);
    await waitFor(send, "document.body.innerText.includes('Lilia') ? 'yes' : ''");
    assert.equal(await evalValue(send, "document.activeElement?.id"), "filter-month");

    await go(send, "/more/database?month=2026-11&amount=income&account=Card%20A");
    await waitFor(send, "document.querySelector('[data-state=\"filtered-empty\"]') ? 'yes' : ''");
    assert.match(await evalValue(send, "document.body.innerText"), /No rows match Nov 2026, Income only and Card A/);
    const filtered = await evalValue(
      send,
      `(() => {
        const card = document.querySelector('[data-state-card]');
        const clear = [...document.querySelectorAll('button')].find((node) => node.textContent.trim() === 'Clear filters');
        const back = [...document.querySelectorAll('a')].find((node) => node.textContent.trim() === 'Back to More');
        return {
          outside: Boolean(card && clear && back && !card.contains(clear) && !card.contains(back)),
          swipe: document.body.innerText.includes('Swipe horizontally'),
        };
      })()`,
    );
    assert.equal(filtered.outside, true);
    assert.equal(filtered.swipe, false);
    await click(send, `[...document.querySelectorAll('button')].find((node) => node.textContent.trim() === 'Clear filters').click();`);
    await waitFor(send, "document.querySelectorAll('tbody th button').length === 14 ? 'yes' : ''");

    const sticky = await evalValue(
      send,
      `(() => {
        const region = document.getElementById('table-scroll');
        region.scrollLeft = 188;
        const merchant = region.querySelector('tbody th').getBoundingClientRect();
        const box = region.getBoundingClientRect();
        const amount = region.querySelector('tbody tr').children[3].getBoundingClientRect();
        return {
          stuck: Math.abs(merchant.left - box.left) < 3,
          amountVisible: amount.left < box.right - 4 && amount.left >= box.left + 80,
          scrolls: region.scrollWidth > region.clientWidth + 40,
          page: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        };
      })()`,
    );
    assert.equal(sticky.stuck, true);
    assert.equal(sticky.amountVisible, true);
    assert.equal(sticky.scrolls, true);
    assert.ok(sticky.page <= 1, JSON.stringify(sticky));
    const moved = await evalValue(
      send,
      `(() => {
        const region = document.getElementById('table-scroll');
        region.scrollLeft = 0;
        region.focus();
        region.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
        return region.scrollLeft;
      })()`,
    );
    assert.ok(moved >= 48);

    await evalValue(send, "document.getElementById('table-scroll').scrollLeft = 120");
    await click(send, `document.getElementById('tx-example-tx-01').click();`);
    await waitFor(send, "document.querySelector('[role=dialog]') ? 'yes' : ''");
    const detail = await evalValue(
      send,
      `(() => {
        const dialog = document.querySelector('[role=dialog]');
        return {
          title: dialog.querySelector('h2')?.textContent,
          amount: dialog.innerText.includes('−$14.50'),
          reviewed: dialog.innerText.includes('Yes'),
          fields: dialog.querySelectorAll('input, textarea').length,
          inert: document.querySelector('[data-ready] > div')?.hasAttribute('inert'),
          titleSize: parseFloat(getComputedStyle(dialog.querySelector('h2')).fontSize),
          amountSize: parseFloat(getComputedStyle(dialog.querySelector('[data-amount]')).fontSize),
          grouped: dialog.querySelector('h2').parentElement.querySelector('p')?.textContent.includes('read-only') === true && dialog.querySelector('h2').parentElement.querySelector('button') == null,
          scrim: getComputedStyle(document.querySelector('[data-scrim]')).backgroundColor,
          close: dialog.querySelector('[aria-label="Close"]').getBoundingClientRect().width,
        };
      })()`,
    );
    assert.equal(detail.title, "Joe's Pizza");
    assert.equal(detail.amount, true);
    assert.equal(detail.reviewed, true);
    assert.equal(detail.fields, 0);
    assert.equal(detail.inert, true);
    assert.equal(detail.titleSize, 20);
    assert.equal(detail.amountSize, 32);
    assert.equal(detail.grouped, true);
    assert.equal(detail.close, 44);
    const scrim = String(detail.scrim).match(/rgba?\(\s*31,\s*42,\s*36(?:,\s*([0-9.]+))?\)/);
    assert.ok(scrim, detail.scrim);
    const scrimAlpha = scrim[1] === undefined ? 1 : Number(scrim[1]);
    assert.ok(scrimAlpha > 0.43 && scrimAlpha < 0.45, detail.scrim);
    await send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
    await send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
    await waitFor(send, "document.querySelector('[role=dialog]') ? '' : 'closed'");
    await waitFor(send, "document.activeElement?.id === 'tx-example-tx-01' ? 'yes' : ''");
    assert.equal(await evalValue(send, "document.getElementById('table-scroll').scrollLeft"), 120);

    await go(send, "/more/database", 1280);
    const wide = await evalValue(
      send,
      `(() => ({
        main: getComputedStyle(document.querySelector('main')).maxWidth,
        table: document.querySelector('table').getBoundingClientRect().width,
        page: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      }))()`,
    );
    assert.equal(wide.main, "390px");
    assert.ok(wide.table < 600);
    assert.ok(wide.page <= 1);

    await go(send, "/more/database?view=loading");
    const loading = await evalValue(
      send,
      `(() => ({
        state: document.querySelector('[data-state]')?.getAttribute('data-state'),
        busy: document.getElementById('table-scroll')?.getAttribute('aria-busy'),
        pizza: document.body.innerText.includes("Joe's Pizza"),
        disabled: document.querySelector('button[aria-label^="Sort"]').disabled,
        hint: document.getElementById('table-hint')?.innerText.trim(),
        status: document.body.innerText.includes('Loading your table. No counts until it resolves.'),
        swipe: document.body.innerText.includes('Swipe horizontally'),
      }))()`,
    );
    assert.equal(loading.state, "loading");
    assert.equal(loading.busy, "true");
    assert.equal(loading.pizza, false);
    assert.equal(loading.disabled, true);
    assert.equal(loading.hint, "Loading transactions…");
    assert.equal(loading.status, true);
    assert.equal(loading.swipe, false);

    await go(send, "/more/database?view=empty");
    assert.match(await evalValue(send, "document.body.innerText"), /No transactions yet/);
    assert.equal(await evalValue(send, "document.body.innerText.includes(\"Joe's Pizza\")"), false);
    const empty = await evalValue(
      send,
      `(() => {
        const card = document.querySelector('[data-state-card]');
        const back = [...document.querySelectorAll('a')].find((node) => node.textContent.trim() === 'Back to More');
        return { outside: Boolean(card && back && !card.contains(back)), swipe: document.body.innerText.includes('Swipe horizontally') };
      })()`,
    );
    assert.equal(empty.outside, true);
    assert.equal(empty.swipe, false);

    await go(send, "/more/database?view=error&fresh=1");
    assert.match(await evalValue(send, "document.body.innerText"), /Table unavailable/);
    const error = await evalValue(
      send,
      `(() => {
        const card = document.querySelector('[data-state-card]');
        const retry = [...document.querySelectorAll('button')].find((node) => node.textContent.trim() === 'Retry');
        const back = [...document.querySelectorAll('a')].find((node) => node.textContent.trim() === 'Back to More');
        return { outside: Boolean(card && retry && back && !card.contains(retry) && !card.contains(back)) };
      })()`,
    );
    assert.equal(error.outside, true);
    await click(send, `[...document.querySelectorAll('button')].find((node) => node.textContent.trim() === 'Retry').click();`);
    await waitFor(send, "document.body.innerText.includes(\"Joe's Pizza\") ? 'yes' : ''");

    await go(send, "/more/database");
    await go(send, "/more/database?view=error");
    assert.match(await evalValue(send, "document.body.innerText"), /last snapshot/);
    assert.equal(await evalValue(send, "document.body.innerText.includes(\"Joe's Pizza\")"), true);

    const shots = [
      ["/more/database", "more_fix_m06_detail", false],
      ["/more/database?view=loading", "more_fix_m07_loading", true],
      ["/more/database?view=empty", "more_fix_m08_empty", true],
      ["/more/database?view=error&fresh=1", "more_fix_m09_error", true],
      ["/more/database?month=2026-11&amount=income&account=Card%20A", "more_fix_m10_filtered_empty", true],
    ];
    for (const [path, name, full] of shots) {
      for (const width of [390, 1280]) {
        await go(send, path, width);
        if (name.endsWith("detail")) {
          await click(send, `document.getElementById('tx-example-tx-01').click();`);
          await waitFor(send, "document.querySelector('[role=dialog] h2') ? 'yes' : ''");
        }
        await capture(
          send,
          width,
          `${name}_${width}.png`,
          full && !name.endsWith("detail"),
          name.endsWith("sticky") || name.endsWith("sort")
            ? "document.getElementById('table-scroll').scrollLeft = 188"
            : "",
        );
      }
    }
  } finally {
    await page.close();
  }
});

async function tab(send) {
  await send("Input.dispatchKeyEvent", { type: "keyDown", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9, nativeVirtualKeyCode: 9 });
  await send("Input.dispatchKeyEvent", { type: "keyUp", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9, nativeVirtualKeyCode: 9 });
}

test("more pages stay inside 320px and 200% text and answer the Tab key", { timeout: 180000, skip }, async () => {
  const page = await openPage();
  const { send } = page;
  try {
    const cases = [
      ["/more", 320, false],
      ["/more/database", 320, false],
      ["/more/database?view=loading", 320, false],
      ["/more/database?view=empty", 320, false],
      ["/more/database?view=error&fresh=1", 320, false],
      ["/more/database?month=2026-11&amount=income&account=Card%20A", 320, false],
      ["/more", 390, true],
      ["/more/database", 390, true],
      ["/more/database?view=empty", 390, true],
    ];
    for (const [path, width, enlarge] of cases) {
      await go(send, path, width);
      if (enlarge) {
        await send("Runtime.evaluate", { expression: "document.documentElement.style.fontSize = '200%'" });
        await send("Runtime.evaluate", {
          expression: "new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))",
          awaitPromise: true,
        });
      }
      const value = await evalValue(
        send,
        `(() => {
          const doc = document.documentElement;
          const primary = document.querySelector("nav[aria-label='Primary'] ul");
          const tabs = primary ? [...primary.querySelectorAll("a")] : [];
          const h1 = document.querySelector("h1");
          return {
            overflow: doc.scrollWidth - doc.clientWidth,
            title: h1 ? parseFloat(getComputedStyle(h1).fontSize) : 0,
            tabs: tabs.map((tab) => (tab.textContent || "").replace(/\\s+/g, " ").trim()),
            tabsInside: tabs.every((tab) => {
              const box = tab.getBoundingClientRect();
              return box.width > 0 && box.left >= -1 && box.right <= window.innerWidth + 1 && box.bottom <= window.innerHeight + 1;
            }),
          };
        })()`,
      );
      assert.ok(value.overflow <= 1, `${path} at ${width}${enlarge ? " text 200%" : ""} overflows by ${value.overflow}px`);
      assert.deepEqual(value.tabs, ["Home", "Finance", "Jobs", "Journal", "More"]);
      assert.equal(value.tabsInside, true, `${path} clips a primary tab`);
      if (enlarge) assert.ok(Math.abs(value.title - 44) < 0.6, `${path} title computed ${value.title}px`);
    }

    await go(send, "/more", 320);
    await send("Emulation.setFocusEmulationEnabled", { enabled: true });
    let guard = 0;
    while ((await evalValue(send, "document.activeElement?.id || ''")) !== "more-database" && guard < 12) {
      await tab(send);
      guard += 1;
    }
    assert.equal(await evalValue(send, "document.activeElement?.id"), "more-database");
    await tab(send);
    assert.equal(await evalValue(send, "document.activeElement?.id"), "more-accounts");
    await tab(send);
    const afterAccounts = await evalValue(send, "(document.activeElement?.innerText || '').trim()");
    assert.match(afterAccounts, /Home/);
    assert.equal(await evalValue(send, "document.body.innerText.includes('Appearance')"), true);
    assert.equal(afterAccounts.includes("Appearance"), false);

    await go(send, "/more/database", 320);
    guard = 0;
    while (!(await evalValue(send, "document.activeElement?.getAttribute('aria-label') || ''")).startsWith("Sort") && guard < 12) {
      await tab(send);
      guard += 1;
    }
    assert.match(await evalValue(send, "document.activeElement?.getAttribute('aria-label') || ''"), /^Sort/);
    await tab(send);
    assert.equal(await evalValue(send, "document.activeElement?.id"), "filter-month");
    await tab(send);
    assert.match(await evalValue(send, "document.activeElement?.innerText || ''"), /amounts|Expenses|Income/);
    const seen = [];
    let steps = 0;
    while (steps < 8 && !(await evalValue(send, "(document.activeElement?.id || '').startsWith('tx-')"))) {
      seen.push(await evalValue(send, "(document.activeElement?.innerText || '').trim()"));
      await tab(send);
      steps += 1;
    }
    assert.equal(seen.some((label) => String(label).includes("planned")), false);
    assert.match(await evalValue(send, "document.activeElement?.id || ''"), /^tx-/);
  } finally {
    await page.close();
  }
});
