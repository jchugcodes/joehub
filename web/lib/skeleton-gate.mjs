export const SKELETON_DELAY_MS = 180;
export const SKELETON_HOLD_MS = 300;

const HOLDS = new Set(["skel", "refresh", "section", "error", "empty"]);

export function readSkeletonHold(search, enabled) {
  if (!enabled) return "";
  const params = typeof search === "string" ? new URLSearchParams(search.replace(/^\?/, "")) : search;
  const value = params?.get?.("xd") || "";
  return HOLDS.has(value) ? value : "";
}

function browserClock() {
  return {
    later(fn, ms) {
      return setTimeout(fn, ms);
    },
    clear(id) {
      clearTimeout(id);
    },
  };
}

export function createSkeletonGate(clock = browserClock()) {
  let phase = "idle";
  let timer = null;
  const listeners = new Set();

  function snapshot() {
    return { phase, skeleton: phase === "skeleton" };
  }

  function emit() {
    const snap = snapshot();
    for (const listener of listeners) listener(snap);
  }

  function clear() {
    if (timer != null) {
      clock.clear(timer);
      timer = null;
    }
  }

  function later(fn, ms) {
    clear();
    timer = clock.later(() => {
      timer = null;
      fn();
    }, ms);
  }

  return {
    phase: () => phase,
    skeleton: () => phase === "skeleton",
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    start({ cached = false } = {}) {
      clear();
      if (cached) {
        phase = "ready";
        emit();
        return;
      }
      phase = "pending";
      emit();
      later(() => {
        if (phase !== "pending") return;
        phase = "skeleton";
        emit();
      }, SKELETON_DELAY_MS);
    },
    resolve() {
      if (phase === "ready" || phase === "error") return;
      if (phase === "skeleton") {
        later(() => {
          phase = "ready";
          emit();
        }, SKELETON_HOLD_MS);
        return;
      }
      clear();
      phase = "ready";
      emit();
    },
    fail() {
      if (phase === "error") return;
      if (phase === "skeleton") {
        later(() => {
          phase = "error";
          emit();
        }, SKELETON_HOLD_MS);
        return;
      }
      clear();
      phase = "error";
      emit();
    },
    force(next) {
      clear();
      phase = next;
      emit();
    },
    stop() {
      clear();
    },
  };
}
