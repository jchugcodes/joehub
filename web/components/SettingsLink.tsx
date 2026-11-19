"use client";

import Link from "next/link";
import { Icon } from "./Icon";
import { useProductionNav } from "./LivePages";

export function SettingsLink() {
  const production = useProductionNav();
  if (!production) return null;
  return (
    <Link href="/more/settings" aria-label="Settings" className="inline-flex h-11 w-11 shrink-0 items-center justify-center text-muted">
      <Icon name="gear" size={22} />
    </Link>
  );
}
