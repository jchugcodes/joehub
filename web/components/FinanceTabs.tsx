"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import { financeTabsFor } from "../lib/live-pages.mjs";
import { useProductionNav } from "./LivePages";

function selected(pathname: string, href: string) {
  if (href === "/finance") return pathname === "/finance";
  if (href === "/finance/categories") return pathname.startsWith("/finance/categories");
  return pathname === href || pathname.startsWith(`${href}/`);
}

function revealTab(item: HTMLElement, scroller: HTMLElement) {
  const itemBox = item.getBoundingClientRect();
  const view = scroller.getBoundingClientRect();
  const margin = 4;
  if (itemBox.right > view.right - margin) scroller.scrollLeft += itemBox.right - view.right + margin;
  if (itemBox.left < view.left + margin) scroller.scrollLeft -= view.left + margin - itemBox.left;
}

export function FinanceTabs() {
  const pathname = usePathname();
  const links = financeTabsFor(useProductionNav());
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
    <nav aria-label="Finance sections" data-tabs="contained" className="finance-sections flex w-full min-w-0 items-end border-b border-line">
      <div ref={scrollerRef} className="finance-tab-row flex min-h-11 min-w-0 flex-1 items-end justify-start gap-3 overflow-x-auto pl-5 pr-1 max-[389px]:gap-1.5 min-[420px]:px-5 min-[1024px]:gap-5">
        {links.map((link) => {
          const current = selected(pathname, link.href);
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
              className={`finance-type inline-flex min-h-11 min-[1024px]:min-w-11 shrink-0 scroll-mx-2 items-end justify-center border-b-[2.5px] pb-2 text-body leading-none ${
                current ? "-mb-px border-finance-primary font-semibold text-ink" : "border-transparent font-medium text-muted"
              }`}
            >
              {link.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
