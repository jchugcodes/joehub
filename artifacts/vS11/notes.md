# S11 Finance writes on libSQL

With `JOEHUB_BACKEND_FINANCE=sqlite`, every Finance read and write goes through libSQL. The flag defaults to `upstash`. Unset means Upstash for reads and writes, so production does not change. This slice does not set a Vercel env, does not create a Turso database, and does not copy real finance data.

`JOEHUB_BACKEND_TASKS` and `JOEHUB_BACKEND_GROCERY` stay separate. Setting the finance flag does not move Tasks, Grocery, lists, sessions, devices, or the API rate limit. `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN` do not select a backend. `JOEHUB_LIBSQL_URL` and `JOEHUB_LIBSQL_AUTH_TOKEN` win when both pairs are set. Startup uses the same remote-only check already driven by any sqlite area.

`web/lib/live-pages.mjs` and `web/lib/overlay-flag.mjs` are unchanged. Their git blobs stay `f0c23a7637db0ad4d3e6e1fe98837b9878f62098` and `c3af66a42247cd7baf351e56a2736c1defc28245`. No page markup changed. Ingest is unchanged.

Migrations `001` through `007` are unchanged. `008_finance_writes.sql` adds `finance_idem` and `finance_sources` only. The box tables `accounts`, `transactions`, `categories`, `budgets`, and `goals` keep the schema from `001`. Each finance write loads the book, applies the same pure function Upstash uses, and saves inside one libSQL write transaction. Validation errors, field names, and status codes match Upstash. A successful Idempotency-Key response is stored for 24 hours and is not cleared when the book is rewritten.

Bots read `goals.status` directly. A goal saved as `inactive` writes `paused` there. A goal saved as `not_started` writes `active`. `active` and `paused` are written as themselves. The exact status always goes to `finance_goal_status`. The web goals document still returns the exact status.

## Audit

| Path | What it touches | When the flag is sqlite |
| --- | --- | --- |
| `GET /api/finance/overview`, category, categories, spending month | the read methods from S9 | libSQL |
| `GET /api/finance/accounts` and `GET /api/finance/accounts/:id` | account documents | libSQL |
| `POST /api/finance/accounts` | `financeCreateAccount`, idempotency key `joehub:finance:account:idem:{key}` | libSQL, one transaction |
| `PATCH /api/finance/accounts/:id` | `financePatchAccount`. A ledger account can only change `hiddenFromNetWorth`. Loan fields already on the document stay. | libSQL, one transaction |
| `DELETE /api/finance/accounts/:id` | `financeDeleteAccount`. Refuses a ledger account and an account that still has transactions. | libSQL, one transaction |
| `GET /api/finance/debts` and `GET /api/finance/debts/:id` | read-only view of liability accounts | libSQL. There is no debts write route. |
| `GET /api/finance/bills` and `GET /api/finance/bills/:id` | bill documents, including the due-date projection | libSQL. A projection that changes a bill is one transaction. |
| `POST /api/finance/bills` | `financeCreateBill`, idempotency key `joehub:finance:bill:idem:{key}` | libSQL, one transaction |
| `PATCH /api/finance/bills/:id` | `financePatchBill`, including mark paid | libSQL, one transaction |
| `DELETE /api/finance/bills/:id` | `financeDeleteBill` | libSQL, one transaction |
| `GET /api/finance/goals` and the goals pages | the goals document | libSQL |
| `POST /api/finance/goals` | `financeCreateGoal`, idempotency key `joehub:finance:goal:idem:{key}` | libSQL, one transaction |
| `PATCH /api/finance/goals/:slug` | `financePatchGoal`. Status is written to `goals.status` with the collapse above, and the exact status to `finance_goal_status`. | libSQL, one transaction |
| `DELETE /api/finance/goals/:slug` | `financeDeleteGoal` | libSQL, one transaction |
| `PATCH /api/finance/caps` | `financeSaveCaps`, idempotency key `joehub:finance:txn:idem:{key}` | libSQL, one transaction |
| `PATCH /api/finance/budgets` | `financeSaveBudgets`, the plan `budgetsSaved` flag, idempotency key `joehub:finance:budget:idem:{key}` | libSQL, one transaction |
| `GET /api/finance/transactions` and `GET /api/finance/transactions/:id` | transaction documents | libSQL |
| `POST /api/finance/transactions` | `financeCreateTransaction`, idempotency key `joehub:finance:txn:idem:create:{key}` | libSQL, one transaction |
| `PATCH /api/finance/transactions/:id` | `financePatchTransaction` (payee, amount, date, category, type, account) | libSQL, one transaction |
| `POST /api/finance/transactions/import` | `financeImportTransaction` | libSQL, one transaction |
| `POST /api/finance/ledger/simulate-refresh` | `financeSimulateRefresh`. Production still returns 404 before the store. | libSQL, one transaction |
| `POST /api/finance/transactions/:id/reset-ledger` | `financeResetLedger` | libSQL, one transaction |
| `joehub:finance:txn:bysource:{sourceId}` | `finance_sources` | A second create with the same source id patches that transaction. Rebuilt from the documents. |
| `joehub:finance:txn:{id}`, account documents, bill documents, caps, categories, plan, goals, snapshots, legacy accounts | `finance_docs` and `finance_blobs`, plus the box projection | libSQL |
| Spending page rename, note, tags, exclude, recurring, bucket hide | no store method, route, or field | Not in this app. See the gap below. The spending writes that exist are the transaction patch, caps, and budgets rows above. |
| Tasks, Grocery, lists, sessions, devices, ingest, API rate limit | their existing stores | Unchanged |

## Gaps

The box `goals.status` check is still only `active`, `paused`, `completed`, and `cancelled`. `inactive` is stored as `paused`. `not_started` is stored as `active`. `finance_goal_status` keeps the exact value. The API goals document also keeps the exact value.

`budgets` has no `kind` column. Kind stays on `categories`. A weekly or monthly cap is a budget row. A null cap has no budget row. Integer `0` is a real budget.

Bills, the plan total, snapshots, the legacy accounts snapshot, colors, slugs, sort, groups, and the extra transaction and loan fields have no box columns. They stay in `finance_docs` or `finance_blobs`. Reads return those web documents, so the JSON matches Upstash.

A transaction with no account is stored on the box `Unassigned` account. That account is not in the web account list and does not change net worth. The web document omits `accountId`. The API returns `accountId: null`.

`notion_id` stays null. A non-Notion `sourceId` stays on the web document and in `finance_sources`.

There is no debts write route. Debts and loans are account documents. Creating, patching, and deleting an account is the write path. A patch keeps loan fields that are already on the document.

The spending overlays named in the slice (rename, note, tags, exclude, recurring, bucket hide) are not store methods, routes, or fields in this app. Nothing was invented for them. Payee, amount, date, category, and type already change through `PATCH /api/finance/transactions/:id`. Caps and monthly budgets already change through their routes. Those paths are on libSQL.

`JOEHUB_MONTHLY_PLAN`, `JOEHUB_NET_WORTH_SERIES`, and `JOEHUB_SEED_GOALS` still affect the in-memory store only. They do not change Upstash or libSQL seed data.

## S12 cutover

A person runs this on a private machine after Joe says yes. This slice does not run the scripts against a real database. The scripts use synthetic fixtures in tests. They print counts, ids, and hashes only. They do not print amounts, payees, balances, or account names. Snapshot and rows files are mode 600.

Joe's OK is required three times:

1. Before `finance-export.mjs`. The flag is `--i-have-joes-ok`.
2. Before `finance-import.mjs`. The same flag.
3. Before setting `JOEHUB_BACKEND_FINANCE=sqlite` in Vercel production.

Ask everyone to stop editing Finance. From the export until verify prints `PASS`, do not add or edit a transaction, category, cap, budget, bill, goal, account, or debt. If Upstash changes after the export, stop and export again. Do not flip the flag.

Upstash is only read. Export rejects every write command. Import and verify never talk to Upstash. The export copies the finance documents: transactions, accounts, bills, categories, caps, the plan, goals, snapshots, and the legacy accounts snapshot. It skips the transaction index, the account index, the bill index, every idempotency key, the by-source index, and the seed flags. Import rebuilds the box rows and the by-source index from the documents. Idempotency keys are not copied.

Run these from `web/`. Fill in the real values yourself. Do not commit them.

```bash
export UPSTASH_REDIS_REST_URL="https://YOUR-UPSTASH.upstash.io"
export UPSTASH_REDIS_REST_TOKEN="YOUR_UPSTASH_TOKEN"
export TURSO_DATABASE_URL="libsql://YOUR-DB.turso.io"
export TURSO_AUTH_TOKEN="YOUR_TURSO_TOKEN"
```

If `JOEHUB_LIBSQL_URL` or `JOEHUB_LIBSQL_AUTH_TOKEN` is set, it wins over the `TURSO_` value.

```bash
node scripts/finance-export.mjs --i-have-joes-ok --out /secure/joehub-finance-snapshot.json

node scripts/finance-transform.mjs \
  --in /secure/joehub-finance-snapshot.json \
  --out /secure/joehub-finance-rows.json

JOEHUB_LIBSQL_URL="$TURSO_DATABASE_URL" JOEHUB_LIBSQL_AUTH_TOKEN="$TURSO_AUTH_TOKEN" \
  node scripts/libsql-migrate.mjs

node scripts/finance-import.mjs --i-have-joes-ok --in /secure/joehub-finance-rows.json

node scripts/finance-verify.mjs --snapshot /secure/joehub-finance-snapshot.json
```

Export and transform print `transactions`, `accounts`, `bills`, `goals`, and a sha256. Import prints those counts. Verify prints `PASS` or `FAIL`, then the same counts. On failure it prints the mismatched ids and exits non-zero. It does not print amounts or names. Do not flip the flag on `FAIL`.

`:memory:` and `file:` URLs are refused unless `--test` is passed. A remote URL needs a token. Import refuses a database that already has finance rows unless `--merge` is passed. `--merge` replaces the finance book in one transaction. It does not delete `finance_idem`.

Do not set `JOEHUB_BACKEND_TASKS` or `JOEHUB_BACKEND_GROCERY` as part of this cutover. In Vercel production, set only:

```bash
JOEHUB_BACKEND_FINANCE=sqlite
```

Leave the remote URL and token in place. Do not point either URL at a file. Redeploy, then open Finance while signed in. The pages should match the verify counts.

## Rollback

Unset `JOEHUB_BACKEND_FINANCE` in Vercel production and redeploy. The app goes back to Upstash. Nothing in this copy deletes or changes Upstash. Leave the libSQL rows where they are. They are unused while the flag is unset.
