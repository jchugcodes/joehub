# S9 Finance reads on libSQL

`JOEHUB_BACKEND_FINANCE=sqlite` moves every Finance read onto libSQL. Unset means Upstash, so production does not change. This slice does not set the flag in Vercel, does not create a Turso database, and does not copy real figures. Writes stay on Upstash. S11 is the write slice.

`JOEHUB_BACKEND_TASKS` and `JOEHUB_BACKEND_GROCERY` stay separate. Setting the finance flag does not move Tasks, Grocery, sessions, devices, or the API rate limit. `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN` do not select a backend. `JOEHUB_LIBSQL_URL` and `JOEHUB_LIBSQL_AUTH_TOKEN` win when both pairs are set. Startup uses the same remote-only check already driven by any sqlite area.

This slice covers every Finance read: spending month and weeks, categories, bills, goals, accounts, overview (including net worth), and debts. It is not split into a later S10. The reads share one bundle loader.

`web/lib/live-pages.mjs` and `web/lib/overlay-flag.mjs` are unchanged. Their git blobs stay `f0c23a7637db0ad4d3e6e1fe98837b9878f62098` and `c3af66a42247cd7baf351e56a2736c1defc28245`. No page markup changed. `@libsql/client` stays in `serverExternalPackages`. Finance SQL goes through `store-sqlite.mjs`, which already imports that client. `finance-box.mjs` does not.

Migrations `001` through `006` are unchanged. `007_finance_reads.sql` adds side tables only. The box tables `accounts`, `transactions`, `categories`, `budgets`, and `goals` keep the schema from `001`.

The API returns the web documents in `finance_docs` and `finance_blobs`. The same write fills the box rows so the mapping is real. `finance_ids` maps each web id to a 36-character box UUID.

## Audit

| Path | What it touches | When the flag is sqlite |
| --- | --- | --- |
| `GET /api/finance/overview` | `financeOverview`. Home (`web/app/page.tsx`) calls the same method. Net worth is this payload, from the manual-account roll-up when any manual account exists. | libSQL |
| `GET /api/finance/spending/month` | `financeSpendingMonth` | libSQL |
| `GET /api/finance/categories` | `financeCategories`. Week and month. Caps are inside this payload. | libSQL |
| `GET /api/finance/weeks/:start/categories/:category` | `financeCategory` | libSQL |
| `GET /api/finance/bills` | `financeBills`. `projectBills` may update `finance_docs` bill bodies. It does not write Redis. | libSQL |
| `GET /api/finance/bills/:id` | `financeBill` | libSQL |
| `GET /api/finance/goals` | `financeGoals`. `web/app/finance/goals/page.tsx` and `web/app/finance/goals/[slug]/page.tsx` call the same method. | libSQL |
| `GET /api/finance/accounts` | `financeAccounts` | libSQL |
| `GET /api/finance/accounts/:id` | `financeAccount` | libSQL |
| `GET /api/finance/debts` | `financeDebts` | libSQL |
| `GET /api/finance/debts/:id` | `financeDebt` | libSQL |
| `GET /api/finance/transactions` | `financeTransactions` | libSQL |
| `GET /api/finance/transactions/:id` | `financeTransaction` | libSQL |
| Other Finance pages | browser fetches of the GET routes above | The flag is read at process start. No markup change. IndexedDB caches are unchanged. |
| `PATCH /api/finance/caps` | `financeSaveCaps` | Upstash |
| `POST /api/finance/budgets` | `financeSaveBudgets` | Upstash |
| Account create, patch, delete | `financeCreateAccount`, `financePatchAccount`, `financeDeleteAccount` | Upstash |
| Bill create, patch, delete | `financeCreateBill`, `financePatchBill`, `financeDeleteBill` | Upstash |
| Goal create, patch, delete | `financeCreateGoal`, `financePatchGoal`, `financeDeleteGoal` | Upstash |
| Transaction create, patch, import, simulate, reset | the existing write methods | Upstash |
| `financeRows` and `financeBundle` | used by those writes | Upstash. They are not overlaid, so a write does not read libSQL and then write Redis. |
| `POST /api/ingest` | tasks and grocery only | Unchanged. No finance ingest path was added. |
| Tasks, Grocery, sessions, devices, API rate limit | their existing stores | Unchanged |

There is no separate net-worth route. Net worth is the overview chart and the accounts snapshot.

## Mapping

Web categories become `categories` rows with `kind` `expense`, plus `budgets` rows. A weekly budget exists when `weeklyCapCents` is an integer, including 0. A monthly budget exists when `monthlyCapCents` is an integer. Null means no budget row. Budget `amount_cents` is the cap. `start_date` is `2026-01-01`. The budgets table has no kind column.

Transactions with no `accountId` use an `accounts` row named `Unassigned`, type `other`, currency `USD`. That row is not a web account, so it is absent from the account list and from net worth. The stored transaction document still omits `accountId`. The API presenter returns `accountId: null`, which is the same shape Upstash already returns.

Goal web statuses are `active`, `not_started`, `paused`, and `inactive`. The box `goals.status` check only allows `active`, `paused`, `completed`, and `cancelled`. `not_started` is stored as `active` in that column. `inactive` is stored as `paused`. `finance_goal_status` keeps the web status, including `not_started` and `inactive`. The goals array returned by the API is the web document, so an explicit status is unchanged.

Account types: checking, savings, and cash stay; credit card becomes `credit`; investment, retirement, brokerage, and crypto become `investment`; loan, installment, student, and anything else become `other`.

## Gaps

- `goals.status` cannot store `not_started` or `inactive` without editing `001`. Those values live on the web document and in `finance_goal_status`. The box column stores the collapsed value.
- `budgets` has no kind column. `kind` `expense` is `categories.kind`. The budget row is the cap amount.
- Bills have no box table. Plan cents, snapshots and the net-worth series, the legacy account snapshot, colors, slugs, sort, groups, and the extra transaction fields (`type`, `source`, `correction`, `ledger`, `mask`, `impulse`, `billId`, `periodDue`) have no box columns. They stay in `finance_docs` or `finance_blobs`. Reads return those documents.
- Account balances and loan fields have no box columns. They stay on the account document.
- `Unassigned` is a box account only.
- `notion_id` stays null. A non-Notion `sourceId` stays on the web document and is not copied into `notion_id`.
- Idempotency keys and the transaction by-source index stay on Upstash until S11.
- The Upstash seed does not apply `JOEHUB_MONTHLY_PLAN`, `JOEHUB_NET_WORTH_SERIES`, or `JOEHUB_SEED_GOALS`. The libSQL seed matches that. Those switches still affect the in-memory store only.
