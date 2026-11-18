export const OVERLAY_EASE = "cubic-bezier(0.32, 0.72, 0, 1)";

const HOLDS = new Set(["skel", "empty", "error", "offline"]);

export function overlayDurations(reduced) {
  if (reduced) return { phoneOpen: 120, phoneClose: 120, desktopOpen: 120, desktopClose: 120, push: 120, snap: 120 };
  return { phoneOpen: 320, phoneClose: 280, desktopOpen: 240, desktopClose: 200, push: 280, snap: 200 };
}

export function shouldDismissSwipe(distance, width, velocity) {
  if (!(width > 0) || !(distance > 0)) return false;
  return distance >= width * 0.4 || velocity >= 800;
}

export function shouldCloseOutside({ moved, interactive }) {
  return moved < 8 && !interactive;
}

export function overlayEscape({ confirming, form, nested }) {
  if (confirming) return "confirm";
  if (form) return "form";
  if (nested) return "pop";
  return "close";
}

export function focusReturnSelector(id) {
  if (!id || /["'\\]/.test(id)) return "";
  return `a[href*="${id}"]`;
}

export function readOverlayHold(search, enabled) {
  if (!enabled) return "";
  const params = typeof search === "string" ? new URLSearchParams(search.replace(/^\?/, "")) : search;
  const value = params?.get?.("xe") || "";
  return HOLDS.has(value) ? value : "";
}
