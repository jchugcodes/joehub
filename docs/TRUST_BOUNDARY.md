# Trust boundary

The locked rule is enforced owner write access. joehub does not enforce bot identity while every agent runs as one OS user. That is not a cooperative mode anyone can accept in place of the rule. It is a missing kernel credential. Joe reviews the privileged steps in `docs/DEPLOYMENT_ACCESS.md` before they are applied. Applying them is what turns the writer on. Starting the daemon without them does not.

Real isolation is not achievable on one shared OS user.

## What is true on one shared OS user

File mode `600` does not isolate Ledger, Scout, Cato, and the operator when they are the same Unix user. Any of those processes can read a mode-600 file, open the SQLite file, and write it with their own connection. `PRAGMA query_only` is not a boundary against that. `SO_PEERCRED` returns the same uid for every peer, so a uid map cannot tell them apart.

A separate writer OS user is not enough on its own if the bots still share one uid:

- They can read any credential file that uid can read, including a file the writer hoped was private to one bot.
- A per-principal socket or directory is owned by a uid. One uid owns all of them, and any of those processes can connect or read.
- A host-mediated credential injected into the environment, a file, or a memfd is readable by another process of that uid through the file itself, `/proc/<pid>/environ`, or `/proc/<pid>/mem`. It is not an identity the process cannot forge.
- A user namespace the bot creates for itself still presents that same host uid to a daemon outside the namespace.

The missing platform capability is a distinct kernel uid for each principal (operator, Ledger, Scout, and Cato), different from the writer uid. An equivalent would be some other kernel credential that `SO_PEERCRED` or an LSM exposes and that another process of the same uid cannot present. This machine does not have that for the agents. No design in the list above supplies it.

## What the writer service enforces once those uids exist

`joehub.writer_service` is the enforced path. It is implemented. It is not in effect on a shared uid, and it refuses to listen unless all of the following are true:

- The access map lists operator, Ledger, Scout, and Cato, each with a different uid, and none of those uids is the writer's euid.
- The access map file is mode `0600` and owned by the writer uid.
- The database file and its WAL sidecars are mode `0600`, the database directory is mode `0700`, and all of them are owned by the writer uid. Clients cannot open SQLite on that path.
- The socket directory is owned by the writer and is not writable by group or other, so a client cannot replace the socket.

Clients speak JSON over the Unix socket and do not send a credential, a principal name, or a uid. The daemon reads `SO_PEERCRED` and maps that uid through the access map. A request that includes a credential is rejected. Owner names are not accepted as identity. A human write still needs an unrevoked `delegations` row. A bot uid cannot delegate.

Tests that need distinct uids run inside a Linux user namespace when `newuidmap` works, and skip otherwise. They do not create host users.

## What the in-process library still is

`WriteLayer`, `connect()`, and the operator token file are the writer's own engine and the same-user tools. They are cooperative among processes of one uid. They are not the boundary. `connect()` never returns a writable handle. The maintenance connection used by the daemon, migrations, and restore is not an authorization boundary against another process of the writer uid. There is no API that loads an owner token by name. The socket daemon does not accept the operator token as a client credential.

The restore gate is a different control. Every joehub opener refuses the database while a handover flock is held, including the gap after the new inode is published and before the operator credential is installed. That stops a second runtime. It does not separate two bots that share a uid.
