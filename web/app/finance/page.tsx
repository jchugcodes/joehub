"use client";

import Link from "next/link";
import { useState } from "react";
import { Sparkline } from "../../components/Charts";
import { Icon } from "../../components/Icon";
import { finance } from "../../lib/design-fixtures";

const capTone: Record<string, { bar: string; tint: string; text: string }> = {
  dining: { bar: "bg-finance-dining", tint: "bg-finance-dining/[0.12]", text: "text-finance-dining" },
  groceries: { bar: "bg-finance-primary", tint: "bg-finance-primary/[0.12]", text: "text-finance-primary" },
  transport: { bar: "bg-finance-transport", tint: "bg-finance-transport/[0.12]", text: "text-finance-transport" },
  subscriptions: { bar: "bg-finance-warning", tint: "bg-finance-subscriptions/[0.12]", text: "text-finance-subscriptions" },
  shopping: { bar: "bg-finance-shopping", tint: "bg-finance-shopping/[0.12]", text: "text-finance-shopping" },
  utilities: { bar: "bg-finance-utilities", tint: "bg-finance-utilities/[0.12]", text: "text-finance-utilities" },
};

export default function FinancePage() {
  const [range, setRange] = useState("YTD");
  return (
    <div>
      <header className="flex items-center justify-between px-5 pt-2">
        <div>
          <p className="text-ui-13 mut">Finance</p>
          <h1 className="text-ui-22 font-bold">Net worth</h1>
        </div>
        <div className="flex gap-2">
          <button type="button" className="card grid h-10 w-10 place-items-center rounded-full" aria-label="Search finance">
            <Icon name="search" size={19} />
          </button>
          <button type="button" className="card grid h-10 w-10 place-items-center rounded-full" aria-label="Finance alerts">
            <Icon name="bell" size={19} />
          </button>
        </div>
      </header>
      <div className="mt-2 px-5">
        <p className="text-ui-40 font-extrabold tracking-tight tnum">
          {finance.net}
          <span className="text-ui-24 font-extrabold">{finance.cents}</span>
        </p>
        <p className="flex items-center gap-1 text-ui-14 font-semibold text-finance-primary">
          <Icon name="trend" size={16} />
          {finance.delta} <span className="font-medium mut">YTD</span>
        </p>
      </div>
      <div className="mt-2">
        <Sparkline />
      </div>
      <div className="flex min-w-0 items-center justify-between gap-2 px-5">
      <fieldset className="flex min-w-0 flex-1 gap-1 overflow-x-auto">
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
              className={`inline-block rounded-full px-3.5 py-1.5 text-ui-13 font-semibold ${
                range === item ? "bg-finance-primary text-white" : "mut"
              }`}
            >
              {item}
            </span>
          </label>
        ))}
      </fieldset>
      <Icon name="chevron" size={18} />
      </div>
      <section className="card mx-4 mt-4 p-4" aria-labelledby="spent-heading">
        <div className="flex justify-between text-ui-13">
          <h2 id="spent-heading" className="font-semibold">
            Spent this month
          </h2>
          <p className="mut">{finance.period}</p>
        </div>
        <p className="mt-1 text-ui-24 font-bold tnum">
          {finance.spent} <span className="text-ui-14 font-medium mut">{finance.plan}</span>
        </p>
        <div
          className="relative mt-2.5 h-2.5 rounded-full bg-line"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={finance.used}
          aria-label="Percent of the monthly plan used"
        >
          <div className="h-full rounded-full bg-finance-dining" style={{ width: `${finance.used}%` }} />
          <div className="absolute -top-1 h-[18px] w-0.5 bg-ink" style={{ left: "20%" }} />
        </div>
        <div className="mt-1.5 flex justify-between text-ui-11.5 mut">
          <span>{finance.used}% used</span>
          <span>| {finance.pace}</span>
        </div>
      </section>
      <ul className="mx-4 mt-3 grid grid-cols-3 gap-2.5">
        {finance.stats.map((stat) => (
          <li key={stat.label} className="card p-3">
            <p className="text-ui-11.5 mut">{stat.label}</p>
            <p
              className={`text-ui-17 font-bold tnum ${
                stat.tone === "spent-text" ? "text-finance-dining" : stat.tone === "jobs-text" ? "text-jobs" : "text-finance-primary"
              }`}
            >
              {stat.value}
            </p>
          </li>
        ))}
      </ul>
      <div className="mt-5 flex items-baseline justify-between px-5">
        <h2 className="text-ui-17 font-bold">Weekly caps</h2>
        <Link href="/finance/caps" className="shrink-0 text-ui-13 font-semibold text-finance-primary">
          Edit caps
        </Link>
      </div>
      <ul className="mx-4 mt-2.5 grid grid-cols-2 gap-2.5">
        {finance.caps.map((cap) => {
          const tone = capTone[cap.tone];
          return (
            <li key={cap.name}>
              {cap.href ? (
              <a href={cap.href} className="block card p-3.5">
                <span className="flex items-start justify-between">
                  <span className={`grid h-9 w-9 place-items-center rounded-xl ${tone.tint} ${tone.text}`}>
                    <Icon name={cap.icon} size={18} />
                  </span>
                  <span className="text-ui-11 mut">{cap.cap}</span>
                </span>
                <p className="mt-2.5 text-ui-13 mut">{cap.name}</p>
                <p className="text-ui-19 font-bold tnum">
                  {cap.left}
                  <span className="text-ui-12 font-medium mut"> {cap.rest}</span>
                </p>
                <div className="mt-2 h-1.5 rounded-full bg-line">
                  <div className={`h-full rounded-full ${tone.bar}`} style={{ width: `${cap.width}%` }} />
                </div>
              </a>
              ) : (
              <div className="card p-3.5">
                <span className="flex items-start justify-between">
                  <span className={`grid h-9 w-9 place-items-center rounded-xl ${tone.tint} ${tone.text}`}>
                    <Icon name={cap.icon} size={18} />
                  </span>
                  <span className="text-ui-11 mut">{cap.cap}</span>
                </span>
                <p className="mt-2.5 text-ui-13 mut">{cap.name}</p>
                <p className="text-ui-19 font-bold tnum">
                  {cap.left}
                  <span className="text-ui-12 font-medium mut"> {cap.rest}</span>
                </p>
                <div className="mt-2 h-1.5 rounded-full bg-line">
                  <div className={`h-full rounded-full ${tone.bar}`} style={{ width: `${cap.width}%` }} />
                </div>
              </div>
              )}
            </li>
          );
        })}
      </ul>
      <h2 className="mt-5 px-5 text-ui-17 font-bold">Recent</h2>
      <ul className="px-5">
        {finance.recent.map((row) => (
          <li key={row.name} className="flex items-center gap-3 py-2.5">
            <span className={`grid h-10 w-10 place-items-center rounded-full ${row.tint}`}>
              <Icon name={row.icon} size={19} />
            </span>
            <div className="flex-1">
              <p className="text-ui-14.5 font-semibold">{row.name}</p>
              <p className="text-ui-12 mut">{row.meta}</p>
            </div>
            <p className={`ml-auto text-ui-14.5 font-semibold tnum ${row.positive ? "text-finance-primary" : ""}`}>{row.amount}</p>
          </li>
        ))}
      </ul>
      <p className="mb-28 mt-3 text-center text-ui-9.5 text-inactive">EXAMPLE DATA · design mockup · not real accounts</p>
    </div>
  );
}
