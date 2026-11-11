import Link from "next/link";
import { FinanceTabs } from "../../../components/FinanceTabs";
import { Icon } from "../../../components/Icon";
import { store } from "../../../lib/store.mjs";

export const dynamic = "force-dynamic";

type Goal = { slug: string; name: string; value: number; amount: string; target: string; note: string };

const colors = ["#2E8B6A", "#3A86C8", "#E9B949", "#7C6BB0"];

function ring(value: number, radius: number) {
  const length = 2 * Math.PI * radius;
  return `${(Math.max(0, Math.min(100, value)) / 100) * length} ${length}`;
}

export default async function GoalsPage() {
  const goals = (await store.financeGoals()) as Goal[];
  return (
    <div className="finance-type">
      <p className="px-5 text-meta text-muted">joehub</p>
      <h1 className="mb-3 px-5 text-title font-medium">Goals</h1>
      <FinanceTabs />
      <section className="mx-4 mt-4">
        <div className="card flex items-center gap-5 p-5">
          <div className="relative h-[120px] w-[120px]" aria-hidden>
            {goals.slice(0, 3).map((goal, index) => {
              const size = 120 - index * 28;
              const radius = size / 2 - 5;
              return (
                <svg key={goal.slug} width={size} height={size} className="absolute -rotate-90" style={{ left: index * 14, top: index * 14 }}>
                  <circle cx={size / 2} cy={size / 2} r={radius} stroke="var(--line)" strokeWidth="10" fill="none" />
                  <circle cx={size / 2} cy={size / 2} r={radius} stroke={colors[index]} strokeWidth="10" fill="none" strokeLinecap="round" strokeDasharray={ring(goal.value, radius)} />
                </svg>
              );
            })}
          </div>
          <ul className="space-y-2 text-ui-13">
            {goals.slice(0, 3).map((goal, index) => (
              <li key={goal.slug} className="flex items-center gap-2">
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: colors[index] }} />
                {goal.name} {goal.value}%
              </li>
            ))}
          </ul>
        </div>
      </section>
      <ul className="mx-4 mt-3 space-y-2.5">
        {goals.map((goal, index) => (
          <li key={goal.slug} className="card flex items-center gap-4 p-4">
            <div className="relative h-[78px] w-[78px]">
              <svg width="78" height="78" className="-rotate-90" role="img" aria-label={`${goal.name} ${goal.value} percent`}>
                <circle cx="39" cy="39" r="34.5" stroke="var(--line)" strokeWidth="9" fill="none" />
                <circle cx="39" cy="39" r="34.5" stroke={colors[index % colors.length]} strokeWidth="9" fill="none" strokeLinecap="round" strokeDasharray={ring(goal.value, 34.5)} />
              </svg>
              <span className="absolute inset-0 grid place-items-center text-ui-15 font-bold">{goal.value}%</span>
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-ui-16 font-bold">{goal.name}</p>
              <p className="mt-1.5 text-ui-15 font-semibold tnum">
                {goal.amount} <span className="font-medium mut">{goal.target}</span>
              </p>
              <p className="mt-0.5 text-ui-12 text-finance-primary">{goal.note}</p>
            </div>
            <Link href={`/finance/goals/${goal.slug}`} aria-label={`Open ${goal.name}`} className="shrink-0 text-inactive">
              <Icon name="chevron" size={18} />
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
