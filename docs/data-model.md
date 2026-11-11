# Redis data model

This is the record layout for the web app's Upstash store. `docs/SCHEMA.md` describes an older SQLite design and is not what the web app reads.

Joe's import writes these keys directly. It does not go through the HTTP API. This app never sees that data. Synthetic samples are not written when `VERCEL_ENV` is `production`. Preview, local dev, and tests still seed. `NODE_ENV=production` alone does not turn seeding off.

## Key prefix

Logical names below start with `joehub:`. The stored key replaces that prefix with `JOEHUB_KEY_PREFIX`.

- Unset or empty prefix stores the logical name unchanged (`joehub:`).
- A set prefix must match `^[a-z0-9-]+:$`, for example `joehub-preview:`.
- An invalid prefix fails closed. The app does not fall back onto `joehub:`.
- Production and preview must use different prefixes when they share one database.

Record keys have no TTL. Idempotency keys (`*:idem:*`) expire after 86400 seconds and are not part of an import.

There is no secondary index by external id. Redis keys use the ids below. An optional `sourceId` string records where a row came from, for example `notion:<pageId>`. The app stores it and returns it. It does not look rows up by it. Omit the field when there is no external id. A present value must match `^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$`.

## Tasks

| Key | Type | Value |
| --- | --- | --- |
| `joehub:task:{id}` | string | One task JSON object |
| `joehub:tasks:active` | zset | Member is the id. Score is `createdAt`. Open tasks only. |
| `joehub:tasks:done` | zset | Member is the id. Score is `completedAt`. Done tasks only. |
| `joehub:tasks:seeded` | string | Synthetic flag `"1"`. Not used by an import. |
| `joehub:tasks:seeded:v2` | string | Synthetic flag `"1"`. |
| `joehub:tasks:seeded:v3` | string | Synthetic flag `"1"`. |
| `joehub:tasks:seeded:v4` | string | Synthetic flag `"1"`. |

`id` matches `^[A-Za-z0-9-]{1,80}$`. New tasks created in the app are UUIDs.

Required: `id`, `title` (1–200), `status`, `createdAt` (epoch ms), `updatedAt` (epoch ms).

`status` is `To do`, `Doing`, `Blocked`, or `Done`. A `Done` task also has `completedAt` (epoch ms) and belongs in the done zset. Any other status belongs in the active zset.

Optional: `notes` (text, up to 4000), `dueDate` (`YYYY-MM-DD`), `priority` (`High`, `Medium`, or `Low`), `project` (text, up to 120), `sourceId`, `bot` (`{ name, detail, progress }` with `progress` a number).

`joehub:task:bysource:{sourceId}` is a string, the task id, with no TTL. A second create with the same `sourceId` updates that task.

## Grocery

| Key | Type | Value |
| --- | --- | --- |
| `joehub:grocery:item:{id}` | string | One item JSON object |
| `joehub:grocery:items:unchecked` | zset | Member is the id. Score is `createdAt`. Unchecked items. |
| `joehub:grocery:items:checked` | zset | Member is the id. Score is `checkedAt` or `updatedAt`. Checked items. |
| `joehub:grocery:seeded` | string | Synthetic flag `"1"`. Not used by an import. |

`id` matches `^[A-Za-z0-9-]{1,80}$`.

Required: `id`, `name` (1–200), `checked` (boolean), `createdAt`, `updatedAt`.

Optional: `quantity` (text, up to 80), `notes` (up to 4000), `section` (up to 120), `checkedAt` (epoch ms, set when `checked` is true), `sourceId`.

An item is in exactly one of the two zsets.

`joehub:grocery:item:bysource:{sourceId}` is a string, the item id, with no TTL. A second create with the same `sourceId` updates that item.

## Finance categories, caps, and plan

Categories live in one list. The old caps object is still read so a database that only has it keeps working.

| Key | Type | Value |
| --- | --- | --- |
| `joehub:finance:categories` | string | JSON array of category objects, ordered by `sort`. |
| `joehub:finance:caps` | string | Legacy JSON object of slug to integer cents. `0` is a set cap. Missing slugs are not implied. |
| `joehub:finance:plan` | string | `{ "cents": <integer> }`. The weekly plan. |
| `joehub:finance:goals` | string | JSON array. Each goal has `slug`, `name`, `value` (number), `amount`, `target`, `note`. |
| `joehub:finance:snapshots` | string | `{ netWorthCents, ytdDeltaCents, caption, points }`. `points` is an array of integer cents for the chart. |
| `joehub:finance:accounts` | string | Legacy snapshot. See below. |
| `joehub:finance:seeded` | string | Synthetic flag `"1"`, or a one-time legacy blob that has already been migrated. Not used by an import. |

A category object:

| Field | Required | Rules |
| --- | --- | --- |
| `slug` | yes | Stable id. Lowercase words and hyphens. Existing slugs stay `groceries`, `dining-out`, `transport`, `utilities`, `subscriptions`, `shopping`. |
| `name` | yes | Display name. Seed names: Groceries, Dining Out, Gas & Transport, Bills & Utilities, Subscriptions, Shopping, Health & Fitness, Fun, School, Other. |
| `group` | no | Short text. Omit when there is no group. |
| `weeklyCapCents` | yes | Integer cents, or `null` when this category has no weekly cap. `0` is a cap of zero and stays in the envelope. |
| `monthlyCapCents` | yes | Integer cents, or `null`. |
| `sort` | yes | Integer. Lower numbers come first. |

The weekly envelope is the sum of the `weeklyCapCents` values that are integers. Categories with `weeklyCapCents: null` still show in the spending breakdown and are left out of the envelope.

When `finance:categories` is missing, the app builds that list from the seed categories and copies any integer values in `finance:caps` onto `weeklyCapCents`. Saving caps writes both keys. An import should write `finance:categories`. It can also write `finance:caps` for the slugs that have a weekly cap.

The preview seed is those ten categories. The first six keep the current weekly caps (`12000`, `8000`, `6000`, `0`, `5500`, `7500` cents) so the envelope is still `$390`. `health-fitness`, `fun`, `school`, and `other` have a null weekly cap.

The overview also reads plan, snapshots, the legacy accounts snapshot, and goals. If the category list and the caps key are both missing, or plan, snapshots, the accounts snapshot, or goals is missing, the finance API returns unavailable. Money is integer cents.

## Transactions

| Key | Type | Value |
| --- | --- | --- |
| `joehub:finance:txn:{id}` | string | One transaction JSON object |
| `joehub:finance:txns` | zset | Member is the id. Score is `YYYYMMDD * 1000000 + (createdAt % 1000000)`. |
| `joehub:finance:txn:bysource:{sourceId}` | string | The transaction id. One key per `sourceId`. |

`id` matches `^[A-Za-z0-9._:-]{1,80}$`.

Required: `id`, `payee` (1–80), `date` (`YYYY-MM-DD`), `type`, `amountCents`, `source`, `createdAt`.

`type` is `expense`, `income`, `transfer`, or `refund`. `amountCents` is a non-zero integer with absolute value at most `100000000`. Expenses and transfers are negative. Income and refunds are positive. `category` is a slug or `null`. Income and transfers use `null`. `source` is `manual` or `ledger`.

Optional: `updatedAt`, `sourceId`, `accountMask`, `impulse`, `correction`, `ledger`.

`accountMask` is exactly four digits, the last four of an account number. There is no field for a full account number. Omit it when it is unknown. `impulse` is a boolean. Omit it when it was not set. `false` is stored as `false`.

`joehub:finance:txn:bysource:{sourceId}` holds the transaction id with no TTL. A create with a `sourceId` that is already indexed updates that transaction instead of inserting another. The same pattern is `joehub:task:bysource:{sourceId}` and `joehub:grocery:item:bysource:{sourceId}`.

`correction`, when present, is `{ payee, date, type, amountCents, category, updatedAt }` for a ledger row the app has edited. `ledger` holds `{ original, latest }` import snapshots. Keep `sourceId` on the transaction object, not inside `correction`.

`accountId` is optional and is defined with accounts below. Existing rows without it stay valid.

## Accounts

Manual accounts are separate from the legacy snapshot at `joehub:finance:accounts`.

The legacy snapshot is one JSON object:

```json
{
  "netWorthCents": 1847236,
  "assetsCents": 2647236,
  "liabilitiesCents": 800000,
  "updatedAt": "2026-11-10T14:58:00.000Z",
  "accounts": [{ "name": "Example checking", "group": "Cash", "amountCents": 247236 }]
}
```

`group` is `Cash`, `Investments`, `Liability`, or `Other`. `updatedAt` is an ISO timestamp. `amountCents` is an integer. This object has no per-account ids. When no manual accounts are stored, the accounts page and the net worth figure use this snapshot.

Manual account records:

| Key | Type | Value |
| --- | --- | --- |
| `joehub:finance:account:{id}` | string | One account JSON object |
| `joehub:finance:accounts:index` | zset | Member is the id. Score is `createdAt`. |
| `joehub:finance:seeded:v2` | string | Synthetic flag `"1"` for the sample accounts only. An import does not set it. Production does not write it. |

`id` matches `^acct-[A-Za-z0-9._:-]{1,70}$`.

Required: `id`, `name` (1–80), `type`, `balanceCents`, `createdAt` (epoch ms), `updatedAt` (epoch ms).

`type` is `checking`, `savings`, `credit card`, `cash`, `investment`, `loan`, or `other`. `balanceCents` is an integer with absolute value at most `100000000`. `0` is allowed. `credit card` and `loan` are liabilities. Every other type is an asset.

When the index has at least one account, net worth is the sum of asset `balanceCents` minus the sum of liability `balanceCents`. The accounts page lists those records. The legacy snapshot totals are not used for that figure. Write the legacy snapshot as well, with the same totals, so a database that has no manual accounts still has a figure, and so the overview's required-key check succeeds.

Optional: `sourceId`, and `mask`. `mask` is exactly four digits, the last four of an account number. There is no field for a full account number. Omit `mask` when it is unknown. Do not write any other number field.

A transaction's optional `accountId` is one of these account ids. The app rejects a transaction write whose `accountId` is not in the index. Rows with no `accountId` stay valid.

## What production skips

With `VERCEL_ENV=production`, the app does not write `joehub:tasks:seeded`, `joehub:tasks:seeded:v2`, `joehub:tasks:seeded:v3`, `joehub:tasks:seeded:v4`, `joehub:grocery:seeded`, or `joehub:finance:seeded`. The accounts flag `joehub:finance:seeded:v2` is gated the same way by the accounts change. Preview still writes the current flags and the sample rows.
