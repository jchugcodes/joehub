"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useLayoutEffect, useRef } from "react";
import { Icon } from "./Icon";
import { applyAppearance } from "../lib/appearance.mjs";
import { DEV_PRIMARY, LIVE_PRIMARY } from "../lib/live-pages.mjs";
import { useProductionNav } from "./LivePages";

function matches(tab: { href: string; label: string }, pathname: string) {
  if (tab.label === "Home") return pathname === "/" || pathname.startsWith("/tasks") || pathname.startsWith("/grocery");
  if (tab.href === "/") return pathname === "/" || pathname.startsWith("/tasks");
  return pathname === tab.href || pathname.startsWith(`${tab.href}/`);
}

const activeText: Record<string, string> = {
  Home: "text-ink",
  Tasks: "text-ink",
  Grocery: "text-ink",
  Finance: "text-finance-primary",
  Jobs: "text-jobs",
  Journal: "text-journal",
  More: "text-ink",
};

const activePill: Record<string, string> = {
  Home: "bg-ink/[0.12]",
  Tasks: "bg-ink/[0.12]",
  Grocery: "bg-ink/[0.12]",
  Finance: "bg-finance-primary/[0.12]",
  Jobs: "bg-jobs/[0.12]",
  Journal: "bg-journal/[0.12]",
  More: "bg-ink/[0.12]",
};

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  useLayoutEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => applyAppearance();
    apply();
    media.addEventListener("change", apply);
    window.addEventListener("joehub-appearance", apply);
    window.addEventListener("storage", apply);
    return () => {
      media.removeEventListener("change", apply);
      window.removeEventListener("joehub-appearance", apply);
      window.removeEventListener("storage", apply);
    };
  }, []);

  const composing = pathname.startsWith("/journal/compose");
  const tasksScreen = pathname.startsWith("/tasks");
  const groceryScreen = pathname.startsWith("/grocery");
  const financeScreen = pathname.startsWith("/finance");
  const outfitScreen = tasksScreen || groceryScreen || financeScreen;
  const navRef = useRef<HTMLElement>(null);
  const production = useProductionNav();
  const tabs = production ? LIVE_PRIMARY : DEV_PRIMARY;

  useEffect(() => {
    const nav = navRef.current;
    if (!nav) {
      document.documentElement.style.setProperty("--primary-nav-height", "0px");
      return;
    }
    const apply = () => document.documentElement.style.setProperty("--primary-nav-height", `${nav.offsetHeight}px`);
    apply();
    const observer = new ResizeObserver(apply);
    observer.observe(nav);
    return () => observer.disconnect();
  }, [composing]);

  return (
    <div className="min-h-screen bg-page text-ink">
      <a className="sr-only" href="#content">
        Skip to content
      </a>
      {/* Tasks and Grocery widen on desktop. The tab bar stays a full-width bar so it does not cover the column. */}
      <main
        id="content"
        className={`mx-auto w-full min-w-0 pt-2 ${pathname.startsWith("/tasks") || pathname.startsWith("/grocery") || pathname.startsWith("/finance") || pathname.startsWith("/more/settings") ? "max-w-[1080px]" : "max-w-phone"} ${composing ? "pb-8" : "pb-[calc(var(--primary-nav-height,84px)+28px)]"}`}
      >
        {children}
      </main>
      {composing ? null : (
      <nav ref={navRef} aria-label="Primary" className="fixed inset-x-0 bottom-0 z-30">
        <ul className="flex min-h-[84px] w-full min-w-0 items-stretch border-t border-tab-line bg-tab px-2 py-2 backdrop-blur">
          {tabs.map((tab) => {
            const current = matches(tab, pathname);
            const tone = current ? (production ? "text-finance-primary" : activeText[tab.label]) : "text-inactive";
            const pill = current ? (production ? "bg-finance-primary/[0.12]" : activePill[tab.label]) : "";
            return (
              <li key={tab.href} className="flex min-w-0 flex-1 basis-0">
                <Link
                  href={tab.href}
                  aria-current={current ? "page" : undefined}
                  className={`flex min-h-11 w-full min-w-0 flex-col items-center justify-center gap-1 px-0.5 text-center leading-tight ${production ? `text-ui-10.5 ${current ? "font-semibold" : "font-medium"}` : financeScreen ? `finance-type text-ui-10.5 ${current ? "font-semibold" : "font-medium"}` : outfitScreen ? `${groceryScreen ? "grocery-type" : "tasks-type"} text-meta font-normal` : `text-ui-10.5 ${current ? "font-semibold" : "font-medium"}`} ${tone}`}
                >
                  <span className={`rounded-full px-3 py-1 ${pill} ${current ? tone : ""}`}>
                    <Icon name={tab.icon} size={22} strokeWidth={current ? 2.2 : 1.8} />
                  </span>
                  <span className="w-full whitespace-normal break-words">{tab.label}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
      )}
    </div>
  );
}
