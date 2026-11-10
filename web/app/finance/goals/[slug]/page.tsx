import Link from "next/link";
import { notFound } from "next/navigation";
import { Icon } from "../../../../components/Icon";
import { store } from "../../../../lib/store.mjs";

export const dynamic = "force-dynamic";

type Goal = { slug: string; name: string; value: number; amount: string; target: string; note: string };

export default async function GoalDetailPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const goals = (await store.financeGoals()) as Goal[];
  const goal = goals.find((item) => item.slug === slug);
  if (!goal) notFound();
  const radius = 61;
  const length = 2 * Math.PI * radius;
  const dash = `${(goal.value / 100) * length} ${length}`;
  return (
    <div className="finance-type min-w-0">
      <header className="flex items-center gap-3 px-5">
        <Link href="/finance/goals" className="grid h-11 w-11 place-items-center" aria-label="Back to goals">
          <Icon name="back" size={22} />
        </Link>
        <div>
          <p className="text-ui-13 text-muted">Finance · Goals</p>
          <h1 className="text-title font-medium">{goal.name}</h1>
        </div>
      </header>
      <section className="card mx-4 mt-4 p-4">
        <div className="flex justify-center">
          <div className="relative h-[132px] w-[132px]">
            <svg width="132" height="132" className="-rotate-90" aria-hidden>
              <circle cx="66" cy="66" r={radius} stroke="#E6E8E4" strokeWidth="10" fill="none" />
              <circle cx="66" cy="66" r={radius} stroke="#2E8B6A" strokeWidth="10" fill="none" strokeLinecap="round" strokeDasharray={dash} />
            </svg>
            <span className="absolute inset-0 grid place-items-center text-title font-medium">{goal.value}%</span>
          </div>
        </div>
        <p className="mt-4 text-center text-body font-medium">
          {goal.amount} <span className="font-normal text-muted">of {goal.target}</span>
        </p>
        <p className="mt-1 text-center text-body text-finance-primary">{goal.note}</p>
      </section>
    </div>
  );
}
