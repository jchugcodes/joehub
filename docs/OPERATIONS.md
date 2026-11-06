# Operations

joehub is a local personal data hub. The database, encrypted exports, and keys stay outside the git checkout. The seed data is fictional. Do not load real records, passwords, or key material into this repository.

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

A path inside the repository is rejected. The database directory, export directory, and key directory must be distinct.

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

This writes one age-encrypted CSV per table to the export directory, using stable names such as `transactions.csv.age` and `export_history.csv.age`. Files are overwritten on the next run. The identity file is `$JOEHUB_KEY_DIR/age-identity.txt`. It is created with mode `600` when missing. The command prints the export directory, not the key.

The run is stored in `export_history`, and that table is included in the encrypted files.

## Push

Push is off unless you ask for it. The remote must be a GitHub repository, and `gh repo view <owner>/<repo> --json visibility` must return `"visibility": "PRIVATE"`. Any other visibility, a failed check, or a non-GitHub remote refuses the push. Nothing is sent in those cases.

```bash
gh auth login
export JOEHUB_EXPORT_REMOTE=git@github.com:YOU/joehub-exports.git
python scripts/export_data.py --push
```

You can pass `--remote` instead of the environment variable. The export directory is its own git checkout. The age identity is not part of that commit.

## Restore

```bash
export JOEHUB_DB_PATH=/home/box/joehub/data/joehub-restored.db
python scripts/restore_data.py
```

Restore decrypts every `<table>.csv.age`, applies the migrations to a new database, and replaces all rows. It refuses to overwrite an existing database file unless you pass `--force`. After loading, it runs SQLite's foreign-key check. Cent amounts come back as integers, and primary keys are unchanged.

Use the same `JOEHUB_KEY_DIR` that created the export.

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

Finance, Jobs, and Journal are the three domain pages. Inspector lists every table, with filter and sort. Domain edits, including the two-step delete, call the same write layer as the scripts. Meta tables are read-only in the inspector. Use Lock in the sidebar to drop the session.

Equivalent direct command, from the repository root after the editable install:

```bash
python -m streamlit run src/joehub/dashboard/streamlit_app.py \
  --server.address 127.0.0.1 --server.port 8501
```

## What not to commit

Do not commit `*.db`, `*.age`, `.env`, or anything under the key directory. Defaults already live outside the repo. The seed script is the only dataset that belongs here, and it is synthetic.
