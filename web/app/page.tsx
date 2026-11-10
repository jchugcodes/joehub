import Link from "next/link";
import { Ring, Sparkline } from "../components/Charts";
import { home } from "../lib/design-fixtures";
import { store } from "../lib/store.mjs";

export const dynamic = "force-dynamic";

type HomeTask = { title: string; status: string; dueDate?: string };

function detroitToday(now = Date.now()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Detroit", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

export default async function HomePage() {
  const tasks = (await store.listUnfinishedTasks()) as HomeTask[];
  const today = detroitToday();
  const blocked = tasks.filter((task) => task.status === "Blocked").length;
  const dueToday = tasks.filter((task) => task.dueDate === today);
  const highlight = dueToday[0] || tasks[0] || null;
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

      <Link href="/tasks" className="tasks-type block card border-[1.5px] border-ink p-4 shadow-[0_0_0_3px_rgba(31,42,36,0.08)]">
        <div className="flex items-center justify-between text-meta font-medium text-ink">
          <span>TASKS</span>
          <span aria-hidden className="text-inactive">›</span>
        </div>
        <div className="mt-3 grid grid-cols-3 gap-2">
          <p><span className="block text-title font-medium">{tasks.length}</span><span className="text-meta text-muted">Open</span></p>
          <p><span className="block text-title font-medium text-[#E07A5F]">{blocked}</span><span className="text-meta text-muted">Blocked</span></p>
          <p><span className="block text-title font-medium text-[#C4A035]">{dueToday.length}</span><span className="text-meta text-muted">Due today</span></p>
        </div>
        {highlight ? (
          <p className="mt-3 rounded-xl bg-[#F5F6F4] px-3 py-2.5 text-body">
            {highlight.title}
            {highlight.dueDate === today ? <span className="text-muted"> · due today</span> : null}
          </p>
        ) : null}
        <span className="mt-3 flex min-h-11 items-center justify-center rounded-xl bg-ink text-body font-medium text-white">Open tasks</span>
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
