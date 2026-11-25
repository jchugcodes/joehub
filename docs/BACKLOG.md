# joehub User Stories — Draft Backlog

> Scrubbed copy for the public repo. Real balances, account and loan counts, lender names, and other personal finance details were removed. The original stays with Joe and is not committed.

Joe's confirmed product scope for joehub, organized into epics: MVP (To-do and Grocery), Finance, Development forecasting, Jobs, and Journal. As of Nov 25, 2026, development has resumed. Production is live with Tasks, Grocery and Finance, including Goals and Spending. Every former wishlist item is mapped to a story; nothing was dropped.
Status and roles
Paused Nov 24, 2026, 7:30 PM ET; resumed Nov 25 at Joe's word.
FN-7 Buckets merged Nov 25 (PR #82, main 9650ff81). Production shows Tasks, Grocery and Finance: Overview, Accounts, Bills, Goals and Spending, on Joe's real data. Categories is folded into Spending (FN-6, PR #68), and buckets can be hidden, renamed, added and removed (FN-7, PR #82): bars fill against the estimate, and over-budget shows in brick red. Goals went live Nov 19 (PR #72, Joe approved). Also live: speed polish (PR #71), No estimate copy (PR #78), XE side panels, v9 dark mode and XD skeletons. Debts stays hidden until the figures are refreshed and Joe approves. Jobs and Journal stay hidden (fixture-only). Brand (v10) still waits on Joe's final approval. The next pick is in Epic order, under Proposed next.
Nov 11 snapshot, kept for history.
As of Nov 11, 2026, 3:09 PM ET: MVP (To-do and Grocery) is done and live in production on Joe's real data. The one-time Notion copy happened Nov 11; there is no sync, and preview stays synthetic. GF (live bot updates) comes later in this epic. XA and XB are accepted. Production nav gate (#39, 2b084ec) is live, so production shows only Tasks, Grocery and Finance. #40 hotfix is live (4f5ff6c): Spent this month shows the amount spent only until monthly budgets ship. Finance is active: FA–FD are live (PR #31); Accounts is live (PR #33), grouped by type; Bills is live (PR #35) and starts empty; P3 cleanups are live (PR #34). Goals data was imported one time from Notion Goals / Funds (10 goals); the v8 Goals UI is pending. #36 Debts is accepted pending a one-line green-underline fix, merging when CI is green; Debts stays hidden in production. #37 PR B Categories is in progress: budgets prefilled from monthlyCapCents (utilities and school as weekly × 52/12 or blank), labeled as estimates and editable; ETA around 5 PM ET. Next is v11 · Tasks/Grocery polish (in design with Artie, then Tinker builds). Then the Goals UI, plus the rest of the designed v8 work (FJ monthly budgets on Categories, FK chart polish, and FL monthly income vs spent). After that: dark mode (v9-dark), designed. Brand (v10) is designed and on hold for build until Joe gives final approval. Merges to main auto-deploy to production after Cato acceptance and green CI. Nothing here authorizes paid services or cutovers. Nothing sets estimates or dates for queued work.
Joe
Defines stories with Cato; final product decision
Cato
Defines stories with Joe; owns scope and acceptance criteria; accepts each story when done
Artie
Designs each page in the existing joehub Figma file (style, UX/UI and functionality), including empty, error and offline states
Tinker
Implements from Artie's Figma design and demonstrates proof
Current app
Production (main 9650ff81) shows Tasks, Grocery and Finance: Overview, Accounts, Bills, Goals and Spending, on Joe's real data. Preview stays synthetic. Development paused Nov 24 and resumed Nov 25. Not every backlog feature is finished.
Labels
Requirements are confirmed by Joe. Acceptance details marked (proposed) still need his review.
Process
Decided Nov 9, 2026:
1.
Joe and Cato define the user stories.
2.
Artie designs each page in the existing joehub Figma file (style, UX/UI and functionality). Prior Figma work for joehub is the design source to implement.
3.
Tinker implements from that Figma design.
4.
Cato accepts when the story meets the definition of done.
Process improvements
Candidates as of Nov 11, 2026, 2:50 PM ET. Not decided.
1.
Always queue the next task at each merge.
2.
Tinker self-checks against Artie's design before review.
3.
Run two coding jobs in parallel when PRs don't touch the same code.
4.
One shared review folder per PR.
5.
A decision log on this Page.
6.
Lock spacing, weights and widths in Artie's specs.
Global definition of done
For every story, in this order (decided Nov 9):
1.
First and foremost: the user task the story exists for is accomplished end to end on deterministic synthetic fixtures.
2.
Then: the frontend is shown to match the corresponding Figma design — side-by-side at 390 and 1280, with any deviations listed.
3.
Every visible in-scope control, link, endpoint and chart filter works end to end on deterministic synthetic fixtures.
4.
Each shipped workflow is usable on both phone and computer, with loading, empty, error and offline states.
5.
Automated tests cover each acceptance case, and Joe has watched a demo of the complete task on both devices.
6.
No secrets, live data or personal records leak into the UI, logs, headers or the repo.
7.
No control looks real when it does nothing. Planned features are hidden, not shown as dead buttons.
8.
No incomplete story ships. A thin slice ships only if it completes a whole task.
Data and source of truth

| Mode                | Meaning                                                                                                                                                                                              | Status                        |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- |
| Demo fixture        | Read-only synthetic data that loads the same way every time                                                                                                                                          | In use                        |
| Synthetic test mode | Synthetic records that can be added, edited and removed. They behave like normal tasks: they persist until the user deletes them or until joehub goes live. No automatic reset. Decided Nov 9, 2026. | Decided Nov 9                 |
| Live data           | Real records. Tasks, Grocery and Finance already use them in production. Turso cutovers, Debts go-live, and Jobs and Journal still need Joe's OK                                                     | In use; further moves need OK |

| Domain              | Authority today                    | Intended future (confirmed intent)                                                                                                                                                                |
| ------------------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tasks and groceries | Upstash in production; flags unset | Turso (libSQL), chosen Nov 18. Read and written by both bots and the app                                                                                                                          |
| Finance             | Upstash in production; flags unset | Turso (libSQL), chosen Nov 18. Ledger fills it from the existing Grok Bot account connections. The app reads it and writes manual entries and corrections there. No direct bank import in the app |

Joe chose Turso as joehub's source of truth on Nov 18. The code for the move is merged (S1–S5, S7 Grocery, S9 Finance reads, S11 Finance writes, as PRs #73–#81; there is no S10). Production still runs on Upstash because the backend flags are unset. The Turso database has not been created, and no real data has been moved. There is no automatic cutover. Each remaining step needs Joe's OK at verify: S6 Tasks, S8 Grocery, S12 Finance, S13 merge of the box database, and S14. That work is blocked on Joe creating the Turso account (Vercel Storage to Turso Cloud, Free plan, a database named joehub in US East, connected to all three environments with no prefix). Synthetic test persistence is decided (Nov 9).
Done-task retention, decided Nov 9.
In joehub, Done tasks stay hidden from the default view, remain searchable for 7 days after being marked Done, then are auto-deleted. That resolves the earlier conflict with keeping completed tasks searchable. The existing Notion nightly cleanup routine is unchanged and is not part of this decision.
Epic order
Decided Nov 10, with status as of Nov 25, 2026, ET. Development paused Nov 24, 7:30 PM ET, and resumed Nov 25. XA, XB, XD and XE apply to all shipped work and are accepted. v9 dark mode, XD skeletons and XE side panels are live.

| #   | Epic                    | Stories                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Status         |
| --- | ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- |
| 1   | MVP                     | To-do and Grocery, live in production on real data. XA and XB accepted. v11 polish has shipped. GF (live bot updates) comes later in this epic.                                                                                                                                                                                                                                                                                                                                                     | Live           |
| 2   | Finance                 | FA–FD, Accounts, Bills, Goals and Spending are live, with Categories folded into Spending (FN-6, PR #68). Speed polish (PR #71) and No estimate copy (PR #78) are live. Debts is built and stays hidden until the figures are refreshed and Joe approves. FN-7 Buckets is live (PR #82). Next: FN-8 transaction edits, history by name, AE, then FM. Investments VA–VD and the rest of later finance stay queued. Brand (v10) is designed, on hold until Joe approves. | In progress (FN) |
| 3   | Development forecasting | DA to DF, the joehub cost and timeline forecast                                                                                                                                                                                                                                                                                                                                                                                                                                                     | Queued         |
| 4   | Jobs                    | JA and later Jobs stories, including Interviews and offers (IA, IB). Fixture-only and hidden; a demo-controls PR is queued before they go live.                                                                                                                                                                                                                                                                                                                                                     | Queued; hidden |
| 5   | Journal                 | LA, LB, LC. Fixture-only and hidden; a demo-controls PR is queued before they go live.                                                                                                                                                                                                                                                                                                                                                                                                              | Queued; hidden |

Home and joehub branding (Brand) are in Later / undecided, which is unranked. The dark mode option (UX) has shipped as v9 dark mode.
Proposed next (Nov 25)

| #        | Item                           | Covers                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| -------- | ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1        | FN-8 transaction edits         | Rename, note and tags on a transaction, then exclude from variable spending and mark as recurring so it appears on Bills                                                                                                                                                                                                                                                                                                                                                                  |
| 2        | History by name                | A spend chart and the list of transactions under that merchant or name                                                                                                                                                                                                                                                                                                                                                                                                                    |
| 3        | AE · Group and hide accounts   | Manual groups; the student loans start pre-grouped; hiding a group takes it out of net worth and the Overview chart, with an excluded note                                                                                                                                                                                                                                                                                                                                                |
| 4        | FM · Overview metric           | A picker in Finance settings: Net worth (the default), Total cash, Total debt, Monthly spend, Monthly income, and Monthly cash flow                                                                                                                                                                                                                                                                                                                                                       |
| After FN | Turso cutovers                 | Code is merged; production still runs on Upstash. Remaining, each needing Joe's OK at verify: S6 Tasks, S8 Grocery, S12 Finance, S13 merge of the box database, S14. Blocked on Joe creating the Turso account.                                                                                                                                                                                                                                                                           |
| After FN | Debts go-live                  | Built and hidden. Needs a refresh of the real figures and Joe's OK                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Later    | Rest of Finance                | FI swipe review; FE search (partly covered by the Spending filter); FF compare periods; FG cashflow forecast; FH CSV export; Investments VA–VD                                                                                                                                                                                                                                                                                                                                            |
| Later    | Other epics                    | GF live bot updates; Development forecasting; Jobs and Journal (fixture-only; a demo-controls PR wiring or removing Jobs pipeline controls and the Journal composer is queued before they go live)                                                                                                                                                                                                                                                                                        |

Proposed by Cato. Work resumed Nov 25. Joe picks the order.
Cross-cutting stories
XA and XB apply to every shipped workflow and are accepted. XC is a proposed technical acceptance. XD (shimmer loading) and XE (slide-in overlays) were added Nov 11 as app-wide patterns; they apply to every shipped workflow going forward.
XA · Works equally on phone and computer
1.
Every control in a shipped workflow can be reached and used on a phone-width screen and on a desktop browser.
2.
Nothing is cut off and no row requires sideways scrolling to act. Touch targets are usable on the phone (proposed).
3.
Each acceptance demo runs on both a phone and a computer.
XB · Read previously loaded lists offline
1.
Lists that were loaded earlier stay readable offline.
2.
Offline or stale data is clearly marked, with the time it was last updated. Balances are never shown as live.
3.
Edit controls are disabled or clearly unavailable offline. Offline edits and queued changes are not required.
4.
How sensitive cached data is secured, and how long it is kept, is a technical proposal. Only synthetic data is cached until that is approved.
XC · Shared data store (proposed technical acceptance)
XD · Shimmer loading
App-wide pattern, decided Nov 11 interview. Comes after v9 dark mode so new screens follow it.
1.
Loading states are a skeleton of the actual page — the same cards and rows, just pulsing — so the wait feels lighter.
2.
Applies to every shipped workflow, every screen. Existing pages get the same treatment in this story.
3.
If the page is already in hand, no shimmer flashes for a split second.
4.
Empty, error and offline states are unchanged.
XE · Slide-in overlays
App-wide pattern, decided Nov 11 interview. Comes after v9 dark mode so new screens follow it, along with XD.
1.
On the phone, opening an account, a transaction, or an edit surface — and anything else that can be an overlay rather than a full page — slides in from the right. Joe can dismiss it by swiping it away or tapping X. The previous screen stays at the same scroll position.
2.
On the computer, it is a panel beside the page so Joe can still see what is underneath. He can scroll the page behind; clicking outside the panel closes it.
3.
Opening a transaction or other detail from an overlay opens inside the same panel, not a second one.
4.
Top-level tabs and navigation stay full pages. Short confirms, such as delete, stay small dialogs (Cato product call, Nov 11). Applies app-wide going forward; existing bottom sheets and full-page edits are migrated in this story.
1 · MVP
To-do and Grocery are done and live in production on Joe's real data. XA and XB are accepted. GF (live bot updates) comes later in this epic. v11 · Tasks/Grocery polish shipped Nov 11.
To-do list
Confirmed: a title is the only required field. Description or notes, due date, priority, status and project are optional. The default view shows all unfinished tasks, including ones without a due date, sorted newest first. Completed tasks are hidden from the default view, searchable for 7 days after being marked Done (and can be reopened in that window), then auto-deleted. Seeing bot-assigned tasks is selected, but an assignee field or assign control is not. Priority values match Notion To-Do: High, Medium, Low. Statuses: To do, Doing, Blocked, Done. Synthetic test tasks behave like normal tasks and persist until deleted or until go-live (no auto reset). In every story below, changes are made in synthetic test mode and must still be there after a hard reload and a new session, on both phone and computer. All of the above decided Nov 9, 2026; workflow 1 is unblocked on these points.
TA · Add a task
Figma frame: (pending from Artie)
1.
Entering a title and saving adds the task to the default view right away, and it is still there after a reload.
2.
Optional fields can be left blank, or set at creation.
3.
A blank title cannot be saved, and the title field shows an error.
4.
Cancel or Escape saves nothing.
5.
If saving fails, the input is kept, an error appears, and retrying creates exactly one task. A double-click on Save creates one task.
TB · Edit a task
Figma frame: (pending from Artie)
1.
Title, description or notes, due date, priority, status and project can each be changed, and the change is still there after a reload.
2.
A field can be cleared, except the title.
3.
Due dates use America/Detroit. A task due today counts as today's task at any hour of that day.
4.
Cancelling restores the original values. If saving fails, the stored task is unchanged and an error appears.
5.
Allowed priority values match Notion To-Do: High, Medium, Low (decided Nov 9). Allowed statuses: To do, Doing, Blocked, Done (decided Nov 9).
TC · Complete, search and reopen
Figma frame: (pending from Artie)
1.
Completing a task removes it from the default view. It remains searchable for 7 days after being marked Done, then is auto-deleted (decided Nov 9). Within that window it is still there after a reload.
2.
Search finds completed tasks by title within the 7-day window, and shows them as completed. After auto-deletion they are gone from search.
3.
Reopening a completed task within the 7-day window returns it to the default view, and that holds after a reload.
4.
Searching with no matches shows an empty state.
TD · Default view and organize by status or project
Figma frame: (pending from Artie)
1.
The default view shows every unfinished task, dated or undated. Default sort is newest first (decided Nov 9).
2.
Grouping or filtering by status or project shows exactly the matching tasks. Tasks with no project or status appear in their own group.
3.
With no unfinished tasks, an empty state appears. A filter with no results can be cleared in one step.
TE · Delete a task
Figma frame: (pending from Artie)
1.
Delete asks for confirmation. Once confirmed, the task is permanently gone, including after a reload and from search.
2.
Cancel changes nothing. If deleting fails, the task stays and an error appears.
TF · See bot-assigned tasks and progress
Figma frame: (pending from Artie)
1.
Tasks assigned to a bot show which bot has them and their progress, read-only.
2.
There is no assignee field and no assign or reassign control.
3.
When a bot changes progress, the task shows the update on its next load (live updates are proposed).
Grocery list
GF (see bot changes without refreshing / live bot updates) comes later in this epic.

| ID  | Story                              | Key acceptance (proposed)                                                                    |
| --- | ---------------------------------- | -------------------------------------------------------------------------------------------- |
| GA  | Add, rename or remove an item      | Each change holds after a reload. A blank name is rejected. Remove asks for confirmation     |
| GB  | Check or uncheck an item           | The state holds after a reload                                                               |
| GC  | Quantities and notes               | Saved with the item. An invalid quantity is rejected                                         |
| GD  | Group by store section             | Every item appears in exactly one section, and items without a section get their own group   |
| GE  | Clear purchased items              | After confirmation, removes only checked items. Unchecked items stay                         |
| GF  | See bot changes without refreshing | A bot's change appears without a manual refresh. A conflict with an unsaved edit is surfaced |

There are no store, cart or purchase features.
v11 · Tasks/Grocery polish (Joe, Nov 11 3:09 PM ET)
Shipped Nov 11. Acceptance details were proposed at the time.

| ID  | Story                                                | Key acceptance (proposed)                                                                                                                                              |
| --- | ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TG  | Rename Project to List                               | The Project field is renamed List. It is a dropdown select of the lists that exist. The change holds after a reload                                                    |
| GG  | Section as a dropdown                                | Grocery Section is a dropdown select of existing sections, not free text. Every item still appears in exactly one section; items without a section get their own group |
| TH  | Colored cards when a Status or List filter is active | When the Status or List filter is active, cards take on that status's or list's color for visual separation                                                            |
| TI  | Date created on each task                            | Each task shows a small Date created, to make cleanup easier. Whether existing tasks have createdAt for backfill is still open                                         |

2 · Finance
All money stories, in this delivery order: a. Category budgets and transactions (FA–FD; Artie's v5 design is done as PNGs); b. Accounts (AA–AD); c. Bills and subscriptions (BA–BC); d. Debts, savings and goals (SA–SD); e. Investments (VA–VD, read-only, Archer-owned; plus unranked future story Investments · Archer investment playbook); f. Later finance stories (FE, FF, FH, FI, FJ, FK, FL, unranked within this group; FG cashflow forecast after Accounts and Bills).
Category budgets and transactions
Artie's v5 design is done as PNGs.
Weekly budget periods run Monday through Sunday in America/Detroit (decided Nov 9). Monthly periods use calendar months in America/Detroit.

| ID  | Story                             | Key acceptance (proposed)                                                                                                                                                                                                                                                                                                                                      |
| --- | --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| FA  | Category budgets                  | A weekly or monthly limit per category. Weekly weeks start Monday. Shows spent, remaining and days left, with days left correct on a period's first and last day (Monday and Sunday for weekly). Opening a category lists transactions that add up to its spent amount. Moving budget between categories keeps the total the same, and over-moves are rejected |
| FB  | Safe-to-spend per category        | Remaining equals limit minus spent for the period. Going over shows a negative amount, clearly marked. Periods use America/Detroit boundaries with Monday-start weeks, so 11:59 PM Sunday ends the week and Monday midnight starts the next                                                                                                                    |
| FC  | Transactions                      | Manual entry of expenses and income (income never counts as spending). Recategorizing updates both categories. Marking a transaction as a transfer removes it from spending. All of these hold after a reload, and cancel or a failed save changes nothing. Period attribution follows Monday-start weeks and calendar months in America/Detroit               |
| FD  | Corrections beat Ledger refreshes | A correction stays in place through a simulated refresh until Joe explicitly resets it, with confirmation. The original imported value can be seen. Manual entries are never overwritten                                                                                                                                                                       |

Weekly dining-out spending is one use of FA. Rollover was not requested, and that is not a permanent exclusion.
Accounts

| ID  | Story                                  | Key acceptance (proposed)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| --- | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| AA  | See balances by account and group      | Individual account balances are shown, grouped by type (Banking, Investments, Cards, Loans, and so on). Each balance shows when it was last updated. Stale or offline figures are marked and never shown as live (see XB). Nov 11: this grouping is covered by the in-flight Accounts work, PR #33 from Artie's v6                                                                                                                                                                                                                                                                                                                               |
| AB  | See net worth trend                    | Joe can see how net worth has changed over time, from recorded balances only. Missing points are never filled in or guessed                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| AC  | See available vs set-aside cash        | Joe can see how much cash is available to spend versus set aside (earmarked vs spendable). The figures hold after a reload and are never shown as live if stale                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| AD  | Account detail and recent transactions | Opening an account shows its recent transactions and last-updated time. The list is still there after a reload                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| AE  | Group and hide accounts                | Joe can pick accounts and group them himself. A group shows as a parent with the combined balance, and the individual accounts expand and collapse. The student loans start already grouped. Joe can hide any group in one action; hiding takes those accounts out of net worth and the Overview chart, and Overview shows that some accounts are excluded. Showing the group again restores them to the list, net worth, and the chart. The preference holds after a reload. Individual account detail (AD) still opens from a sub-row. Decided Nov 11 interview. Later Finance story, after the in-flight Finance work and v9 dark |

Bills and subscriptions
Paid, unpaid and overdue bill tracking stays not selected. Auto-cancel remains excluded. FN also adds a bill automatically when Joe marks a transaction as recurring (weekly, monthly, or annually).

| ID  | Story                                     | Key acceptance (proposed)                                                                                                                                                          |
| --- | ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| BA  | See upcoming bills and recurring cost     | Upcoming amounts and due dates are shown, along with monthly and yearly recurring cost. Dates use America/Detroit. With none, an empty state appears                               |
| BB  | Add or edit a recurring bill              | Joe can add or edit a recurring bill, including the paying account. Changes hold after a reload. Cancel or a failed save changes nothing                                           |
| BC  | Track renewal and cancellation intentions | Joe can record a renewal or cancellation intention for a bill. This is tracking only: it never cancels, pays or messages a provider automatically. The record holds after a reload |

Debts, savings and goals

| ID  | Story                                         | Key acceptance (proposed)                                                                                                                                                                                                                                                                                                 |
| --- | --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SA  | See debt balances, rates and minimum payments | A Debts tab lists all debts, including student loans, cards, and other debts (Nov 11). Each debt shows its balance, rate and minimum payment, with a last-updated time. Stale figures are marked and never shown as live                                                                                                 |
| SB  | Compare payoff plans and debt-free dates      | Joe can compare payoff plans and their debt-free dates. Every assumption is listed. Missing inputs are marked unknown, never invented                                                                                                                                                                                     |
| SC  | Savings goals, progress and contributions     | A goal has a target and date, plus progress and contributions. Changes hold after a reload. Cancel or a failed save changes nothing. Nov 11: production Goals is empty; populate from Joe's real data. A Notion source exists: the Goals / Funds database under CATO's Hub / Databases, and the Goals page under Finances |
| SD  | Set aside money per payday                    | Joe can set aside an amount per payday. That set-aside is reflected in the available vs set-aside view (AC). Changes hold after a reload                                                                                                                                                                                  |

Investments
Read-only. No trading. Archer keeps ownership of the plan and any trades.

| ID  | Story                                   | Key acceptance (proposed)                                                                                                                 |
| --- | --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| VA  | Holdings and allocation across accounts | Holdings are shown across accounts, with allocation. Figures show when they were last updated and are never shown as live if stale        |
| VB  | Performance, contributions vs gains     | Joe can see performance history and contributions versus gains, from recorded figures only. Missing points are never filled in or guessed |
| VC  | Dividends and income                    | Dividends and income are shown from recorded figures only, with a last-updated time                                                       |
| VD  | Archer plan and progress                | Joe can see Archer's plan and its progress, read-only. There is no control to trade, change the plan or message Archer                    |

Investments · Archer investment playbook
Future feature, unranked. Exact scope and data path to be defined with Joe and Archer.
1.
Archer, Joe's Robinhood portfolio-manager bot, provides a per-investment or portfolio playbook: thesis, target allocation, buy/hold/trim rules, and review cadence.
2.
The playbook is shown read-only in joehub. Only Archer may trade; joehub never trades.
Later finance stories
FE, FF, FH, FI, FJ, FK, FL, FM and FN are unranked within this group. FI follows the FA–FD slice (transactions and corrections). FG (cashflow forecast) comes after Accounts and Bills (decided Nov 10). FM and AE were added Nov 11 from Joe. FN was added Nov 12 and comes after XD and XE so new screens follow those patterns.

| ID  | Story                                   | Key acceptance (proposed)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| --- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| FE  | Search and filter transactions          | Search and filter find the matching transactions. A search or filter with no results shows an empty state that can be cleared in one step                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| FF  | Compare periods                         | Joe can compare spending or budget totals across Monday–Sunday weeks and calendar months in America/Detroit (decided Nov 10). Figures are shown side by side, with no invented values                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| FG  | Cashflow forecast and upcoming balances | Depends on Accounts and Bills existing first (decided Nov 10). Shows a forecast and upcoming balances from known inputs only. Missing inputs are marked unknown, never invented. Stale balances are never shown as live (see XB)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| FH  | Export records                          | Joe can export records as a CSV file (decided Nov 10). A failed export changes nothing and shows an error                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| FI  | Swipe-review transactions               | A queue of new or unreviewed transactions is shown one card at a time. With none, an empty state appears. Swipe right or tap Looks good marks the current transaction reviewed as-is; that holds after a reload. Swipe left or tap Fix opens the recategorize/correction sheet (see FC and FD). Undo restores the last swipe. At 1280, keyboard and button equivalents do the same as the swipes. A correction made here stays through a simulated Ledger refresh until Joe explicitly uses Reset to Ledger, with confirmation; the original imported value can be seen. Cancel on the sheet changes nothing. In-UI copy stays minimal. Spec note: proposed button labels are Looks good and Fix                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| FJ  | Categories tab shows monthly budgets    | The Categories tab shows each category's monthly budget, not weekly spend (Nov 11). Weekly period rules in FA–FD are otherwise unchanged                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| FK  | Polish the finance chart                | The finance chart animates when the timeframe changes and shows the percent increase or decrease for the selected period. Figures come from recorded history only; missing history is marked, never invented. Spec note: YTD history was not imported and is needed for this                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| FL  | Monthly income vs spent chart           | A monthly bar chart compares total income against total spent for each month. Figures come from recorded history only; missing months are marked, never invented. Joe's reference is Rocket Money's Spending screen: month cards each hold an income bar and a total-spend bar, with Week/Month/Quarter/Year pills, the current month highlighted, and a legend                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| FM  | Configurable Overview metric            | Finance settings offers six metrics: Net worth (the default), Total cash, Total debt, Monthly spend, Monthly income, and Monthly cash flow (income minus spend). The chosen metric is the Overview headline number and chart. Every option uses the same existing Overview chart (period pills, animation, and period change) with different data; it does not project forward. Joe switches the current metric only in Finance settings, not on the Overview itself. Figures come from recorded history only; missing history is marked, never invented. The choice holds after a reload. Decided Nov 11 interview                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| FN  | Spending                                | The Categories tab is renamed to Spending. On that page Joe can hide, rename, add, and remove buckets; a hidden bucket drops out of the list and out of spend totals everywhere, including Overview income-vs-spent, and those figures always match. Showing a hidden bucket again restores it to the list and the totals. On a transaction Joe can rename it, add a note and tags, exclude it from variable spending, and mark it as recurring (weekly, monthly, or annually); a transaction marked recurring appears on the Bills page. Recurring and exclude are independent switches — neither flips the other. A history-by-name view shows a spend chart and the list of transactions under that merchant or name. Changes hold after a reload. Cancel or a failed save changes nothing. Split, rules, and a reviewed mark are out of this story. Joe's Rocket Money transaction pages are the reference for organizing a transaction, in joehub's own design. Decided Nov 12 interview. Later Finance story, after XD and XE. The first slice went live Nov 18. FN-6 (PR #68) folded Categories into a single Spending tab and is live: bars fill against the estimate, and over-budget shows in brick red. FN-7 Buckets is live (PR #82, merged Nov 25). Still to build, in order: FN-8 transaction rename, note and tags, then exclude and recurring; and history-by-name |

3 · Development forecasting
Interview complete for now. Epic 3.
Joe: "That captures it for now." This epic comes after MVP and Finance. No estimates are produced now. Exact prediction isn't possible today: the usage report has no token counts, no split by model and no per-project attribution. Not all of the shared limit is visible to bots, and cloud coding usage is tracked separately. The forecasts depend on new verified telemetry, on assumptions Joe can see and change, or on both.

| Area                | Confirmed answer                                                                                                                                                                                                                                                                           |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Goal                | A forecast timeline and potential token cost for proposed projects, with an adjustable timeline that shows the cost impact. It accounts for model types and plan limits, compares the monthly AI subscription with actual usage, and reserves usage for routines and other activity |
| Adjustable inputs   | Target finish date; weekly usage allocation for the project; included features; model or model mix                                                                                                                                                                                         |
| Infeasible deadline | Show the earliest estimated feasible finish for the same scope, the scope that fits the target date, and alternate model mixes                                                                                                                                                             |
| Reserve             | Recent non-project usage is the starting point, and Joe can adjust it. Routines are never changed                                                                                                                                                                                          |
| Subscription view   | Included usage, used and unused; project usage separated from routine and other usage; estimate vs actual                                                                                                                                                                                  |
| Missing data        | Estimates come from assumptions Joe can see and change, kept clearly apart from measured reports. No invented facts, rates or models, and no conversions between quota, tokens and dollars                                                                                                 |
| Forecast display    | One estimate, shown as a range with its assumptions. Not three default scenarios                                                                                                                                                                                                           |
| Multiple projects   | Prioritize projects that share the budget, and show the impact on other projects                                                                                                                                                                                                           |
| Applying a change   | Adjustments are hypothetical until Joe reviews the effects and applies them. Applying only saves an agreed plan. It doesn't start work, change backlog priorities or dates, or message the team                                                                                            |
| Not selected now    | An extra-spending control; comparing plan upgrades (modeling general plan limits is still wanted); a breakdown of subscription and extra charges                                                                                                                                           |

| ID  | Story                                     | Key acceptance (proposed)                                                                                                                                                                                                                              |
| --- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| DA  | Forecast one project                      | Shows one estimate as a range, with every assumption listed and editable. Measured figures and assumed figures are labeled differently. Missing data shows as unknown, never invented                                                                  |
| DB  | Adjust and see the impact                 | Changing the target date, weekly allocation, included features or model mix immediately updates the range and its cost impact, hypothetically. An infeasible target shows the earliest feasible finish, the scope that fits, and alternate model mixes |
| DC  | Reserve and subscription use              | The reserve starts from recent non-project usage and Joe can adjust it. Shows included usage used and unused, and separates project usage from routine and other usage                                                                                 |
| DD  | Several projects competing for one budget | Projects can be prioritized. Changing one project's inputs shows the impact on the others                                                                                                                                                              |
| DE  | Apply as an agreed plan                   | Nothing is saved until Joe applies it. Applying saves the plan, and it is still there after a reload. It never starts work, edits backlog priorities or dates, messages anyone, spends money, upgrades the plan or changes models                      |
| DF  | Estimate vs actual                        | Where measured data exists, it sits beside the estimate with its source and as-of time. Otherwise it is marked as unmeasured                                                                                                                           |

4 · Jobs
JA · Blockers and requests needing my attention
1.
Each blocked item shows the job, why it is blocked and what is needed. With none, an empty state appears.
2.
Answering Scout or providing missing info saves the reply with the item, and it holds after a reload.
3.
Approving or declining a proposed next step records a decision for that one step. It is not standing permission to send or apply, and it never acts automatically.
4.
Snooze until a date hides the item until that day in America/Detroit. The date must be in the future, and cancelling changes nothing.
5.
There is no control to open a related message, mark complete or notify Scout.
Later Jobs stories in this epic, including Interviews and offers (IA, IB) (decided Nov 10). Follow-up dates, overdue flags, a calendar view, resume versions and a separate pros and cons tool stay not selected.

| ID  | Story                                   | Key acceptance (proposed)                                                                                                                                                                                                                                                                                             |
| --- | --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| JB  | Review Scout roles and decide           | Joe can review a Scout-found role and mark interested, pass or save. Asking Scout to pursue records the request and keeps that status separate from submitted applications. It is not permission to send or apply, and it never acts automatically                                                                    |
| JC  | Add, edit and permanently delete jobs   | A job can be added or edited, and permanently deleted after confirmation. Changes hold after a reload. Cancel changes nothing. A failed save or delete leaves the record unchanged and shows an error                                                                                                                 |
| JD  | Track stages and outcomes               | A job's stage and outcome can be set and updated, and the change holds after a reload                                                                                                                                                                                                                                 |
| JE  | Job detail                              | The detail page shows description and the original listing link, pay, location, work arrangement, fit, notes and questions, and blockers (blockers are also covered in JA). From the page, Joe can mark interested, pass or save, and ask Scout to pursue, with that status kept separate from submitted applications |
| JF  | Board, searchable list and filters      | Jobs can be viewed as a board and as a searchable list. Filters show exactly the matching jobs. A search or filter with no results shows an empty state that can be cleared in one step                                                                                                                               |
| JG  | Dated history                           | A dated history of changes or events for a job is visible. History is never invented                                                                                                                                                                                                                                  |
| JH  | Recruiter contacts and messages         | Recruiter contacts and messages can be viewed and recorded with the job, and they hold after a reload                                                                                                                                                                                                                 |
| IA  | Interview prep, feedback and next steps | Joe can keep prep notes and questions per interview, plus feedback and next steps. Changes hold after a reload. Cancel or a failed save changes nothing                                                                                                                                                               |
| IB  | Compare offers                          | Joe can compare salary, bonus, equity and benefits, and compare commute, relocation and work arrangement. Missing inputs are marked unknown, never invented                                                                                                                                                           |

5 · Journal
LA · Existing logs as a blog-style feed
1.
Entries appear newest first by entry date in America/Detroit, showing wins, fails and streaks as recorded.
2.
Missing days are never filled in or guessed.
3.
Each streak links to the entries it is based on.
4.
Cato reflections and summaries are labeled and kept separate from Joe's own entries, and never count toward streaks.
5.
An empty journal shows an empty state.
Later journal stories in this epic. Editing, deleting or filtering past journal entries stays not selected.

| ID  | Story                           | Key acceptance (proposed)                                                                                                                                                                               |
| --- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| LB  | Write a free-form entry         | Joe can write a free-form entry in the app. It is kept separate from nightly check-ins and never affects their streak. The entry is still there after a reload. Cancel or a failed save changes nothing |
| LC  | Habit trends and streak history | Joe can see habit trends and streak history from recorded entries only. Missing days are never filled in or guessed. Each streak links to the entries it is based on                                    |

Later / undecided
Unranked. Home and any other remaining items that are not in an epic. The dark mode option (UX) has shipped as v9 dark mode. Brand (joehub branding) still waits on Joe's final approval.
Home
Still open; can wait. Initial preference (kept): Home shows today's tasks and open loops, not a mashup of every area. Current lean (Nov 9, not decided): a navigation hub with some quick views or quick-access pages. Those two notes may both end up true (hub plus today's tasks/open loops as the first things shown); finalize later. Home has no spec yet and is not ranked.
UX · Dark mode option in Settings
Shipped as v9 dark mode and is live in production.
1.
Settings has a Light, Dark, or System theme toggle.
2.
A full dark token set is used across every screen.
3.
Contrast meets AA.
4.
The choice is remembered per device.
Brand · joehub branding
Unranked. Owner: Artie. Designed, on hold for build until Joe gives final approval. Package is ready for build at /workspace/joehub-design/handoff/v10-brand/.
1.
Joe picked the V1 Cut tile mark rotated 180° (notch top-left), with the rounded-square wordmark 'o', in Tangerine.
2.
Light/dark colors: fill #FF7A00 / #FFB03A; accent text #A84E00 / #FFC14A; warn is true red #C4161C / #FF4D4D; gains stay green #0B7A52 / #5EECBC.
3.
Ready for build: the icon set (favicon, apple-touch, PWA, maskable, dark variants, manifest), wordmark/lockup, brand sheet, tokens-brand.json with a screensToRecheck list, and BRAND-SPEC.md.
4.
Splash screens and the empty state are exploratory.
Wishlist mapping
Nothing was dropped.
Every item from the former Later wishlist is listed here, with the story it was written into. Items that were already not selected stay in Not selected and exclusions.

| Area                    | Item                                                                                                                                             | Went to                                       |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------- |
| Accounts                | Individual balances                                                                                                                              | AA                                            |
| Accounts                | Cash, investments and debts grouped                                                                                                              | AA                                            |
| Accounts                | Net worth trend                                                                                                                                  | AB                                            |
| Accounts                | Available vs set-aside cash                                                                                                                      | AC                                            |
| Accounts                | Account detail with recent transactions                                                                                                          | AD                                            |
| Accounts                | Last updated                                                                                                                                     | AA and AD                                     |
| Bills and subscriptions | Upcoming amounts and due dates                                                                                                                   | BA                                            |
| Bills and subscriptions | Monthly and yearly recurring cost                                                                                                                | BA                                            |
| Bills and subscriptions | Add or edit a recurring bill                                                                                                                     | BB                                            |
| Bills and subscriptions | Paying account                                                                                                                                   | BB                                            |
| Bills and subscriptions | Renewal and cancellation intentions (tracking only, never auto-cancel)                                                                           | BC                                            |
| Debt and savings        | Balances, rates and minimum payments                                                                                                             | SA                                            |
| Debt and savings        | Comparing payoff plans and debt-free dates                                                                                                       | SB                                            |
| Debt and savings        | Goal targets and dates                                                                                                                           | SC                                            |
| Debt and savings        | Progress and contributions                                                                                                                       | SC                                            |
| Debt and savings        | Set-aside per payday                                                                                                                             | SD                                            |
| Debt and savings        | Earmarked vs spendable                                                                                                                           | AC (same view as available vs set-aside cash) |
| Investments             | Holdings across accounts                                                                                                                         | VA                                            |
| Investments             | Performance history                                                                                                                              | VB                                            |
| Investments             | Contributions vs gains                                                                                                                           | VB                                            |
| Investments             | Allocation                                                                                                                                       | VA                                            |
| Investments             | Dividends and income                                                                                                                             | VC                                            |
| Investments             | Archer plan and progress                                                                                                                         | VD                                            |
| Investments             | Read-only, no trading, Archer keeps ownership                                                                                                    | Investments intro; applies to VA–VD           |
| More finance            | Transaction search and filter                                                                                                                    | FE                                            |
| More finance            | Comparing periods                                                                                                                                | FF                                            |
| More finance            | Cashflow forecast and upcoming balances                                                                                                          | FG                                            |
| More finance            | Record export                                                                                                                                    | FH                                            |
| Jobs                    | Review Scout roles and decide                                                                                                                    | JB                                            |
| Jobs                    | Add, edit and permanently delete jobs after confirmation                                                                                         | JC                                            |
| Jobs                    | Stages and outcomes                                                                                                                              | JD                                            |
| Jobs                    | Detail page (description and original link, pay, location, work arrangement, fit, notes and questions, blockers)                                 | JE (blockers also in JA)                      |
| Jobs                    | Interested, pass or save; ask Scout to pursue with status kept separate from submitted applications                                              | JB and JE                                     |
| Jobs                    | Board and searchable list                                                                                                                        | JF                                            |
| Jobs                    | Filters                                                                                                                                          | JF                                            |
| Jobs                    | Dated history                                                                                                                                    | JG                                            |
| Jobs                    | Recruiter contacts and messages                                                                                                                  | JH                                            |
| Interviews and offers   | Prep notes and questions per interview                                                                                                           | IA (later Jobs story)                         |
| Interviews and offers   | Feedback and next steps                                                                                                                          | IA (later Jobs story)                         |
| Interviews and offers   | Comparing salary, bonus, equity and benefits                                                                                                     | IB (later Jobs story)                         |
| Interviews and offers   | Comparing commute, relocation and work arrangement                                                                                               | IB (later Jobs story)                         |
| Journal                 | Writing free-form entries, kept separate from nightly check-ins and never affecting their streak                                                 | LB                                            |
| Journal                 | Habit trends and streak history                                                                                                                  | LC                                            |
| Journal                 | Cato reflections and summaries                                                                                                                   | LA (existing criterion extended)              |
| Accounts                | Group the student loans as a parent account with expandable individual loans, and hide the whole group                                   | AE                                            |
| More finance            | Overview headline and chart switch among a short list of metrics, set in Finance settings; all use the same forecast chart                       | FM                                            |
| App-wide                | Shimmer loading placeholders                                                                                                                     | XD                                            |
| App-wide                | Slide-in overlays for account, transaction, and edit surfaces; swipe or X to close, previous scroll position kept                                | XE                                            |
| More finance            | Rename Categories to Spending; hide, rename, add, and remove buckets; hidden buckets drop out of spend totals everywhere                         | FN                                            |
| More finance            | Exclude a transaction from variable spending; mark it recurring so it appears on Bills; rename, note, and tags on a transaction; history-by-name | FN                                            |

Not selected and exclusions
Not selected for now (not ruled out):
1.
Paid, unpaid and overdue bill tracking.
2.
Budget rollover.
3.
Résumé versions and a separate pros and cons tool.
4.
Setting follow-up dates on jobs, overdue flags and a calendar view.
5.
Editing, deleting or filtering past journal entries.
6.
A task assignee field.
7.
Split, rules, and a reviewed mark on transactions (out of FN; not ruled out later).
8.
Offline editing.
9.
Other app areas.
Excluded:
1.
joehub's own notifications or reminders. Outside notifications stay with the existing bots.
2.
Store, cart, purchase and trading features.
3.
Automatic sending or applying.
4.
Direct bank import.
5.
Live data and paid services without separate approval.
Decided Nov 9
1.
Synthetic test tasks behave like normal tasks: they persist until the user deletes them or until joehub goes live. No automatic reset. Workflow 1 is unblocked on storage/reset.
2.
Priority values match Notion To-Do: High, Medium, Low.
3.
Statuses: To do, Doing, Blocked, Done.
4.
Default sort for unfinished tasks: newest first.
5.
Done tasks stay hidden from the default view, searchable for 7 days after completion, then auto-deleted. Notion nightly cleanup is unchanged.
6.
Workflow 3: weekly budget periods start Monday (Monday through Sunday, America/Detroit). Applied to FA–FD.
7.
Process: Joe and Cato define stories; Artie designs each page in the existing joehub Figma file (style, UX/UI and functionality); Tinker implements from that design; Cato accepts.
8.
Definition of done order: (1) the user task the story exists for is accomplished end to end; (2) frontend is shown to match the corresponding Figma design (side-by-side at 390 and 1280, deviations listed).
9.
Workflow 1 (to-do) unpaused and in progress; workflows 2–6 remain queued.
Updated Nov 10
Later wishlist features were written into existing or new stories. Nothing was dropped. See Wishlist mapping. Those stories were then ordered into epics. To-do stories TA–TF were not expanded. Acceptance details on the new stories remain proposed unless noted.
Decided later on Nov 10:
1.
Interviews and offers (IA, IB) are later Jobs stories, not a separate workflow.
2.
Cashflow forecast (FG) waits until Accounts and Bills exist.
3.
Comparing periods (FF) uses Monday–Sunday weeks and calendar months in America/Detroit.
4.
Record export (FH) is CSV.
5.
Work is ordered into five epics: 1 MVP (To-do and Grocery, with GF later in that epic); 2 Finance (FA–FD, then Accounts, Bills, Debts, savings and goals, Investments, then later finance stories, with FG after Accounts and Bills); 3 Development forecasting; 4 Jobs (including IA, IB); 5 Journal. Home and remaining items are in Later / undecided, which is unranked.
6.
FI (swipe-review transactions) added as a later Finance story, unranked within later finance stories; it follows the FA–FD slice.
Updated Nov 11
Finance feedback after production began using real data:
1.
A Debts tab lists all debts, including student loans, cards, and other debts. Merged into SA.
2.
The Categories tab shows each category's monthly budget, not weekly spend. Added as FJ.
3.
Production Goals is empty; populate from real data. A Notion Goals / Funds source exists. Merged into SC.
4.
Accounts grouped by type (Banking, Investments, Cards, Loans, and so on) is covered by the in-flight Accounts story, PR #33 from Artie's v6. Noted on AA.
5.
The finance chart should animate when the timeframe changes and show the percent increase or decrease for the selected period. Needs real history (YTD was not imported). Added as FK.
6.
A monthly bar chart compares total income against total spent for each month. Added as FL. Joe's reference is Rocket Money's Spending screen: month cards each hold an income bar and a total-spend bar, with Week/Month/Quarter/Year pills, the current month highlighted, and a legend.
7.
UX (dark mode option in Settings) added as an unranked story; design pending from Artie.
8.
Brand (joehub branding) added as an unranked design story, owned by Artie; design pending.
9.
Investments · Archer investment playbook added as an unranked future feature under Investments. Read-only in joehub; only Archer may trade. Exact scope and data path to be defined with Joe and Archer.
Updates as of 2:50 PM ET:
1.
Brand: Joe picked the V1 Cut tile mark rotated 180° (notch top-left), with the rounded-square wordmark 'o', in Tangerine, plus the light/dark token set. Artie's v10-brand package is ready for build and on hold until Joe gives final approval.
2.
#39 production nav gate is live (2b084ec): production shows only Tasks, Grocery and Finance.
3.
#40 hotfix is live (4f5ff6c): Spent this month shows the amount spent only until monthly budgets ship.
4.
#36 Debts is accepted pending a one-line green-underline fix, merging when CI is green; Debts stays hidden in production.
5.
#37 PR B Categories is in progress: budgets prefilled from monthlyCapCents (utilities and school as weekly × 52/12 or blank), labeled as estimates and editable; ETA around 5 PM ET.
6.
Process improvement candidates were added; they are not decided.
Updates as of 3:09 PM ET:
1.
v11 · Tasks/Grocery polish added, ordered after PR B Categories and before Goals. In design with Artie, then Tinker builds. Stories: TG rename Project to List (dropdown), GG Section as a dropdown, TH colored cards when a Status or List filter is active, TI Date created on each task.
Updates as of 10:15 PM ET:
1.
As of this evening: v11, the Goals UI, the net worth chart (#45), and Income vs spent (#46) have been accepted and merged. Goals and Debts stay hidden in production. v9 dark mode is in progress.
2.
AE (group and hide accounts) added under Accounts as a later Finance story. Nov 11 interview: Joe picks accounts and groups them; the student loans start already grouped; hiding any group takes those accounts out of net worth and the chart; Overview shows that some accounts are excluded.
3.
FM (configurable Overview metric) added as a later Finance story. Nov 11 interview: six metrics (Net worth default, Total cash, Total debt, Monthly spend, Monthly income, Monthly cash flow); same existing chart with different data, no forward projection; switch only in Finance settings.
4.
XD and XE added as app-wide patterns, queued after v9 dark mode. Nov 11 interview: XD is a skeleton of the actual page, with no flash on already-loaded pages. XE slides in from the right on the phone; on the computer it is a panel beside the page; scroll behind is allowed, clicking outside closes it; nested details open inside the same panel.
Updated Nov 12
Spending story locked from Joe's interview, 11:50 AM–2:04 PM ET:
1.
FN (Spending) added as a later Finance story, after XD shimmer and XE overlays. The Categories tab is renamed to Spending. On that page Joe can hide, rename, add, and remove buckets; hiding a bucket drops it from spend totals everywhere, including Overview, and those figures always match.
2.
On a transaction Joe can rename it, add a note and tags, exclude it from variable spending, and mark it as recurring (weekly, monthly, or annually) so it appears on the Bills page. Recurring and exclude are two independent switches.
3.
History-by-name is in: a spend chart and the list of transactions under that merchant or name. Joe's Rocket Money transaction pages are the reference, in joehub's own design. Split, rules, and a reviewed mark are out of this story.
Updated Nov 18
1.
XE side panels are done (#51–#61) and turned on in production (#62). Debts, Goals, Jobs and Journal stay hidden.
2.
FN slice 1 (Spending) shipped as #63–#67 and went live with Joe's OK. It was built from existing Finance and XE patterns, with no Artie frames. It shows spend only until category budgets are saved.
3.
Gap: what shipped covers only part of the locked FN story. Categories and Spending currently sit side by side. The rest of FN is listed as item 1 in Proposed next.
4.
Backlog polish filed: the Accounts panel's cold fill, Escape on Categories while loading, and a Spending month endpoint.
Updated Nov 19–25
1.
Joe approved turning on Goals. Goals went live Nov 19 (PR #72). Joe will adjust a few goal statuses himself in the Goals UI; bots write no real data.
2.
Speed polish (PR #71) and No estimate copy (PR #78) are live. FN-6 (PR #68) folded Categories into a single Spending tab and is live.
3.
Joe chose Turso as joehub's source of truth on Nov 18. The code side of the move is merged: S1–S5, S7 Grocery, S9 Finance reads, and S11 Finance writes, as PRs #73–#81 (there is no S10). Production main is 1bfc2433 (the S11 merge). All backend flags are unset, so production still runs on Upstash. The Turso database has not been created, and no real data has been moved.
4.
FN-7 Buckets (PR #82) merged Nov 25. Cato's three fixes (Remove as a small centered dialog; an 'N bucket hidden' line; a visible tappable entry point) were all in at 190bfddb. Review fixes added live buckets in the transaction picker, a retry-safe Upstash remove, and the full moved amount in the remove dialog. Bills still uses a fixed category list.
5.
On Nov 24, 2026, at 7:30 PM ET, Joe asked to pause development. All joehub work stopped. Nothing has been pushed, merged or deployed since. Work resumes only when Joe says so.
Open decisions
1.
Joe chose Turso (Nov 18). The remaining cutovers wait on Joe creating the Turso account (Vercel Storage to Turso Cloud, Free plan, a database named joehub in US East, all three environments, no prefix), then his OK at each verify step: S6 Tasks, S8 Grocery, S12 Finance, S13 merge of the box database, and S14.
2.
Home: still open. Lean (not decided): navigation hub with quick views / quick-access pages; also keep today's tasks and open loops as what Joe wanted to see first. Finalize later.
3.
Security and retention for any cached sensitive data (Joe not sure yet).
4.
Exact scope and data path for the Archer investment playbook, to be defined with Joe and Archer.
5.
Brand (v10) build is on hold until Joe gives final approval.
6.
Whether existing tasks have createdAt for backfill (TI).
7.
Goals is live (Nov 19). Joe will adjust a few goal statuses himself in the Goals UI. Debts stays hidden until the figures are refreshed and Joe approves.
8.
When Jobs and Journal go live. Both are fixture-only and hidden. A demo-controls PR wiring or removing Jobs pipeline controls and the Journal composer is queued first.
9.
FN-6 and FN-7 were built from existing patterns, with no new Artie frames. Whether history-by-name needs Artie frames first is still open.