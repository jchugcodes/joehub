# Bot Team Charter (Draft)

This is the handoff charter for the Joe Hub: the Grok bots and Cato built part of it, and Claude will finish it. It covers the shared design rules and a lane for every bot. Posty's lane is done.

## Core design principles

- Functions are shared tools. Each bot has a list of functions it is allowed to call. Cato can call all of them. The app should check who is calling, since a rule written only in a prompt can drift.
- Each bot writes directly to its own tables through its own functions. Cato only writes shared records no single bot owns, like the journal and general to-dos.
- Conversation stays open and uses judgment. Database changes go through fixed functions so the data comes out consistent.
- Escape hatch: a generic add-note function takes free text for anything that does not fit a category. Notes can be promoted to proper records later.
- Reads are kept low. Bots read on demand, not at startup. Plain lookups run as code and return only the answer, so the model never reads whole tables.
- Overlap is fine as long as it does not create redundancy or bloat.

## Shared memory

- Activity log: after anything meaningful, a bot writes one short line (who, what, when) through a function. It is not a transcript.
- Rolling summary: one short note, overwritten about once a day, covering what is current. Cato reads only this at the start of a conversation, so he knows what you told other bots.
- Full history and the journal live separately in the database.

## Rules table

- A table of rules, each row saying which bot or routine it applies to, what the rule is, and whether it is active.
- Cato gets a propose-rule-change function, not a change-rule one. A change stays pending until Joe approves it, so a bot cannot quietly rewrite its own rules.
- Each bot loads only the rules for its own lane.

## Email ownership

- Any predictable, recurring email stream belongs to the bot that uses it. Posty only handles what is left over.
- Scout pulls job alerts straight from the mailbox, scores them, and deletes them, with no handoff through Posty.
- Posty's cleanup skips the job label. Optional safety net: Posty may delete job-labelled mail only after about a week.
- Mail powers per bot: read only, read and archive, or read, archive, and delete. Posty is the only one with delete on general mail.

## Cato (chief of staff)

- Main point of contact: conversation, judgment, routing.
- Reads only the rolling summary at the start of a chat.
- Hands specialist work to the right bot or function, then relays the answer so context is not lost.
- Runs two routines: an 8:30 p.m. daily check-in asking for a win and a failure, logged to the journal, and a morning brief built from code-pulled tasks, calendar, and anything urgent.
- Handles requests to change routines or rules by proposing a rule change for approval.
- Does not do development. That goes to Claude (the hub build) and Tinker (other projects).

## Ledger (accountant)

- Owns bank accounts and spending: transactions, categories, budgets, weekly and monthly summaries.
- Main writer to the finance tables, through functions like log transaction and update category.
- Reads only finance data plus the rolling summary.
- Does not do investing. Archer gets read-only access to balances.
- The dashboard reads the database directly, so it adds no load on Ledger.

## Archer (investments)

Advisory mode:

- Can see the IRA and long-term accounts but never touches them.
- Monthly portfolio summary on a schedule.
- If something should shift, he recommends it and Joe makes the move.
- On-demand market digest: a short brief of what is happening and how it affects Joe's money. Not stored.

Autonomous mode:

- Acts only inside the Robinhood MCP account, which currently holds no money.
- Follows an investor template Joe picks, stored as a row in the rules table so changing it is propose-and-approve.
- The MCP credentials should only reach that one account.
- Caps and approval thresholds to be set with Archer before real money goes in.

Alerts:

- Emergency triggers are numeric thresholds in the rules table, for example a market or single-holding drop past a set percentage. Numbers to be decided later.
- A plain script checks the thresholds, and Archer is only called when one trips.

## Handoff to Claude

- Joe supplies the current backlog of what Cato and Tinker have built. Claude finishes the dashboard, the functions, and the Turso cutovers, using the tables, functions, and flows at the end of this doc as the starting contract.
- Decision: Turso (hosted SQLite) is the single source of truth (see the data layer section below).

## Other bot lanes

Lanes for the remaining bots. Posty's daily cleanup routine is included.

## Tinker (development)

- Before the handoff, Tinker directed a Cursor agent that did the coding in the repo, and he handled GitHub and pull requests. That was the old setup for the hub build.
- After the hub is built, Tinker is the project manager for everything outside the hub: Beam, Tally, LeadReport, Phase Space, and new ideas. Joe gives him an idea or a bug, he turns it into a task for the Cursor agent, watches the repo, reviews pull requests, and reports when something is ready.
- The hub is Claude's project, so Tinker does not maintain it.
- Works on code only and never touches the personal data tables.
- Reports on a schedule or when a pull request is ready, not constantly, to keep token use low.
- Decision: Tinker may merge pull requests himself.

## Artie (designer and creative director)

- Three jobs: user-centered UX and interface design for Joe's apps with Figma as his workspace; visual work for anything else, like Notion headers, logos, branding, and graphics; and the look, personality, and world of the bots themselves, including any new bot.
- Not an image generator. He reviews and critiques when asked ("how does this look?") and designs new things when asked.
- Called in on demand, with no routines. Lane left loose on purpose, and he is allowed to give opinions.
- Produces design work only and does not write to the personal data tables.

## Sync (calendar and scheduling)

- Kept as a light bot. His job is reasoning-heavy scheduling: finding free time for dates and appointments, and slotting tasks into open gaps.
- Simple calendar work (list events, add an event) is done by Cato calling the same shared functions directly, so Sync is only pulled in for scheduling puzzles.
- Items with a hard date or time are calendar items, owned by Sync. Open-ended to-dos live on Cato's list. A to-do with a soft target date can show on the dashboard's calendar view, and becomes a real calendar event only when Joe says to block time for it.
- If Joe barely uses him in a few months, fold him into Cato.

## Posty (mail)

- Owns inbox housekeeping: triage, archive, delete clutter, and routing what matters. Only bot with delete on general mail, and skips any label another bot owns, like Scout's job alerts.
- Routes only what is actionable: bills to Ledger, invites to Sync, reply-needed items into the morning brief.
- Routine: once a day, Posty cleans up and organizes the connected inboxes, skipping any label another bot owns.

## Scout (jobs)

- Owns the job search from alert email to tracker. He pulls alerts from the job label in the mailbox, scores each posting for fit, adds good ones to the interested list, drops the rest, deletes the alert, and keeps the applied-jobs tracker current.
- Fit criteria, target cities, companies, role types, and the cutoff score live in the rules table, so Joe can tune them with a propose-and-approve edit.
- Application support (tailoring a resume, cover letters, follow-ups, interview prep) runs on demand only.
- Auto-apply stays on for roles above a 7.5 fit score, as it works today. Every application is logged. No daily cap for now.
- The scoring system is parked as future work.

## Bustler (side hustles)

- Idea and feasibility bot: a quick market check, a rough financial estimate, and a simple business plan for a side hustle idea. On demand only, no routines.
- Writes to one small ideas table with status and notes. Reads Ledger's numbers only when an idea needs Joe's real budget.
- A serious idea becomes its own project and goes to Tinker to build.
- Joe barely uses him yet. If neither Bustler nor Sella earns real use in a few months, fold them into one ventures bot or retire them.

## Sella (buying and selling)

- Runs a sale from listing to handoff. Joe sends photos and a description, and Sella writes the listing, suggests a price, posts it, tracks what is posted and sold, and answers interested buyers based on rules. He stops when the item needs to be shipped or handed off.
- Posts through his own computer and browser, so eBay needs a login. Suggested: use a separate password for that account and keep it in that computer's credential store, never in the database or this charter.
- Rules to define in the rules table: price floor, how much he can negotiate, and what he never agrees to without asking Joe. Suggested: ask before accepting any offer under the floor.
- Joe will define the buyer-message rules when he starts posting.

## Scope and the development split

- This charter covers the Joe Hub handoff: what Cato and the Grok bots built so far goes to Claude to finish. The bots remain a big part of the project.
- Development is a separate track from the life bots, mainly to keep usage separate. Tinker stays as he is, a project manager for non-hub builds, and may merge his own pull requests.

## Data layer

- Turso (hosted SQLite) is the chosen source of truth, decided Nov 18. Production still runs on Upstash until the cutovers happen. Notion was copied over once on Nov 11 for Tasks, Grocery, and Finance, with no ongoing sync.
- The Joe Hub dashboard reads from SQLite. The bots use it as their memory through the shared functions, and their rules live in the rules table inside it.
- The migration code is merged. The remaining cutovers (S6 Tasks, S8 Grocery, S12 Finance, S13 merging the older local database, S14) wait on Joe creating the Turso account and approving each step.

## Current build state (Nov 25)

- Live in production on Vercel with real data: Tasks, Grocery, and Finance (Overview, Accounts, Bills, Goals, Spending). Dark mode, loading skeletons, and side panels are live.
- Built but hidden: Debts (needs refreshed figures and Joe's OK), and Jobs and Journal (demo data only; the Journal composer does not save).
- Development paused Nov 24 at 7:30 p.m. The resume point is reviewing FN-7 Buckets, PR #82 (open, CI green, the entry-point fix may be missing). Then FN-8 transaction edits, history by name, AE account groups, and FM overview metric.
- Blocked on Joe: creating the Turso account and approving each cutover. Brand v10 also waits on his approval.
- Bots do not write live data to the hub yet. Live bot updates (GF) and Ledger filling Finance from his account connections are planned but not built. An ingest API with per-bot duplicate protection exists.
- The app's ownership rules know only Ledger, Scout, and Cato. The other bots have no tables yet.
- Process since Nov 9: Joe and Cato define stories, Artie designs in Figma, Tinker builds, Cato accepts. With this handoff, Claude takes over the build on the hub. The new process is in the next section.
- Cato's user-story backlog is the feature spec. This charter covers roles, data, and how the bots behave.

## Development process (from the handoff on)

1. Joe picks the next story from the backlog, and works out new stories with Claude when needed.
2. Claude builds it in one session: Opus for planning and the harder slices, Sonnet for routine ones.
3. Claude checks its own work against the story's acceptance criteria and leaves a short note on the pull request: what works, how to see it in the preview, and anything skipped.
4. Joe looks at the preview and approves the merge.

- Cato is kept fully separate from hub development. He does not write, review, or accept stories.
- One build lane by default. A second session only for a track that doesn't touch the same code, such as Journal beside Finance. No orchestrator or bot swarm.
- Claude takes over the whole hub project, design included. Artie, Tinker, and Cato are all out of hub development. Existing Figma designs and the patterns already in the app are the starting point, and Claude designs anything new.
- Definition of done is loosened, replacing the Nov 9 list. See the next section.

## Definition of done (loosened)

Must-haves for every story:

1. The task the story exists for works end to end.
2. It's usable on a phone and on a computer.
3. No secrets, personal data, or live records leak into the UI, logs, or repo.
4. No control looks real when it does nothing. Unfinished features stay hidden.
5. Tests cover the main path, plus anything touching money, dates, or deletes.

Dropped as standing requirements: side-by-side design checks at two screen widths, a test for every acceptance case, and a demo on both devices. Loading, empty, and error states are handled where they matter, not drawn for every screen. Claude still lists any known deviations in the pull request note.

## Bot identity and permissions

- Each bot gets its own key from the app. Every function call carries that key, and the app checks it against the permission grid below before running anything. A bot without access gets an error, whatever its prompt says.
- Cato's key can call every function.
- Every write records which bot made it and when.
- Only Joe approves rule changes, from the dashboard. No bot can approve its own rule.
- Open: how the Grok bots store and send their key. Confirm with Joe's setup.

## Tables (draft)

These names are proposals. The repo already has tasks, grocery\_items, lists, accounts, transactions, budgets, goals, applications, journal\_entries, and bot\_activity, so Claude should map onto those and add only what is missing (for example Archer's, Bustler's, and Sella's tables).

| Table | Written by | Purpose |
| --- | --- | --- |
| todos | Cato | General to-dos, with an optional soft target date |
| journal | Cato | Daily win and failure entries |
| activity\_log | All bots | One-line entries after meaningful events, archived after a few weeks |
| rolling\_summary | Daily refresh job | One note, overwritten, read by Cato |
| rules | Cato proposes, Joe approves | Per-bot rules, thresholds, templates, with a pending or active status |
| notes | All bots | Free-text catch-all |
| transactions, categories, budgets, accounts | Ledger | Spending and balances. Archer reads balances only |
| positions, watchlist, recommendations, portfolio\_summaries | Archer | Advisory data and the monthly summary |
| jobs, applications | Scout | Scored postings, interested list, applied tracker |
| ideas | Bustler | Side hustle ideas with status and notes |
| listings, buyer\_messages | Sella | Items for sale and buyer conversations |
| dev\_requests | Cato | Dev inbox that Tinker reads on his own schedule |

Open: whether calendar events stay only in Google Calendar and the dashboard reads them from there, or get mirrored into SQLite.

## Functions (draft)

The functions are the contract between the bots and the app. Dashboard reads use plain queries, not these functions.

| Function | What it does | Who can call it |
| --- | --- | --- |
| get\_summary | Return the rolling summary | All bots |
| log\_activity | Add a one-line log entry | All bots |
| add\_note | Save a free-text note | All bots |
| list\_rules | Return the active rules for the caller's own lane | All bots |
| propose\_rule | Create a pending rule change | Cato |
| add\_todo, update\_todo, list\_todos | Manage the to-do list | Cato (others list only) |
| add\_journal\_entry | Save a journal entry | Cato |
| log\_transaction, update\_category, spending\_summary | Finance bookkeeping and reports | Ledger (Cato reads) |
| get\_balances | Return account balances | Ledger, Archer, Cato |
| save\_recommendation, update\_watchlist, save\_portfolio\_summary | Archer's advisory records | Archer |
| add\_job, score\_job, log\_application | Job pipeline | Scout |
| add\_idea | Save a side hustle idea | Bustler |
| create\_listing, update\_listing, log\_buyer\_message | Sales tracking | Sella |
| list\_events, add\_event, find\_free\_time | Calendar reads and writes | Cato (simple), Sync (all) |
| add\_dev\_request | Drop a request in the dev inbox | Cato |
| list\_dev\_requests | Read the dev inbox | Tinker |

The escape hatch is add\_note. The notes Joe sees most often get promoted into proper functions later.

## User flows (draft)

| Flow | Path |
| --- | --- |
| "Add milk to my list" | Cato calls add\_todo. No other bot is involved |
| "What's on my plate today?" | Cato calls list\_todos and list\_events, then summarizes |
| Joe mentions a purchase | Ledger calls log\_transaction, then log\_activity |
| 8:30 p.m. check-in | Cato asks for a win and a failure, then calls add\_journal\_entry |
| Morning brief | Code pulls tasks, calendar, and anything urgent, and Cato turns it into a message |
| Job alert arrives | Scout reads the job label, scores the posting, drops or adds it to the interested list, auto-applies above 7.5, deletes the alert, and logs it |
| "Have Posty skip newsletters" | Cato calls propose\_rule, reads it back, and the rule goes live only after Joe approves |
| Find time for a date | Cato hands off to Sync, who calls find\_free\_time and adds the event once Joe says yes |
| Date or place note | Whichever bot hears it calls add\_note, and log\_activity makes it visible to Cato |
| Market drop past a threshold | A script checks the thresholds in the rules table and wakes Archer only when one trips |
| Monthly portfolio summary | Archer calls save\_portfolio\_summary on a schedule |
| Bug or feature idea | Cato calls add\_dev\_request and Tinker picks it up on his own schedule |

## Still to do

- Sella's rules for buyer messages, price floor, and negotiation limits, once Joe starts posting.
- Any Posty routines beyond the daily inbox cleanup, if Joe adds some.
- Scout's scoring system, parked as future work.
- Archer's trade caps and alert thresholds, to be set with Archer when Joe adds money to the MCP account.
- Claude reviews the draft tables, functions, and flows below, and confirms how each bot sends its key.
