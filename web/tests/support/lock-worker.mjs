import { createBrowserLock } from "./harness.mjs";

const command = process.argv[2];
const lockDir = process.argv[3];
const lock = createBrowserLock(lockDir);

if (command === "hold") {
  const release = await lock.acquire();
  process.stdout.write(`enter ${process.pid} ${Date.now()}\n`);
  await new Promise((resolve) => setTimeout(resolve, 120));
  process.stdout.write(`exit ${process.pid} ${Date.now()}\n`);
  await release();
  process.stdout.write(`released ${process.pid}\n`);
} else if (command === "hold-forever") {
  await lock.acquire();
  process.stdout.write(`enter ${process.pid} ${Date.now()}\n`);
  setInterval(() => {}, 1000);
  await new Promise(() => {});
} else if (command === "foreign-release") {
  const removed = await lock.release(process.argv[4] || "not-the-owner");
  const owner = lock.read();
  process.stdout.write(`foreign ${removed ? "removed" : "kept"} ${owner ? owner.token : "none"}\n`);
} else {
  throw new Error(`unknown lock worker command ${command}`);
}
