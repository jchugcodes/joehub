import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { overlayHoldsEnabled, overlaysEnabled } from "../lib/overlay-flag.mjs";
import { focusReturnSelector, overlayDurations, overlayEscape, readOverlayHold, shouldCloseOutside, shouldDismissSwipe } from "../lib/overlay-motion.mjs";

test("overlays are off in production and the preview hold stays inert there", () => {
  const production = { VERCEL_ENV: "production" };
  assert.equal(overlaysEnabled(production), false);
  assert.equal(overlaysEnabled({ NEXT_PUBLIC_VERCEL_ENV: "production" }), false);
  assert.equal(overlaysEnabled({ VERCEL_ENV: "production", NEXT_PUBLIC_VERCEL_ENV: "preview" }), false);
  assert.equal(overlaysEnabled({ VERCEL_ENV: "preview" }), true);
  assert.equal(overlaysEnabled({}), true);
  assert.equal(overlaysEnabled({ NODE_ENV: "production" }), true);
  assert.equal(overlayHoldsEnabled(production), false);
  assert.equal(overlayHoldsEnabled({ NEXT_PUBLIC_VERCEL_ENV: "production" }), false);
  assert.equal(overlayHoldsEnabled({ VERCEL_ENV: "preview" }), true);
  assert.equal(overlayHoldsEnabled({}), true);
  for (const xe of ["skel", "empty", "error", "offline"]) {
    assert.equal(readOverlayHold(`?xe=${xe}`, overlayHoldsEnabled(production)), "");
    assert.equal(readOverlayHold(`?xe=${xe}`, overlaysEnabled(production) && overlayHoldsEnabled(production)), "");
  }
  assert.equal(readOverlayHold("?xe=skel", overlayHoldsEnabled({ VERCEL_ENV: "preview" })), "skel");
  assert.equal(readOverlayHold("?xe=error", false), "");
  assert.equal(readOverlayHold("?xe=nope", true), "");
});

test("a swipe dismisses at 40 percent of the width or 800px/s", () => {
  assert.equal(shouldDismissSwipe(137, 342, 0), true);
  assert.equal(shouldDismissSwipe(136, 342, 0), false);
  assert.equal(shouldDismissSwipe(10, 342, 800), true);
  assert.equal(shouldDismissSwipe(10, 342, 799), false);
  assert.equal(shouldDismissSwipe(0, 342, 2000), false);
  assert.equal(shouldDismissSwipe(-40, 342, 900), false);
  assert.equal(shouldDismissSwipe(200, 0, 900), false);
});

test("an outside click closes and a drag or control press does not", () => {
  assert.equal(shouldCloseOutside({ moved: 0, interactive: false }), true);
  assert.equal(shouldCloseOutside({ moved: 7, interactive: false }), true);
  assert.equal(shouldCloseOutside({ moved: 8, interactive: false }), false);
  assert.equal(shouldCloseOutside({ moved: 0, interactive: true }), false);
});

test("escape pops one level and focus returns to the account link", () => {
  assert.equal(overlayEscape({ confirming: true, form: true, nested: true }), "confirm");
  assert.equal(overlayEscape({ confirming: false, form: true, nested: false }), "form");
  assert.equal(overlayEscape({ confirming: false, form: false, nested: true }), "pop");
  assert.equal(overlayEscape({ confirming: false, form: false, nested: false }), "close");
  assert.equal(focusReturnSelector("acct-checking"), 'a[href*="acct-checking"]');
  assert.equal(focusReturnSelector(""), "");
  assert.equal(focusReturnSelector('acct"x'), "");
});

test("reduced motion is a 120ms fade and the slide timings stay put", () => {
  const reduced = overlayDurations(true);
  for (const key of ["phoneOpen", "phoneClose", "desktopOpen", "desktopClose", "push", "snap"]) {
    assert.equal(reduced[key], 120);
  }
  const full = overlayDurations(false);
  assert.deepEqual(full, { phoneOpen: 320, phoneClose: 280, desktopOpen: 240, desktopClose: 200, push: 280, snap: 200 });
});

test("accounts read the overlay flag from context and never the public env name", () => {
  const root = new URL("..", import.meta.url);
  const accounts = readFileSync(new URL("components/FinanceAccounts.tsx", root), "utf8");
  const bills = readFileSync(new URL("components/FinanceBills.tsx", root), "utf8");
  const layout = readFileSync(new URL("app/layout.tsx", root), "utf8");
  assert.match(accounts, /useOverlays\(\)/);
  assert.match(accounts, /readOverlayHold\(search, useOverlayHolds\(\)\)/);
  assert.match(accounts, /text-left text-body text-ink/);
  assert.doesNotMatch(accounts, /overlay-flag/);
  assert.doesNotMatch(accounts, /NEXT_PUBLIC_/);
  assert.match(bills, /useOverlays\(\)/);
  assert.match(bills, /readOverlayHold\(search, useOverlayHolds\(\)\)/);
  assert.match(bills, /ConfirmDialog/);
  assert.match(bills, /text-left text-body text-ink/);
  assert.doesNotMatch(bills, /overlay-flag/);
  assert.doesNotMatch(bills, /NEXT_PUBLIC_/);
  assert.match(layout, /overlays=\{overlaysEnabled\(\)\}/);
  assert.match(layout, /overlayHolds=\{overlayHoldsEnabled\(\)\}/);
  const motion = readFileSync(new URL("lib/overlay-motion.mjs", root), "utf8");
  const panel = readFileSync(new URL("components/OverlayPanel.tsx", root), "utf8");
  assert.doesNotMatch(motion, /NEXT_PUBLIC_/);
  assert.doesNotMatch(panel, /NEXT_PUBLIC_/);
  assert.match(panel, /translateX\(100%\)/);
  assert.match(panel, /data-state=\{phase\}/);
  assert.match(panel, /requestAnimationFrame/);
  assert.match(panel, /data-overlay="desktop"/);
  assert.match(panel, /position:\s*"fixed"|className="fixed z-40"/);
  assert.doesNotMatch(panel, /pointer-events-none/);
  assert.doesNotMatch(panel, /transitionend/);
});
