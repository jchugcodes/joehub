"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { Icon } from "./Icon";

const tabs = [
  { href: "/", label: "Home", icon: "home", match: (path: string) => path === "/" },
  { href: "/finance", label: "Finance", icon: "finance", match: (path: string) => path.startsWith("/finance") },
  { href: "/jobs", label: "Jobs", icon: "jobs", match: (path: string) => path.startsWith("/jobs") },
  { href: "/journal", label: "Journal", icon: "journal", match: (path: string) => path.startsWith("/journal") },
  { href: "/more", label: "More", icon: "more", match: (path: string) => path.startsWith("/more") },
];

const activeTone: Record<string, string> = {
  Home: "bg-ink/[0.12] text-ink",
  Finance: "bg-finance-primary/[0.12] text-finance-primary",
  Jobs: "bg-jobs/[0.12] text-jobs",
  Journal: "bg-journal/[0.12] text-journal",
  More: "bg-ink/[0.12] text-ink",
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

  return (
    <div data-theme={dark ? "dark" : "light"} className="min-h-screen bg-page text-ink">
      <a className="sr-only" href="#content">
        Skip to content
      </a>
      <div className="mx-auto flex min-h-screen w-full max-w-6xl lg:gap-10 lg:px-8">
        {/* GAP: a side nav is not in the frames. It replaces the bottom bar from 1024px up. */}
        <nav aria-label="Primary" className="hidden w-48 shrink-0 flex-col gap-1 py-8 lg:flex">
          {tabs.map((tab) => {
            const current = tab.match(pathname);
            return (
              <Link
                key={tab.href}
                href={tab.href}
                aria-current={current ? "page" : undefined}
                className={`flex items-center gap-3 rounded-full px-3 py-2 text-sm font-medium ${
                  current ? activeTone[tab.label] : "text-muted"
                }`}
              >
                <Icon name={tab.icon} />
                {tab.label}
              </Link>
            );
          })}
        </nav>
        <div className="min-w-0 flex-1">
          {/* GAP: phone width matches the 390 frame. 768px widens the column. */}
          <main id="content" className="mx-auto w-full max-w-phone px-0 pb-28 pt-2 md:max-w-3xl lg:pb-16">
            {children}
          </main>
        </div>
      </div>
      <nav
        aria-label="Primary"
        className="fixed inset-x-0 bottom-0 z-30 h-[84px] border-t border-tab-line bg-tab backdrop-blur lg:hidden"
      >
        <ul className="mx-auto flex max-w-phone justify-around px-2 pt-2 md:max-w-3xl">
          {tabs.map((tab) => {
            const current = tab.match(pathname);
            return (
              <li key={tab.href}>
                <Link
                  href={tab.href}
                  aria-current={current ? "page" : undefined}
                  className={`flex w-14 flex-col items-center gap-1 text-ui-10.5 ${
                    current ? "font-semibold" : "font-medium text-inactive"
                  }`}
                >
                  <span className={`rounded-full px-3 py-1 ${current ? activeTone[tab.label] : "text-inactive"}`}>
                    <Icon name={tab.icon} />
                  </span>
                  <span className={current ? activeTone[tab.label].split(" ").find((c) => c.startsWith("text-")) : ""}>
                    {tab.label}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </div>
  );
}
