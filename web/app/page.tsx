import Link from "next/link";
import { Ring, Sparkline } from "../components/Charts";
import { home } from "../lib/design-fixtures";
import { detroitHeading } from "../lib/detroit-date.mjs";
import { money } from "../lib/finance.mjs";
import { store } from "../lib/store.mjs";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const now = Date.now();
  let overview = null;
  try {
    const result = await store.financeOverview(now);
    if (result && result.status === 200) overview = result.body;
  } catch {
    overview = null;
  }
  const dining = overview?.caps?.find((cap) => cap.slug === "dining-out") || null;
  const spentWidth = overview ? Math.min(100, Math.max(0, overview.month.percent)) : 0;
  return (
    <div>
      <header className="flex items-center justify-between px-5 pt-2">
        <div>
          <p className="text-ui-13 mut">{detroitHeading(now)}</p>
          <h1 className="text-ui-24 font-bold">{home.greeting}</h1>
        </div>
        <span className="grid h-10 w-10 place-items-center rounded-full bg-ink text-ui-15 font-bold text-white" aria-hidden>
          {home.initial}
        </span>
      </header>

      <div className="mt-4 space-y-2.5 px-4">
      <Link href="/finance" className="block card p-4">
        <div className="flex items-center justify-between text-ui-13 font-bold text-finance-primary">
          <span>FINANCE</span>
          <span aria-hidden className="text-inactive">›</span>
        </div>
        {overview ? (
          <>
            <div className="mt-1 flex items-end justify-between">
              <div>
                <p className="text-ui-28 font-extrabold tnum">{money(overview.netWorthCents)}</p>
                {overview.chart?.caption ? <p className="text-ui-13 font-semibold text-finance-primary">{overview.chart.caption}</p> : null}
              </div>
              <Sparkline compact />
            </div>
            <div
              className="mt-3 h-2 overflow-hidden rounded-full bg-line"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={spentWidth}
              aria-label="Spent against the monthly plan"
            >
              <div className="h-full rounded-full bg-finance-dining" style={{ width: `${spentWidth}%` }} />
            </div>
            <p className="mt-1 text-ui-12 mut">
              {money(overview.month.spentCents, false)} of {money(overview.month.planCents, false)} spent
              {dining ? ` · ${dining.name} ${dining.status} this week` : ""}
            </p>
          </>
        ) : null}
      </Link>

      <Link href="/jobs" className="block card p-4">
        <div className="flex items-center justify-between text-ui-13 font-bold text-jobs">
          <span>JOBS</span>
          <span aria-hidden className="text-inactive">›</span>
        </div>
        <ul className="mt-2 flex gap-5">
          {home.jobs.map((item) => (
            <li key={item.label}>
              <p
                className={`text-ui-24 font-extrabold ${
                  item.tone === "finance" ? "text-finance-primary" : item.tone === "jobs" ? "text-jobs" : "text-finance-subscriptions"
                }`}
              >
                {item.value}
              </p>
              <p className="text-ui-12 mut">{item.label}</p>
            </li>
          ))}
        </ul>
        <p className="mt-3 rounded-xl bg-jobs/[0.12] p-2.5 text-ui-13">{home.nextEvent}</p>
      </Link>

      <section className="card p-4">
        <div className="flex items-center justify-between text-ui-13 font-bold text-journal">
          <span>JOURNAL</span>
          <Link href="/journal" className="text-inactive" aria-label="Open journal">
            ›
          </Link>
        </div>
        <h2 className="mt-2 text-ui-20 font-extrabold">{home.streak}</h2>
        <p className="text-ui-12.5 mut">{home.streakNote}</p>
        <Link
          href="/journal?compose=1"
          className="mt-3 flex h-10 items-center justify-center rounded-xl bg-journal text-ui-14 font-bold text-white"
        >
          Log tonight&apos;s wins
        </Link>
      </section>

      <Link href="/tasks" className="tasks-type block card border-[1.5px] border-ink p-4 shadow-[0_0_0_3px_rgba(31,42,36,0.08)]">
        <div className="flex items-center justify-between text-meta font-medium text-ink">
          <span>TASKS</span>
          <span aria-hidden className="text-inactive">›</span>
        </div>
        <span className="mt-2.5 flex min-h-11 items-center justify-center rounded-xl bg-ink text-body font-medium text-white">Open tasks</span>
      </Link>

      <section className="card p-4" aria-labelledby="goals-heading">
        <h2 id="goals-heading" className="mb-2 text-ui-13 font-bold mut">
          GOALS
        </h2>
        <ul className="flex justify-around">
          {home.goals.map((goal) => (
            <li key={goal.label} className="flex flex-col items-center gap-1">
              <Ring value={goal.value} tone={goal.tone} label={`${goal.label} ${goal.value} percent`} />
              <span className="text-ui-11.5 mut">{goal.label}</span>
            </li>
          ))}
        </ul>
      </section>
      <p className="mb-28 mt-3 text-center text-ui-9.5 text-inactive">EXAMPLE DATA · design mockup · not real accounts</p>
      </div>
    </div>
  );
}
