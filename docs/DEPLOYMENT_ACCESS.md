# Deployment access

This is the optional strict mode, not the default deployment. The default is cooperative shared-computer mode, recorded in `docs/TRUST_BOUNDARY.md`. These are the privileged changes that make owner write access enforceable when each principal has its own uid. They are not applied by this repository, by tests, or by the daemon. Do not apply them as part of the default. Review them before anyone runs them. Paths below are the ones the unit file uses. Synthetic data only; do not put real records or the age secret into git.

The daemon is not sufficient without this layout, and it is not the default. If Ledger, Scout, Cato, and the operator still execute as one uid, do not start it and expect isolation. It will refuse a map that gives two principals the same uid or that gives a principal the writer uid. Mapping the shared uid to a single name would make every bot that uid into that one principal. There is no configuration that turns one uid into four principals.

The missing capability until the users below exist is a distinct kernel uid per principal, different from the writer uid.

## Users and groups

```bash
groupadd --system joehub-writer
groupadd --system joehub-clients
groupadd --system joehub-operator
groupadd --system joehub-ledger
groupadd --system joehub-scout
groupadd --system joehub-cato

useradd --system --gid joehub-writer --groups joehub-clients \
  --home-dir /var/lib/joehub --create-home \
  --shell /usr/sbin/nologin joehub-writer
useradd --system --gid joehub-operator --groups joehub-clients \
  --home-dir /var/lib/joehub-operator --create-home \
  --shell /usr/sbin/nologin joehub-operator
useradd --system --gid joehub-ledger --groups joehub-clients \
  --home-dir /var/lib/joehub-ledger --create-home \
  --shell /usr/sbin/nologin joehub-ledger
useradd --system --gid joehub-scout --groups joehub-clients \
  --home-dir /var/lib/joehub-scout --create-home \
  --shell /usr/sbin/nologin joehub-scout
useradd --system --gid joehub-cato --groups joehub-clients \
  --home-dir /var/lib/joehub-cato --create-home \
  --shell /usr/sbin/nologin joehub-cato
```

`joehub-writer` is in `joehub-clients` only so it can `chgrp` the socket. Its umask is `0077`, so that membership does not make new files group-readable. Each bot's primary group is private. `joehub-clients` is only the supplementary group that may connect to the socket.

## Ownership and modes

```bash
install -d -o joehub-writer -g joehub-writer -m 0700 /var/lib/joehub
install -d -o joehub-writer -g joehub-writer -m 0700 /var/lib/joehub/data
install -d -o joehub-writer -g joehub-writer -m 0700 /var/lib/joehub/exports
install -d -o joehub-writer -g joehub-writer -m 0700 /var/lib/joehub/keys
install -d -o joehub-writer -g joehub-writer -m 0755 /run/joehub

# after the daemon creates it; the unit also sets these
# /var/lib/joehub/data/joehub.db          joehub-writer:joehub-writer 0600
# /var/lib/joehub/data/joehub.db-wal      joehub-writer:joehub-writer 0600
# /var/lib/joehub/data/joehub.db-shm      joehub-writer:joehub-writer 0600
# /run/joehub/writer.sock                 joehub-writer:joehub-clients 0660

chmod 0700 /var/lib/joehub-operator /var/lib/joehub-ledger \
  /var/lib/joehub-scout /var/lib/joehub-cato
```

`/run/joehub` is `0755` so clients can traverse it, and not group-writable so they cannot unlink or replace the socket. `/var/lib/joehub` is `0700` so clients cannot read the database, the age identity, or the access map. The database file itself is `0600`. A client uid gets `EACCES` from `open` on that path. Direct SQLite is closed.

Do not put the database, the key directory, or the export directory inside the git checkout.

## Credential custody

There is no bearer token for Ledger, Scout, or Cato, and the socket does not accept one. Identity is the peer uid.

| Secret | Where | Mode | Who can read it |
| --- | --- | --- | --- |
| Access map | `/var/lib/joehub/access.json` | `0600` `joehub-writer:joehub-writer` | writer only |
| Age identity | `/var/lib/joehub/keys/age-identity.txt` | `0600` writer | writer only |
| Operator token file | `/var/lib/joehub/keys/principals/operator.token` | `0600` writer | writer only; not a socket credential |
| Bot homes | `/var/lib/joehub-ledger` and the other homes | `0700` that user | that user only; leave them empty |

The access map is the only record of which uid is which principal. Generate it after `useradd` so the numbers are the real uids. Do not copy sample numbers.

```bash
python3 - << 'PY'
import json, pwd
names = {
    "operator": "joehub-operator",
    "Ledger": "joehub-ledger",
    "Scout": "joehub-scout",
    "Cato": "joehub-cato",
}
path = "/var/lib/joehub/access.json"
with open(path, "w", encoding="utf-8") as handle:
    json.dump({"principals": {key: pwd.getpwnam(user).pw_uid for key, user in names.items()}}, handle)
    handle.write("\n")
PY
chown joehub-writer:joehub-writer /var/lib/joehub/access.json
chmod 0600 /var/lib/joehub/access.json
```

The operator token file is created by the writer for in-process maintenance on the writer uid. Bot runtimes must not receive it, and must not be able to read `/var/lib/joehub/keys`. Do not inject it into a bot's environment or a file in a bot's home. A bot that needs to act as its owner connects to the socket as its own uid.

## Socket

| Path | Owner | Mode | Purpose |
| --- | --- | --- | --- |
| `/run/joehub` | `joehub-writer:joehub-writer` | `0755` | directory, not writable by clients |
| `/run/joehub/writer.sock` | `joehub-writer:joehub-clients` | `0660` | connect rights for the client group only |

The unit sets `RuntimeDirectory=joehub` and `RuntimeDirectoryMode=0755`. The process binds the socket, `chgrp`s it to `joehub-clients`, and chmods it to `0660`. `JOEHUB_WRITER_SOCKET_GROUP` and `JOEHUB_WRITER_SOCKET_MODE` select that. Clients need write permission on the socket inode and execute permission on `/run/joehub`. They do not need write permission on the directory.

## systemd

Install the unit from `deploy/joehub-writer.service`. It runs `User=joehub-writer`, `Group=joehub-writer`, `UMask=0077`, and points `JOEHUB_DB_PATH`, `JOEHUB_EXPORT_DIR`, `JOEHUB_KEY_DIR`, `JOEHUB_ACCESS_MAP`, and `JOEHUB_WRITER_SOCKET` at the paths above.

```bash
install -o root -g root -m 0644 deploy/joehub-writer.service /etc/systemd/system/joehub-writer.service
systemctl daemon-reload
systemctl enable --now joehub-writer.service
```

Each bot is its own unit (or other supervisor entry) with `User=` set to that bot's account. Example for Ledger:

```ini
[Service]
User=joehub-ledger
Group=joehub-ledger
SupplementaryGroups=joehub-clients
UMask=0077
NoNewPrivileges=yes
ExecStart=/usr/bin/python3 /path/to/ledger-runtime.py
```

Repeat for `joehub-scout`, `joehub-cato`, and `joehub-operator`. Do not set `User=joehub-writer` on a bot. Do not set two bots to the same `User=`.

## What each bot runtime must be able to do

- Execute as its own uid, the one named in the access map. Ledger's process is `joehub-ledger`, not a shared agent user.
- Be a member of `joehub-clients` so it can connect to `/run/joehub/writer.sock`.
- Send JSON requests with `method` of `write`, `delegate`, or `revoke`. `write` carries `table`, `operation`, `payload`, and `idempotency_key`. `delegate` and `revoke` carry `delegate_owner`. `joehub.writer_client.WriterClient` does this.
- Omit `credential`, `principal`, `uid`, and `token`. The daemon rejects those fields.
- Delegate only from the operator uid. Ledger, Scout, and Cato cannot delegate. The operator still needs an unrevoked delegation before a human write of another owner's table. An owner uid writes only its own tables.

It must not be able to:

- Open `/var/lib/joehub/data/joehub.db` or the key directory.
- Read another bot's home or the access map.
- Bind or replace `/run/joehub/writer.sock`.

The human dashboard, once this layout exists, runs as `joehub-operator` and uses `WriterClient`. Until that user exists, an in-process `WriteLayer` on the shared uid is not enforced access.

## What stays refused

The writer exits instead of listening when:

- the access map is missing, unreadable, or not mode `0600` owned by the writer
- any two principals share a uid, or any principal uid is the writer uid
- the database is missing after open, is not owned by the writer, or is readable or writable by group or other
- the socket directory is missing, is not owned by the writer, or is writable by group or other

Do not work around a refusal by running the bots as `joehub-writer` or by chmod `0666` on the database.
