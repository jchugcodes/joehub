# Web architecture

joehub's web foundation is a Next.js shell styled from the Figma frames, plus a read-only synthetic API. Gaps in that handoff are listed in [DESIGN_GAPS.md](DESIGN_GAPS.md). The private SQLite database, the age identity, and the operator token stay out of this application. Existing Streamlit, export, and SQLite code is unchanged.

## Data flow

```
browser UI (web/)
    -> authenticated public API (same-origin Next.js route handlers, or the separable api/)
        -> internal read service (scoped read credential, fixed queries or synthetic fixtures)
            -> private SQLite (not connected in this foundation)
```

The browser talks only to the public API. That API checks a server-side session, then calls the internal read service with a scoped read credential. The read service does not accept SQL from the client. It either returns the synthetic fixtures in `contract/fixtures.json` or, on the Python side only, calls the existing `joehub.queries` functions on a connection the caller already opened.

The Next.js route handlers under `web/app/api/` implement `contract/openapi.json` for the synthetic fixtures. They are ordinary App Router handlers, so one Node process can serve the UI and the fixture API. No second host is required for this foundation, and the repo contains no host-specific config.

`api/` is a separate FastAPI process with the same contract. It is the place a later live read can sit. It is not required to run the shell. It does not open the default database path, and it refuses to start if that path, the age identity, the export directory, or an operator token is present in its environment.

Both providers serve the `/api/...` paths in `contract/openapi.json`. On the Next.js site origin, `GET /api/finance/accounts` is JSON. `GET /finance/accounts` is the UI page and returns HTML. The optional FastAPI process serves the same `/api/...` paths on its own origin. The contract `servers` list records both origins. Neither URL is a deployed host.

Rate limits use the connecting peer. A client-supplied `X-Forwarded-For` is ignored unless that peer is listed in `JOEHUB_TRUSTED_PROXIES`. The Next.js route handlers cannot see the TCP peer, so they ignore `X-Forwarded-For` and a spoofed hop cannot open a new limit bucket. Those handlers put every caller in one bucket named `direct`. That bucket is not a per-client mitigation on serverless: each isolate has its own memory, and every request in that isolate shares the same bucket.

## Sessions

The session cookie is `joehub_session`. It is HttpOnly, Secure, and SameSite=Lax. The value is a random id sealed with the session secret. The secret is read on the server and is not part of the page.

The server stores the session and a device row. `expires_at` is set to 14 days after creation and is not moved on later requests. There is no idle timeout. Logout revokes the current session. Revoke-device revokes that device's session. Login and the API are rate limited in the process.

The dev login accepts the username `synthetic` and the password `synthetic` only when dev auth is explicitly enabled and the process is not in production. In production the Python service refuses to start if dev or fake auth is enabled, if the session secret is missing or short, or if the scoped read credential is missing or still the synthetic placeholder. The Next.js process uses the same rule on startup, except during `next build`. A production boot with no session secret does not come up. A build does not need secrets.

The device list and the expiry live in process memory. That memory is not a database. It is not durable across restarts or across more than one process. It is not a stand-in for SQLite.

## Secret boundaries

- Browser-exposed configuration must not carry the session secret, the read credential, the database path, the age key, or the operator token. `tests/test_web_public_env.py` fails if a public env name is paired with a secret-like word.
- The web build is scanned for `/home/box/joehub`, `AGE-SECRET-KEY`, `operator.token`, and `age-identity`. Client bundles are also scanned for the server env names.
- The Python API holds `JOEHUB_READ_CREDENTIAL` for the internal read service. It has no operator token and no age key. The age key remains only on the existing export job.
- Request logs record the method and path. They do not record row payloads.
- `.gitignore` and `.dockerignore` ignore `*.db`, `*.age`, key material, and `.env` files.

Preview environments get none of those secrets. A preview is not a place to point at the private database or to turn on fake login.

## Isolation

Running the UI, the API, and SQLite as one OS user on the shared computer is not isolation. A process with that uid can open the database file itself. Real isolation needs a separate host or a dedicated uid before any live data is connected. That is the same limit recorded in `docs/TRUST_BOUNDARY.md`.

Deploying this public repository moves no personal data. The fixtures in git are fictional. The database, exports, and keys are not in the repository.

## Hosting

Hosting for this foundation is free-tier only. The scaffold is provider-neutral: there is no vendor config file, no project link, and no account in this repo.

Recommendation: serve `web/` on a single free-tier Node host. The synthetic route handlers travel with the UI, so a second host is unnecessary now. Leave `api/` undeployed until live reads exist. Do not put the private SQLite file on a host disk that disappears when the process stops. Ephemeral disk is not durable storage for joehub.

Costs are UNVERIFIED. This pass did not check vendor price pages, free-tier limits, overages, or whether any durable volume is free. A free allowance can become a charge. Nothing here selects a paid plan.

The source of truth and any move of the datastore are a separate live-migration decision. This scaffold does not perform that move.

## Scaffold limitations

Each item below is a SCAFFOLD LIMITATION and a deploy blocker. This pass does not add a live backend.

### In-memory session, revoke, and rate-limit stores

SCAFFOLD LIMITATION. Deploy blocker. The session store, the revoke list, and the rate-limit buckets live in process memory. A Vercel cold start or a separate function instance drops them, so a cookie issued on one instance is unknown on another and a limit resets when a new instance starts. The Next.js `direct` bucket is one shared counter for that instance, not a per-client limit. Minimal requirement: a durable store shared by every instance before this is deployed.

### No production login

SCAFFOLD LIMITATION. Deploy blocker. The only login is the synthetic dev pair, and production refuses to start while that pair is enabled. Minimal requirement: a production authentication method that does not use the dev pair.

### Device registration is not verified-device auth

SCAFFOLD LIMITATION. Deploy blocker. Login writes a device row in memory. Nothing checks that the device is a verified device. Minimal requirement: a verified-device check before a device is treated as trusted.

### Public pages render fixtures without authentication

SCAFFOLD LIMITATION. Deploy blocker for any live data. The HTML pages render the design fixtures with no session. That is acceptable for a synthetic demo ONLY. Minimal requirement before any live row is shown: those pages require a session, or they stay off the host.

### Fixture packaging on a Vercel build

`web/lib/fixtures.json` is a copy of `contract/fixtures.json`, and a Next.js standalone build is checked for that file. A Vercel build has not been run. SCAFFOLD LIMITATION. Deploy blocker. Minimal requirement: confirm the same fixture file is present in the Vercel build output before that build is served.

## Decisions only Joe can make

- Which free-tier account to open, and which host runs the Node app.
- The domain name and DNS.
- Whether a secret-less preview may serve the unauthenticated shell. Production startup currently refuses to boot without a session secret.
- Where verified-device sessions live once there is more than one process. Process memory is not that store.
- When fictional fixtures are replaced with live reads.
- Where the durable database lives, and when the separable `api/` process is deployed on its own free-tier host.
