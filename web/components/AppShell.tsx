"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Icon } from "./Icon";

const tabs = [
  { href: "/", label: "Home", icon: "home", match: (path: string) => path === "/" || path.startsWith("/tasks") || path.startsWith("/grocery") },
  { href: "/finance", label: "Finance", icon: "finance", match: (path: string) => path.startsWith("/finance") },
  { href: "/jobs", label: "Jobs", icon: "jobs", match: (path: string) => path.startsWith("/jobs") },
  { href: "/journal", label: "Journal", icon: "journal", match: (path: string) => path.startsWith("/journal") },
  { href: "/more", label: "More", icon: "more", match: (path: string) => path.startsWith("/more") },
];

const activeText: Record<string, string> = {
  Home: "text-ink",
  Finance: "text-finance-primary",
  Jobs: "text-jobs",
  Journal: "text-journal",
  More: "text-ink",
};

const activePill: Record<string, string> = {
  Home: "bg-ink/[0.12]",
  Finance: "bg-finance-primary/[0.12]",
  Jobs: "bg-jobs/[0.12]",
  Journal: "bg-journal/[0.12]",
  More: "bg-ink/[0.12]",
};

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const params = useSearchParams();
  const [storedDark, setStoredDark] = useState(false);

  useEffect(() => {
    const read = () => setStoredDark(localStorage.getItem("joehub-finance-theme") === "dark");
    read();
    window.addEventListener("joehub-theme", read);
    return () => window.removeEventListener("joehub-theme", read);
  }, []);

  const dark = pathname === "/finance" && (params.get("theme") === "dark" || storedDark);
  const composing = pathname.startsWith("/journal/compose");
  const tasksScreen = pathname.startsWith("/tasks");
  const groceryScreen = pathname.startsWith("/grocery");
  const outfitScreen = tasksScreen || groceryScreen;
  const navRef = useRef<HTMLElement>(null);

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
    <div data-theme={dark ? "dark" : "light"} className="min-h-screen bg-page text-ink">
      <a className="sr-only" href="#content">
        Skip to content
      </a>
      {/* The frames are 390px. Wider viewports keep that column centered. */}
      <main
        id="content"
        className={`mx-auto w-full min-w-0 pt-2 ${pathname.startsWith("/tasks") || pathname.startsWith("/grocery") ? "max-w-[1080px]" : "max-w-phone"} ${composing ? "pb-8" : "pb-[calc(var(--primary-nav-height,84px)+28px)]"}`}
      >
        {children}
      </main>
      {composing ? null : (
      <nav ref={navRef} aria-label="Primary" className="fixed inset-x-0 bottom-0 z-30 flex justify-center">
        <ul className="flex min-h-[84px] w-full min-w-0 max-w-phone items-stretch border-t border-tab-line bg-tab px-2 py-2 backdrop-blur">
          {tabs.map((tab) => {
            const current = tab.match(pathname);
            const tone = current ? activeText[tab.label] : "text-inactive";
            return (
              <li key={tab.href} className="flex min-w-0 flex-1 basis-0">
                <Link
                  href={tab.href}
                  aria-current={current ? "page" : undefined}
                  className={`flex min-h-11 w-full min-w-0 flex-col items-center justify-center gap-1 px-0.5 text-center leading-tight ${outfitScreen ? `${groceryScreen ? "grocery-type" : "tasks-type"} text-meta font-normal` : `text-ui-10.5 ${current ? "font-semibold" : "font-medium"}`} ${tone}`}
                >
                  <span className={`rounded-full px-3 py-1 ${current ? `${activePill[tab.label]} ${tone}` : ""}`}>
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
