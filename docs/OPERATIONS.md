# Operations

joehub is a local personal data hub. The database, encrypted exports, and keys stay outside the git checkout. The seed data is fictional. Do not load real records, passwords, or key material into this repository.

## Default deployment

Decision (Joe, Nov 6, 2026, 6:18 PM ET): "Accept cooperative bot ownership on the shared computer, with the single writer queue, validation, audits and two-step deletes retained."

The default is cooperative shared-computer mode. One OS user runs the operator and the bots. The single-writer queue and lock, ownership validation, audit fields, owner-only two-step hard deletes, and the backup/restore handover stay in force. Bot identity is cooperative and not tamper-resistant on this computer. The uid-mapped daemon in `docs/DEPLOYMENT_ACCESS.md` is an optional strict mode. It is not required for this deployment, and it refuses to claim enforcement when principals share a uid. Do not apply those privileged user or service-account changes as part of the default.

## Install

Requires Python 3.11 or newer.

```bash
python -m pip install -e ".[dev]"
```

## Paths

| Variable | Default |
| --- | --- |
| `JOEHUB_DB_PATH` | `/home/box/joehub/data/joehub.db` |
| `JOEHUB_EXPORT_DIR` | `/home/box/joehub/exports` |
| `JOEHUB_KEY_DIR` | `/home/box/.config/joehub/keys` |
| `JOEHUB_EXPORT_REMOTE` | unset |
| `JOEHUB_AUTH_HASH` | unset |
| `JOEHUB_AUTH_HASH_FILE` | `$JOEHUB_KEY_DIR/dashboard_auth_hash` |
| `JOEHUB_BIND_ADDRESS` | `127.0.0.1` |
| `JOEHUB_BIND_PORT` | `8501` |
| `JOEHUB_LOCK_TTL_SECONDS` | `30` |
| `JOEHUB_MAX_RETRIES` | `8` |
| `JOEHUB_RETRY_BACKOFF_SECONDS` | `0.05` |
| `JOEHUB_RECOVERY_INTERVAL_SECONDS` | `1` (set `0` to disable the recovery timer) |

A path inside the repository is rejected. The database file and the password-hash file must not sit inside the export directory. The key directory and the export directory must not contain each other. The database, export, and key paths must be distinct.

The first write, export, or seed creates the database and applies `migrations/001_initial.sql`.

## Tests

```bash
pytest
```

GitHub Actions runs the same command on Python 3.11.

## Synthetic seed

```bash
python scripts/seed_synthetic.py
```

Running it again is safe. Each fictional row has a stable idempotency key, so a second run does not insert duplicates. The companies, people, and amounts are made up (`example.com` mailboxes, Example Harbor Credit Union, and similar).

## Export

```bash
python scripts/export_data.py
```

This reads every table in one snapshot, encrypts that set, and publishes it as a generation pointed at by `current`. Stable names such as `transactions.csv.age` and `export_history.csv.age` are replaced only after the generation is in place. The identity file is `$JOEHUB_KEY_DIR/age-identity.txt`. It is created with mode `600` when missing. The command prints the export directory, not the key.

The command records an audited delegation from the operator to Cato, then writes `export_history` with the operator credential. The only token file is `$JOEHUB_KEY_DIR/principals/operator.token` (mode 600). Owner token files are not created. On one shared OS user that file is readable by every process. That does not enforce bot identity. Cooperative shared-computer mode is the default. The daemon in `docs/DEPLOYMENT_ACCESS.md` is an optional strict mode and is not in effect on a shared uid. Read `docs/TRUST_BOUNDARY.md`.

`export_history.status` stays `running` until that snapshot is published. A failed dump is `failed`. `publication_state` stays `incomplete` on the remote until the audit push of the `pushed` row returns. A crash during that push leaves a journal at `$JOEHUB_EXPORT_DIR/.publication-journal.json`. The next export holds the publication lock, pushes a snapshot of the `pushed` row, and only then clears the journal. Two exporters cannot replace that journal while the lock is held. The same OS user can open the SQLite file directly. `connect()` is not a boundary against that user.

`WriteLayer` retries expired leases on a timer (`JOEHUB_RECOVERY_INTERVAL_SECONDS`, default 1 second). Set it to `0` to keep recovery to process start only. A human write is recovered only if that human's delegation is still unrevoked.

## Push

Push is off unless you ask for it. The remote must be a GitHub repository, and `gh repo view <owner>/<repo> --json visibility` must return `"visibility": "PRIVATE"`. Any other visibility, a failed check, or a non-GitHub remote refuses the push. Nothing is sent in those cases.

```bash
gh auth login
export JOEHUB_EXPORT_REMOTE=git@github.com:YOU/joehub-exports.git
python scripts/export_data.py --push
```

You can pass `--remote` instead of the environment variable. The push clones the remote, commits only the expected `*.csv.age` files, and fast-forwards `main`. It does not force-push. A remote that already contains a README is kept; the ciphertext is added on top. The age identity, the database, and the password hash are not part of that commit. A local bare-repo test is not a completed publication to a hosted private repository.

## Restore

```bash
export JOEHUB_DB_PATH=/home/box/joehub/data/joehub-restored.db
python scripts/restore_data.py
```

Stop the dashboard and any other writer first. Restore decrypts into a temporary database, checks integrity, foreign keys, row counts, and the schema, and only then replaces the live file. The exclusive handover lock is taken before credentials are staged and before the live file is replaced. It is held across the WAL checkpoint (which runs outside the SQLite lock transaction), the sidecar removal, the replace, and the credential install. Openers take that same lock shared and hold it across connect and validation, so they cannot open the database in the middle of the install. Cleanup writes a durable completed record before it unlinks anything, removes the gate before the journal, and can be restarted after a crash at each of those steps. If a check fails, the original database stays. It refuses to overwrite an existing database file unless you pass `--force`, and it refuses when the file is still locked. Cent amounts come back as integers, and primary keys are unchanged. NULL, an empty string, and the literal `\N` stay distinct.

The CSV exports and the age identity are enough. You do not need a backup of the token files. When the operator token is missing or does not match the restored hash, restore keeps every principal id (and `notion_id`, `migrated_on`, name, kind, and owner name), rotates the hashes, and writes a new operator token. Owner token files are not written. `last_modified_by` on those rows becomes `restore`.

Use the same `JOEHUB_KEY_DIR` so the age identity is the one that encrypted the export.

## Dashboard

Create a password hash without printing the password:

```bash
python scripts/hash_password.py
```

That writes `$JOEHUB_AUTH_HASH_FILE` with mode `600`. You can instead set `JOEHUB_AUTH_HASH` to the same `scrypt$...` string. The dashboard will not start until one of those is set.

```bash
python scripts/run_dashboard.py
```

The process binds to `127.0.0.1:8501` unless `JOEHUB_BIND_ADDRESS` or `JOEHUB_BIND_PORT` is set. `.streamlit/config.toml` uses the same localhost default. Open `http://127.0.0.1:8501`.

The password unlocks the human principal. It does not act as Ledger, Scout, or Cato. Use the sidebar delegation buttons before saving. Those buttons write an audited `delegations` row. Domain edits, including the two-step delete, call the same write layer as the scripts and send the human token loaded on the server. Meta tables are read-only in the inspector. Use Lock in the sidebar to drop the session.

## Open gates

These are not done:

- Export git history semantics.
- Off-computer age key backup. The age identity stays in `JOEHUB_KEY_DIR` on this machine.
- A daily scheduler. Nothing here runs export or restore on a clock.
- Secure mobile access. The dashboard binds to localhost. A phone on another network is not a supported client.
- Cutover enforcement. Nothing here switches a live system off an old store or blocks the previous writer.

Equivalent direct command, from the repository root after the editable install:

```bash
python -m streamlit run src/joehub/dashboard/streamlit_app.py \
  --server.address 127.0.0.1 --server.port 8501
```

## What not to commit

Do not commit `*.db`, `*.age`, `.env`, or anything under the key directory. Defaults already live outside the repo. The seed script is the only dataset that belongs here, and it is synthetic.
