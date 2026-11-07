import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createBrowserLock, stopProcess } from "./support/harness.mjs";

const worker = fileURLToPath(new URL("./support/lock-worker.mjs", import.meta.url));
const leader = fileURLToPath(new URL("./support/group-leader.mjs", import.meta.url));

function pidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code !== "ESRCH";
  }
}

function runWorker(command, lockDir, token) {
  const child = spawn(process.execPath, [worker, command, lockDir, token || ""], { stdio: ["ignore", "pipe", "pipe"] });
  let output = "";
  let errors = "";
  child.stdout.on("data", (chunk) => {
    output += chunk;
  });
  child.stderr.on("data", (chunk) => {
    errors += chunk;
  });
  const done = new Promise((resolve, reject) => {
    child.on("exit", (code, signal) => {
      if (code === 0) resolve(output);
      else reject(new Error(`${command} exited ${code ?? signal}\n${output}\n${errors}`));
    });
  });
  done.catch(() => {});
  return { child, done, read: () => output };
}

function criticalSections(output) {
  const events = output
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [kind, pid, at] = line.split(" ");
      return { kind, pid: Number(pid), at: Number(at) };
    });
  const enters = events.filter((event) => event.kind === "enter");
  const exits = events.filter((event) => event.kind === "exit");
  assert.equal(exits.length, enters.length);
  return enters.map((enter) => {
    const exit = exits.find((event) => event.pid === enter.pid && event.at >= enter.at);
    assert.ok(exit, `missing exit for ${enter.pid}`);
    return { pid: enter.pid, start: enter.at, end: exit.at };
  });
}

function assertExclusive(intervals) {
  const ordered = [...intervals].sort((left, right) => left.start - right.start || left.end - right.end);
  for (let index = 1; index < ordered.length; index += 1) {
    assert.ok(
      ordered[index].start >= ordered[index - 1].end,
      `critical sections overlapped: ${JSON.stringify(ordered)}`,
    );
  }
}

function readTrace(file) {
  try {
    return readFileSync(file, "utf8")
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

async function waitFor(predicate, label) {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 15));
  }
  throw new Error(`timed out waiting for ${label}`);
}

test("contenders acquire, reclaim, and release without deleting a foreign lock", async () => {
  const dir = mkdtempSync(join(tmpdir(), "joehub-lock-"));
  const lockPath = join(dir, "lock");
  const lock = createBrowserLock(lockPath);
  try {
    const holders = Array.from({ length: 6 }, () => runWorker("hold", lockPath));
    const outputs = await Promise.all(holders.map((holder) => holder.done));
    assert.equal(criticalSections(outputs.join("\n")).length, 6);
    assertExclusive(criticalSections(outputs.join("\n")));

    const release = await lock.acquire();
    const owned = lock.read();
    const contenders = Array.from({ length: 4 }, () => runWorker("hold", lockPath));
    const foreign = runWorker("foreign-release", lockPath, "someone-else");
    await new Promise((resolve) => setTimeout(resolve, 200));
    assert.equal(lock.read().token, owned.token);
    assert.equal(lock.read().pid, process.pid);
    const foreignOutput = await foreign.done;
    assert.match(foreignOutput, /foreign kept/);
    assert.equal(lock.read().token, owned.token);
    await release();
    const reclaimed = await Promise.all(contenders.map((contender) => contender.done));
    assert.equal(reclaimed.length, 4);
    assertExclusive(criticalSections(reclaimed.join("\n")));
    assert.equal(lock.read(), null);

    const stuck = runWorker("hold-forever", lockPath);
    stuck.done.catch(() => {});
    const holderPid = stuck.child.pid;
    const seen = Date.now() + 10000;
    while (Date.now() < seen) {
      const owner = lock.read();
      if (owner && owner.pid === holderPid) break;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.equal(lock.read() && lock.read().pid, holderPid);
    process.kill(holderPid, "SIGKILL");
    await new Promise((resolve) => stuck.child.once("exit", resolve));
    const reclaimers = Array.from({ length: 4 }, () => runWorker("hold", lockPath));
    const reclaimerOutputs = await Promise.all(reclaimers.map((reclaimer) => reclaimer.done));
    assertExclusive(criticalSections(reclaimerOutputs.join("\n")));
    assert.equal(pidAlive(holderPid), false);
    assert.equal(lock.read(), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a paused reclaimer cannot remove a live owner's lock", { timeout: 20000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "joehub-lock-"));
  const lockPath = join(dir, "lock");
  const tracePath = join(dir, "trace.log");
  const yRelease = join(dir, "y-release");
  const lock = createBrowserLock(lockPath);
  const children = [];
  let openGate = () => {};
  process.env.JOEHUB_LOCK_TRACE = tracePath;
  const sacrificial = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"]);
  const deadPid = sacrificial.pid;
  process.kill(deadPid, "SIGKILL");
  await new Promise((resolve) => sacrificial.once("exit", resolve));
  mkdirSync(lockPath);
  writeFileSync(join(lockPath, "owner"), JSON.stringify({ pid: deadPid, token: "dead-token" }));
  let pending;
  try {
    assert.equal(pidAlive(deadPid), false);
    const reached = new Promise((resolve) => {
      lock.setReclaimPauseHook(async (observed) => {
        assert.equal(observed.token, "dead-token");
        assert.equal(observed.pid, deadPid);
        resolve();
        await new Promise((go) => {
          openGate = go;
        });
      });
    });
    pending = lock.acquire();
    pending.catch(() => {});
    await reached;

    const reclaimer = runWorker("hold", lockPath);
    children.push(reclaimer.child);
    const reclaimerOutput = await reclaimer.done;
    assert.equal(lock.read(), null);

    const live = runWorker("hold-until", lockPath, yRelease);
    children.push(live.child);
    await waitFor(() => live.read().includes("enter "), "Y to enter");
    const liveOwner = lock.read();
    const inode = statSync(lockPath).ino;
    assert.equal(liveOwner.pid, live.child.pid);
    assert.doesNotMatch(live.read(), /stolen/);

    const contender = runWorker("hold", lockPath);
    children.push(contender.child);
    await waitFor(() => contender.read().includes("waiting "), "C to wait");
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(contender.read().includes("enter "), false);

    openGate();
    openGate = () => {};
    await waitFor(() => {
      const stolen = live.read().includes("stolen");
      const removed = readTrace(tracePath).some((event) => event.op === "remove" && event.token === liveOwner.token);
      const left = readTrace(tracePath).some((event) => event.op === "decided" && event.action === "leave" && event.token === liveOwner.token && event.pid === process.pid);
      return stolen || removed || left;
    }, "A to leave Y's lock");
    assert.equal(lock.read().token, liveOwner.token);
    assert.equal(lock.read().pid, liveOwner.pid);
    assert.equal(statSync(lockPath).ino, inode);
    assert.equal(readTrace(tracePath).some((event) => event.op === "remove" && event.token === liveOwner.token), false);
    assert.equal(contender.read().includes("enter "), false);
    assert.doesNotMatch(live.read(), /stolen/);

    writeFileSync(yRelease, "go");
    const releaseA = await pending;
    const aStart = Date.now();
    await releaseA();
    const aEnd = Date.now();
    const liveOutput = await live.done;
    const contenderOutput = await contender.done;
    const yExit = criticalSections(liveOutput)[0].end;
    const yRemoves = readTrace(tracePath).filter((event) => event.op === "remove" && event.token === liveOwner.token);
    assert.equal(yRemoves.length, 1);
    assert.ok(yRemoves[0].at >= yExit, "live owner's lock was removed before the owner left");
    assert.doesNotMatch(liveOutput, /stolen/);
    assertExclusive([
      ...criticalSections([reclaimerOutput, liveOutput, contenderOutput].join("\n")),
      { pid: process.pid, start: aStart, end: aEnd },
    ]);
  } finally {
    openGate();
    for (const child of children) {
      try {
        child.kill("SIGKILL");
      } catch {
        // already gone
      }
    }
    lock.setReclaimPauseHook(null);
    delete process.env.JOEHUB_LOCK_TRACE;
    if (pending) await pending.catch(() => {});
    rmSync(dir, { recursive: true, force: true });
  }
});

test("stopProcess reaps a descendant after the leader exits", async () => {
  for (const mode of ["exit", "signal"]) {
    const child = spawn(process.execPath, [leader, mode], { detached: true, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    const descendantPid = await new Promise((resolve, reject) => {
      child.stdout.on("data", (chunk) => {
        output += chunk;
        const line = output.trim().split("\n")[0];
        if (/^\d+$/.test(line)) resolve(Number(line));
      });
      child.on("exit", () => {
        if (!/^\d+$/.test(output.trim().split("\n")[0] || "")) reject(new Error(`leader produced no descendant pid\n${output}`));
      });
    });
    await new Promise((resolve) => child.once("exit", resolve));
    assert.equal(child.exitCode != null || child.signalCode != null, true, mode);
    if (mode === "signal") assert.notEqual(child.signalCode, null, mode);
    assert.equal(pidAlive(descendantPid), true, mode);
    await stopProcess(child);
    assert.equal(pidAlive(descendantPid), false, mode);
  }
});
