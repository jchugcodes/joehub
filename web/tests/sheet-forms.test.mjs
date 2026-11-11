import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { acquireBrowserLock, reservePort, spawnLogged, startChrome, stopProcess, waitForChrome, waitForHttp } from "./support/harness.mjs";
import { pressLabel } from "./support/pointer.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const ARTIFACTS = "/opt/cursor/artifacts";
const chromeBin = ["google-chrome", "google-chrome-stable"].find((bin) => spawnSync("which", [bin]).status === 0);
const skip = chromeBin ? false : "google-chrome is not installed";

const measureSheet = `(() => {
  const dialog = document.querySelector("[role='dialog']");
  if (!dialog) return { ok: false, reason: "missing" };
  const doc = document.documentElement;
  const controls = [...dialog.querySelectorAll("button, a, input, select, textarea")].filter((el) => {
    const style = getComputedStyle(el);
    return style.display !== "none" && style.visibility !== "hidden";
  });
  const small = controls.filter((el) => {
    const rect = el.getBoundingClientRect();
    return rect.width < 44 || rect.height < 44;
  }).map((el) => {
    const rect = el.getBoundingClientRect();
    return { id: el.id, text: (el.innerText || el.getAttribute("aria-label") || el.tagName).replace(/\\s+/g, " ").trim().slice(0, 40), w: Math.round(rect.width), h: Math.round(rect.height) };
  });
  const fields = [...dialog.querySelectorAll("input, select, textarea")].map((el) => ({
    id: el.id,
    size: parseFloat(getComputedStyle(el).fontSize),
    box: getComputedStyle(el).boxSizing,
  }));
  const wider = [...dialog.querySelectorAll("*")].some((el) => el.getBoundingClientRect().width > window.innerWidth + 1);
  const saves = [...dialog.querySelectorAll("button")].filter((el) => /^(Save|Saving…|Save correction)$/.test((el.innerText || "").trim()));
  const cancel = [...dialog.querySelectorAll("button")].find((el) => (el.innerText || "").trim() === "Cancel");
  const title = dialog.querySelector("input, textarea");
  const save = saves[0];
  const header = Boolean(
    cancel && save && title &&
    cancel.getBoundingClientRect().top <= title.getBoundingClientRect().top &&
    save.getBoundingClientRect().width < 180,
  );
  return {
    ok: small.length === 0 && !wider && fields.every((field) => field.size >= 16 && field.box === "border-box") && saves.length === 1 && header && doc.scrollWidth <= doc.clientWidth + 1 && document.body.scrollWidth <= document.body.clientWidth + 1 && dialog.scrollWidth <= dialog.clientWidth + 1,
    small,
    wider,
    fields,
    saves: saves.length,
    header,
    doc: doc.scrollWidth - doc.clientWidth,
    body: document.body.scrollWidth - document.body.clientWidth,
    dialog: dialog.scrollWidth - dialog.clientWidth,
    hints: Object.fromEntries([...dialog.querySelectorAll("input, textarea")].map((el) => [el.id, { inputMode: el.inputMode, enterKeyHint: el.enterKeyHint }])),
  };
})()`;

test("phone sheets stay in the viewport with a slim header and 44px targets", { timeout: 240000, skip }, async () => {
  mkdirSync(ARTIFACTS, { recursive: true });
  const release = await acquireBrowserLock();
  const port = await reservePort();
  const cdp = await reservePort();
  const base = `http://127.0.0.1:${port}`;
  const started = spawnLogged(["node_modules/next/dist/bin/next", "dev", "-H", "127.0.0.1", "-p", String(port)], {
    cwd: ROOT,
    env: {
      PATH: process.env.PATH,
      HOME: process.env.HOME || "/tmp",
      TMPDIR: process.env.TMPDIR || "/tmp",
      LANG: "C.UTF-8",
      NODE_ENV: "development",
      JOEHUB_DEV_AUTH: "1",
      JOEHUB_SESSION_SECRET: "sheet-forms-secret-value",
    },
  });
  let chrome = null;
  try {
    await waitForHttp(`${base}/tasks`, {
      child: started.child,
      log: started.log,
      accept: (response) => response.status === 200 && (response.headers.get("content-type") || "").includes("text/html"),
    });
    const logged = await fetch(`${base}/api/session/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "synthetic", password: "synthetic", device_label: "sheet-forms" }),
    });
    assert.equal(logged.status, 200);
    const cookie = ((logged.headers.getSetCookie?.() || []).find((row) => row.startsWith("joehub_session=")) || "").split(";", 1)[0].slice("joehub_session=".length);
    const auth = { "content-type": "application/json", cookie: `joehub_session=${cookie}` };
    assert.equal((await fetch(`${base}/api/tasks`, { method: "POST", headers: { ...auth, "idempotency-key": crypto.randomUUID() }, body: JSON.stringify({ title: "Sheet sample task" }) })).status, 201);
    assert.equal((await fetch(`${base}/api/grocery`, { method: "POST", headers: { ...auth, "idempotency-key": crypto.randomUUID() }, body: JSON.stringify({ name: "Sheet sample item" }) })).status, 201);

    chrome = startChrome(chromeBin, cdp, `/tmp/chrome-sheets-${process.pid}`);
    await waitForChrome(cdp, chrome);
    const page = await fetch(`http://127.0.0.1:${cdp}/json/new?about:blank`, { method: "PUT" }).then((response) => response.json());
    const ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      ws.addEventListener("open", resolve);
      ws.addEventListener("error", reject);
    });
    let seq = 0;
    const pending = new Map();
    ws.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (message.id && pending.has(message.id)) pending.get(message.id)(message);
    });
    const send = (method, params = {}) => new Promise((resolve) => {
      const id = ++seq;
      pending.set(id, resolve);
      ws.send(JSON.stringify({ id, method, params }));
    });
    const evalPage = async (first, second) => {
      const expression = typeof first === "string" ? first : second;
      const result = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
      if (result.result?.exceptionDetails) throw new Error(JSON.stringify(result.result.exceptionDetails));
      return result.result?.result?.value;
    };
    const waitFor = async (expression, label) => {
      const deadline = Date.now() + 20000;
      let last = "";
      while (Date.now() < deadline) {
        try {
          last = await evalPage(expression);
          if (last) return last;
        } catch (error) {
          last = error instanceof Error ? error.message : String(error);
        }
        await new Promise((resolve) => setTimeout(resolve, 150));
      }
      throw new Error(`${label}: ${last}`);
    };
    await send("Network.setCookie", { name: "joehub_session", value: cookie, url: `${base}/` });
    const size = (width, height) => send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: true });
    const shot = async (name) => {
      const image = await send("Page.captureScreenshot", { format: "png" });
      writeFileSync(`${ARTIFACTS}/${name}`, Buffer.from(image.result.data, "base64"));
    };
    const check = async (label) => {
      const measured = await evalPage(measureSheet);
      assert.equal(measured.ok, true, `${label} ${JSON.stringify(measured)}`);
      return measured;
    };

    await size(390, 844);
    await send("Page.navigate", { url: `${base}/tasks` });
    await waitFor("document.body.innerText.includes('Sheet sample task') ? 'yes' : ''", "tasks");
    await pressLabel(send, evalPage, "Add a task");
    await waitFor("document.getElementById('task-title') ? 'yes' : ''", "add task");
    for (const width of [390, 360]) {
      await size(width, 844);
      await check(`add task ${width}`);
    }
    const taskHints = await check("add task hints");
    assert.equal(taskHints.hints["task-title"].enterKeyHint, "next");
    assert.equal(taskHints.hints["task-title"].inputMode, "text");
    assert.equal(await evalPage("document.getElementById('task-project')?.tagName"), "BUTTON");

    await size(390, 844);
    const keyboard = await send("Emulation.setVirtualKeyboardGeometryOverride", {
      keyboardRect: { x: 0, y: 500, width: 390, height: 344 },
    });
    assert.equal(keyboard.error, undefined, JSON.stringify(keyboard.error));
    await waitFor("document.querySelector(\"[data-sheet='form']\")?.getBoundingClientRect().bottom <= 501 ? 'yes' : ''", "task keyboard placed");
    const viewport = await evalPage(`(() => {
      const rect = navigator.virtualKeyboard.boundingRect;
      const sheet = document.querySelector("[data-sheet='form']");
      const box = sheet.getBoundingClientRect();
      return { keyboardTop: rect.y, keyboardHeight: rect.height, sheetBottom: box.bottom, sheetHeight: box.height, inner: window.innerHeight };
    })()`);
    assert.ok(viewport.keyboardTop <= 520 && viewport.keyboardTop >= 460, JSON.stringify(viewport));
    assert.ok(viewport.sheetBottom <= viewport.keyboardTop + 1, JSON.stringify(viewport));
    await check("add task keyboard");
    const titleVisible = await evalPage(`(() => {
      const el = document.getElementById("task-title");
      const rect = el.getBoundingClientRect();
      const keyboardTop = navigator.virtualKeyboard.boundingRect.y;
      return rect.top >= -1 && rect.bottom <= keyboardTop + 1 ? "yes" : JSON.stringify({ top: rect.top, bottom: rect.bottom, keyboardTop });
    })()`);
    assert.equal(titleVisible, "yes");
    await shot("tasks_t04_keyboard_390.png");

    await pressLabel(send, evalPage, "Save");
    await waitFor("document.getElementById('task-title-error')?.textContent.includes('Enter a title') ? 'yes' : ''", "blank title");
    await pressLabel(send, evalPage, "Cancel");
    await waitFor("document.querySelector(\"[role='dialog']\") ? '' : 'closed'", "task closed");
    await send("Emulation.setVirtualKeyboardGeometryOverride", {});
    await size(390, 844);
    await pressLabel(send, evalPage, "Edit Sheet sample task");
    await waitFor("document.getElementById('task-title') ? 'yes' : ''", "edit task");
    for (const width of [390, 360]) {
      await size(width, 844);
      await check(`edit task ${width}`);
    }

    await size(390, 844);
    await send("Page.navigate", { url: `${base}/grocery` });
    await waitFor("document.body.innerText.includes('Sheet sample item') ? 'yes' : ''", "grocery");
    await pressLabel(send, evalPage, "Add an item");
    await waitFor("document.getElementById('grocery-name') ? 'yes' : ''", "add item");
    for (const width of [390, 360]) {
      await size(width, 844);
      await check(`add item ${width}`);
    }
    const groceryHints = await check("grocery hints");
    assert.equal(groceryHints.hints["grocery-quantity"].inputMode, "numeric");
    assert.equal(groceryHints.hints["grocery-name"].enterKeyHint, "next");
    assert.equal(groceryHints.hints["grocery-notes"].enterKeyHint, "done");
    await pressLabel(send, evalPage, "Cancel");
    await waitFor("document.querySelector(\"[role='dialog']\") ? '' : 'closed'", "grocery reopen");
    await size(390, 844);
    await pressLabel(send, evalPage, "Add an item");
    await waitFor("document.getElementById('grocery-name') ? 'yes' : ''", "grocery sheet again");
    await evalPage(`(() => {
      const el = document.getElementById("grocery-name");
      el.focus();
      const set = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), "value").set;
      set.call(el, " ");
      el.dispatchEvent(new Event("input", { bubbles: true }));
      set.call(el, "");
      el.dispatchEvent(new Event("input", { bubbles: true }));
      return "yes";
    })()`);
    await send("Emulation.setVirtualKeyboardGeometryOverride", {
      keyboardRect: { x: 0, y: 500, width: 390, height: 344 },
    });
    await waitFor("document.querySelector(\"[data-sheet='form']\")?.getBoundingClientRect().bottom <= 501 ? 'yes' : ''", "grocery keyboard placed");
    await check("add item keyboard");
    const groceryVisible = await evalPage(`(() => {
      const el = document.getElementById("grocery-name");
      const rect = el.getBoundingClientRect();
      const keyboardTop = navigator.virtualKeyboard.boundingRect.y;
      return rect.bottom <= keyboardTop + 1 && rect.top >= -1 ? "yes" : JSON.stringify({ top: rect.top, bottom: rect.bottom, keyboardTop });
    })()`);
    assert.equal(groceryVisible, "yes");
    await shot("grocery_g03_keyboard_390.png");
    await pressLabel(send, evalPage, "Cancel");
    await waitFor("document.querySelector(\"[role='dialog']\") ? '' : 'closed'", "grocery closed");
    await send("Emulation.setVirtualKeyboardGeometryOverride", {});
    await size(390, 844);
    await pressLabel(send, evalPage, "Edit Sheet sample item");
    await waitFor("document.getElementById('grocery-name') ? 'yes' : ''", "edit item");
    for (const width of [390, 360]) {
      await size(width, 844);
      await check(`edit item ${width}`);
    }

    await size(390, 844);
    await send("Page.navigate", { url: `${base}/finance/transactions` });
    const finance = await waitFor("document.body ? (document.body.innerText.includes('Add expense or income') ? 'sheet' : (document.querySelector('h1') ? 'other' : '')) : ''", "finance route").catch(() => "missing");
    if (finance === "sheet") {
      await pressLabel(send, evalPage, "Add expense or income");
      await waitFor("document.getElementById('txn-payee') ? 'yes' : ''", "finance sheet");
      for (const width of [390, 360]) {
        await size(width, 844);
        await check(`finance add ${width}`);
      }
      const financeHints = await check("finance hints");
      assert.equal(financeHints.hints["txn-amount"].inputMode, "decimal");
      await send("Emulation.setVirtualKeyboardGeometryOverride", {
        keyboardRect: { x: 0, y: 500, width: 390, height: 344 },
      });
      await waitFor("document.querySelector(\"[data-sheet='form']\")?.getBoundingClientRect().bottom <= 501 ? 'yes' : ''", "finance keyboard placed");
      await check("finance keyboard");
      const financeVisible = await evalPage(`(() => {
        const el = document.getElementById("txn-payee");
        const rect = el.getBoundingClientRect();
        const keyboardTop = navigator.virtualKeyboard.boundingRect.y;
        return rect.bottom <= keyboardTop + 1 && rect.top >= -1 ? "yes" : JSON.stringify({ top: rect.top, bottom: rect.bottom, keyboardTop });
      })()`);
      assert.equal(financeVisible, "yes");
      await shot("finance_f05_keyboard_390.png");
    }
    ws.close();
  } finally {
    await stopProcess(chrome);
    await stopProcess(started.child);
    await release();
  }
});
