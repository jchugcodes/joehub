import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { skeletonHoldsEnabled, skeletonsEnabled } from "../lib/skeleton-flag.mjs";
import { createSkeletonGate, readSkeletonHold } from "../lib/skeleton-gate.mjs";

test("skeletons are on in production and the preview hold stays inert there", () => {
  assert.equal(skeletonsEnabled({ VERCEL_ENV: "production" }), true);
  assert.equal(skeletonsEnabled({ NEXT_PUBLIC_VERCEL_ENV: "production" }), true);
  assert.equal(skeletonsEnabled({ VERCEL_ENV: "production", NEXT_PUBLIC_VERCEL_ENV: "preview" }), true);
  assert.equal(skeletonsEnabled({ NODE_ENV: "production" }), true);
  assert.equal(skeletonsEnabled({ VERCEL_ENV: "preview" }), true);
  assert.equal(skeletonsEnabled({}), true);
  const production = { VERCEL_ENV: "production" };
  assert.equal(skeletonHoldsEnabled(production), false);
  assert.equal(skeletonHoldsEnabled({ NEXT_PUBLIC_VERCEL_ENV: "production" }), false);
  assert.equal(skeletonHoldsEnabled({ VERCEL_ENV: "production", NEXT_PUBLIC_VERCEL_ENV: "preview" }), false);
  assert.equal(skeletonHoldsEnabled({ VERCEL_ENV: "preview" }), true);
  assert.equal(skeletonHoldsEnabled({}), true);
  for (const xd of ["skel", "refresh", "section", "error", "empty"]) {
    assert.equal(readSkeletonHold(`?xd=${xd}`, skeletonHoldsEnabled(production)), "");
    assert.equal(readSkeletonHold(`?xd=${xd}`, skeletonsEnabled(production) && skeletonHoldsEnabled(production)), "");
  }
  assert.equal(readSkeletonHold("?xd=skel", skeletonHoldsEnabled({ VERCEL_ENV: "preview" })), "skel");
  assert.equal(readSkeletonHold("?xd=error", false), "");
  assert.equal(readSkeletonHold("?xd=nope", true), "");
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

test("new page skeletons stay behind the flag, honor xd holds, and overview has five pills", () => {
  const root = new URL("..", import.meta.url);
  const bones = readFileSync(new URL("components/Skeleton.tsx", root), "utf8");
  const overview = bones.slice(bones.indexOf("function OverviewSkeleton"), bones.indexOf("function MonthSkeleton"));
  assert.match(overview, /data-skeleton-pills="5"/);
  assert.match(overview, /length: 5/);
  for (const name of ["home", "bills", "jobs", "journal", "tasks", "grocery"]) {
    assert.match(bones, new RegExp(`data-skeleton="${name}"`));
  }
  const pages = {
    "app/page.tsx": ["readSkeletonHold", "skeletonHoldsEnabled", "HomeSkeleton"],
    "components/FinanceBills.tsx": ["useSkeletons", "useSkeletonHolds", "BillsSkeleton"],
    "components/FinanceOverview.tsx": ["useSkeletons", "useSkeletonHolds", "OverviewSkeleton"],
    "components/FinanceSpending.tsx": ["useSkeletons", "useSkeletonHolds", "SpendingSkeleton"],
    "components/FinanceAccounts.tsx": ["useSkeletons", "useSkeletonHolds", "AccountsSkeleton"],
    "components/JobsScreen.tsx": ["useSkeletons", "useSkeletonHolds", "JobsSkeleton"],
    "components/JournalFeed.tsx": ["useSkeletons", "useSkeletonHolds", "JournalSkeleton"],
    "app/tasks/page.tsx": ["useSkeletons", "useSkeletonHolds", "TasksSkeleton"],
    "app/grocery/page.tsx": ["useSkeletons", "useSkeletonHolds", "GrocerySkeleton"],
  };
  for (const [file, needles] of Object.entries(pages)) {
    const text = readFileSync(new URL(file, root), "utf8");
    for (const needle of needles) assert.match(text, new RegExp(needle), `${file} ${needle}`);
    assert.match(text, /readSkeletonHold\([^)]*holdsOn|skeletonHoldsEnabled\(\)/, `${file} hold gate`);
    assert.doesNotMatch(text, /readSkeletonHold\([^)]*skeletonOn/, `${file} must not use the skeleton flag as the hold`);
    assert.doesNotMatch(text, /NEXT_PUBLIC_/);
  }
  assert.equal(readSkeletonHold("?xd=skel", false), "");
  assert.equal(readSkeletonHold("?xd=refresh", true), "refresh");
  assert.equal(readSkeletonHold("?xd=empty", true), "empty");
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
