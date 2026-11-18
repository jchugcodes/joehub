import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createSkeletonGate, readSkeletonHold, skeletonsEnabled } from "../lib/skeleton-gate.mjs";

test("skeletons stay off in production and the hold is inert there", () => {
  assert.equal(skeletonsEnabled({ VERCEL_ENV: "production" }), false);
  assert.equal(skeletonsEnabled({ NEXT_PUBLIC_VERCEL_ENV: "production" }), false);
  assert.equal(skeletonsEnabled({ VERCEL_ENV: "production", NEXT_PUBLIC_VERCEL_ENV: "preview" }), false);
  assert.equal(skeletonsEnabled({ NODE_ENV: "production" }), true);
  assert.equal(skeletonsEnabled({ VERCEL_ENV: "preview" }), true);
  assert.equal(skeletonsEnabled({}), true);
  assert.equal(readSkeletonHold("?xd=skel", { VERCEL_ENV: "production" }), "");
  assert.equal(readSkeletonHold("?xd=error", { NEXT_PUBLIC_VERCEL_ENV: "production" }), "");
  assert.equal(readSkeletonHold("?xd=skel", { VERCEL_ENV: "preview" }), "skel");
  assert.equal(readSkeletonHold("?xd=nope", {}), "");
});

test("a fast response never shows a skeleton", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const gate = createSkeletonGate();
  let skeleton = false;
  gate.subscribe((snap) => {
    if (snap.skeleton) skeleton = true;
  });
  gate.start();
  t.mock.timers.tick(50);
  gate.resolve();
  t.mock.timers.tick(500);
  assert.equal(skeleton, false);
  assert.equal(gate.phase(), "ready");
});

test("a 181ms response keeps the skeleton until 481ms", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const gate = createSkeletonGate();
  gate.start();
  t.mock.timers.tick(180);
  assert.equal(gate.phase(), "skeleton");
  t.mock.timers.tick(1);
  gate.resolve();
  assert.equal(gate.phase(), "skeleton");
  t.mock.timers.tick(299);
  assert.equal(gate.phase(), "skeleton");
  t.mock.timers.tick(1);
  assert.equal(gate.phase(), "ready");
});

test("cached data is ready immediately and never shows a skeleton", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const gate = createSkeletonGate();
  let skeleton = false;
  gate.subscribe((snap) => {
    if (snap.skeleton) skeleton = true;
  });
  gate.start({ cached: true });
  assert.equal(gate.phase(), "ready");
  t.mock.timers.tick(1000);
  assert.equal(skeleton, false);
});

test("skeleton bones use the light and dark tokens and rest under reduced motion", () => {
  const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
  const light = css.slice(0, css.indexOf("html.dark,"));
  const dark = css.slice(css.indexOf("html.dark,"));
  assert.match(light, /--skeleton:\s*#dde1dc/);
  assert.match(dark, /--skeleton:\s*#2a332d/);
  assert.match(css, /skeleton-pulse 1\.4s ease-in-out infinite/);
  assert.match(css, /opacity:\s*0\.45/);
  assert.match(css, /@media \(prefers-reduced-motion:\s*reduce\)/);
  assert.match(css, /opacity:\s*0\.7/);
  assert.match(css, /refresh-slide 1\.1s ease-in-out infinite/);
});
