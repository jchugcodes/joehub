import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
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

function trace(lockDir, event) {
  const file = process.env.JOEHUB_LOCK_TRACE;
  if (!file) return;
  appendFileSync(file, `${JSON.stringify({ ...event, pid: process.pid, at: Date.now(), lockDir })}\n`);
}

function removeLock(lockDir, token) {
  trace(lockDir, { op: "remove", token: token ?? null });
  rmSync(lockDir, { recursive: true, force: true });
}

function publish(lockDir, token) {
  if (existsSync(lockDir)) throw new Error(`refusing to replace lock ${lockDir}`);
  const staging = `${lockDir}.stage.${token}`;
  rmSync(staging, { recursive: true, force: true });
  mkdirSync(staging);
  writeFileSync(`${staging}/owner`, JSON.stringify({ pid: process.pid, token }));
  renameSync(staging, lockDir);
  const published = readOwner(lockDir);
  if (!published || published.token !== token || published.pid !== process.pid) {
    throw new Error(`failed to publish lock ${lockDir}`);
  }
}

// Exclusive flock around recheck + delete + publish. The first look at a dead
// owner can be stale; only the look taken while this flock is held may delete.
// The kernel releases the flock when the holder exits.
function holdMutex(lockDir) {
  const path = `${lockDir}.mutex`;
  closeSync(openSync(path, "a"));
  const child = spawn("flock", ["-x", path, "sh", "-c", "echo ready; cat"], {
    stdio: ["pipe", "pipe", "ignore"],
  });
  let buf = "";
  let finished = false;
  const exited = new Promise((resolve) => {
    child.once("exit", (code, signal) => {
      finished = true;
      resolve({ code, signal });
    });
  });
  const ready = new Promise((resolve, reject) => {
    child.once("error", reject);
    child.stdout.on("data", (chunk) => {
      buf += chunk;
      if (buf.includes("ready")) resolve();
    });
    exited.then((result) => {
      if (!buf.includes("ready")) reject(new Error(`flock exited before ready ${result.code ?? result.signal}`));
    });
  });
  return ready.then(() => async () => {
    if (!finished) child.stdin.end();
    await exited;
  });
}

async function withMutex(lockDir, fn) {
  const release = await holdMutex(lockDir);
  try {
    return fn();
  } finally {
    await release();
  }
}

function claim(lockDir, token) {
  const owner = readOwner(lockDir);
  if (owner && owner.pid === process.pid && owner.token === token) return true;
  if (owner && !pidDead(owner.pid)) {
    trace(lockDir, { op: "decided", action: "leave", token: owner.token, ownerPid: owner.pid });
    return false;
  }
  if (existsSync(lockDir)) removeLock(lockDir, owner ? owner.token : null);
  publish(lockDir, token);
  return true;
}

function releaseToken(lockDir, token) {
  const owner = readOwner(lockDir);
  if (!owner || owner.token !== token) {
    trace(lockDir, { op: "decided", action: "leave", token: owner ? owner.token : null });
    return false;
  }
  removeLock(lockDir, owner.token);
  return true;
}

export function createBrowserLock(lockDir) {
  let beforeReclaimAct = async () => {};
  return {
    setReclaimPauseHook(hook) {
      beforeReclaimAct = hook || (async () => {});
    },
    async acquire() {
      const token = randomBytes(16).toString("hex");
      let paused = false;
      const deadline = Date.now() + 180000;
      while (Date.now() < deadline) {
        const owner = readOwner(lockDir);
        if (owner && owner.pid === process.pid && owner.token === token) return () => withMutex(lockDir, () => releaseToken(lockDir, token));
        if (owner && !pidDead(owner.pid)) {
          await sleep(20);
          continue;
        }
        if (owner && pidDead(owner.pid) && !paused) {
          paused = true;
          await beforeReclaimAct({ lockDir, token: owner.token, pid: owner.pid });
        }
        if (await withMutex(lockDir, () => claim(lockDir, token))) {
          return () => withMutex(lockDir, () => releaseToken(lockDir, token));
        }
        await sleep(20);
      }
      throw new Error("timed out waiting for the browser test lock");
    },
    release(token) {
      return withMutex(lockDir, () => releaseToken(lockDir, token));
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
