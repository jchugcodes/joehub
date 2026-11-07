import Link from "next/link";
import { Ring, Sparkline } from "../components/Charts";
import { home } from "../lib/design-fixtures";

export default function HomePage() {
  const spentWidth = 27;
  return (
    <div className="space-y-4">
      <header className="flex items-start justify-between">
        <div>
          <p className="text-sm text-muted">{home.date}</p>
          <h1 className="text-3xl font-semibold tracking-tight">{home.greeting}</h1>
        </div>
        <span className="grid h-11 w-11 place-items-center rounded-full bg-ink text-sm font-semibold text-card" aria-hidden>
          {home.initial}
        </span>
      </header>

      <Link href="/finance" className="block rounded-2xl bg-card p-4 shadow-sm">
        <div className="flex items-center justify-between text-xs font-semibold tracking-wide text-finance-text">
          <span>FINANCE</span>
          <span aria-hidden>›</span>
        </div>
        <p className="mt-2 text-4xl font-semibold">{home.net}</p>
        <p className="text-sm font-medium text-finance-text">{home.ytd}</p>
        <Sparkline />
        <div
          className="mt-2 h-2 overflow-hidden rounded-full bg-line"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={spentWidth}
          aria-label="Spent against the monthly plan"
        >
          <div className="h-full rounded-full bg-spent" style={{ width: `${spentWidth}%` }} />
        </div>
        <p className="mt-2 text-sm text-muted">
          {home.spent} · {home.diningNote}
        </p>
      </Link>

      <Link href="/jobs" className="block rounded-2xl bg-card p-4 shadow-sm">
        <div className="flex items-center justify-between text-xs font-semibold tracking-wide text-jobs-text">
          <span>JOBS</span>
          <span aria-hidden>›</span>
        </div>
        <ul className="mt-3 grid grid-cols-3 gap-2">
          {home.jobs.map((item) => (
            <li key={item.label}>
              <p
                className={`text-3xl font-semibold ${
                  item.tone === "finance" ? "text-finance-text" : item.tone === "jobs" ? "text-jobs-text" : "text-interview"
                }`}
              >
                {item.value}
              </p>
              <p className="text-xs text-muted">{item.label}</p>
            </li>
          ))}
        </ul>
        <p className="mt-3 rounded-xl bg-jobs-soft px-3 py-2 text-sm text-jobs-text">{home.nextEvent}</p>
      </Link>

      <section className="rounded-2xl bg-card p-4 shadow-sm">
        <div className="flex items-center justify-between text-xs font-semibold tracking-wide text-journal-text">
          <span>JOURNAL</span>
          <Link href="/journal" aria-label="Open journal">
            ›
          </Link>
        </div>
        <h2 className="mt-2 text-2xl font-semibold">{home.streak}</h2>
        <p className="text-sm text-muted">{home.streakNote}</p>
        <Link
          href="/journal?compose=1"
          className="mt-3 block rounded-full bg-journal-text py-3 text-center text-sm font-semibold text-white"
        >
          Log tonight&apos;s wins
        </Link>
      </section>

      <section className="rounded-2xl bg-card p-4 shadow-sm" aria-labelledby="goals-heading">
        <h2 id="goals-heading" className="text-xs font-semibold tracking-wide text-muted">
          GOALS
        </h2>
        <ul className="mt-3 grid grid-cols-3 gap-2">
          {home.goals.map((goal) => (
            <li key={goal.label} className="flex justify-center">
              <Ring value={goal.value} tone={goal.tone} label={`${goal.label} ${goal.value} percent`} />
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
