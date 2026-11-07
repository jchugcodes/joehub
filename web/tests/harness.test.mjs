import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
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
  child.stdout.on("data", (chunk) => {
    output += chunk;
  });
  child.stderr.on("data", (chunk) => {
    output += chunk;
  });
  const done = new Promise((resolve, reject) => {
    child.on("exit", (code, signal) => {
      if (code === 0) resolve(output);
      else reject(new Error(`${command} exited ${code ?? signal}\n${output}`));
    });
  });
  return { child, done };
}

test("contenders acquire, reclaim, and release without deleting a foreign lock", async () => {
  const dir = mkdtempSync(join(tmpdir(), "joehub-lock-"));
  const lockPath = join(dir, "lock");
  const lock = createBrowserLock(lockPath);
  try {
    const holders = Array.from({ length: 6 }, () => runWorker("hold", lockPath));
    const outputs = await Promise.all(holders.map((holder) => holder.done));
    const events = outputs
      .flatMap((output) => output.trim().split("\n"))
      .map((line) => {
        const [kind, pid, at] = line.split(" ");
        return { kind, pid: Number(pid), at: Number(at) };
      });
    const enters = events.filter((event) => event.kind === "enter");
    const exits = events.filter((event) => event.kind === "exit");
    assert.equal(enters.length, 6);
    assert.equal(exits.length, 6);
    const intervals = enters.map((enter) => {
      const exit = exits.find((event) => event.pid === enter.pid && event.at >= enter.at);
      assert.ok(exit, `missing exit for ${enter.pid}`);
      return { start: enter.at, end: exit.at };
    });
    intervals.sort((left, right) => left.start - right.start);
    for (let index = 1; index < intervals.length; index += 1) {
      assert.ok(intervals[index].start >= intervals[index - 1].end, "critical sections overlapped");
    }

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
    await Promise.all(reclaimers.map((reclaimer) => reclaimer.done));
    assert.equal(pidAlive(holderPid), false);
    assert.equal(lock.read(), null);
  } finally {
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
