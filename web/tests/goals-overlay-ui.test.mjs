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

function cookieValue(response) {
  const rows = typeof response.headers.getSetCookie === "function" ? response.headers.getSetCookie() : [];
  const raw = rows.find((row) => row.startsWith("joehub_session=")) || response.headers.get("set-cookie") || "";
  return raw.split(";", 1)[0].slice("joehub_session=".length);
}

async function boot(extra = {}) {
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
      JOEHUB_SESSION_SECRET: "goals-overlay-secret-value",
      JOEHUB_SCREENSHOTS: "1",
      ...extra,
    },
  });
  child = started.child;
  await waitForHttp(`${base()}/finance/goals`, {
    child,
    log: started.log,
    accept: (response) => response.status === 200 && (response.headers.get("content-type") || "").includes("text/html"),
  });
  chrome = startChrome(chromeBin, cdp, `/tmp/chrome-goals-overlay-${process.pid}`);
  await waitForChrome(cdp, chrome);
  const logged = await fetch(`${base()}/api/session/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: "synthetic", password: "synthetic", device_label: "goals-overlay" }),
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
  await send("Runtime.enable");
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

test("goals overlay is a read-only detail and an empty-state add", { timeout: 180000, skip }, async () => {
  let page = null;
  try {
    const cookie = await boot();
    page = await openPage(cookie);
    const { send } = page;
    await size(send, 390, 844);
    await send("Page.navigate", { url: `${base()}/finance/goals` });
    await waitFor(send, "document.querySelector(\"[data-ready='true'] h1\")?.textContent === 'Finance' ? 'yes' : ''", "goals");
    await waitFor(send, "document.body.innerText.includes('$740 / mo') && document.body.innerText.includes('Loan payoff') ? 'yes' : ''", "goal list");
    const listed = await evalPage(send, "document.body.innerText");
    assert.match(listed, /\$12,400/);
    assert.match(listed, /\$8,400/);
    assert.doesNotMatch(listed, /4,204/);
    assert.doesNotMatch(listed, /147,184/);
    assert.equal(await evalPage(send, "document.querySelector(\"[data-goal='emergency-fund']\")?.classList.contains('row-selected') ? 'yes' : 'no'"), "no");

    await evalPage(send, "document.querySelector(\"[data-goal='emergency-fund']\")?.click()");
    await waitFor(send, `${settled} && document.querySelector("[data-goal-detail]") ? "yes" : ""`, "goal detail");
    const detail = JSON.parse(await evalPage(send, `(() => {
      const panel = document.querySelector("[data-overlay='panel']");
      const heading = panel?.querySelector("h2");
      const body = panel?.querySelector("[data-stack]")?.firstElementChild;
      const close = panel?.querySelector("[aria-label='Close']");
      const row = document.querySelector("[data-goal='emergency-fund']");
      const name = row?.querySelector(".text-section");
      const rows = [...(panel?.querySelectorAll("dl div") || [])].map((el) => (el.innerText || "").replace(/\\s+/g, " ").trim());
      const controls = [...(panel?.querySelectorAll("button") || [])].map((el) => (el.getAttribute("aria-label") || el.innerText || "").replace(/\\s+/g, " ").trim());
      return JSON.stringify({
        title: heading ? heading.textContent : "",
        align: heading ? getComputedStyle(heading).textAlign : "",
        titleColor: heading ? getComputedStyle(heading).color : "",
        width: panel ? Math.round(panel.getBoundingClientRect().width) : 0,
        pad: body ? getComputedStyle(body).paddingLeft : "",
        padY: body ? getComputedStyle(body).paddingTop : "",
        rows,
        controls,
        text: panel?.innerText || "",
        focusRing: close?.matches(":focus-visible") ? "yes" : "no",
        row: row?.classList.contains("row-selected") ? "yes" : "no",
        rowH: row ? Math.round(row.getBoundingClientRect().height) : 0,
        nameColor: name ? getComputedStyle(name).color : "",
      });
    })()`));
    assert.equal(detail.title, "Emergency fund");
    assert.equal(detail.align, "left");
    assert.equal(detail.titleColor, "rgb(31, 42, 36)");
    assert.equal(detail.width, 342);
    assert.equal(detail.pad, "20px");
    assert.equal(detail.padY, "16px");
    assert.deepEqual(detail.rows, ["Type Savings", "Target $12,600", "In account Emergency savings", "Monthly $220"]);
    assert.deepEqual(detail.controls, ["Close", "Edit"]);
    assert.match(detail.text, /\$8,400/);
    assert.match(detail.text, /of \$12,600/);
    assert.doesNotMatch(detail.text, /Delete|Transfer|Mark complete|4,204/);
    assert.equal(detail.focusRing, "no");
    assert.equal(detail.row, "yes");
    assert.ok(detail.rowH >= 44);
    assert.equal(detail.nameColor, "rgb(31, 42, 36)");

    await size(send, 390, 844);
    await send("Page.navigate", { url: `${base()}/finance/goals/emergency-fund?xe=offline` });
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
    await send("Page.navigate", { url: `${base()}/finance/goals/emergency-fund` });
    await waitFor(send, `${settled} && document.querySelector("[data-overlay='desktop']") ? "yes" : ""`, "desktop pin");
    const desktop = JSON.parse(await evalPage(send, `(() => {
      const panel = document.querySelector("[data-overlay='panel']");
      const heading = panel?.querySelector("h2");
      const pin = document.querySelector("[data-overlay='desktop']");
      const rows = [...(panel?.querySelectorAll("dl div") || [])].map((el) => (el.innerText || "").replace(/\\s+/g, " ").trim());
      const name = document.querySelector("[data-goal='nyc-move-fund'] .text-section");
      const box = name ? name.getBoundingClientRect() : null;
      return JSON.stringify({
        title: heading ? heading.textContent : "",
        align: heading ? getComputedStyle(heading).textAlign : "",
        titleColor: heading ? getComputedStyle(heading).color : "",
        pin: pin ? "yes" : "",
        rows,
        nameColor: name ? getComputedStyle(name).color : "",
        x: box ? box.x + box.width / 2 : 0,
        y: box ? box.y + Math.min(12, box.height / 2) : 0,
      });
    })()`));
    assert.equal(desktop.title, "Emergency fund");
    assert.equal(desktop.align, "left");
    assert.equal(desktop.titleColor, "rgb(31, 42, 36)");
    assert.equal(desktop.pin, "yes");
    assert.deepEqual(desktop.rows, ["Type Savings", "In account Emergency savings", "Monthly $220"]);
    assert.equal(desktop.nameColor, "rgb(31, 42, 36)");
    await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: desktop.x, y: desktop.y });
    const hovered = await evalPage(send, "getComputedStyle(document.querySelector(\"[data-goal='nyc-move-fund'] .text-section\")).color");
    assert.equal(hovered, "rgb(31, 42, 36)");
  } finally {
    if (page) await page.close();
    await stopProcess(chrome);
    await stopProcess(child);
    await release();
  }
});

test("adding a goal from the empty state uses the overlay save header", { timeout: 180000, skip }, async () => {
  let page = null;
  try {
    const cookie = await boot({ JOEHUB_SEED_GOALS: "0" });
    page = await openPage(cookie);
    const { send } = page;
    await size(send, 390, 844);
    await send("Page.navigate", { url: `${base()}/finance/goals` });
    await waitFor(send, "document.querySelector(\"[data-ready='true']\") && document.querySelector(\"[data-hydrated]\") && document.body.innerText.includes('No goals yet') ? 'yes' : ''", "empty");
    await evalPage(send, "[...document.querySelectorAll('button')].find((el) => (el.innerText || '').trim() === 'Add a goal')?.click()");
    await waitFor(send, `${settled} && document.getElementById('goal-name') ? "yes" : ""`, "add form");
    const header = JSON.parse(await evalPage(send, `(() => {
      const panel = document.querySelector("[data-overlay='panel']");
      const buttons = [...panel.querySelectorAll("button")].map((el) => (el.innerText || el.getAttribute("aria-label") || "").replace(/\\s+/g, " ").trim()).filter(Boolean);
      return JSON.stringify({ title: panel.querySelector("h2")?.textContent || "", buttons, text: panel.innerText || "" });
    })()`));
    assert.equal(header.title, "Add a goal");
    assert.deepEqual(header.buttons, ["Cancel", "Save"]);
    assert.doesNotMatch(header.text, /Delete|4,204/);
    await evalPage(send, `(() => {
      const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
      const fill = (id, value) => { const el = document.getElementById(id); set.call(el, value); el.dispatchEvent(new Event("input", { bubbles: true })); };
      fill("goal-name", "Cabin fund");
      fill("goal-saved", "100");
      fill("goal-target", "500");
      fill("goal-monthly", "10");
      return "yes";
    })()`);
    await evalPage(send, "[...document.querySelectorAll('button')].find((el) => (el.innerText || '').trim() === 'Save')?.click()");
    await waitFor(send, "document.body.innerText.includes('Cabin fund') && document.body.innerText.includes('$100') && !document.querySelector(\"[data-overlay='panel']\") ? 'yes' : ''", "saved goal");
    const saved = await evalPage(send, "document.body.innerText");
    assert.match(saved, /\$100/);
    assert.doesNotMatch(saved, /4,204/);
  } finally {
    if (page) await page.close();
    await stopProcess(chrome);
    await stopProcess(child);
    await release();
  }
});

test("add goal save stays disabled until the name and target are valid", { timeout: 180000, skip }, async () => {
  let page = null;
  try {
    const cookie = await boot({ JOEHUB_SEED_GOALS: "0" });
    page = await openPage(cookie);
    const { send } = page;
    await size(send, 390, 844);
    await send("Page.navigate", { url: `${base()}/finance/goals` });
    await waitFor(send, "document.querySelector(\"[data-ready='true']\") && document.querySelector(\"[data-hydrated]\") && document.body.innerText.includes('No goals yet') ? 'yes' : ''", "empty");
    await evalPage(send, "[...document.querySelectorAll('button')].find((el) => (el.innerText || '').trim() === 'Add a goal')?.click()");
    await waitFor(send, `${settled} && document.getElementById('goal-name') ? "yes" : ""`, "add form");
    const measure = `(() => {
      const panel = document.querySelector("[data-overlay='panel']");
      const save = [...panel.querySelectorAll("button")].find((el) => (el.innerText || "").trim() === "Save");
      const pill = save?.querySelector("span");
      const pillBox = pill?.getBoundingClientRect();
      const saveBox = save?.getBoundingClientRect();
      return JSON.stringify({
        disabled: Boolean(save?.disabled),
        opacity: save ? getComputedStyle(save).opacity : "",
        buttonH: saveBox ? Math.round(saveBox.height) : 0,
        pillH: pillBox ? Math.round(pillBox.height) : 0,
        pillBg: pill ? getComputedStyle(pill).backgroundColor : "",
        pillColor: pill ? getComputedStyle(pill).color : "",
      });
    })()`;
    const empty = JSON.parse(await evalPage(send, measure));
    assert.equal(empty.disabled, true);
    assert.equal(empty.opacity, "0.5");
    assert.equal(empty.buttonH, 44);
    assert.equal(empty.pillH, 32);
    assert.equal(empty.pillBg, "rgb(31, 42, 36)");
    assert.equal(empty.pillColor, "rgb(245, 246, 244)");
    await evalPage(send, `(() => {
      const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
      const fill = (id, value) => { const el = document.getElementById(id); set.call(el, value); el.dispatchEvent(new Event("input", { bubbles: true })); };
      fill("goal-name", "   ");
      fill("goal-target", "0");
      return "yes";
    })()`);
    assert.equal(JSON.parse(await evalPage(send, measure)).disabled, true);
    await evalPage(send, `(() => {
      const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
      const fill = (id, value) => { const el = document.getElementById(id); set.call(el, value); el.dispatchEvent(new Event("input", { bubbles: true })); };
      fill("goal-name", "Cabin fund");
      fill("goal-target", "500");
      return "yes";
    })()`);
    const ready = JSON.parse(await evalPage(send, measure));
    assert.equal(ready.disabled, false);
    assert.equal(ready.opacity, "1");
    assert.equal(ready.pillH, 32);
  } finally {
    if (page) await page.close();
    await stopProcess(chrome);
    await stopProcess(child);
    await release();
  }
});

test("editing a goal keeps save disabled until a change, then delete asks inside the sheet", { timeout: 180000, skip }, async () => {
  let page = null;
  try {
    const cookie = await boot();
    page = await openPage(cookie);
    const { send } = page;
    await size(send, 390, 844);
    await send("Page.navigate", { url: `${base()}/finance/goals` });
    await waitFor(send, "document.body.innerText.includes('Show 1 hidden') && !document.body.innerText.includes('Travel — Japan') && !document.querySelector('[data-yearly]') ? 'yes' : ''", "hidden trip");
    await evalPage(send, "document.querySelector(\"[data-goal='emergency-fund']\")?.click()");
    await waitFor(send, `${settled} && document.querySelector("[data-goal-action='edit']") ? "yes" : ""`, "detail edit");
    await evalPage(send, "document.querySelector(\"[data-goal-action='edit']\").click()");
    await waitFor(send, `${settled} && document.getElementById("goal-edit-name") ? "yes" : ""`, "edit sheet");
    const saveState = `(() => {
      const panel = document.querySelector("[data-overlay='panel']");
      const save = [...panel.querySelectorAll("button")].find((el) => (el.innerText || "").trim() === "Save");
      const name = document.getElementById("goal-edit-name");
      const target = document.getElementById("goal-edit-target");
      const monthly = document.getElementById("goal-edit-monthly");
      return JSON.stringify({
        disabled: Boolean(save?.disabled),
        height: save ? Math.round(save.getBoundingClientRect().height) : 0,
        nameSize: name ? parseFloat(getComputedStyle(name).fontSize) : 0,
        targetMode: target ? target.getAttribute("inputmode") : "",
        monthlyHint: monthly ? monthly.getAttribute("enterkeyhint") : "",
        labels: [...panel.querySelectorAll("button")].map((el) => (el.innerText || "").replace(/\\s+/g, " ").trim()).filter(Boolean),
      });
    })()`;
    const untouched = JSON.parse(await evalPage(send, saveState));
    assert.equal(untouched.disabled, true);
    assert.equal(untouched.height, 44);
    assert.ok(untouched.nameSize >= 16);
    assert.equal(untouched.targetMode, "decimal");
    assert.equal(untouched.monthlyHint, "done");
    assert.deepEqual(untouched.labels, ["Cancel", "Save", "Delete"]);
    await evalPage(send, `(() => {
      const period = document.getElementById("goal-edit-period");
      period.value = "yearly";
      period.dispatchEvent(new Event("change", { bubbles: true }));
      return "yes";
    })()`);
    assert.equal(JSON.parse(await evalPage(send, saveState)).disabled, false);
    await evalPage(send, "[...document.querySelectorAll('button')].find((el) => (el.innerText || '').trim() === 'Save')?.click()");
    await waitFor(send, "document.querySelector(\"[data-goal='emergency-fund'] [data-yearly]\")?.textContent === 'yearly' && document.querySelector(\"[data-goal-detail]\") ? 'yes' : ''", "yearly label");
    await evalPage(send, "document.querySelector(\"[data-goal='emergency-fund']\")?.click()");
    await waitFor(send, `${settled} && document.querySelector("[data-goal-action='edit']") ? "yes" : ""`, "detail again");
    await evalPage(send, "document.querySelector(\"[data-goal-action='edit']\").click()");
    await waitFor(send, `${settled} && document.getElementById("goal-edit-name") ? "yes" : ""`, "edit again");
    await evalPage(send, "[...document.querySelectorAll('button')].find((el) => (el.innerText || '').trim() === 'Delete')?.click()");
    await waitFor(send, `${settled} && document.querySelector("[data-delete-confirm]") ? "yes" : ""`, "delete confirm");
    const confirm = JSON.parse(await evalPage(send, `(() => {
      const panel = document.querySelector("[data-overlay='panel']");
      const danger = [...panel.querySelectorAll("button")].find((el) => (el.innerText || "").trim() === "Delete");
      const chip = danger?.querySelector("span");
      return JSON.stringify({
        text: document.querySelector("[data-delete-confirm]")?.textContent || "",
        labels: [...panel.querySelectorAll("button")].map((el) => (el.innerText || "").replace(/\\s+/g, " ").trim()).filter(Boolean),
        bg: chip ? getComputedStyle(chip).backgroundColor : "",
      });
    })()`));
    assert.equal(confirm.text, "Delete goal?");
    assert.deepEqual(confirm.labels, ["Cancel", "Delete"]);
    assert.notEqual(confirm.bg, "rgb(31, 42, 36)");
    await evalPage(send, "[...document.querySelectorAll('button')].find((el) => (el.innerText || '').trim() === 'Delete')?.click()");
    await waitFor(send, "!document.body.innerText.includes('Emergency fund') && !document.querySelector(\"[data-overlay='panel']\") ? 'yes' : ''", "deleted");
  } finally {
    if (page) await page.close();
    await stopProcess(chrome);
    await stopProcess(child);
    await release();
  }
});
