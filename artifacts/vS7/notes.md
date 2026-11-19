# S7 Grocery on libSQL

With `JOEHUB_BACKEND_GROCERY=sqlite`, every Grocery read and write goes through libSQL. The flag defaults to `upstash`. Unset means Upstash. Production does not set it, so production Grocery stays on the current path. This slice does not change Vercel env, does not create a Turso database, and does not copy real items.

`JOEHUB_BACKEND_TASKS` is separate. Setting the grocery flag does not move Tasks, lists, sessions, devices, finance, or the API rate limit. Setting the tasks flag does not move Grocery. `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN` do not select a backend. `JOEHUB_LIBSQL_URL` and `JOEHUB_LIBSQL_AUTH_TOKEN` win when both pairs are set. Startup uses the same remote-only check as Tasks: in production or preview, a sqlite area requires a `libsql://` or `https://` URL and a token. Dev may use `file:` or `:memory:`.

`web/lib/live-pages.mjs` and `web/lib/overlay-flag.mjs` are unchanged. Their git blobs stay `f0c23a7637db0ad4d3e6e1fe98837b9878f62098` and `c3af66a42247cd7baf351e56a2736c1defc28245`. No page markup changed.

The item stored in libSQL is the Upstash document. `body` is that JSON. Empty quantity, notes, section, and source id are omitted. `checkedAt` is present only while the item is checked. Columns on `grocery_items` are indexes and stay in step with the document. `source_id` is the `joehub:grocery:item:bysource:{sourceId}` key. Taking a source id clears it on the other row's column only. The previous document is left as it was. `004_grocery_and_lists.sql` is unchanged. `006_grocery_documents.sql` adds `body`, `checked_at`, `grocery_idempotency`, and `grocery_flags`.

## Audit

| Path | What it touches | When the flag is sqlite |
| --- | --- | --- |
| `GET /api/grocery` | `listGrocery`. Unchecked by `createdAt`, then checked by `checkedAt` or `updatedAt`. Equal scores are ordered by id. | libSQL. The grocery page loads this list. Home does not. |
| `POST /api/grocery` | `createGrocery`, including a repeated Notion `sourceId` update and the idempotency key | libSQL |
| `GET /api/grocery/:id` | `getGrocery` | libSQL |
| `PATCH /api/grocery/:id` | `patchGrocery` (the edit sheet) | libSQL |
| `DELETE /api/grocery/:id` | `deleteGrocery` | libSQL |
| `POST /api/grocery/:id/check` | `checkGrocery`. A second check keeps the same `checkedAt`. | libSQL |
| `POST /api/grocery/:id/uncheck` | `uncheckGrocery`. Removes `checkedAt`. | libSQL |
| `POST /api/grocery/clear-checked` | `clearGrocery`. Deletes checked items in list order and returns `{deleted, ids}`. | libSQL |
| Grocery page grouping, section suggestions, duplicate-name hint | `groupGrocery`, `sectionSuggestions`, `existingName` in the browser | Display only. They do not write. |
| IndexedDB `joehub-grocery` | browser cache of the API list | Unchanged. It is not a server key. |
| `POST /api/ingest` with entity `grocery` | rejected before a store write | Still 403. Not a grocery write path. |
| `joehub:grocery:seeded` | `grocery_flags` key `seeded` | Written only when synthetic seed is allowed. `VERCEL_ENV=production` does not write samples. Import does not use this flag. |
| `joehub:grocery:item:idem:{key}` | `grocery_idempotency` | Store internal. 30s claim, 24h stored response. Not a route of its own. |
| `joehub:grocery:item:bysource:{sourceId}` | `grocery_items.source_id` | Store internal. A second create with the same source id patches that item. |
| `joehub:grocery:items:unchecked` and `joehub:grocery:items:checked` | list order from `body` | No zset is written. Order matches the Upstash scores. |
| Tasks, lists, sessions, devices, finance, API rate limit | their existing stores | Unchanged |

There is no Grocery server action. The page only calls the routes above.

## S8 cutover

A person runs this on a private machine after Joe says yes. This slice does not run the scripts against a real database. The scripts use synthetic fixtures in tests. They print counts and hashes only. They do not print item names, notes, quantities, or sections. Snapshot and rows files are mode 600.

Joe's OK is required three times:

1. Before `grocery-export.mjs`. The flag is `--i-have-joes-ok`.
2. Before `grocery-import.mjs`. The same flag.
3. Before setting `JOEHUB_BACKEND_GROCERY=sqlite` in Vercel production.

Ask everyone to stop editing Grocery. From the export until verify prints `PASS`, do not add, edit, check, uncheck, clear, or delete an item. If Upstash changes after the export, stop and export again. Do not flip the flag.

Upstash is only read. Export rejects every write command. Import and verify never talk to Upstash. The export copies `joehub:grocery:item:{id}` documents only. It skips the unchecked and checked indexes, the idempotency keys, the source index, and the seed flag. Those are rebuilt from the documents.

Run these from `web/`. Fill in the real values yourself. Do not commit them.

```bash
export UPSTASH_REDIS_REST_URL="https://YOUR-UPSTASH.upstash.io"
export UPSTASH_REDIS_REST_TOKEN="YOUR_UPSTASH_TOKEN"
export TURSO_DATABASE_URL="libsql://YOUR-DB.turso.io"
export TURSO_AUTH_TOKEN="YOUR_TURSO_TOKEN"
```

If `JOEHUB_LIBSQL_URL` or `JOEHUB_LIBSQL_AUTH_TOKEN` is set, it wins over the `TURSO_` value.

```bash
node scripts/grocery-export.mjs --i-have-joes-ok --out /secure/joehub-grocery-snapshot.json

node scripts/grocery-transform.mjs \
  --in /secure/joehub-grocery-snapshot.json \
  --out /secure/joehub-grocery-rows.json

JOEHUB_LIBSQL_URL="$TURSO_DATABASE_URL" JOEHUB_LIBSQL_AUTH_TOKEN="$TURSO_AUTH_TOKEN" \
  node scripts/libsql-migrate.mjs

node scripts/grocery-import.mjs --i-have-joes-ok --in /secure/joehub-grocery-rows.json

node scripts/grocery-verify.mjs --snapshot /secure/joehub-grocery-snapshot.json
```

Export and transform print `items N` and a sha256. Import prints `items N`. Verify prints `PASS` or `FAIL`, then `items`, `unchecked`, and `checked`. On failure it prints the mismatched ids and exits non-zero. It does not print item text. Do not flip the flag on `FAIL`.

`:memory:` and `file:` URLs are refused unless `--test` is passed. A remote URL needs a token. Import refuses a database that already has grocery items unless `--merge` is passed. `--merge` upserts the same rows.

Do not set `JOEHUB_BACKEND_TASKS` as part of this cutover. In Vercel production, set only:

```bash
JOEHUB_BACKEND_GROCERY=sqlite
```

Leave the remote URL and token in place. Do not point either URL at a file. Redeploy, then open Grocery while signed in. The list should match the verify counts, with unchecked items first.

## Rollback

Unset `JOEHUB_BACKEND_GROCERY` in Vercel production and redeploy. The app goes back to Upstash. Nothing in this copy deletes or changes Upstash. Leave the libSQL rows where they are. They are unused while the flag is unset.
