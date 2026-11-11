"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { FinanceTabs } from "./FinanceTabs";
import { CategoryMark } from "./CategoryMark";
import { Icon } from "./Icon";

type Row = { id: string; payee: string; amountCents: number; meta: string };
type Category = {
  slug: string;
  name: string;
  color: string;
  spentCents: number;
  capCents: number;
  percent: number | null;
  fill: number;
  tone: string;
  status: string;
  label: string;
  daysLeft: number | null;
  rows: Row[];
};

function money(cents: number, digits = true, signed = false) {
  const sign = cents < 0 ? "−" : signed && cents > 0 ? "+" : "";
  const abs = Math.abs(cents);
  const text = digits || abs % 100 !== 0 ? (abs / 100).toFixed(2) : String(Math.round(abs / 100));
  const [whole, frac] = text.split(".");
  return `${sign}$${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}${frac ? `.${frac}` : ""}`;
}

export function FinanceCategory({ slug, tabs = false }: { slug: string; tabs?: boolean }) {
  const [category, setCategory] = useState<Category | null>(null);
  const [message, setMessage] = useState("");
  const [backHref, setBackHref] = useState("/finance");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const asOf = params.get("asOf") || "";
    const week = params.get("week") || "";
    const back = new URLSearchParams();
    if (week) back.set("week", week);
    if (asOf) back.set("asOf", asOf);
    setBackHref(back.toString() ? `/finance?${back.toString()}` : "/finance");
    const query = new URLSearchParams();
    if (asOf) query.set("asOf", asOf);
    const suffix = query.toString() ? `?${query.toString()}` : "";
    const load = async () => {
      let start = week;
      if (!start) {
        const overview = await fetch(`/api/finance/overview${suffix}`, { cache: "no-store" });
        if (!overview.ok) throw new Error("overview");
        start = ((await overview.json()) as { weekStart: string }).weekStart;
      }
      const response = await fetch(`/api/finance/weeks/${start}/categories/${slug}${suffix}`, { cache: "no-store" });
      if (!response.ok) throw new Error("category");
      setCategory((await response.json()) as Category);
    };
    void load().catch(() => setMessage("Finance is unavailable."));
  }, [slug]);

  const tone = category?.tone === "over" ? "#E07A5F" : category?.color;
  const summary =
    category && category.percent != null
      ? `${category.percent}% used · ${category.status}${category.daysLeft != null ? ` · ${category.daysLeft} days left` : ""}`
      : category?.status || "";

  return (
    <main className="finance-type min-w-0 text-ink" data-ready={category ? "true" : undefined}>
      {tabs ? <FinanceTabs /> : null}
      <div className="flex items-center gap-2 px-3 pt-2">
        <Link href={backHref} aria-label="Back to overview" className="grid h-11 w-11 place-items-center">
          <Icon name="back" size={20} />
        </Link>
        <h1 className="text-title font-medium">{category?.name || "Category"}</h1>
      </div>
      {!category ? <p className="px-5 py-8 text-body text-muted">{message || "Loading…"}</p> : null}
      {category ? (
        <>
          <div className="px-5">
            <p className="text-title font-medium">
              {money(category.spentCents)} <span className="text-body font-normal text-muted">of {money(category.capCents, false)} this week</span>
            </p>
            <p className="mt-1 text-body font-medium" style={{ color: tone }}>
              {summary}
            </p>
          </div>
          {category.percent != null ? (
            <div className="mx-4 mt-3 rounded-[20px] border border-line p-4">
              <div className="h-2 overflow-hidden rounded-full bg-line">
                <div className="h-full rounded-full" style={{ width: `${category.fill}%`, background: category.tone === "over" ? "#E07A5F" : category.color }} />
              </div>
            </div>
          ) : null}
          <div className="mt-5 flex items-baseline justify-between px-5">
            <h2 className="text-section font-medium">This week’s transactions</h2>
            <p className="text-meta text-muted">
              {category.rows.length} · sum {money(category.spentCents)}
            </p>
          </div>
          <ul className="px-5">
            {category.rows.map((row) => (
              <li key={row.id} className="flex min-h-11 items-center gap-3 border-b border-line py-2.5">
                <CategoryMark category={category.slug} />
                <span className="min-w-0 flex-1">
                  <span className="block text-body font-medium">{row.payee}</span>
                  <span className="block text-meta text-muted">{row.meta}</span>
                </span>
                <span className={`text-body font-medium ${row.amountCents > 0 ? "text-finance-primary" : ""}`}>{money(row.amountCents, true, true)}</span>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </main>
  );
}
