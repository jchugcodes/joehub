# S2 libSQL schema

The Turso schema is the box database plus new tables. `web/migrations-libsql/001_initial.sql` and `002_writers_and_registry.sql` are the same bytes as `migrations/001_initial.sql` and `migrations/002_writers_and_registry.sql`. A row copied from the box database lands in the same table, column, and id. Nothing in those two files was renamed or retyped.

`003_tasks.sql` adds the Tasks tables the S1 store already uses: `tasks`, `task_idempotency`, and `task_flags`. `004_grocery_and_lists.sql` adds stub tables for grocery items and lists. The app does not read those stubs yet. No box table was altered.

`web/scripts/libsql-migrate.mjs` applies those files in order and writes one `schema_migrations` row per file, in the same shape as the Python runner: a new UUID, null `notion_id`, null `migrated_on`, `last_modified_by` `system`, and the same UTC timestamp in `last_modified_at` and `applied_at`. The version is the file name. It refuses `:memory:` and `file:` URLs unless `--test` is passed. This PR never points it at a real database.

Every box table also has `id` (a 36-character UUID), `notion_id`, `migrated_on`, `last_modified_by`, and `last_modified_at`. The web app does not store those, except where a field below names one of them.

## Categories

The web keeps one JSON list. The box keeps one row per category.

| Web field | Box column | Proposal |
| --- | --- | --- |
| slug | no box equivalent | The box identifies a category by `categories.id` and `categories.name`. Match a box row by name when the name is unique, and keep the slug for the web. Do not put the slug in `id`. |
| name | categories.name | Copy the name as written. |
| weeklyCapCents | no box equivalent | This is a weekly budget, not a category column. One `budgets` row with `period` `weekly` and `amount_cents` set to this number. A null cap means no weekly row. |
| monthlyCapCents | no box equivalent | Same, with `period` `monthly`. A null amount means no monthly row. |
| capCents | no box equivalent | The web copies the weekly cap here for the week screen. Do not store it a second time. |
| sort | no box equivalent | Screen order only. |
| color | no box equivalent | Screen color only. |
| group | no box equivalent | Optional label. The box has no group column. |
| (none) | categories.kind | The box requires `income`, `expense`, or `transfer`. These web categories are spending envelopes. Proposed value: `expense`. |

## Budgets

The web has no budgets table. Weekly caps are a map of slug to cents. Monthly amounts live on each category as `monthlyCapCents`. The plan total is a separate number, with a flag that someone saved the monthly budgets.

| Web field | Box column | Proposal |
| --- | --- | --- |
| weekly cap for a slug | budgets.amount_cents | One row per category that has a weekly cap. `period` is `weekly`. `category_id` is the matched category. |
| monthlyCapCents | budgets.amount_cents | One row per category that has a monthly amount. `period` is `monthly`. |
| plan total | no box equivalent | The box does not store a grand total. It is the sum of the rows. |
| budgetsSaved | no box equivalent | Only remembers that Save was pressed. |
| (none) | budgets.name | Required. Use the category name. |
| (none) | budgets.account_id | Leave empty. Web budgets are not tied to an account. |
| (none) | budgets.start_date | Required, and the web caps have no start date. Use the day the row is first loaded, and leave `end_date` empty. |
| (none) | budgets.period | `weekly` or `monthly`, from the two rows above. The box also allows `yearly`. The web has no yearly category budget. |

## Goals

The web keeps one JSON list, found by slug. The box keeps one row per goal, found by UUID.

| Web field | Box column | Proposal |
| --- | --- | --- |
| slug | no box equivalent | Match a box row by `goals.name`. Keep the slug for the web. Do not put the slug in `id`. |
| name | goals.name | Copy the name as written. |
| savedCents | goals.current_cents | Same integer cents. |
| targetCents | goals.target_cents | Same integer cents. The web requires a target above zero. The box allows zero. |
| targetDate | goals.target_date | Same `YYYY-MM-DD` when the web has one. |
| account | goals.account_id | The web stores an account name. Look up `accounts.name` and store that row's id. A blank name, or a name that matches nothing, stays empty. |
| status | goals.status | Web values are `active`, `not_started`, `paused`, and `inactive`. Box values are `active`, `paused`, `completed`, and `cancelled`. Proposed: `active` stays `active`, `paused` stays `paused`, `not_started` becomes `active`, `inactive` becomes `paused` because the web hides both paused and inactive goals. `completed` and `cancelled` are box values the web does not use. |
| monthlyCents | no box equivalent | A monthly contribution. The box goal has no monthly amount. |
| kind | no box equivalent | `Savings` or `Debt`. The box goal has no such flag. |
| color | no box equivalent | Screen color only. |
| note | no box equivalent | Short text. The box goal has no note. |
| value, amount, target | no box equivalent | A percent and two display strings. The box stores cents. Do not copy the strings. |
| period | no box equivalent | One seed goal is marked yearly. The box goal has no period. |

## Accounts

The web stores each account as its own document. Ids look like `acct-checking`. The box id must be a 36-character UUID, so those web ids cannot be copied into `accounts.id`.

| Web field | Box column | Proposal |
| --- | --- | --- |
| id | accounts.id | Mint a new UUID. Keep the web id outside the box columns. |
| name | accounts.name | Copy the name as written. |
| type | accounts.account_type | `checking`, `savings`, and `cash` stay. `credit card` becomes `credit`. `investment`, `retirement`, `brokerage`, and `crypto` become `investment`. `loan`, `installment`, and `student` become `other`. |
| institution | accounts.institution | Copy it when the web has one. |
| (none) | accounts.currency | The web has no currency. Use `USD`. |
| balanceCents | no box equivalent | The box does not store a balance on the account. The web balance is a snapshot. |
| source | no box equivalent | `ledger` or `manual`. No box column. |
| createdAt | no box equivalent | No created-at column on the box account. |
| updatedAt | accounts.last_modified_at | Closest column. That timestamp is the writer time, not the balance time. |
| balanceAsOf | no box equivalent | No box column. |
| hiddenFromNetWorth | no box equivalent | No box column. |
| closed | no box equivalent | No box column. |
| estimate | no box equivalent | No box column. |
| mask | no box equivalent | Four display digits. No box column. |
| sourceId | accounts.notion_id | Only when the value is a Notion page id. Any other external id has no box column. |
| loanKind, rateBps, minimumCents, nextDue, paymentsLeft, paymentsTotal | no box equivalent | Loan details. The box account has none of these. |
| group, amountCents, stale | no box equivalent | Computed for the screen. Do not store them. |

## Transactions

Web ids look like `fin-pizza`. The box id must be a UUID, so those ids cannot be copied into `transactions.id`. Amounts are integer cents in both places, and money out is negative in both places.

| Web field | Box column | Proposal |
| --- | --- | --- |
| id | transactions.id | Mint a new UUID. Keep the web id outside the box columns. |
| payee | transactions.payee | Copy the payee as written. |
| amountCents | transactions.amount_cents | Copy the signed integer cents. |
| date | transactions.date | Same `YYYY-MM-DD`. |
| category | transactions.category_id | The web stores a slug. Store the matched category's UUID. An empty category stays empty. |
| accountId | transactions.account_id | Required in the box. Map the web account to its new UUID. A transaction with no account cannot be a box row until an account is chosen. |
| type | no box equivalent | `expense`, `income`, `transfer`, or `refund`. The box has no type. The sign of the amount covers direction. A transfer is not marked on its own. |
| source | no box equivalent | `manual`, `ledger`, or `bill`. No box column. |
| sourceId | transactions.notion_id | Only when the value is a Notion page id. Otherwise no box column. |
| accountMask | no box equivalent | No box column. |
| impulse | no box equivalent | No box column. |
| correction | no box equivalent | The web keeps an edited payee, amount, and category on top of the imported row. The box stores one of each. Proposed: the corrected values are the box row. The original import has no box column. |
| ledger.original, ledger.latest | no box equivalent | Import history. No box column. |
| meta, corrected, uncategorized | no box equivalent | Computed for the screen. |
| billId, periodDue | no box equivalent | The web can point a transaction at a bill. The box transaction cannot. |
| createdAt, updatedAt | transactions.last_modified_at | Closest column for `updatedAt`. There is no created-at column. |
| (none) | transactions.goal_id | The web transaction does not point at a goal. Leave empty. |
| (none) | transactions.memo | The web spending row has no memo. Leave empty. |

## Tasks

The box database has no tasks table. Every web task field is no box equivalent.

S2 still stores them, in the new tables, because that is what the S1 store reads. This is not a translation of a box row.

| Web field | Box column | Where S2 stores it |
| --- | --- | --- |
| id | no box equivalent | tasks.id |
| title, notes, dueDate, priority, project, updatedAt, bot | no box equivalent | Inside `tasks.body`, the JSON document |
| status | no box equivalent | `tasks.status`, and again inside the JSON |
| createdAt | no box equivalent | `tasks.created_at`, as milliseconds, and again inside the JSON |
| completedAt | no box equivalent | `tasks.completed_at`, and again inside the JSON |
| sourceId | no box equivalent | `tasks.source_id`, and again inside the JSON |

`project` is a list id or a list name inside that JSON. It is not a foreign key. Idempotency keys live in `task_idempotency`. Seed flags live in `task_flags`. Neither exists in the box.

## Grocery and lists

The box has no grocery table and no lists table. The shapes in the web app are clear, so S2 adds stubs and does not read them.

A grocery item has id, name, quantity, notes, section, checked, created_at, updated_at, and source_id. A list has id, name, color, created_at, and updated_at. The count shown on a list is how many tasks use that list as `project`. It is not a column.

## Escape while a category is loading

The Spending test does press Escape once the Groceries panel is on screen and the category request is stalled. It then waits until the dialog is gone and the URL no longer has `cat=`. That test is on main, in the commit merged with PR #73, and both web CI jobs on that commit were green.

Escape during that load does close the panel. The listener is attached as soon as a category is open. It does not wait for the category fetch. Escape removes `cat` from the address, and the panel is shown only while `cat` is set, so the panel closes. The panel body says "Loading…" until the fetch returns. The listener stays off when a transaction is open, the budget editor is open, or a transaction inside the category panel is open. The loading state is none of those, so no code change was made.
