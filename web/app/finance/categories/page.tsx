"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { FinanceTabs } from "../../../components/FinanceTabs";

type Cap = { slug: string; name: string; color: string; spentCents: number; status: string; percent: number | null };

function money(cents: number) {
  const abs = Math.abs(cents);
  const text = abs % 100 === 0 ? String(abs / 100) : (abs / 100).toFixed(2);
  return `$${text}`;
}

export default function CategoriesPage() {
  const [caps, setCaps] = useState<Cap[] | null>(null);
  const [suffix, setSuffix] = useState("");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const query = new URLSearchParams();
    if (params.get("asOf")) query.set("asOf", params.get("asOf") || "");
    if (params.get("week")) query.set("week", params.get("week") || "");
    void fetch(`/api/finance/overview?${query.toString()}`, { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) return;
        const body = (await response.json()) as { weekStart: string; caps: Cap[] };
        query.set("week", body.weekStart);
        setSuffix(query.toString());
        setCaps(body.caps);
      })
      .catch(() => setCaps([]));
  }, []);

  return (
    <main className="finance-type min-w-0 text-ink">
      <header className="px-5 pt-2">
        <p className="text-meta text-muted">joehub</p>
        <h1 className="text-title font-medium">Categories</h1>
      </header>
      <div className="mt-3">
        <FinanceTabs />
      </div>
      <ul className="mt-4 grid grid-cols-2 gap-3 px-4">
        {(caps || []).map((cap) => (
          <li key={cap.slug}>
            <Link href={`/finance/categories/${cap.slug}${suffix ? `?${suffix}` : ""}`} className="block min-h-11 rounded-2xl border border-line p-3">
              <span className="block h-2 w-2 rounded-full" style={{ background: cap.color }} />
              <span className="mt-2 block text-body font-medium">{cap.name}</span>
              <span className="mt-1 block text-meta text-muted">
                {money(cap.spentCents)}
                {cap.percent != null ? ` · ${cap.percent}%` : ""}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}
