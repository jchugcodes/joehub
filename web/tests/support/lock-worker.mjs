import { existsSync } from "node:fs";
import { createBrowserLock } from "./harness.mjs";

const command = process.argv[2];
const lockDir = process.argv[3];
const lock = createBrowserLock(lockDir);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

if (command === "hold") {
  process.stdout.write(`waiting ${process.pid}\n`);
  const release = await lock.acquire();
  process.stdout.write(`enter ${process.pid} ${Date.now()}\n`);
  await sleep(120);
  process.stdout.write(`exit ${process.pid} ${Date.now()}\n`);
  await release();
  process.stdout.write(`released ${process.pid}\n`);
} else if (command === "hold-forever") {
  process.stdout.write(`waiting ${process.pid}\n`);
  await lock.acquire();
  process.stdout.write(`enter ${process.pid} ${Date.now()}\n`);
  setInterval(() => {}, 1000);
  await new Promise(() => {});
} else if (command === "hold-until") {
  const releaseFile = process.argv[4];
  process.stdout.write(`waiting ${process.pid}\n`);
  const release = await lock.acquire();
  const owned = lock.read();
  process.stdout.write(`enter ${process.pid} ${Date.now()}\n`);
  while (!existsSync(releaseFile)) {
    const current = lock.read();
    if (!current || current.token !== owned.token || current.pid !== process.pid) {
      process.stdout.write(`stolen ${process.pid} ${Date.now()}\n`);
      process.exit(1);
    }
    await sleep(5);
  }
  process.stdout.write(`exit ${process.pid} ${Date.now()}\n`);
  await release();
  process.stdout.write(`released ${process.pid}\n`);
} else if (command === "foreign-release") {
  const removed = await lock.release(process.argv[4] || "not-the-owner");
  const owner = lock.read();
  process.stdout.write(`foreign ${removed ? "removed" : "kept"} ${owner ? owner.token : "none"}\n`);
} else {
  throw new Error(`unknown lock worker command ${command}`);
}
