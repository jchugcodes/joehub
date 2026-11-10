import Link from "next/link";
import { notFound } from "next/navigation";
import { Icon } from "../../../../components/Icon";
import { goals } from "../../../../lib/design-fixtures";

export function generateStaticParams() {
  return goals.map((goal) => ({ slug: goal.slug }));
}

export default async function GoalDetailPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const goal = goals.find((item) => item.slug === slug);
  if (!goal) notFound();
  if (goal.slug !== "student-loan-payoff") {
    return (
      <div className="finance-type">
        <Link href="/finance/goals" className="inline-flex min-h-11 items-center gap-2 px-5 font-semibold">
          <Icon name="back" size={22} /> Back to goals
        </Link>
        <h1 className="px-5 text-title font-medium">{goal.name}</h1>
        <p className="mx-4 mt-4 text-body text-muted">No detail for this goal.</p>
      </div>
    );
  }
  return (
    <div className="finance-type min-w-0">
      <header className="flex items-center gap-3 px-5">
        <Link href="/finance/goals" className="grid h-11 w-11 place-items-center" aria-label="Back to goals">
          <Icon name="back" size={22} />
        </Link>
        <div>
          <p className="text-ui-13 text-muted">Finance · Goals</p>
          <h1 className="text-title font-medium">Student loan payoff</h1>
        </div>
      </header>
      <section className="card mx-4 mt-4 p-4">
        <div className="flex justify-center">
          <div className="relative h-[132px] w-[132px]">
            <svg width="132" height="132" className="-rotate-90" aria-hidden>
              <circle cx="66" cy="66" r="61" stroke="#E6E8E4" strokeWidth="10" fill="none" />
              <circle cx="66" cy="66" r="61" stroke="#2E8B6A" strokeWidth="10" fill="none" strokeLinecap="round" strokeDasharray="237.6 383.3" />
            </svg>
            <div className="absolute inset-0 grid place-items-center text-ui-15 font-bold">62%</div>
          </div>
        </div>
        <div className="mt-4 text-center">
          <h2 className="text-section font-medium">Student loan payoff</h2>
          <p className="mt-2 text-[1.75rem] font-bold tabular-nums">
            $12,400 <span className="text-ui-14 font-medium text-muted">/ $20,000</span>
          </p>
          <p className="mt-2 text-ui-13 text-muted">Illustrative payoff progress, not a live loan balance.</p>
        </div>
      </section>
      <section className="card mx-4 mt-3 p-4 text-ui-14">
        {[
          ["Status", "On track"],
          ["Monthly contribution", "$400"],
          ["Remaining toward target", "$7,600"],
          ["Illustrative forecast", "Mar 2028"],
        ].map(([label, value]) => (
          <div key={label} className="flex items-center justify-between gap-4 border-b border-line py-3">
            <span className="text-muted">{label}</span>
            <span className="text-right font-semibold">{value}</span>
          </div>
        ))}
      </section>
      <section className="card mx-4 mt-3 p-4">
        <h2 className="text-ui-16 font-bold">Recent progress · sample</h2>
        {[
          ["Nov 1 contribution", "+$400"],
          ["Oct 1 contribution", "+$400"],
        ].map(([label, value]) => (
          <div key={label} className="flex items-center justify-between gap-4 border-b border-line py-3 text-ui-14">
            <span className="text-muted">{label}</span>
            <span className="font-semibold">{value}</span>
          </div>
        ))}
      </section>
      <div className="px-4">
        <Link
          href="/finance/goals"
          className="mt-4 flex min-h-12 items-center justify-center rounded-xl border border-finance-primary px-4 text-ui-19 font-bold text-finance-primary"
        >
          Back to goals
        </Link>
      </div>
    </div>
  );
}
