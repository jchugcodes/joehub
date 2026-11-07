import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const descendant = spawn(process.execPath, [fileURLToPath(new URL("./group-descendant.mjs", import.meta.url))], {
  stdio: "ignore",
});
process.stdout.write(`${descendant.pid}\n`);
await new Promise((resolve) => setTimeout(resolve, 150));
if (process.argv[2] === "signal") process.kill(process.pid, "SIGKILL");
process.exit(0);
