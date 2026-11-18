"use client";

import { useEffect, useId, useRef, useState, type ReactNode, type TouchEvent } from "react";
import { OVERLAY_EASE, overlayDurations, overlayEscape, shouldCloseOutside, shouldDismissSwipe } from "../lib/overlay-motion.mjs";

function useReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const apply = () => setReduced(media.matches);
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, []);
  return reduced;
}

export function PanelHeader({
  title,
  onClose,
  onBack,
  action = null,
  slim = false,
}: {
  title: string;
  onClose: () => void;
  onBack?: () => void;
  action?: ReactNode;
  slim?: boolean;
}) {
  return (
    <div className="flex h-11 shrink-0 items-center gap-1 border-b border-line px-1">
      {slim ? (
        <button type="button" onClick={onBack || onClose} className="inline-flex h-11 items-center px-3 text-body text-muted">
          Cancel
        </button>
      ) : (
        <button type="button" onClick={onBack || onClose} aria-label={onBack ? "Back" : "Close"} className="inline-flex h-11 w-11 items-center justify-center">
          {onBack ? (
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M15 18l-6-6 6-6" />
            </svg>
          ) : (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          )}
        </button>
      )}
      <h2 className="min-w-0 flex-1 truncate text-center text-section font-medium">{title}</h2>
      {slim ? action : action || <span className="w-11 shrink-0" aria-hidden="true" />}
    </div>
  );
}

export function ConfirmDialog({ title, onCancel, onConfirm }: { title: string; onCancel: () => void; onConfirm: () => void }) {
  const titleId = useId();
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 dark:bg-black/60">
      <div role="alertdialog" aria-modal="true" aria-labelledby={titleId} className="w-full max-w-[280px] rounded-[20px] bg-surface p-4 shadow-2xl">
        <h2 id={titleId} className="text-center text-section font-medium">
          {title}
        </h2>
        <div className="mt-4 flex gap-2">
          <button type="button" onClick={onConfirm} className="order-2 inline-flex h-11 flex-1 items-center justify-center rounded-xl bg-finance-dining text-body font-medium text-white">
            Delete
          </button>
          <button type="button" onClick={onCancel} className="order-1 inline-flex h-11 flex-1 items-center justify-center rounded-xl border border-line bg-surface text-body font-medium">
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

export function OverlayPanel({
  wide,
  title,
  onClose,
  onBack,
  action = null,
  slim = false,
  form = false,
  nested = false,
  confirming = false,
  sheet = false,
  depth = 0,
  children,
}: {
  wide: boolean;
  title: string;
  onClose: () => void;
  onBack?: () => void;
  action?: ReactNode;
  slim?: boolean;
  form?: boolean;
  nested?: boolean;
  confirming?: boolean;
  sheet?: boolean;
  depth?: number;
  children: ReactNode;
}) {
  const reduced = useReducedMotion();
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  const backRef = useRef(onBack);
  const depthRef = useRef(depth);
  const leaveTimer = useRef(0);
  closeRef.current = onClose;
  backRef.current = onBack;
  const durations = overlayDurations(reduced);
  const openMs = wide ? durations.desktopOpen : durations.phoneOpen;
  const closeMs = wide ? durations.desktopClose : durations.phoneClose;
  const closeMsRef = useRef(closeMs);
  closeMsRef.current = closeMs;
  const [phase, setPhase] = useState<"enter" | "open" | "leave">("enter");
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  const [stack, setStack] = useState("");

  useEffect(() => {
    let second = 0;
    const first = requestAnimationFrame(() => {
      second = requestAnimationFrame(() => {
        if (phaseRef.current === "enter") setPhase("open");
      });
    });
    return () => {
      cancelAnimationFrame(first);
      cancelAnimationFrame(second);
    };
  }, []);

  useEffect(() => {
    if (depth === depthRef.current) return;
    setStack(depth > depthRef.current ? "push" : "pop");
    depthRef.current = depth;
  }, [depth]);

  useEffect(() => {
    const node = viewRef.current;
    if (!node || !stack) return;
    const easing = OVERLAY_EASE;
    const animation = reduced
      ? node.animate([{ opacity: 0 }, { opacity: 1 }], { duration: durations.push, easing })
      : node.animate(
          [{ transform: stack === "pop" ? "translateX(-40%)" : "translateX(100%)" }, { transform: "translateX(0)" }],
          { duration: durations.push, easing },
        );
    return () => animation.cancel();
  }, [stack, depth, title, reduced, durations.push]);

  function dismiss() {
    if (phaseRef.current === "leave") return;
    setPhase("leave");
    window.clearTimeout(leaveTimer.current);
    leaveTimer.current = window.setTimeout(() => closeRef.current(), closeMsRef.current);
  }

  useEffect(() => () => window.clearTimeout(leaveTimer.current), []);

  useEffect(() => {
    if (wide) return;
    const y = window.scrollY;
    const body = document.body;
    body.style.position = "fixed";
    body.style.top = `-${y}px`;
    body.style.left = "0";
    body.style.right = "0";
    return () => {
      body.style.position = "";
      body.style.top = "";
      body.style.left = "";
      body.style.right = "";
      window.scrollTo(0, y);
    };
  }, [wide]);

  useEffect(() => {
    const node = panelRef.current;
    const focusable = () =>
      [...(node?.querySelectorAll<HTMLElement>("button, input, textarea, select, a[href], [tabindex]") ?? [])].filter((el) => !el.hasAttribute("disabled") && el.tabIndex !== -1);
    const preferred = node?.querySelector<HTMLElement>("[data-autofocus]");
    (preferred && !preferred.hasAttribute("disabled") ? preferred : focusable()[0])?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        const actionName = overlayEscape({ confirming, form, nested: Boolean(backRef.current) || nested });
        if (actionName === "confirm" || phaseRef.current === "leave") return;
        event.preventDefault();
        if ((actionName === "pop" || actionName === "form") && backRef.current) backRef.current();
        else dismiss();
        return;
      }
      if (wide || event.key !== "Tab") return;
      const items = focusable();
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [wide, confirming, form, nested, title]);

  useEffect(() => {
    if (!wide) return;
    let startX = 0;
    let startY = 0;
    let moved = 0;
    const down = (event: PointerEvent) => {
      if (panelRef.current?.contains(event.target as Node)) return;
      startX = event.clientX;
      startY = event.clientY;
      moved = 0;
    };
    const move = (event: PointerEvent) => {
      moved = Math.max(moved, Math.hypot(event.clientX - startX, event.clientY - startY));
    };
    const up = (event: PointerEvent) => {
      if (panelRef.current?.contains(event.target as Node)) return;
      const interactive = event.target instanceof Element && Boolean(event.target.closest("a, button, input, textarea, select, label, [role='switch']"));
      if (shouldCloseOutside({ moved, interactive })) dismiss();
    };
    document.addEventListener("pointerdown", down);
    document.addEventListener("pointermove", move);
    document.addEventListener("pointerup", up);
    return () => {
      document.removeEventListener("pointerdown", down);
      document.removeEventListener("pointermove", move);
      document.removeEventListener("pointerup", up);
    };
  }, [wide]);

  function onTouchStart(event: TouchEvent) {
    if (wide || phaseRef.current === "leave") return;
    const touch = event.changedTouches[0];
    panelRef.current?.setAttribute("data-swipe-x", String(touch.clientX));
    panelRef.current?.setAttribute("data-swipe-t", String(performance.now()));
  }

  function onTouchMove(event: TouchEvent) {
    if (wide || phaseRef.current !== "open") return;
    const node = panelRef.current;
    if (!node) return;
    const startX = Number(node.getAttribute("data-swipe-x") || "0");
    const dx = Math.max(0, event.changedTouches[0].clientX - startX);
    node.style.transition = "none";
    node.style.transform = `translateX(${dx}px)`;
  }

  function onTouchEnd(event: TouchEvent) {
    if (wide || phaseRef.current === "leave") return;
    const node = panelRef.current;
    if (!node) return;
    const startX = Number(node.getAttribute("data-swipe-x") || "0");
    const startT = Number(node.getAttribute("data-swipe-t") || "0");
    const touch = event.changedTouches[0];
    const distance = touch.clientX - startX;
    const elapsed = Math.max(1, performance.now() - startT);
    const velocity = (distance / elapsed) * 1000;
    if (distance >= 8 && shouldDismissSwipe(distance, node.getBoundingClientRect().width, velocity)) {
      dismiss();
      return;
    }
    if (distance > 0) {
      node.style.transition = `transform ${durations.snap}ms ${OVERLAY_EASE}`;
      node.style.transform = "translateX(0)";
    }
  }

  const travel = phase === "leave" ? closeMs : openMs;
  const motion = reduced ? `opacity ${travel}ms ${OVERLAY_EASE}` : `transform ${travel}ms ${OVERLAY_EASE}`;
  const parked = phase !== "open";

  const panel = (
    <div
      ref={panelRef}
      role="dialog"
      aria-modal={wide ? undefined : true}
      aria-labelledby={titleId}
      data-overlay="panel"
      data-state={phase}
      data-sheet={sheet ? "form" : undefined}
      data-motion={reduced ? "fade" : "slide"}
      data-duration={String(travel)}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
      className={`pointer-events-auto flex min-h-0 flex-col overflow-hidden bg-surface ${wide ? "h-fit max-h-[calc(100vh-16px)] w-full rounded-[20px] border border-line" : "absolute inset-y-0 right-0 w-[342px] shadow-2xl"}`}
      style={{
        transform: reduced ? "none" : parked ? "translateX(100%)" : "translateX(0)",
        opacity: reduced ? (parked ? 0 : 1) : 1,
        transition: phase === "enter" ? "none" : motion,
        pointerEvents: "auto",
      }}
    >
      <span id={titleId} className="sr-only">
        {title}
      </span>
      <PanelHeader title={title} onClose={dismiss} onBack={onBack} action={action} slim={slim} />
      <div ref={viewRef} data-stack={stack || "idle"} className="min-h-0 flex-1 overflow-y-auto">
        {children}
      </div>
    </div>
  );

  if (wide) {
    return (
      <div className="sticky top-2 w-[440px] shrink-0 self-start" style={{ overflow: "clip" }}>
        {panel}
      </div>
    );
  }
  return (
    <div
      className="fixed inset-0 z-40"
      style={{ overflow: "clip" }}
      data-overlay="phone"
      onClick={(event) => {
        if (event.target === event.currentTarget) dismiss();
      }}
    >
      <button
        type="button"
        aria-label="Close account"
        onClick={dismiss}
        className="pointer-events-auto absolute bottom-0 top-0 w-12 bg-black/40 dark:bg-black/60"
        style={{ right: 342, opacity: phase === "open" ? 1 : phase === "leave" ? 0 : 0, transition: phase === "enter" ? "none" : `opacity ${travel}ms ${OVERLAY_EASE}` }}
      />
      {panel}
    </div>
  );
}
