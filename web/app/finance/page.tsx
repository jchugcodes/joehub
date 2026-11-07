"use client";

import { useState } from "react";
import { Sparkline } from "../../components/Charts";
import { Icon } from "../../components/Icon";
import { finance } from "../../lib/design-fixtures";

export default function FinancePage() {
  const [range, setRange] = useState("YTD");
  return (
    <div className="space-y-4">
      <header className="flex items-start justify-between">
        <div>
          <p className="text-sm text-muted">Finance</p>
          <h1 className="text-3xl font-semibold">Net worth</h1>
        </div>
        <div className="flex gap-2">
          <button type="button" className="grid h-10 w-10 place-items-center rounded-full bg-card" aria-label="Search finance">
            <Icon name="search" />
          </button>
          <button type="button" className="grid h-10 w-10 place-items-center rounded-full bg-card" aria-label="Finance alerts">
            <Icon name="bell" />
          </button>
        </div>
      </header>
      <p className="text-4xl font-semibold tracking-tight">{finance.net}</p>
      <p className="text-sm font-medium text-finance-text">{finance.delta}</p>
      <div className="-mx-4 bg-finance-soft px-4 md:mx-0 md:rounded-2xl">
        <Sparkline />
      </div>
      <fieldset className="flex gap-2">
        <legend className="sr-only">Chart range</legend>
        {finance.ranges.map((item) => (
          <label key={item} className="cursor-pointer">
            <input
              className="sr-only"
              type="radio"
              name="chart-range"
              value={item}
              checked={range === item}
              onChange={() => setRange(item)}
            />
            <span
              className={`inline-block rounded-full px-3 py-1 text-sm ${
                range === item ? "bg-finance-text text-white" : "text-muted"
              }`}
            >
              {item}
            </span>
          </label>
        ))}
      </fieldset>
      <section className="rounded-2xl bg-card p-4 shadow-sm" aria-labelledby="spent-heading">
        <div className="flex justify-between text-sm">
          <h2 id="spent-heading" className="font-medium">
            Spent this month
          </h2>
          <p className="text-muted">{finance.period}</p>
        </div>
        <p className="mt-2 text-2xl font-semibold">
          {finance.spent} <span className="text-base font-normal text-muted">{finance.plan}</span>
        </p>
        <div
          className="mt-3 h-2 rounded-full bg-line"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={finance.used}
          aria-label="Percent of the monthly plan used"
        >
          <div className="h-full rounded-full bg-spent" style={{ width: `${finance.used}%` }} />
        </div>
        <div className="mt-2 flex justify-between text-xs text-muted">
          <span>{finance.used}% used</span>
          <span>{finance.pace}</span>
        </div>
      </section>
      <ul className="grid grid-cols-3 gap-2">
        {finance.stats.map((stat) => (
          <li key={stat.label} className="rounded-2xl bg-card p-3 shadow-sm">
            <p className="text-xs text-muted">{stat.label}</p>
            <p
              className={`text-lg font-semibold ${
                stat.tone === "spent-text" ? "text-spent-text" : stat.tone === "jobs-text" ? "text-jobs-text" : "text-finance-text"
              }`}
            >
              {stat.value}
            </p>
          </li>
        ))}
      </ul>
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Weekly caps</h2>
        <a href="/finance/dining-out" className="text-sm font-semibold text-finance-text">
          Edit caps
        </a>
      </div>
      <ul className="grid grid-cols-2 gap-3">
        {finance.caps.map((cap) => (
          <li key={cap.name}>
            <a href="/finance/dining-out" className="block rounded-2xl bg-card p-3 shadow-sm">
              <p className="text-right text-xs text-muted">{cap.cap}</p>
              <p className="mt-3 font-medium">{cap.name}</p>
              <p className="text-xl font-semibold">
                {cap.left} <span className="text-sm font-normal text-muted">left {cap.spent}</span>
              </p>
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}
