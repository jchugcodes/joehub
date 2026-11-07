"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import { Icon } from "./Icon";

const links = [
  { href: "/finance", label: "Overview" },
  { href: "/finance/dining-out", label: "Categories" },
  { href: "/finance/goals", label: "Goals" },
  { href: "/finance/accounts", label: "Accounts" },
];

function revealTab(item: HTMLElement, scroller: HTMLElement) {
  const itemBox = item.getBoundingClientRect();
  const view = scroller.getBoundingClientRect();
  const margin = 4;
  if (itemBox.right > view.right - margin) scroller.scrollLeft += itemBox.right - view.right + margin;
  if (itemBox.left < view.left + margin) scroller.scrollLeft -= view.left + margin - itemBox.left;
}

export function FinanceTabs({ hint = false }: { hint?: boolean }) {
  const pathname = usePathname();
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
    <nav aria-label="Finance sections" data-tabs="contained" className="flex w-full min-w-0 items-end border-b border-line">
      <div ref={scrollerRef} className="flex min-w-0 flex-1 items-end gap-6 overflow-x-auto overflow-y-hidden px-5 scroll-px-5">
        {links.map((link) => {
          const current = pathname === link.href;
          return (
            <Link
              key={link.href}
              href={link.href}
              aria-current={current ? "page" : undefined}
              ref={(node) => {
                if (!node) return;
                node.onfocus = () => {
                  const scroller = node.parentElement;
                  if (scroller) revealTab(node, scroller);
                };
              }}
              className={`shrink-0 scroll-mx-2 border-b-[2.5px] pb-2.5 text-ui-15 ${
                current ? "border-finance-primary font-bold text-ink" : "border-transparent font-medium text-muted"
              }`}
            >
              {link.label}
            </Link>
          );
        })}
      </div>
      {hint ? (
        <span className="flex shrink-0 items-center gap-1 pb-2.5 pr-5 text-ui-11 text-muted">
          swipe <Icon name="swipe" size={14} />
        </span>
      ) : null}
    </nav>
  );
}
