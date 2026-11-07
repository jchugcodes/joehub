"use client";

import Link from "next/link";
import { useState } from "react";
import { FinanceTabs } from "../../../components/FinanceTabs";
import { Icon } from "../../../components/Icon";
import { goals } from "../../../lib/design-fixtures";

const noteClass: Record<string, string> = {
  finance: "text-finance-primary",
  jobs: "text-jobs",
  gold: "text-finance-shopping",
  subscriptions: "text-finance-subscriptions",
};

export default function GoalsPage() {
  const [demo, setDemo] = useState("");
  return (
    <div>
      <p className="px-5 text-ui-13 mut">Finance</p>
      <h1 className="mb-3 px-5 text-ui-22 font-bold">Goals</h1>
      <FinanceTabs hint />
      <section className="mx-4 mt-4">
        <div className="card flex items-center gap-5 p-5">
          <div className="relative h-[120px] w-[120px]" aria-hidden>
            <svg width="120" height="120" className="-rotate-90">
              <circle cx="60" cy="60" r="55" stroke="var(--line)" strokeWidth="10" fill="none" />
              <circle cx="60" cy="60" r="55" stroke="#2E8B6A" strokeWidth="10" fill="none" strokeLinecap="round" strokeDasharray="214.3 345.6" />
            </svg>
            <svg width="92" height="92" className="absolute left-[14px] top-[14px] -rotate-90">
              <circle cx="46" cy="46" r="41" stroke="var(--line)" strokeWidth="10" fill="none" />
              <circle cx="46" cy="46" r="41" stroke="#3A86C8" strokeWidth="10" fill="none" strokeLinecap="round" strokeDasharray="105.6 257.6" />
            </svg>
            <svg width="64" height="64" className="absolute left-[28px] top-[28px] -rotate-90">
              <circle cx="32" cy="32" r="27" stroke="var(--line)" strokeWidth="10" fill="none" />
              <circle cx="32" cy="32" r="27" stroke="#E9B949" strokeWidth="10" fill="none" strokeLinecap="round" strokeDasharray="47.5 169.6" />
            </svg>
          </div>
          <ul className="space-y-2 text-ui-13">
            <li className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-full bg-finance-primary" />
              Loan payoff 62%
            </li>
            <li className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-full bg-jobs" />
              Emergency 41%
            </li>
            <li className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-full bg-finance-shopping" />
              NYC move 28%
            </li>
            <li className="pt-1 text-ui-12 mut">$740/mo going to goals</li>
          </ul>
        </div>
      </section>
      <ul className="mx-4 mt-3 space-y-2.5">
        {goals.map((goal) => (
          <li key={goal.name} className="card flex items-center gap-4 p-4">
            <div className="relative h-[78px] w-[78px]">
              <svg width="78" height="78" className="-rotate-90" role="img" aria-label={`${goal.name} ${goal.value} percent`}>
                <circle cx="39" cy="39" r="34.5" stroke="var(--line)" strokeWidth="9" fill="none" />
                <circle
                  cx="39"
                  cy="39"
                  r="34.5"
                  stroke={goal.color}
                  strokeWidth="9"
                  fill="none"
                  strokeLinecap="round"
                  strokeDasharray={goal.dash}
                />
              </svg>
              <span className="absolute inset-0 grid place-items-center text-ui-15 font-bold">{goal.value}%</span>
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-ui-16 font-bold">{goal.name}</p>
              <p className="text-ui-12.5 mut">{goal.detail}</p>
              <p className="mt-1.5 text-ui-15 font-semibold tnum">
                {goal.amount} <span className="font-medium mut">{goal.target}</span>
              </p>
              <p className={`mt-0.5 text-ui-12 ${noteClass[goal.tone]}`}>{goal.note}</p>
            </div>
            <Link href={`/finance/goals/${goal.slug}`} aria-label={`Open ${goal.name}`} className="shrink-0 text-inactive">
              <Icon name="chevron" size={18} />
            </Link>
          </li>
        ))}
      </ul>
      <div className="mx-4 mt-3">
        <button
          type="button"
          className="flex w-full items-center justify-center gap-2 rounded-[20px] border-2 border-dashed border-subtle-border p-4 font-semibold text-finance-primary"
          onClick={() => setDemo("Demo only. Nothing was saved.")}
        >
          <Icon name="plus" size={18} />
          New goal
        </button>
      </div>
      {demo ? (
        <p role="status" className="mt-2 text-center text-ui-12 mut">
          {demo}
        </p>
      ) : null}
      <p className="mb-28 mt-3 text-center text-ui-9.5 text-inactive">EXAMPLE DATA · design mockup · not real accounts</p>
    </div>
  );
}
