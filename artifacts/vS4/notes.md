# S4 Tasks on libSQL

With `JOEHUB_BACKEND_TASKS=sqlite`, every Tasks read and write goes through libSQL. The flag still defaults to `upstash`. Production does not set it, so production Tasks, including `/api/ingest/tasks`, stay on the current path. Ingest keeps returning 503 `ingest not enabled` until S6 sets the flag and points `JOEHUB_LIBSQL_URL` at the remote database. This slice does not change Vercel env or create a Turso database.

`web/lib/live-pages.mjs` and `web/lib/overlay-flag.mjs` are unchanged. Their git blobs stay `f0c23a7637db0ad4d3e6e1fe98837b9878f62098` and `c3af66a42247cd7baf351e56a2736c1defc28245`. No page markup changed.

## Audit

S1 had already moved these store methods onto libSQL when the flag is sqlite: `listUnfinishedTasks`, `searchTasks`, `createTask`, `getTask`, `patchTask`, `completeTask`, `reopenTask`, `deleteTask`.

Two more paths still read or wrote `joehub:task:` and `joehub:tasks:` keys. `listLists` counted tasks by walking those keys. `deleteList` cleared `task.project` by writing the task record back. `createList` and `patchList` called `listLists`, so they took the same path. Those four methods now use the libSQL `lists` table from `004_grocery_and_lists.sql` and the task rows in `tasks`. No new migration was required. 001 through 004 were not edited. Grocery, finance, sessions, devices, and the API rate limit stay on Upstash.

| Path | What it touches | When the flag is sqlite |
| --- | --- | --- |
| `GET /api/tasks` | `listUnfinishedTasks`, or `searchTasks` when `q` is set | libSQL. Home also calls `listUnfinishedTasks` for the open-task count. |
| `POST /api/tasks` | `createTask`, including a Notion `sourceId` update | libSQL |
| `GET /api/tasks/:id` | `getTask` | libSQL |
| `PATCH /api/tasks/:id` | `patchTask` (the Edit sheet) | libSQL |
| `DELETE /api/tasks/:id` | `deleteTask` | libSQL |
| `POST /api/tasks/:id/complete` | `completeTask` (Mark done) | libSQL |
| `POST /api/tasks/:id/reopen` | `reopenTask` | libSQL |
| `GET /api/lists` and `POST /api/lists` | list rows, plus a count of task `project` values | libSQL |
| `PATCH /api/lists/:id` | list row, then the same count | libSQL |
| `DELETE /api/lists/:id` | clears `project` on matching tasks, then deletes the list | libSQL |
| `POST /api/ingest/tasks` | `createTask` on the libSQL store | Already libSQL, and only when the flag is sqlite. A task written here is returned by `GET /api/tasks`. |
| Tasks page ordering | `sortByCreated` in the browser | Display only. It does not write. The API order is newest unfinished first, then done tasks from the last 7 days. |
| Done history | `listUnfinishedTasks` hides a done task after 7 days. `searchTasks` and `getTask` still return it. | libSQL. `purgeDone` exists on the Upstash backend and is not called by any route, page, or store method. |
| Recurring tasks | none | There is no recurring-task field or route. Bill recurrence is finance and stays on Upstash. |
| `scripts/migrate-lists.mjs` | rewrites a Redis dump offline | Not a request path. It does not run in the app. A later cutover can copy list rows into libSQL. |
| Sessions, devices, grocery, finance, API rate limit | Upstash or the dev memory store | Unchanged |

There is no Tasks server action. The Tasks page only calls the routes above.

The list and search responses are the full set. There is no page cursor.

## Until S6

Leave `JOEHUB_BACKEND_TASKS` unset in production. Unset means Upstash, which is what production uses today. Setting it to `sqlite` without a remote `JOEHUB_LIBSQL_URL` and `JOEHUB_LIBSQL_AUTH_TOKEN` refuses to start. S6 is the step that sets the flag and copies data. Until then there is nothing to change in Vercel.
