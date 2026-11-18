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
        <button type="button" onClick={onClose} className="inline-flex h-11 items-center px-3 text-body text-muted">
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
  children: ReactNode;
}) {
  const reduced = useReducedMotion();
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  const backRef = useRef(onBack);
  closeRef.current = onClose;
  backRef.current = onBack;
  const durations = overlayDurations(reduced);
  const openMs = wide ? durations.desktopOpen : durations.phoneOpen;
  const closeMs = wide ? durations.desktopClose : durations.phoneClose;

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
        if (actionName === "confirm") return;
        event.preventDefault();
        if (actionName === "pop" || actionName === "form") backRef.current?.();
        else closeRef.current();
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
      if (shouldCloseOutside({ moved, interactive })) closeRef.current();
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
    if (wide) return;
    const touch = event.changedTouches[0];
    panelRef.current?.setAttribute("data-swipe-x", String(touch.clientX));
    panelRef.current?.setAttribute("data-swipe-t", String(performance.now()));
  }

  function onTouchEnd(event: TouchEvent) {
    if (wide) return;
    const node = panelRef.current;
    if (!node) return;
    const startX = Number(node.getAttribute("data-swipe-x") || "0");
    const startT = Number(node.getAttribute("data-swipe-t") || "0");
    const touch = event.changedTouches[0];
    const distance = touch.clientX - startX;
    const elapsed = Math.max(1, performance.now() - startT);
    const velocity = (distance / elapsed) * 1000;
    if (shouldDismissSwipe(distance, node.getBoundingClientRect().width, velocity)) closeRef.current();
    else if (distance > 0) {
      node.style.transition = `transform ${durations.snap}ms ${OVERLAY_EASE}`;
      node.style.transform = "translateX(0)";
    }
  }

  const motion = reduced
    ? `opacity ${openMs}ms ${OVERLAY_EASE}`
    : `transform ${openMs}ms ${OVERLAY_EASE}, opacity ${openMs}ms ${OVERLAY_EASE}`;

  const panel = (
    <div
      ref={panelRef}
      role="dialog"
      aria-modal={wide ? undefined : true}
      aria-labelledby={titleId}
      data-overlay="panel"
      data-sheet={sheet ? "form" : undefined}
      data-motion={reduced ? "fade" : "slide"}
      data-duration={String(openMs)}
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
      className={`flex min-h-0 flex-col bg-surface translate-x-0 opacity-100 ${wide ? "sticky top-2 h-fit max-h-[calc(100vh-16px)] w-[440px] shrink-0 overflow-hidden rounded-[20px] border border-line" : "absolute inset-y-0 right-0 w-[342px] shadow-2xl"}`}
      style={{ transition: motion, ["--overlay-close" as string]: `${closeMs}ms` }}
    >
      <span id={titleId} className="sr-only">
        {title}
      </span>
      <PanelHeader title={title} onClose={onClose} onBack={onBack} action={action} slim={slim} />
      <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
    </div>
  );

  if (wide) return panel;
  return (
    <div className="fixed inset-0 z-40" data-overlay="phone">
      <button type="button" aria-label="Close account" onClick={onClose} className="absolute bottom-0 top-0 w-12 bg-black/40 dark:bg-black/60" style={{ right: 342 }} />
      {panel}
    </div>
  );
}
