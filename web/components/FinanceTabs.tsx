"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon } from "./Icon";

const links = [
  { href: "/finance", label: "Overview" },
  { href: "/finance/dining-out", label: "Categories" },
  { href: "/finance/goals", label: "Goals" },
  { href: "/finance/accounts", label: "Accounts" },
];

export function FinanceTabs({ hint = false }: { hint?: boolean }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Finance sections" className="flex items-end gap-6 border-b border-line px-5">
      {links.map((link) => {
        const current = pathname === link.href;
        return (
          <Link
            key={link.href}
            href={link.href}
            aria-current={current ? "page" : undefined}
            className={`shrink-0 border-b-[2.5px] pb-2.5 text-ui-15 ${
              current ? "border-finance-primary font-bold text-ink" : "border-transparent font-medium text-muted"
            }`}
          >
            {link.label}
          </Link>
        );
      })}
      {hint ? (
        <span className="mb-0 ml-auto flex items-center gap-1 pb-2.5 text-ui-11 text-muted">
          swipe <Icon name="swipe" size={14} />
        </span>
      ) : null}
    </nav>
  );
}
