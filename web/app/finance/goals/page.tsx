import Link from "next/link";
import { Ring } from "../../../components/Charts";
import { FinanceTabs } from "../../../components/FinanceTabs";
import { goals } from "../../../lib/design-fixtures";

const noteClass: Record<string, string> = {
  finance: "text-finance-primary",
  jobs: "text-jobs",
  gold: "text-finance-shopping",
};

export default function GoalsPage() {
  return (
    <div className="space-y-4 px-4">
      <p className="text-sm text-muted">Finance</p>
      <h1 className="text-ui-22 font-bold">Goals</h1>
      <FinanceTabs />
      <section className="card p-4">
        <div className="flex items-center gap-4">
          <Ring value={62} tone="finance" label="Combined goal progress, loan payoff leading at 62 percent" />
          <ul className="space-y-1 text-sm">
            <li className="text-finance-primary">Loan payoff 62%</li>
            <li className="text-jobs">Emergency 41%</li>
            <li className="text-finance-shopping">NYC move 28%</li>
          </ul>
        </div>
        <p className="mt-3 text-sm text-muted">$740/mo going to goals</p>
      </section>
      <ul className="space-y-3">
        {goals.map((goal) => (
          <li key={goal.name}>
            <Link href="/finance" className="flex items-center gap-3 card p-4">
              <Ring value={goal.value} tone={goal.tone} suffix="%" label={`${goal.name} ${goal.value} percent`} />
              <span className="min-w-0 flex-1">
                <span className="block font-semibold">{goal.name}</span>
                <span className="block text-sm text-muted">{goal.detail}</span>
                <span className="block text-sm">{goal.progress}</span>
                <span className={`block text-sm ${noteClass[goal.tone]}`}>{goal.note}</span>
              </span>
              <span aria-hidden className="text-muted">
                ›
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
