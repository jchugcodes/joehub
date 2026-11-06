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
| Cato | `events`, `journal_entries`, `bot_activity`, `export_history`, and the meta tables below |

Every table has exactly one `table_registry` row. Meta tables are owned by Cato so the registry is complete: `schema_migrations`, `owners`, `table_registry`, `write_queue`, `locks`, `errors`, `pending_deletes`, `principals`, `delegations`.

Privileged maintenance is the only writer of those meta tables. That means the migration runner, the hall-pass and queue implementation, error logging, delegation records, and restore. The public write API does not accept them. Cato's domain credential cannot insert into `schema_migrations`. Maintenance is not permission for a bot to write Ledger or Scout tables.

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
- `export_history`: `started_at`, optional `finished_at`, `status` (`running`, `succeeded`, `failed`), `export_dir`, optional `remote`, optional `push_status` (`pushed`, `refused`, `failed`), optional `publication_state` (`not_requested`, `pushed`, `refused`, `failed`, `incomplete`), optional `detail`. `succeeded` is recorded only after a snapshot has been published. `publication_state = incomplete` means a push landed without the final audit commit.

## Writers

A caller presents a server-issued token. The plaintext lives under the key directory (`principals/<name>.token`, mode 600) and the database stores only its SHA-256. Passing the string `Ledger`, `Scout`, or `Cato` does not authenticate. Owner principals may write only their own tables. The human principal `operator` may write a domain table only after `delegations` has an unrevoked row for that human and that owner. Creating that row is an explicit, audited action and only the human credential can do it. A principal with kind `bot` is rejected. The dashboard password unlocks the human session; it does not by itself act as Ledger, Scout, or Cato.

## Writes, locks, and deletes

`write_queue` is the single-writer log. Each call has an idempotency key and a fingerprint of the principal, owner, table, operation, and payload. The same key with the same fingerprint returns the original row. A different payload, actor, table, or operation is rejected and does not replace the stored request. A failed key stays failed.

`locks` holds one hall pass, `lock_name = hall_pass`, plus a fencing token. The holder and expiry are committed before the domain change. Taking over a stale lock increments `fence`. The holder renews `expires_at` without changing the fence. An apply whose fence no longer matches rolls back. Releasing the pass deletes the row only when the holder id matches. On startup, `WriteLayer` finishes `running` queue rows whose lease has expired, using the stored fingerprint, without the original caller resubmitting. The domain change and the queue row's `committed` status share one transaction. If that transaction rolls back, the domain rows disappear and `errors.persistent` is set to `1`.

`connect()` opens the database read-only (`query_only`). Domain changes go through `WriteLayer`. That does not isolate two processes running as the same OS user: either process can open the SQLite file itself and ignore the writer.

Lock contention and a busy database are retried a bounded number of times (`JOEHUB_MAX_RETRIES`). Validation errors, unauthorized owners, and exhausted retries are recorded immediately and are not applied again under the same key.

Hard delete is two operations on the same owner:

1. `delete_request` inserts `pending_deletes` with `status = pending` and leaves the row in place. A non-owner cannot start this.
2. `delete_confirm` deletes the row and sets the pending record to `confirmed`. The same owner must confirm. A second open request for the same row is rejected. Foreign keys are `ON DELETE RESTRICT`, so a parent with children is left in place and the confirm rolls back.

## Exports

Each table, including empty ones and `export_history`, is read inside one snapshot and written to `<table>.csv.age`. NULL is the field `\N`. An empty string is an empty field. A backslash is doubled, so the literal text `\N` is stored as `\\N` and comes back as `\N`. The published set is the `current` generation. Stable file names are replaced only after that generation is in place. Restore decrypts into a temporary database, checks `integrity_check`, `foreign_key_check`, row counts, and the leading `id` column, and only then replaces the live file. A failure leaves the original database in place. The runtime has to be stopped; restore takes an exclusive lock and refuses when it cannot. Integer columns are loaded as integers so cent amounts stay integers.

The age identity is not a column and is not exported.

## Migrations

`migrations/001_initial.sql` creates this schema and seeds the three owners plus `table_registry`. Later migrations must not drop tables or indexes. `schema_migrations` records the filename of each applied file.
