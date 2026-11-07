"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const links = [
  { href: "/finance", label: "Overview" },
  { href: "/finance/dining-out", label: "Categories" },
  { href: "/finance/goals", label: "Goals" },
  { href: "/finance/accounts", label: "Accounts" },
];

export function FinanceTabs() {
  const pathname = usePathname();
  return (
    <nav aria-label="Finance sections" className="flex gap-4 overflow-x-auto border-b border-line text-sm">
      {links.map((link) => {
        const current = pathname === link.href;
        return (
          <Link
            key={link.href}
            href={link.href}
            aria-current={current ? "page" : undefined}
            className={`shrink-0 border-b-2 pb-2 ${
              current ? "border-finance-text font-semibold text-ink" : "border-transparent text-muted"
            }`}
          >
            {link.label}
          </Link>
        );
      })}
    </nav>
  );
}
