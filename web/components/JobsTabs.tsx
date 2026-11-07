"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import { Icon } from "./Icon";

const links = [
  { href: "/jobs#overview", label: "Overview" },
  { href: "/jobs#matches", label: "Matches" },
  { href: "/jobs#board", label: "Board" },
  { href: "/jobs/globex#notes", label: "Notes" },
];

function revealTab(item: HTMLElement, scroller: HTMLElement) {
  const itemBox = item.getBoundingClientRect();
  const view = scroller.getBoundingClientRect();
  const margin = 4;
  if (itemBox.right > view.right - margin) scroller.scrollLeft += itemBox.right - view.right + margin;
  if (itemBox.left < view.left + margin) scroller.scrollLeft -= view.left + margin - itemBox.left;
}

export function JobsTabs({ current = "Overview" }: { current?: string }) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const onFocus = (event: globalThis.FocusEvent) => {
      const item = event.target;
      if (item instanceof HTMLElement && scroller.contains(item)) revealTab(item, scroller);
    };
    scroller.addEventListener("focusin", onFocus);
    scroller.setAttribute("data-hydrated", "true");
    return () => scroller.removeEventListener("focusin", onFocus);
  }, []);
  return (
    <nav aria-label="Jobs sections" data-tabs="contained" className="mt-3 flex w-full min-w-0 items-end border-b border-line">
      <div ref={scrollerRef} className="scroll-x flex min-w-0 flex-1 items-end gap-6 overflow-x-auto overflow-y-hidden px-5 scroll-px-5">
        {links.map((link) => {
          const active = link.label === current;
          return (
            <Link
              key={link.label}
              href={link.href}
              aria-current={active ? "page" : undefined}
              className={`shrink-0 border-b-[2.5px] pb-2.5 text-ui-15 ${
                active ? "border-jobs font-bold text-ink" : "border-transparent font-medium text-muted"
              }`}
            >
              {link.label}
            </Link>
          );
        })}
      </div>
      <span className="flex shrink-0 items-center gap-1 pb-2.5 pr-5 text-ui-11 text-muted">
        swipe <Icon name="swipe" size={14} />
      </span>
    </nav>
  );
}
