import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
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
    const primary = document.querySelector("nav[aria-label='Primary'] ul");
    const tabs = primary ? [...primary.querySelectorAll("a")] : [];
    const h1 = document.querySelector("h1");
    const goal = document.querySelector(".text-ui-16");
    const root = getComputedStyle(doc).fontSize;
    return {
      overflow: doc.scrollWidth - doc.clientWidth,
      hintOutside: hint ? !scroller.contains(hint) && nav.contains(hint) : null,
      hintWidth: hint ? hint.getBoundingClientRect().width : 0,
      accountsFit: (() => {
        if (!scroller) return null;
        const link = [...scroller.querySelectorAll("a")].find((el) => (el.textContent || "").trim() === "Accounts");
        if (!link) return false;
        const box = link.getBoundingClientRect();
        const view = scroller.getBoundingClientRect();
        return scroller.scrollLeft <= 1 && box.left >= view.left - 1 && box.right <= view.right + 1;
      })(),
      contained: nav ? nav.dataset.tabs || "" : "",
      root,
      title: h1 ? parseFloat(getComputedStyle(h1).fontSize) : 0,
      goal: goal ? parseFloat(getComputedStyle(goal).fontSize) : 0,
      tabLabel: tabs[0] ? parseFloat(getComputedStyle(tabs[0]).fontSize) : 0,
      tabLabels: tabs.map((tab) => (tab.textContent || "").replace(/\\s+/g, " ").trim()),
      tabsInside: tabs.every((tab) => {
        const box = tab.getBoundingClientRect();
        return box.width > 0 && box.left >= -1 && box.right <= window.innerWidth + 1 && box.bottom <= window.innerHeight + 1;
      }),
      tabOverflow: primary ? primary.scrollWidth - primary.clientWidth : 0,
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

function extraOverflowCases() {
  const dir = fileURLToPath(new URL("./overflow-cases/", import.meta.url));
  try {
    return readdirSync(dir)
      .filter((name) => name.endsWith(".json"))
      .sort()
      .flatMap((name) => JSON.parse(readFileSync(new URL(`./overflow-cases/${name}`, import.meta.url), "utf8")));
  } catch (error) {
    if (error && error.code === "ENOENT") return [];
    throw error;
  }
}

function readyExpression(path) {
  const laidOut = "document.querySelector(\"nav[aria-label='Primary'] a\")?.getBoundingClientRect().width > 0";
  const value = String(path);
  if (value.startsWith("/jobs") && !value.includes("view=") && !value.includes("/globex")) {
    return `document.querySelector("[aria-label='Jobs sections'] [data-hydrated='true']") && ${laidOut} ? 'yes' : ''`;
  }
  if (value.startsWith("/jobs") || value === "/finance" || value.startsWith("/finance/caps") || /\/goals\/[^/?]+/.test(value)) {
    return `document.querySelector('h1') && ${laidOut} ? 'yes' : ''`;
  }
  return `document.querySelector("[aria-label='Finance sections'] [data-hydrated='true']") && ${laidOut} ? 'yes' : ''`;
}

test("finance tabs do not widen the page", { timeout: 180000, skip: chromeBin ? false : "google-chrome is not installed" }, async () => {
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
      ["/finance/goals", 390, 844, false],
      ["/finance/goals", 390, 900, true],
      ["/finance", 390, 900, true],
    ].concat(extraOverflowCases());
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
          expression: readyExpression(path),
          returnByValue: true,
        });
        if (ready.result?.result?.value === "yes") break;
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
      if (enlarge) {
        await send("Runtime.evaluate", {
          expression: "document.documentElement.style.fontSize = '200%'; new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))",
          awaitPromise: true,
        });
      }
      const measured = await send("Runtime.evaluate", { expression: measureSource(), returnByValue: true });
      const value = measured.result?.result?.value;
      assert.ok(value, `no measurement for ${path} at ${width}`);
      assert.ok(value.overflow <= 1, `${path} at ${width}${enlarge ? " text 200%" : ""} overflows by ${value.overflow}px`);
      assert.deepEqual(value.tabLabels, ["Home", "Finance", "Jobs", "Journal", "More"], JSON.stringify(value.tabLabels));
      assert.equal(value.tabsInside, true, `a primary tab is clipped ${JSON.stringify(value.tabLabels)}`);
      assert.ok(value.tabOverflow <= 1, `primary nav overflows by ${value.tabOverflow}px`);
      if (path === "/finance/goals") {
        assert.equal(value.contained, "contained", `served an old tab row ${JSON.stringify(value)}`);
        assert.equal(value.hintOutside, true);
        assert.equal(value.hintWidth, 0, "swipe hint still reserves width inside the 390 column");
        if (enlarge) {
          assert.ok(Math.abs(value.title - 44) < 0.6, `Goals title computed ${value.title}px, root ${value.root}`);
          assert.ok(Math.abs(value.goal - 32) < 0.6, `goal title computed ${value.goal}px`);
          assert.ok(Math.abs(value.tabLabel - 21) < 0.6, `tab label computed ${value.tabLabel}px`);
        } else if (width === 390) {
          assert.equal(value.accountsFit, true, "Accounts is cut off at 390px");
          assert.ok(Math.abs(value.title - 22) < 0.6, `Goals title computed ${value.title}px at normal size`);
          const fontReport = await send("Runtime.evaluate", {
            expression: `(() => {
              const heading = document.querySelector("h1");
              const style = getComputedStyle(heading);
              const family = style.fontFamily.split(",")[0].trim().replace(/^['"]|['"]$/g, "");
              return document.fonts.ready.then(() => ({
                family: style.fontFamily,
                weight: style.fontWeight,
                optical: style.fontOpticalSizing,
                size: style.fontSize,
                loaded: document.fonts.check(style.fontWeight + " " + style.fontSize + " \\"" + family + "\\""),
                faces: [...document.fonts].filter((face) => /dm/i.test(face.family)).map((face) => face.family + " " + face.weight + " " + face.status),
              }));
            })()`,
            awaitPromise: true,
            returnByValue: true,
          });
          const font = fontReport.result?.result?.value;
          assert.equal(font.loaded, true, `DM Sans did not load ${JSON.stringify(font)}`);
          assert.match(font.family, /DM Sans|__DM_Sans/i, JSON.stringify(font));
          assert.equal(font.optical, "auto", JSON.stringify(font));
          await send("DOM.enable");
          await send("CSS.enable");
          const documentNode = await send("DOM.getDocument", { depth: 0 });
          const heading = await send("DOM.querySelector", { nodeId: documentNode.result.root.nodeId, selector: "h1" });
          const platform = await send("CSS.getPlatformFontsForNode", { nodeId: heading.result.nodeId });
          const names = (platform.result?.fonts || []).map((item) => item.familyName);
          assert.ok(names.some((name) => /DM Sans/i.test(name)), `platform fonts ${JSON.stringify(platform.result?.fonts)}`);
          console.log("FONT", JSON.stringify({ ...font, platform: names }));
        }
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
      if (path === "/jobs") {
        const jobsNav = await send("Runtime.evaluate", {
          expression: `(() => {
            const nav = document.querySelector("[aria-label='Jobs sections']");
            const scroller = nav ? nav.querySelector(":scope > div") : null;
            const hint = nav ? [...nav.children].find((el) => (el.textContent || "").includes("swipe")) : null;
            return {
              contained: nav ? nav.dataset.tabs || "" : "",
              hintOutside: hint ? !scroller.contains(hint) && nav.contains(hint) : false,
            };
          })()`,
          returnByValue: true,
        });
        const jobs = jobsNav.result?.result?.value;
        assert.equal(jobs.contained, "contained");
        assert.equal(jobs.hintOutside, true);
        await send("Emulation.setFocusEmulationEnabled", { enabled: true });
        await send("Runtime.evaluate", {
          expression: "document.querySelector(\"[aria-label='Jobs sections'] a\").focus()",
        });
        const expectedJobs = ["Overview", "Matches", "Board", "Notes"];
        for (let step = 0; step < expectedJobs.length; step += 1) {
          if (step > 0) {
            await send("Input.dispatchKeyEvent", { type: "keyDown", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9, nativeVirtualKeyCode: 9 });
            await send("Input.dispatchKeyEvent", { type: "keyUp", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9, nativeVirtualKeyCode: 9 });
          }
          const focused = await send("Runtime.evaluate", {
            expression: `(() => {
              const el = document.activeElement;
              const scroller = document.querySelector("[aria-label='Jobs sections'] > div");
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
          assert.equal(link.text, expectedJobs[step], `Tab did not reach ${expectedJobs[step]} ${JSON.stringify(link)}`);
          assert.equal(link.inScroller, true, `keyboard focus on ${link?.text} is outside the jobs tab scroller ${JSON.stringify(link)}`);
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
