"use client";

import { useEffect, useId, useRef } from "react";

/** Local sheet. Escape closes it and Tab stays inside. Not part of the API. */
export function Sheet({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    const node = ref.current;
    const previous = document.activeElement as HTMLElement | null;
    const focusable = () =>
      [...(node?.querySelectorAll<HTMLElement>("button, input, textarea, a[href], [tabindex]") ?? [])].filter(
        (el) => !el.hasAttribute("disabled") && el.tabIndex !== -1,
      );
    focusable()[0]?.focus();
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
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-overlay">
      <button type="button" className="absolute inset-0 cursor-default" aria-label={`Close ${title}`} onClick={onClose} />
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="relative z-10 max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-t-3xl bg-card p-4 pb-8 shadow-lg"
      >
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-line" />
        <div className="mb-2 flex items-center justify-between">
          <h2 id={titleId} className="text-xl font-semibold">
            {title}
          </h2>
          <button type="button" className="rounded-full px-2 py-1 text-xl leading-none" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
