import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { appearanceIsDark, normalizeAppearance } from "../lib/appearance.mjs";

test("appearance defaults to system and resolves light, dark, and the OS scheme", () => {
  assert.equal(normalizeAppearance(null), "system");
  assert.equal(normalizeAppearance("nope"), "system");
  assert.equal(normalizeAppearance("light"), "light");
  assert.equal(appearanceIsDark("system", false), false);
  assert.equal(appearanceIsDark("system", true), true);
  assert.equal(appearanceIsDark("dark", false), true);
  assert.equal(appearanceIsDark("light", true), false);
});

test("dark tokens keep accent text and checkbox marks on the passing pairs", () => {
  const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
  const tailwind = readFileSync(new URL("../tailwind.config.cjs", import.meta.url), "utf8");
  const dark = css.slice(css.indexOf("html.dark"));
  assert.match(dark, /--finance-rgb:\s*78 174 134/);
  assert.match(dark, /--chart-positive:\s*#4eae86/);
  assert.match(dark, /--on-gain:\s*#0e1310/);
  assert.match(dark, /--ink:\s*#ecf1ee/);
  assert.match(dark, /--page:\s*#0e1310/);
  assert.match(dark, /--line:\s*#616b63/);
  assert.match(dark, /--spend-dot:\s*#d5ddd7/);
  assert.equal(dark.includes("#2e8b6a"), false);
  assert.match(tailwind, /darkMode:\s*"class"/);
  assert.match(readFileSync(new URL("../components/IncomeSpent.tsx", import.meta.url), "utf8"), /dark:bg-ink dark:text-page/);
  assert.match(readFileSync(new URL("../app/grocery/page.tsx", import.meta.url), "utf8"), /bg-gain text-on-gain/);
});
