# joehub schema

joehub stores three domains in one SQLite database. **Ledger** keeps the books, **Scout** keeps the job search, and **Cato** keeps the journal, calendar, bot log, and export log. A row in `owners` names each of those writers. `table_registry` gives every domain table exactly one of those owners through a real foreign key. The public write API allows only Ledger, Scout, and Cato, and only on the table that owner is registered for.

Money is an integer number of cents. Identifiers are UUID text and cannot be updated. There is no credential table. Password hashes and the age identity live outside the database.

## Common columns

Every table has:

| Column | Rules |
| --- | --- |
| `id` | Text UUID primary key. Immutable. |
| `notion_id` | Nullable text. Unique when present. |
| `migrated_on` | Nullable UTC timestamp `YYYY-MM-DDTHH:MM:SSZ`. |
| `last_modified_by` | Required. The write layer sets this to the owner. |
| `last_modified_at` | Required UTC timestamp. The write layer sets this. |

Triggers abort any update of `id`.

## Owners

| Owner | Tables |
| --- | --- |
| Ledger | `categories`, `accounts`, `budgets`, `goals`, `transactions` |
| Scout | `companies`, `contacts`, `applications`, `application_status_history` |
| Cato | `events`, `journal_entries`, `bot_activity`, `export_history` |

Meta tables are not in `table_registry` and are not writable by those owners: `schema_migrations`, `owners`, `table_registry`, `write_queue`, `locks`, `errors`, `pending_deletes`.

## Ledger

- `categories`: `name`, `kind` (`income`, `expense`, `transfer`).
- `accounts`: `name`, `account_type` (`checking`, `savings`, `credit`, `cash`, `investment`, `other`), `institution`, `currency` (3 letters, default `USD`).
- `budgets`: `name`, `category_id`, optional `account_id`, `period` (`weekly`, `monthly`, `yearly`), `amount_cents` (>= 0), `start_date`, optional `end_date`.
- `goals`: `name`, `target_cents` (>= 0), `current_cents` (>= 0), optional `target_date`, optional `account_id`, `status` (`active`, `paused`, `completed`, `cancelled`).
- `transactions`: `account_id`, optional `category_id`, optional `goal_id`, `amount_cents` (required integer, negative for outflow), `date` (required `YYYY-MM-DD`), optional `payee`, optional `memo`.

## Scout

- `companies`: `name`, optional `website`, optional `notes`. Names are not unique, so two companies can share a name.
- `contacts`: optional `company_id`, `name`, optional `email`, `role`, `notes`.
- `applications`: optional `company_id`, optional `contact_id`, `role_title`, `status`, optional `applied_on`, `notes`, and the raw source columns `raw_company`, `raw_contact`, `raw_status`, `raw_source`.
- `application_status_history`: `application_id`, optional `from_status`, `to_status`, `event_kind`, `occurred_at`, optional `note`.

`status` and the history status columns use exactly: `Interested`, `Applied`, `Interviewing`, `Offer`, `Rejected`, `Passed`.

`event_kind` is `migration_baseline` for an imported starting point, or `transition` for a real status change. Inserting an application writes one history row in the same transaction. Updating `status` writes another. `company_id` and `contact_id` stay null unless the payload includes an id that exists, or `raw_company` / `raw_contact` matches exactly one row (contacts are matched inside the resolved company when there is one). Raw text is stored as given, including case and surrounding spaces.

## Cato

- `events`: `title`, `starts_at`, optional `ends_at`, `location`, `notes`.
- `journal_entries`: `entry_date`, optional `title`, `body`, optional `mood`.
- `bot_activity`: `bot_name`, `action`, `occurred_at`, optional `detail`.
- `export_history`: `started_at`, optional `finished_at`, `status` (`running`, `succeeded`, `failed`), `export_dir`, optional `remote`, optional `push_status` (`pushed`, `refused`, `failed`), optional `detail`.

## Writes, locks, and deletes

`write_queue` is the single-writer log. Each call has an idempotency key. A committed key returns the original row and does not apply a later payload. A failed key stays failed.

`locks` holds one hall pass, `lock_name = hall_pass`. The holder and expiry are committed before the domain change. Another writer can take the pass only after `expires_at`. Releasing the pass deletes the row only when the holder id matches, so a crashed holder cannot clear a recovered pass. The domain change and the queue row's `committed` status share one transaction. If that transaction rolls back, the domain rows disappear and `errors.persistent` is set to `1`.

Lock contention and a busy database are retried a bounded number of times (`JOEHUB_MAX_RETRIES`). Validation errors, unauthorized owners, and exhausted retries are recorded immediately and are not applied again under the same key.

Hard delete is two operations on the same owner:

1. `delete_request` inserts `pending_deletes` with `status = pending` and leaves the row in place. A non-owner cannot start this.
2. `delete_confirm` deletes the row and sets the pending record to `confirmed`. The same owner must confirm. A second open request for the same row is rejected. Foreign keys are `ON DELETE RESTRICT`, so a parent with children is left in place and the confirm rolls back.

## Exports

Each table, including empty ones and `export_history`, is written to `<table>.csv.age`. NULL is an empty CSV field. Non-empty text is kept, including commas, quotes, and newlines. Restore rebuilds a migrated database, replaces every row, and checks foreign keys. Integer columns are loaded as integers so cent amounts stay integers.

The age identity is not a column and is not exported.

## Migrations

`migrations/001_initial.sql` creates this schema and seeds the three owners plus `table_registry`. Later migrations must not drop tables or indexes. `schema_migrations` records the filename of each applied file.
