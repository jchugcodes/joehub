import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const STANDALONE = join(ROOT, ".next", "standalone");
const BUNDLED = join(STANDALONE, "lib", "fixtures.json");
const TRACE = join(
  STANDALONE,
  ".next",
  "server",
  "app",
  "api",
  "finance",
  "accounts",
  "route.js.nft.json",
);

test("standalone build bundles the fixture json", { skip: !existsSync(STANDALONE) }, () => {
  const expected = JSON.parse(readFileSync(join(ROOT, "lib", "fixtures.json"), "utf8"));
  assert.equal(existsSync(BUNDLED), true);
  assert.deepEqual(JSON.parse(readFileSync(BUNDLED, "utf8")), expected);
  const trace = JSON.parse(readFileSync(TRACE, "utf8"));
  assert.equal(
    trace.files.some((file) => file.endsWith("fixtures.json")),
    true,
  );
});
