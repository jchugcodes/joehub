# joehub

joehub is Joe's personal hub: tasks, grocery lists, and finance today, with jobs and journal still to come. Claude owns this project from here, including design. The Grok bots (Cato, Tinker, Artie, and the rest) are no longer part of building it. They will use the hub as data sources later, but they don't write, review, or accept code.

## Read before working

- `docs/BACKLOG.md`: the feature spec, organized as epics and stories with acceptance criteria. This decides what to build.
- `docs/CHARTER.md`: the bot roles, data rules, and how bots should read and write the hub. The table and function names there are proposals. Map them onto the tables that already exist and add only what's missing.
- `docs/SCHEMA.md`, `docs/WEB_ARCHITECTURE.md`, `docs/DESIGN_GAPS.md`: how the current code works. Parts of these are out of date. Production is live on Vercel, so where these docs disagree with `docs/BACKLOG.md`, trust the backlog and say so.

## Where things stand (Nov 25, 2026)

- **Live in production with real data:** Tasks, Grocery, and Finance (Overview, Accounts, Bills, Goals, Spending).
- **Built but hidden:** Debts, Jobs, and Journal. Jobs and Journal still run on demo data, and the Journal composer doesn't save.
- **Storage:** production runs on Upstash. Turso was chosen on Nov 18 as the source of truth, and the code for it is merged behind the `JOEHUB_BACKEND_*` flags, but the Turso database doesn't exist yet. Joe has to create it before any cutover.
- **Resume point:** review PR #82 (FN-7 Buckets) against the FN story. Cato asked for three fixes, and the entry-point fix may be missing. Next come FN-8 transaction edits, history by name, AE account groups, and FM overview metric, unless Joe picks a different order.

## Process

1. Joe picks the story.
2. Build it on a branch as a small pull request. Run one build lane at a time unless Joe asks for a second one on code that doesn't overlap.
3. Check the work against the story's acceptance criteria.
4. Leave a short note on the pull request: what works, how to see it in the Vercel preview, and anything skipped or different from the story.
5. Joe looks at the preview and approves the merge.

## Never do these without Joe saying yes in the session

- Merge to `main`. Merges auto-deploy to production.
- Create accounts, set or change Vercel environment variables, or flip a `JOEHUB_BACKEND_*` flag.
- Run a data cutover, import or change real data, or turn on a hidden area (Debts, Jobs, Journal).
- Spend money or pick a paid plan.

## Personal data

The repo is public. Joe's real data lives only in the database (Upstash now, Turso after the cutover), never in the code. Never put real balances, account or loan details, lender names, job applications, journal text, or anything copied from production into code, fixtures, tests, docs, commit messages, or pull request notes. Use fictional examples. `docs/BACKLOG.md` is a scrubbed copy, so keep it that way when you update it.

## Definition of done

1. The task the story exists for works end to end.
2. It works on a phone and on a computer.
3. No secrets, personal data, or live records end up in the UI, logs, or repo. The repo is public, so fixtures stay fictional.
4. No control looks real when it does nothing. Unfinished features stay hidden.
5. Tests cover the main path, plus anything touching money, dates, or deletes.

Side-by-side design checks at two widths, a test for every acceptance case, and a demo on both devices are no longer required. Add loading, empty, and error states where they matter.

## Design

Follow the patterns already in the app: the tokens in `web/tailwind.config.cjs`, dark mode, loading skeletons, and side panels. When a story needs a new screen, design it in that style yourself. Don't wait for Figma frames. The v10 brand package isn't approved, so don't build it.

## Keep it simple

This codebase has more machinery than a one-user app needs (fencing tokens, a writer daemon, and so on). Don't add more. When a simpler approach does the job, propose it in the pull request note rather than building around the complexity. Ask before removing anything big.

## Commands

- Web app: `cd web && npm ci && npm test`, and `npm run dev` for local work with the synthetic login.
- Python: `pip install -e ".[dev]"`, then `pytest`. For the API: `pip install -e ./api`, then `pytest api/tests`.
- CI runs all three on every push.
