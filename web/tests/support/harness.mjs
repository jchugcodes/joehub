import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";

const LOCK_DIR = "/tmp/joehub-web-browser.lock";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function readOwner(dir) {
  try {
    const parsed = JSON.parse(readFileSync(`${dir}/owner`, "utf8"));
    if (!parsed || typeof parsed.token !== "string" || !Number.isInteger(parsed.pid) || parsed.pid <= 0) return null;
    return parsed;
  } catch {
    return null;
  }
}

function pidDead(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return false;
  } catch (error) {
    return error.code === "ESRCH";
  }
}

function groupAlive(pgid) {
  try {
    process.kill(-pgid, 0);
    return true;
  } catch (error) {
    if (error.code === "ESRCH") return false;
    if (error.code === "EPERM") return true;
    throw error;
  }
}

function signalGroup(pgid, signal) {
  try {
    process.kill(-pgid, signal);
  } catch (error) {
    if (error.code === "ESRCH") return;
    throw error;
  }
}

async function restoreDisplaced(grave, lockDir) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    try {
      renameSync(grave, lockDir);
      return;
    } catch (error) {
      if (error.code !== "EEXIST" && error.code !== "ENOTEMPTY") throw error;
      await sleep(20);
    }
  }
  throw new Error(`could not restore lock ${lockDir} after displacing it`);
}

async function displaceIf(lockDir, token, { requireDead }) {
  const current = readOwner(lockDir);
  if (!current || current.token !== token) return false;
  if (requireDead && !pidDead(current.pid)) return false;
  const grave = `${lockDir}.reap.${process.pid}.${randomBytes(4).toString("hex")}`;
  try {
    renameSync(lockDir, grave);
  } catch {
    return false;
  }
  const moved = readOwner(grave);
  const tokenOk = Boolean(moved && moved.token === token);
  const deadOk = !requireDead || Boolean(moved && pidDead(moved.pid));
  if (tokenOk && deadOk) {
    rmSync(grave, { recursive: true, force: true });
    return true;
  }
  await restoreDisplaced(grave, lockDir);
  return false;
}

export function createBrowserLock(lockDir) {
  return {
    async acquire() {
      const token = randomBytes(16).toString("hex");
      const deadline = Date.now() + 180000;
      while (Date.now() < deadline) {
        const staging = `${lockDir}.stage.${token}`;
        rmSync(staging, { recursive: true, force: true });
        mkdirSync(staging);
        writeFileSync(`${staging}/owner`, JSON.stringify({ pid: process.pid, token }));
        try {
          renameSync(staging, lockDir);
        } catch (error) {
          rmSync(staging, { recursive: true, force: true });
          if (error.code !== "EEXIST" && error.code !== "ENOTEMPTY") throw error;
          const owner = readOwner(lockDir);
          if (owner && pidDead(owner.pid)) await displaceIf(lockDir, owner.token, { requireDead: true });
          await sleep(20);
          continue;
        }
        const published = readOwner(lockDir);
        if (published && published.token === token && published.pid === process.pid) {
          return async () => {
            await displaceIf(lockDir, token, { requireDead: false });
          };
        }
        await sleep(20);
      }
      throw new Error("timed out waiting for the browser test lock");
    },
    release(token) {
      return displaceIf(lockDir, token, { requireDead: false });
    },
    read() {
      return readOwner(lockDir);
    },
  };
}

const defaultLock = createBrowserLock(LOCK_DIR);

export function acquireBrowserLock() {
  return defaultLock.acquire();
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

export function processHasExited(child) {
  return !child || child.exitCode != null || child.signalCode != null;
}

export async function stopProcess(child) {
  if (!child || !child.pid) return;
  const pgid = child.pid;
  if (groupAlive(pgid)) signalGroup(pgid, "SIGTERM");
  const termDeadline = Date.now() + 5000;
  while (groupAlive(pgid) && Date.now() < termDeadline) await sleep(50);
  if (groupAlive(pgid)) {
    signalGroup(pgid, "SIGKILL");
    const killDeadline = Date.now() + 2000;
    while (groupAlive(pgid) && Date.now() < killDeadline) await sleep(50);
  }
  if (groupAlive(pgid)) throw new Error(`process group ${pgid} still has survivors after SIGKILL`);
}

export async function waitForHttp(url, { child, log, accept, timeoutMs = 90000 }) {
  const deadline = Date.now() + timeoutMs;
  let last = "no response";
  while (Date.now() < deadline) {
    if (child && processHasExited(child)) {
      throw new Error(`server exited ${child.exitCode ?? child.signalCode}\n${log ? log() : ""}`);
    }
    try {
      const response = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(2000) });
      last = String(response.status);
      if (accept(response)) return;
    } catch (error) {
      last = error.name || "error";
    }
    await sleep(250);
  }
  throw new Error(`timed out waiting for ${url} (${last})\n${log ? log() : ""}`);
}

export async function waitForChrome(port, chrome, timeoutMs = 60000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (processHasExited(chrome)) throw new Error(`chrome exited ${chrome.exitCode ?? chrome.signalCode} before port ${port} opened`);
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(1000) });
      if (response.ok) return;
    } catch {
      // still starting
    }
    await sleep(200);
  }
  throw new Error(`chrome did not open a debugging port on ${port}`);
}
