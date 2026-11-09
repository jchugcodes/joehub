import Link from "next/link";
import { Ring, Sparkline } from "../components/Charts";
import { home } from "../lib/design-fixtures";

export default function HomePage() {
  const spentWidth = 27;
  return (
    <div>
      <header className="flex items-center justify-between px-5 pt-2">
        <div>
          <p className="text-ui-13 mut">{home.date}</p>
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
        <div className="mt-1 flex items-end justify-between">
          <div>
            <p className="text-ui-28 font-extrabold tnum">{home.net}</p>
            <p className="text-ui-13 font-semibold text-finance-primary">{home.ytd}</p>
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
          {home.spent} · {home.diningNote}
        </p>
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

      <Link href="/tasks" className="block card p-4">
        <div className="flex items-center justify-between text-ui-13 font-bold text-ink">
          <span>Tasks</span>
          <span aria-hidden className="text-inactive">›</span>
        </div>
        <p className="mt-1 text-ui-16 font-bold">Unfinished list</p>
        <p className="text-ui-12 mut">Add a task and keep what isn’t done.</p>
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
