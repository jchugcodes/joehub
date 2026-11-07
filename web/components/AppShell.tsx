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

  return (
    <div data-theme={dark ? "dark" : "light"} className="min-h-screen bg-page text-ink">
      <a className="sr-only" href="#content">
        Skip to content
      </a>
      {/* The frames are 390px. Wider viewports keep that column centered. */}
      <main id="content" className="mx-auto w-full max-w-phone pb-28 pt-2">
        {children}
      </main>
      <nav aria-label="Primary" className="fixed inset-x-0 bottom-0 z-30 flex justify-center">
        <ul className="flex h-[84px] w-full max-w-phone justify-around border-t border-tab-line bg-tab px-2 pt-2 backdrop-blur">
          {tabs.map((tab) => {
            const current = tab.match(pathname);
            const tone = current ? activeText[tab.label] : "text-inactive";
            return (
              <li key={tab.href}>
                <Link
                  href={tab.href}
                  aria-current={current ? "page" : undefined}
                  className={`flex w-14 flex-col items-center gap-1 text-ui-10.5 ${current ? "font-semibold" : "font-medium"} ${tone}`}
                >
                  <span className={`rounded-full px-3 py-1 ${current ? `${activePill[tab.label]} ${tone}` : ""}`}>
                    <Icon name={tab.icon} size={22} strokeWidth={current ? 2.2 : 1.8} />
                  </span>
                  {tab.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </div>
  );
}
