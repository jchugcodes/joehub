"use client";

import { useEffect, useId, useRef } from "react";
import { Icon } from "./Icon";

/** Local sheet. Escape closes it and Tab stays inside. Not part of the API. */
export function Sheet({
  title,
  onClose,
  children,
  frame = false,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  /** Finance category sheet (frame 1:10). Journal keeps the earlier sheet. */
  frame?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    const node = ref.current;
    const previous = document.activeElement as HTMLElement | null;
    const focusable = () =>
      [...(node?.querySelectorAll<HTMLElement>("button, input, textarea, select, a[href], [tabindex]") ?? [])].filter(
        (el) => !el.hasAttribute("disabled") && el.tabIndex !== -1,
      );
    const preferred = node?.querySelector<HTMLElement>("[data-autofocus]");
    (preferred && !preferred.hasAttribute("disabled") ? preferred : focusable()[0])?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const items = focusable();
      if (!items.length || !node) return;
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
    return () => {
      document.removeEventListener("keydown", onKey);
      previous?.focus();
    };
  }, []);

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/40">
      <button type="button" className="absolute inset-0 z-0 cursor-default" aria-label={`Close ${title}`} onClick={onClose} />
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={
          frame
            ? "relative z-10 flex max-h-[calc(100dvh-env(safe-area-inset-top)-env(safe-area-inset-bottom))] w-full max-w-phone flex-col overflow-hidden rounded-t-sheetTop bg-surface shadow-2xl"
            : "relative z-10 max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-t-sheetTop bg-surface p-4 pb-8 shadow-2xl"
        }
      >
        <div className={frame ? "shrink-0 px-5 pt-3" : ""}>
          <div className={`mx-auto rounded-full ${frame ? "h-1.5 w-10 bg-support-handle" : "mb-3 h-1 w-10 bg-line"}`} />
          <div className={`flex items-center justify-between gap-3 ${frame ? "mt-4" : "mb-2"}`}>
            <h2 id={titleId} className={frame ? "min-w-0 text-ui-18 font-bold" : "text-xl font-semibold"}>
              {title}
            </h2>
            <button
              type="button"
              className={frame ? "grid h-11 w-11 shrink-0 place-items-center border-0 bg-transparent p-0 text-muted" : "shrink-0 rounded-full px-2 py-1 text-xl leading-none"}
              onClick={onClose}
              aria-label="Close"
            >
              {frame ? <Icon name="close" size={22} /> : "×"}
            </button>
          </div>
        </div>
        {frame ? <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-[max(1rem,env(safe-area-inset-bottom))]">{children}</div> : children}
      </div>
    </div>
  );
}
