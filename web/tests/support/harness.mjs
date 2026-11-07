import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";

const LOCK_DIR = "/tmp/joehub-web-browser.lock";

function pidAlive(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function reservePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close((error) => (error ? reject(error) : resolve(port)));
    });
  });
}

export async function acquireBrowserLock() {
  const deadline = Date.now() + 180000;
  while (Date.now() < deadline) {
    try {
      mkdirSync(LOCK_DIR);
      writeFileSync(`${LOCK_DIR}/pid`, String(process.pid));
      return () => {
        rmSync(LOCK_DIR, { recursive: true, force: true });
      };
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      let owner = 0;
      try {
        owner = Number(readFileSync(`${LOCK_DIR}/pid`, "utf8"));
      } catch {
        owner = 0;
      }
      if (!pidAlive(owner)) {
        rmSync(LOCK_DIR, { recursive: true, force: true });
        continue;
      }
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }
  throw new Error("timed out waiting for the browser test lock");
}

export function spawnLogged(args, options) {
  let output = "";
  const child = spawn(process.execPath, args, {
    cwd: options.cwd,
    env: options.env,
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (chunk) => {
    output += chunk;
  });
  child.stderr.on("data", (chunk) => {
    output += chunk;
  });
  return { child, log: () => output.slice(-4000) };
}

export function startChrome(chromeBin, port, userDataDir) {
  return spawn(
    chromeBin,
    [
      "--headless=new",
      "--disable-gpu",
      "--no-sandbox",
      "--disable-dev-shm-usage",
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${userDataDir}`,
      "about:blank",
    ],
    { detached: true, stdio: "ignore" },
  );
}

export async function stopProcess(child) {
  if (!child || child.exitCode != null) return;
  const pid = child.pid;
  try {
    process.kill(-pid, "SIGTERM");
  } catch {
    try {
      child.kill("SIGTERM");
    } catch {
      // already gone
    }
  }
  const exited = new Promise((resolve) => child.once("exit", resolve));
  const stopped = await Promise.race([exited.then(() => true), new Promise((resolve) => setTimeout(() => resolve(false), 5000))]);
  if (!stopped && child.exitCode == null) {
    try {
      process.kill(-pid, "SIGKILL");
    } catch {
      try {
        child.kill("SIGKILL");
      } catch {
        // already gone
      }
    }
    await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 2000))]);
  }
}

export async function waitForHttp(url, { child, log, accept, timeoutMs = 90000 }) {
  const deadline = Date.now() + timeoutMs;
  let last = "no response";
  while (Date.now() < deadline) {
    if (child && child.exitCode != null) {
      throw new Error(`server exited ${child.exitCode}\n${log ? log() : ""}`);
    }
    try {
      const response = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(2000) });
      last = String(response.status);
      if (accept(response)) return;
    } catch (error) {
      last = error.name || "error";
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`timed out waiting for ${url} (${last})\n${log ? log() : ""}`);
}

export async function waitForChrome(port, chrome, timeoutMs = 60000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (chrome.exitCode != null) throw new Error(`chrome exited ${chrome.exitCode} before port ${port} opened`);
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(1000) });
      if (response.ok) return;
    } catch {
      // still starting
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`chrome did not open a debugging port on ${port}`);
}
