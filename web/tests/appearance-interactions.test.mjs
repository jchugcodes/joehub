import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { acquireBrowserLock, reservePort, spawnLogged, startChrome, stopProcess, waitForChrome, waitForHttp } from "./support/harness.mjs";
import { pressLabel } from "./support/pointer.mjs";

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

async function evalPage(send, expression) {
  const result = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (result.result?.exceptionDetails) throw new Error(JSON.stringify(result.result.exceptionDetails));
  return result.result?.result?.value;
}

async function waitFor(send, expression, label) {
  const deadline = Date.now() + 30000;
  let last = "";
  while (Date.now() < deadline) {
    try {
      const value = await evalPage(send, expression);
      last = value == null ? "" : String(value);
      if (value) return value;
    } catch (error) {
      last = error instanceof Error ? error.message.slice(0, 160) : "error";
    }
    await new Promise((resolve) => setTimeout(resolve, 120));
  }
  throw new Error(`timed out waiting for ${label}; last=${last}`);
}

test("appearance light, dark, and system persist on the device", { skip }, async () => {
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
      JOEHUB_SESSION_SECRET: "appearance-browser-secret-value",
    },
  });
  child = started.child;
  try {
    await waitForHttp(`${base()}/more/settings`, {
      child,
      log: started.log,
      accept: (response) => response.status === 200,
    });
    chrome = startChrome(chromeBin, cdp, `/tmp/chrome-appearance-${process.pid}`);
    await waitForChrome(cdp, chrome);
    const logged = await fetch(`${base()}/api/session/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "synthetic", password: "synthetic", device_label: "appearance-browser" }),
    });
    assert.equal(logged.status, 200);
    const cookie = cookieValue(logged);
    const created = await fetch(`http://127.0.0.1:${cdp}/json/new?about:blank`, { method: "PUT" }).then((response) => response.json());
    const ws = new WebSocket(created.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      ws.addEventListener("open", resolve);
      ws.addEventListener("error", reject);
    });
    const pending = new Map();
    let seq = 0;
    ws.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (message.id && pending.has(message.id)) pending.get(message.id)(message);
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
    await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "light" }] });
    const cooked = await send("Network.setCookie", { name: "joehub_session", value: cookie, url: `${base()}/`, httpOnly: true });
    assert.equal(cooked.result?.success, true);
    await send("Page.navigate", { url: `${base()}/more/settings` });
    await waitFor(send, "document.querySelector('[data-hydrated=\"true\"]')?.getAttribute('data-appearance') === 'system' && !document.documentElement.classList.contains('dark') ? 'yes' : ''", "system light");
    await pressLabel(send, evalPage, "Dark");
    await waitFor(send, "document.documentElement.classList.contains('dark') && document.documentElement.dataset.appearance === 'dark' ? 'yes' : ''", "dark");
    const chip = await evalPage(
      send,
      `(() => {
        const el = document.querySelector("[data-appearance-option='dark']");
        const style = getComputedStyle(el);
        const root = getComputedStyle(document.documentElement);
        return JSON.stringify({ bg: style.backgroundColor, fg: style.color, gain: root.getPropertyValue("--on-gain").trim(), finance: root.getPropertyValue("--finance-rgb").trim(), line: root.getPropertyValue("--line").trim() });
      })()`,
    );
    const colors = JSON.parse(chip);
    assert.equal(colors.bg, "rgb(236, 241, 238)");
    assert.equal(colors.fg, "rgb(14, 19, 16)");
    assert.equal(colors.gain, "#0e1310");
    assert.equal(colors.finance, "78 174 134");
    assert.equal(colors.line, "#616b63");
    await send("Page.reload", { ignoreCache: true });
    await waitFor(send, "document.documentElement.classList.contains('dark') && document.documentElement.dataset.appearance === 'dark' ? 'yes' : ''", "reloaded dark");
    await pressLabel(send, evalPage, "Light");
    await waitFor(send, "!document.documentElement.classList.contains('dark') && document.documentElement.dataset.appearance === 'light' ? 'yes' : ''", "light");
    await pressLabel(send, evalPage, "System");
    await waitFor(send, "document.documentElement.dataset.appearance === 'system' && !document.documentElement.classList.contains('dark') ? 'yes' : ''", "system again");
    await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "dark" }] });
    await waitFor(send, "document.documentElement.dataset.appearance === 'system' && document.documentElement.classList.contains('dark') ? 'yes' : ''", "system follows dark");
    await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "light" }] });
    await waitFor(send, "document.documentElement.dataset.appearance === 'system' && !document.documentElement.classList.contains('dark') ? 'yes' : ''", "system follows light");
    await send("Page.navigate", { url: `${base()}/finance?asOf=2026-11-11T15:00:00-05:00` });
    await waitFor(send, "document.querySelector('[data-change]')?.innerText.includes('+$2,408.36') ? 'yes' : ''", "overview");
    await evalPage(send, "localStorage.setItem('joehub-appearance','dark'); window.dispatchEvent(new Event('joehub-appearance')); 'yes'");
    await waitFor(send, "document.documentElement.classList.contains('dark') ? 'yes' : ''", "overview dark");
    const change = await evalPage(send, "getComputedStyle(document.querySelector('[data-change]')).color");
    assert.equal(change, "rgb(78, 174, 134)");
    ws.close();
  } finally {
    await stopProcess(chrome);
    await stopProcess(child);
    await release();
  }
});
