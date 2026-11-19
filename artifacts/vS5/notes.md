# S5 Tasks and Lists copy

These scripts copy production Tasks and Lists from Upstash into the remote libSQL database. A person runs them on a private machine, at S6, after Joe says yes. They are not run from the app, and this slice does not run them against a real database.

The scripts print counts and hashes only. They do not print task titles, notes, or list names. The snapshot and the rows file are written with mode 600. Keep both files on the private machine and delete them after verify passes.

`JOEHUB_LIBSQL_URL` and `JOEHUB_LIBSQL_AUTH_TOKEN` are used first. If either one is empty, the matching `TURSO_DATABASE_URL` or `TURSO_AUTH_TOKEN` value is used. The Vercel Marketplace Turso integration sets the `TURSO_` names. Those two values do not move Tasks onto libSQL. Only `JOEHUB_BACKEND_TASKS=sqlite` does that. Startup, the store, ingest, and these scripts all follow that pair. A `file:` or `:memory:` URL is refused for a production start, and the import and verify scripts refuse it unless `--test` is passed.

`web/lib/live-pages.mjs` and `web/lib/overlay-flag.mjs` are unchanged. Their git blobs stay `f0c23a7637db0ad4d3e6e1fe98837b9878f62098` and `c3af66a42247cd7baf351e56a2736c1defc28245`.

## Joe's OK

Joe's OK is required three times:

1. Before `tasks-export.mjs`. The flag is `--i-have-joes-ok`.
2. Before `tasks-import.mjs`. The same flag.
3. Before setting `JOEHUB_BACKEND_TASKS=sqlite` in Vercel production.

Do not export, import, or flip the flag on a guess.

## Quiet window

Ask everyone to stop editing Tasks and Lists. Ingest must be quiet too, because a bot write during the copy would be missed. From the export until verify prints `PASS`, do not create, edit, complete, reopen, or delete a task, and do not change a list. If something is written to Upstash after the export, stop. Export again. Do not flip the flag.

Upstash is only read. The export script rejects every write command. Import and verify never talk to Upstash. Rollback is unsetting the flag, because the Upstash data is still there.

## Commands

Run these from `web/` on the private machine. Fill in the real values yourself. Do not commit them.

```bash
export UPSTASH_REDIS_REST_URL="https://YOUR-UPSTASH.upstash.io"
export UPSTASH_REDIS_REST_TOKEN="YOUR_UPSTASH_TOKEN"
export TURSO_DATABASE_URL="libsql://YOUR-DB.turso.io"
export TURSO_AUTH_TOKEN="YOUR_TURSO_TOKEN"
```

If `JOEHUB_LIBSQL_URL` or `JOEHUB_LIBSQL_AUTH_TOKEN` is set, it wins over the `TURSO_` value.

```bash
node scripts/tasks-export.mjs --i-have-joes-ok --out /secure/joehub-tasks-snapshot.json

node scripts/tasks-transform.mjs \
  --in /secure/joehub-tasks-snapshot.json \
  --out /secure/joehub-tasks-rows.json

JOEHUB_LIBSQL_URL="$TURSO_DATABASE_URL" JOEHUB_LIBSQL_AUTH_TOKEN="$TURSO_AUTH_TOKEN" \
  node scripts/libsql-migrate.mjs

node scripts/tasks-import.mjs --i-have-joes-ok --in /secure/joehub-tasks-rows.json

node scripts/tasks-verify.mjs --snapshot /secure/joehub-tasks-snapshot.json
```

Export, transform, and import print counts and a hash where a file is written. Verify prints `PASS` or `FAIL`, the counts, and, on failure, the mismatched ids. It does not print the task text. A non-zero exit means do not flip the flag.

The copy includes every task, including done tasks older than seven days. The app still hides those from the open list and still finds them in search. Every list is copied. Ids, created time, completed time, project, and the Notion source id stay as they are. Running import again without `--merge` stops if the database already has tasks. With `--merge`, it upserts the same rows and does not create duplicates.

`libsql-migrate.mjs` reads the same URL pair. The command above copies the marketplace values into the `JOEHUB_` names for that one step so an empty Turso database gets the schema. If the schema is already applied, the command prints `already applied`.

## Flip and check

In the Vercel production environment, set:

```bash
JOEHUB_BACKEND_TASKS=sqlite
```

Leave the `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN` values in place, or set `JOEHUB_LIBSQL_URL` and `JOEHUB_LIBSQL_AUTH_TOKEN` to the same remote database and token. Do not point either URL at a file. Redeploy, then open Tasks while signed in. The open list and the list counts should match the verify counts. Search for a done task that is older than seven days and confirm it is still there.

## Rollback

Unset `JOEHUB_BACKEND_TASKS` in Vercel production and redeploy. The app goes back to Upstash. Nothing in this copy deleted or changed Upstash. Leave the libSQL rows where they are. They are unused while the flag is unset.
