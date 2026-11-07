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

Rate limits use the client address from `web/lib/client-ip.mjs`. Off Vercel, `X-Forwarded-For`, `X-Real-Ip`, and `x-vercel-forwarded-for` are ignored. The Next.js handlers cannot see the TCP peer, so every off-platform caller shares the bucket `direct` unless `JOEHUB_TRUSTED_PROXIES` names that peer. On Vercel (`VERCEL=1`) the address is the first hop of `x-vercel-forwarded-for`. A missing platform address is `unverified`. Client `X-Forwarded-For` is not used on Vercel, including when `JOEHUB_TRUSTED_PROXIES` is set. Vercel documents that it overwrites `X-Forwarded-For` and does not forward an upstream proxy's client address, specifically to prevent spoofing; a custom `X-Forwarded-For` is an Enterprise trusted-proxy feature and this app does not enable it. `x-vercel-forwarded-for` is the platform copy that stays stable if something in front of Vercel rewrites `X-Forwarded-For`. See [Vercel request headers](https://vercel.com/docs/headers/request-headers) and [Vercel reverse proxy](https://vercel.com/docs/security/reverse-proxy).

The public origin is `JOEHUB_PUBLIC_ORIGIN` when that is set. On Vercel, and only when that variable is unset, the origin is `x-forwarded-proto` plus `x-forwarded-host`. Vercel documents those as the host and protocol it forwards. Off Vercel, forwarded host and protocol are ignored and the request URL origin is used. `VERCEL_PROJECT_PRODUCTION_URL` is set on preview deployments as well as production ([system environment variables](https://vercel.com/docs/environment-variables/system-environment-variables)). If `VERCEL_ENV` is `preview` and the chosen origin host equals that production URL, the origin is rejected.

## Sessions

The session cookie is `joehub_session`. It is HttpOnly, Secure, and SameSite=Lax. The value is an opaque random id sealed with HMAC-SHA256 and the session secret. The secret is read on the server and is not part of the page. The seal is checked with Web Crypto in middleware and with Node crypto in route handlers.

The server stores the session. `expires_at` is 14 days after creation, absolute and non-rolling. A read does not move it. There is no idle timeout. Logout revokes the current session and clears the cookie. Revoke-device revokes that one session. Revoke-all revokes every session for that owner created at or before the call. A later login still works. Login attempts are limited to 5 per minute and authenticated API calls to 60 per minute, in a fixed window.

Production and preview sign-in is a provider-agnostic OIDC authorization-code flow with state, nonce, and PKCE S256. The issuer document must come from `${JOEHUB_OIDC_ISSUER}/.well-known/openid-configuration`, and the `issuer` field must match the configured issuer. ID tokens are RS256 only. The owner allowlist is `JOEHUB_OWNER_EMAIL` and/or `JOEHUB_OWNER_SUB`. When both are set, both must match. A different owner gets 403 and no session. No client id in this repo is a real provider credential. Tests use a local issuer and JWKS.

The dev login accepts the username `synthetic` and the password `synthetic` only when dev auth is explicitly enabled and the process is not production or preview. Production and preview refuse to start if dev or fake auth is enabled, if the session secret is missing or shorter than 16 characters, or if the OIDC and Upstash settings are incomplete. `next build` does not need those secrets. The Python service keeps its own startup rule for the dev pair, the session secret, and the scoped read credential.

Development without OIDC settings keeps sessions, revocation, and rate limits in process memory so the synthetic UI tests can run. That memory is not a database and is not the production store. Production and preview require the Upstash REST adapter. `JOEHUB_STORE=memory` is rejected there. A store error or a bad configuration is 503 for both pages and APIs. A missing session is 401 on `/api` and a redirect to `/api/auth/login` on a page. The app does not open when the store or the config fails.

## Secret boundaries

- Browser-exposed configuration must not carry the session secret, the read credential, the database path, the age key, or the operator token. `tests/test_web_public_env.py` fails if a public env name is paired with a secret-like word.
- The web build is scanned for `/home/box/joehub`, `AGE-SECRET-KEY`, `operator.token`, and `age-identity`. Client bundles are also scanned for the server env names.
- The Python API holds `JOEHUB_READ_CREDENTIAL` for the internal read service. It has no operator token and no age key. The age key remains only on the existing export job.
- Request logs record the method and path. They do not record row payloads.
- `.gitignore` and `.dockerignore` ignore `*.db`, `*.age`, key material, and `.env` files.

Preview and production are separate. When `VERCEL_ENV` is `production`, `preview`, or `development`, `JOEHUB_ENV_SCOPE` must equal it or the process refuses to start. The error does not include the allowlist. A preview process with `JOEHUB_ENV_SCOPE=production` does not boot, so it cannot use a config that was labeled for production. On Vercel the issuer and the Upstash URL must be `https`. Copying the same secret values into preview and only changing the scope label is not something the process can see. Preview and production need their own session secret, OIDC client, owner allowlist, and Upstash database. A preview is not a place to point at the private database or to turn on fake login.

## Isolation

Running the UI, the API, and SQLite as one OS user on the shared computer is not isolation. A process with that uid can open the database file itself. Real isolation needs a separate host or a dedicated uid before any live data is connected. That is the same limit recorded in `docs/TRUST_BOUNDARY.md`.

Deploying this public repository moves no personal data. The fixtures in git are fictional. The database, exports, and keys are not in the repository.

## Hosting

Hosting for this foundation is free-tier only. There is no `vercel.json`, no project link, and no account in this repo. Nothing has been deployed.

The auth plumbing is aimed at a later Vercel Hobby process plus Upstash Redis Free over the REST API. Those accounts are not opened here. The Upstash adapter speaks the REST command array (`Authorization: Bearer`, JSON body, `{ "result": ... }`) and is tested against a local fake HTTP server. Middleware and route handlers both use that store in production and preview, so a session issued on one instance is visible to another.

Leave `api/` undeployed until live reads exist. Do not put the private SQLite file on a host disk. The web app does not open SQLite, an age key, or Notion.

Costs are UNVERIFIED. This pass did not open an account or re-check vendor price pages, free-tier limits, or overages. A free allowance can become a charge. Nothing here selects a paid plan.

The source of truth and any move of the datastore are a separate live-migration decision. This scaffold does not perform that move.

## What this phase does not deploy

No account is opened, no secret is committed, and nothing is deployed. `/api/health` returns `{ "ok": true }` with no store and no secret, including when the rest of the config is invalid. Every other page and `/api` route is gated. With `JOEHUB_DEV_AUTH=1` outside production and preview, HTML pages stay open so the synthetic UI tests can render without a Secure cookie on `http://127.0.0.1`. APIs still require a session. Production and preview do not use that exception.

The More menu and any new database tables stay on hold. Device rows are session records, not a verified-device product. The OIDC allowlist is the owner check.

### Fixture packaging on a Vercel build

`web/lib/fixtures.json` is a copy of `contract/fixtures.json`, and a Next.js standalone build is checked for that file. A Vercel build has not been run. Confirm the same fixture file is present in the Vercel build output before that build is served.

## Decisions only Joe can make

- Which OIDC provider to use. The adapter is provider-agnostic. Google is a candidate and is not chosen.
- Whether to open a Vercel Hobby account and an Upstash Free account. Neither is opened in this pass.
- Distinct Preview and Production values for `JOEHUB_ENV_SCOPE`, `JOEHUB_SESSION_SECRET`, `JOEHUB_OIDC_ISSUER`, `JOEHUB_OIDC_CLIENT_ID`, `JOEHUB_OIDC_CLIENT_SECRET`, `JOEHUB_OWNER_EMAIL` and/or `JOEHUB_OWNER_SUB`, `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`, and `JOEHUB_PUBLIC_ORIGIN`. Do not reuse production values in preview.
- The domain name and DNS.
- When to deploy. This pass does not deploy.
- When fictional fixtures are replaced with live reads, and when the separable `api/` process is deployed. The web app still does not open SQLite, an age key, or Notion.
