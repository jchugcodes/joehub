import Link from "next/link";
import { pipeline } from "../../lib/design-fixtures";

const valueClass: Record<string, string> = {
  jobs: "text-jobs-text",
  interview: "text-interview",
  finance: "text-finance-text",
  muted: "text-muted",
};

export default function JobsPage() {
  return (
    <div className="space-y-4">
      <header className="flex items-start justify-between">
        <div>
          <p className="text-sm text-muted">Jobs</p>
          <h1 className="text-3xl font-semibold">Pipeline</h1>
        </div>
        <button type="button" className="grid h-10 w-10 place-items-center rounded-full bg-card" aria-label="Filter pipeline">
          ▾
        </button>
      </header>
      <nav aria-label="Jobs sections" className="flex gap-4 overflow-x-auto text-sm">
        <a href="#overview" className="border-b-2 border-jobs-text pb-2 font-semibold" aria-current="page">
          Overview
        </a>
        <a href="#matches" className="pb-2 text-muted">
          Matches
        </a>
        <a href="#board" className="pb-2 text-muted">
          Board
        </a>
        <a href="/jobs/globex#notes" className="pb-2 text-muted">
          Notes
        </a>
      </nav>
      <ul id="overview" className="grid grid-cols-3 gap-2">
        {pipeline.counts.map((item) => (
          <li key={item.label} className="rounded-2xl bg-card p-3 shadow-sm">
            <p className="text-xs text-muted">{item.label}</p>
            <p className={`text-3xl font-semibold ${valueClass[item.tone]}`}>{item.value}</p>
            <p className="text-xs text-muted">{item.note}</p>
          </li>
        ))}
      </ul>
      <div className="flex items-center justify-between">
        <h2 id="board" className="text-lg font-semibold">
          Board
        </h2>
        <p className="text-xs text-muted">drag cards · swipe</p>
      </div>
      <div className="flex gap-3 overflow-x-auto pb-2" tabIndex={0} aria-label="Pipeline columns">
        {pipeline.columns.map((column) => (
          <section key={column.name} className="w-40 shrink-0 rounded-2xl bg-card p-3 shadow-sm" aria-label={column.name}>
            <h3 className={`text-sm font-semibold ${valueClass[column.tone]}`}>
              {column.name} <span className="text-muted">{column.total}</span>
            </h3>
            <ul className="mt-2 space-y-2">
              {column.cards.map((card) => (
                <li key={card}>
                  <Link href="/jobs/globex" className="block rounded-xl border border-line px-2 py-2 text-sm">
                    {card}
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
      <div className="flex items-center justify-between">
        <h2 id="matches" className="text-lg font-semibold">
          Top matches
        </h2>
        <p className="text-sm text-jobs-text">See all 24</p>
      </div>
      <ul className="space-y-3">
        {pipeline.matches.map((match) => (
          <li key={match.id} className="rounded-2xl bg-card p-4 shadow-sm">
            <div className="flex gap-3">
              <span className="grid h-10 w-10 place-items-center rounded-full bg-ink text-sm font-semibold text-card">
                {match.initial}
              </span>
              <div className="min-w-0 flex-1">
                <Link href={`/jobs/${match.id}`} className="font-semibold">
                  {match.title}
                </Link>
                <p className="text-sm text-muted">{match.meta}</p>
              </div>
              <p className={`text-right text-xl font-semibold ${match.id === "hooli" ? "text-gold-text" : "text-finance-text"}`}>
                {match.score}
                <span className="block text-xs font-normal text-muted">/10 fit</span>
              </p>
            </div>
            {match.tags.length ? (
              <ul className="mt-3 flex flex-wrap gap-2 text-xs">
                {match.tags.map((tag) => (
                  <li key={tag} className="rounded-full bg-canvas px-2 py-1">
                    {tag}
                  </li>
                ))}
              </ul>
            ) : null}
            {match.id === "globex" ? (
              <Link href="/jobs/globex" className="mt-3 block rounded-full bg-jobs-text py-2 text-center text-sm font-semibold text-white">
                Save to pipeline
              </Link>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
