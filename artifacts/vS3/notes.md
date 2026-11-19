# S3 ingest API

`POST /api/ingest/<entity>` accepts writes from a bot. This slice registers one entity, `tasks`. Adding another entity means adding one entry to `INGEST_ENTITIES` in `web/lib/ingest.mjs`. Ledger and Scout can already be given tokens, and they receive 403 for tasks until a later slice names an entity they own.

## Request

```
POST /api/ingest/tasks
Authorization: Bearer jht_...
Idempotency-Key: sample-2026-11-19-1
Content-Type: application/json

{"title":"Pack the sample","notes":"Synthetic example","dueDate":"2026-11-20","priority":"Low","status":"To do","project":"Sample","sourceId":"sample:pack"}
```

`Authorization` is a bearer token. A session cookie is ignored. A request with the `joehub_session` cookie and no bearer token is 401 `{ "detail": "authentication required" }`. A bad token is the same 401. The token is hashed with SHA-256 and compared to `principals.token_sha256` with a constant-time compare. The plaintext is never stored and never written to a log.

`Idempotency-Key` is required. It is 1 to 200 characters from `A-Z`, `a-z`, `0-9`, `.`, `_`, `:`, and `-`. The same principal, entity, key, and raw body returns the original task. The same key with a different raw body, including different whitespace, returns 409. The body is hashed as raw bytes. Keys live in `ingest_idempotency`, added by `web/migrations-libsql/005_ingest.sql`. Migrations 001 through 004 are unchanged. `write_queue` is not used: its operations are insert, update, and delete, and the Python writer owns it.

The body is a task create. Allowed fields are `title`, `notes`, `dueDate`, `priority`, `status`, `project`, and `sourceId`. `title` is required. `status` on create is `To do`, `Doing`, or `Blocked`. A 400 body is `{ "fields": ["title"] }` and does not include the submitted values. The raw body must be at most 16 KiB.

A principal may send 60 requests per minute. The counter is `ingest_rate` in libSQL. The 61st request in that window is 429 `{ "detail": "Too many requests." }` with a `Retry-After` header, in seconds. Replays and rejected bodies count. Requests that fail authentication do not. This does not use Upstash.

An accepted task is written only through the libSQL tasks store, and only when `JOEHUB_BACKEND_TASKS=sqlite`. The first accept also inserts one `bot_activity` row: `bot_name` and `last_modified_by` are the principal name, `action` is `ingest`, and `detail` is `tasks:` plus the task id. The title and the token are not in that row. A replay does not insert another row.

When `JOEHUB_BACKEND_TASKS` is unset or `upstash`, the route returns 503 `{ "detail": "ingest not enabled" }` before it opens libSQL or Redis. It never writes Redis.

## Who may write

`delegations` binds a human principal to an owner. `table_registry` names box tables and their owners. `tasks` is not a box table, so neither table can allow this route. The allow-list is the Cato owner for `tasks`. Scout, Ledger, and any other principal get 403 `{ "detail": "not allowed" }`. An unknown entity gets the same 403.

## Gate

`web/middleware.ts` is unchanged. It still calls `decide` in `web/lib/gate.mjs`.

`decide` now returns next for `/api/ingest` and `/api/ingest/*` immediately after the `/api/health` check, before the production page redirect, `readAuthConfig`, the session cookie, and the Upstash session lookup. Other `/api/*` routes still require the session cookie. `/api/ingests` is not included.

`web/lib/live-pages.mjs` and `web/lib/overlay-flag.mjs` are unchanged. Their git blobs stay `f0c23a7637db0ad4d3e6e1fe98837b9878f62098` and `c3af66a42247cd7baf351e56a2736c1defc28245`.

## Environment

- `JOEHUB_BACKEND_TASKS=sqlite` turns ingest on. `upstash` or unset returns 503 `ingest not enabled`.
- `JOEHUB_LIBSQL_URL` is the remote `libsql://` or `https://` database when the web app is running. Tests pass an in-memory client and do not set this.
- `JOEHUB_LIBSQL_AUTH_TOKEN` is the token for that remote database.

This PR does not set Vercel env vars and does not create a Turso database.

## Minting a token for S6

The script is `web/scripts/ingest-token.mjs`. It accepts `--principal ledger`, `scout`, or `cato`. It prints the plaintext token once, on stdout, and writes only the SHA-256 hash into `principals.token_sha256`. Running it again for the same name replaces the hash. The old token stops working. It refuses a URL that is not remote `libsql://` or `https://` unless `--test` is passed. `--test` allows only `:memory:` and `file:` URLs. It is not run against a real database in this PR.

1. Apply migrations to the remote database with `node scripts/libsql-migrate.mjs` from `web/`. Do not pass `--test`. Set `JOEHUB_LIBSQL_URL` and `JOEHUB_LIBSQL_AUTH_TOKEN` for that command.
2. Mint with `node scripts/ingest-token.mjs --principal cato`, with the same URL and auth token. Copy the printed line into the bot's secret store. Do not commit it. The script does not print it again.
3. Set `JOEHUB_BACKEND_TASKS=sqlite` on the web app, with the same remote URL and auth token. This slice does not set those.
4. The bot sends the request above. A retry uses the same `Idempotency-Key` and the same raw body.

## Finance mapping for S9 to S12

These decisions are accepted and not implemented here. Migrations 001 and 002 stay as they are. New columns or side tables belong in later migrations.

- Add a lookup table from web ids to box UUIDs.
- Web categories and caps become category rows plus budget rows with kind `expense`.
- Goal statuses cover `not_started` and `inactive`.
- Transactions with no account go to an `Unassigned` account.
