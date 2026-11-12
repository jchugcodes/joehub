"use client";

import { useState } from "react";

const PERIODS = ["Week", "Month", "Quarter", "Year"] as const;
type Period = (typeof PERIODS)[number];

export type FlowRow = {
  key: string;
  label: string;
  title: string;
  incomeCents: number;
  spentCents: number;
  over: boolean;
  current: boolean;
};

export type Flow = Record<Period, FlowRow[]>;

const BAR_H = 64;

function whole(cents: number) {
  const abs = Math.abs(Math.round(cents));
  const show = abs % 100 !== 0;
  const text = show ? (abs / 100).toFixed(2) : String(Math.round(abs / 100));
  const [dollars, frac] = text.split(".");
  return `$${dollars.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}${frac ? `.${frac}` : ""}`;
}

function barHeight(cents: number, scale: number) {
  return Math.max(4, Math.round((Math.max(0, cents) / scale) * BAR_H));
}

function Bars({ incomeCents, spentCents, scale, over }: { incomeCents: number; spentCents: number; scale: number; over: boolean }) {
  const income = barHeight(incomeCents, scale);
  const spent = barHeight(spentCents, scale);
  return (
    <svg width="25" height={BAR_H} viewBox={`0 0 25 ${BAR_H}`} aria-hidden="true">
      <rect x="0" y={BAR_H - income} width="10" height={income} rx="5" fill="var(--chart-positive)" />
      <rect x="15" y={BAR_H - spent} width="10" height={spent} rx="5" fill={over ? "url(#dotCoral)" : "url(#dotInk)"} />
    </svg>
  );
}

export function IncomeSpent({ flow }: { flow: Flow }) {
  const [period, setPeriod] = useState<Period>("Month");
  const [picked, setPicked] = useState("");
  const rows = flow[period] || [];
  const selected = rows.find((row) => row.key === picked) || rows.find((row) => row.current) || rows[rows.length - 1];
  const scale = Math.max(1, ...rows.map((row) => Math.max(row.incomeCents, row.spentCents)));
  const netCents = selected ? Math.abs(selected.incomeCents - selected.spentCents) : 0;

  return (
    <section className="card mt-4 p-4" data-flow="true" data-period={period}>
      <h2 className="text-section font-medium">Income vs spent</h2>
      <div className="mt-2 flex gap-1">
        {PERIODS.map((item) => (
          <button
            key={item}
            type="button"
            aria-pressed={period === item}
            className={`min-h-11 flex-1 rounded-full text-meta ${period === item ? "bg-finance-primary text-page dark:bg-ink dark:text-page" : "text-muted"}`}
            onClick={() => {
              setPeriod(item);
              setPicked("");
            }}
          >
            {item}
          </button>
        ))}
      </div>
      {selected ? (
        <div className="mt-2">
          <p className="text-body font-medium">{selected.title}</p>
          <p className="mt-1 flex gap-4 text-meta text-muted">
            <span>
              Income <span className="font-medium text-ink">{whole(selected.incomeCents)}</span>
            </span>
            <span>
              Spent <span className="font-medium text-ink">{whole(selected.spentCents)}</span>
            </span>
          </p>
          <p
            className={`mt-1 text-section font-medium ${selected.over ? "text-[#E07A5F]" : "text-finance-primary"}`}
            data-flow-net="true"
            data-over={selected.over ? "true" : "false"}
            data-income={selected.incomeCents}
            data-spent={selected.spentCents}
          >
            {selected.over ? `${whole(netCents)} over` : `+${whole(netCents)}`}
          </p>
        </div>
      ) : null}
      <svg width="0" height="0" className="absolute" aria-hidden="true">
        <defs>
          <pattern id="dotInk" patternUnits="userSpaceOnUse" width="4" height="4">
            <circle cx="1" cy="1" r="0.85" fill="var(--spend-dot)" />
            <circle cx="3" cy="3" r="0.85" fill="var(--spend-dot)" />
          </pattern>
          <pattern id="dotCoral" patternUnits="userSpaceOnUse" width="4" height="4">
            <rect width="4" height="4" fill="var(--spend-wash)" />
            <circle cx="1" cy="1" r="0.85" fill="#E07A5F" />
            <circle cx="3" cy="3" r="0.85" fill="#E07A5F" />
          </pattern>
        </defs>
      </svg>
      <div className="mt-3 flex gap-1.5">
        {rows.map((row) => {
          const on = selected?.key === row.key;
          return (
            <button
              key={row.key}
              type="button"
              aria-pressed={on}
              aria-label={row.label}
              data-flow-card={row.key}
              data-over={row.over ? "true" : "false"}
              className={`flex min-h-11 min-w-0 flex-1 flex-col items-center justify-end gap-1 rounded-xl border px-0.5 pb-2 pt-2.5 ${on ? "border-ink shadow-[inset_0_0_0_1px_var(--ink)]" : "border-line"}`}
              onClick={() => setPicked(row.key)}
            >
              <Bars incomeCents={row.incomeCents} spentCents={row.spentCents} scale={scale} over={row.over} />
              <span className={`text-center text-meta leading-tight ${on ? "font-medium text-ink" : "text-muted"}`}>{row.label}</span>
            </button>
          );
        })}
      </div>
      <div className="mt-2 flex items-center gap-4 text-meta text-muted">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm bg-finance-primary" />
          Income
        </span>
        <span className="inline-flex items-center gap-1.5">
          <svg width="10" height="10" className="overflow-hidden rounded-[2px]" aria-hidden="true">
            <rect width="10" height="10" fill="var(--spend-dot)" />
          </svg>
          Total spend
        </span>
      </div>
    </section>
  );
}
