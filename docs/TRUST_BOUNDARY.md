# Trust boundary

joehub does not enforce bot identity. The process that is running today is cooperative only. Joe has to accept that limit. Until the separate-user design below is actually provisioned, a program running as the same OS user as joehub can ignore every check in this repository.

## What is true on one shared OS user

File mode `600` does not isolate Ledger, Scout, Cato, and the operator when they are the same Unix user. Any of those processes can read a mode-600 file, open the SQLite file, and write it with their own connection. `PRAGMA query_only` is not a boundary against that. Peer credentials on a Unix socket are not a boundary either: `SO_PEERCRED` returns the same uid for every peer.

So:

- There is no API that loads a principal token by name. Owner plaintext is not stored. The only token file joehub writes is the operator's, and every same-user process can read it.
- `connect()` never returns a writable handle and has no writable switch. An authorizer on that handle denies writes even if `query_only` is turned off. Callers that do not use `connect()` are not affected.
- The write layer, migrations, and restore open the database themselves. That maintenance connection is not an authorization boundary.
- Presenting the string `Ledger`, `Scout`, or `Cato` does not authenticate. A human write requires the operator credential and an unrevoked `delegations` row. That check is cooperation between callers that go through `WriteLayer`. It is not enforced against another process.

Real isolation is not achievable on one shared OS user. Treating the current checks as enforced bot identity would be false.

## Proposal, not running

This is the boundary that would actually separate writers. It is not implemented and it is not in effect.

1. One writer daemon, running as its own user (for example `joehub`), is the only process allowed to open the database writable. The database file and the key directory are mode `0600` / `0700`, owned by that user. Bots and the dashboard are not that user, so they cannot open the file for write and they cannot read the age identity or any credential the daemon holds.
2. Clients talk to the daemon over a Unix socket. The daemon calls `SO_PEERCRED` and maps the peer uid to a principal. Ledger, Scout, and Cato each run as their own user. They do not present bearer tokens, and there are no bearer files on a path they can read.
3. The human account is a different uid. The daemon records an explicit `delegations` row when that uid asks. A bot uid cannot delegate and cannot claim another uid.
4. If a deployment still runs every process as one uid, the daemon must refuse to treat the peer as an authenticated bot. Same-uid peer credentials cannot tell those processes apart.

Joe's acceptance of the cooperative limit is required for the current program. The daemon, the separate users, and the socket are open work, not a finished control.

## What cooperative mode does anyway

Callers that use the library get these limits, and nothing more:

- Domain changes go through `WriteLayer` with a server-issued credential.
- The operator token is the human credential. Owner rows exist so recovery can recognize them, but their plaintext is discarded at creation.
- Restore reprovisions principal hashes from the age key and the CSV exports. It keeps ids and the other provenance columns. It does not require a backup of the token files, and it does not write owner token files.
- A rejected or unauthenticated request does not modify a queue row unless the authenticated principal id and the request fingerprint both match that row.

None of that stops a same-user process from writing the database file directly.
