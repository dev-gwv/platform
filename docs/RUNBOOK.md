# IPC Studios — Operations Runbook

## Environments & secrets

Backend secrets live in the repo-root `.env` on the VPS (consumed by Docker
Compose); the web app's build-time vars live in Cloudflare Workers Builds. Never commit
them. `deploy/.env.example` lists every variable.

| Variable | Where | Notes |
|---|---|---|
| `POSTGRES_PASSWORD` | `.env` (db superuser) | Change in Postgres, then `.env`, then `up -d` |
| `DB_AUTHENTICATOR_PASSWORD` | `.env` (role the API logs in as) | The `migrate` service re-applies it on every deploy |
| `RESEND_API_KEY` | `.env` | Rotate in Resend → `up -d api` |
| `BACKUP_S3_ACCESS_KEY_ID` / `..._SECRET_ACCESS_KEY` | `.env` | Scoped to the backup bucket; rotate in the storage provider |
| `JWT_SECRET` | API | HS256 signing key. Rotating it signs everyone out. |
| `CRON_SECRET` | API + scheduler | Compared in constant time. Rotate both sides together. |
| `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` / `RAZORPAY_WEBHOOK_SECRET` | API | With the key pair set, `/subscription/order` creates a Razorpay order and `/subscription/activate` **requires** the Checkout signature. Without it, activation is only allowed when `ENVIRONMENT` is `development`, `test`, `ci` or `local`. |
| `META_VERIFY_TOKEN` / `META_APP_SECRET` / `META_PAGE_ACCESS_TOKEN` | API | Handshake token, post signature secret, Graph API page token (see "Meta lead ads and WhatsApp"). |
| `WHATSAPP_PHONE_NUMBER_ID` / `WHATSAPP_ACCESS_TOKEN` | API | Optional. Templates are delivered by the WhatsApp Cloud API when both are set. |
| `AUTH_COOKIE` / `AUTH_COOKIE_SAMESITE` / `AUTH_COOKIE_DOMAIN` | API | Optional. `AUTH_COOKIE=1` keeps the refresh token in an HttpOnly cookie (see "Refresh-token cookie mode"). |
| `ALLOWED_ORIGINS` | API | Comma-separated prod origins. Empty in production = deny all. |
| `CLIENT_IP_HEADER` | API | Which header carries the real client address. `X-Forwarded-For` (default, last hop; Caddy/nginx) or `CF-Connecting-IP` (behind Cloudflare). Trusting the wrong one lets callers pick their own rate-limit bucket. |
| `SENTRY_DSN` | API | Optional. Errors, traces and cron check-ins. Unset = logs only. |
| `SENTRY_TRACES_SAMPLE_RATE` | API | `0`..`1`. Default `0.1` in production, `1` elsewhere. `0` keeps errors, drops tracing. |
| `LOG_LEVEL` | API | `debug` / `info` / `warn` / `error`. |
| `APP_VERSION` | API | Release id shown by `/health` and stamped on every Sentry event. Set by the deploy to the commit SHA. |
| `VITE_SENTRY_DSN` | Web (build) | Browser DSN. Empty = Sentry off and the beacon fallback is used instead. |
| `VITE_APP_VERSION` | Web (build) | Must equal the API's `APP_VERSION`, or the two halves report different releases. |
| `VITE_ENVIRONMENT` | Web (build) | `production` etc. Drives the browser sample rates. |
| `VITE_SENTRY_REPLAY` | Web (build) | `0` drops Session Replay from the bundle (~40 kB gzip). Anything else keeps it. |
| `SENTRY_AUTH_TOKEN` / `SENTRY_ORG` / `SENTRY_PROJECT` | CI only | Source-map upload at build time. **Never** in the runtime `.env`. |
| `ENVIRONMENT` | API | `production` fails closed everywhere (token echo, demo activation, CORS). |

## Sentry

### Which credential goes where

Sentry issues three kinds of credential and they are not interchangeable.

| Credential | Where it lives | Why |
|---|---|---|
| **DSN** | `SENTRY_DSN` in the VPS `.env`, `VITE_SENTRY_DSN` in the web build | Not a secret. It only permits submitting events to one project, and the browser one is visible in the bundle by design. |
| **Organization auth token** | CI secret `SENTRY_AUTH_TOKEN`, build time only | Uploads source maps. Belongs to the org, not a person, and is scoped to releases. |
| **Personal auth token** | Nowhere in this repo | Carries one human's full access to every project they can see, and stops working the day their account is disabled. Fine for poking the API from your own laptop; never for automation. |

The auth token is **not** needed to run the app. If source maps are the only
thing you are missing, the app still reports errors — the traces are just
minified. So put the token in GitHub Actions / Cloudflare build settings and
leave the VPS `.env` without it.

Create the org token at **Settings → Auth Tokens** (organization level, not
the one under your user menu), with `project:releases` and `org:read`.

### What is instrumented

- **API errors.** Every `attempt()` failure and every unhandled error already
  routed through `lib/error-reporter.ts`; it now hands them to the SDK instead
  of posting a hand-built envelope. Tagged with `label` (the operation name,
  e.g. `crm.merge`), `pg_code` (the SQLSTATE — `42501` is an RLS refusal,
  `23505` a duplicate), `request_id`, user id and `company_id`.
  4xx `HTTPException`s are *not* reported: those are answers, not faults.
- **API tracing.** Hono routes and postgres.js queries, so a slow endpoint
  names the query that made it slow. Sampled at `SENTRY_TRACES_SAMPLE_RATE`.
- **Cron monitors.** `/cron/reminders` checks in as `crm-followup-cron`
  (hourly) and `/cron/attendance` as `attendance-absent-sweep` (`30 18 * * *`
  UTC). Sentry raises an issue when a run **fails** and, more importantly, when
  an expected run **never arrives** — the failure mode that let
  `cron-attendance` sit unstarted for months. `?dry=1` never checks in.
- **Browser errors.** React render crashes (via React 19's `onUncaughtError` /
  `onCaughtError` / `onRecoverableError`), unhandled rejections, failed
  mutations, and failed fetch/XHR.
- **Browser tracing**, route-aware: transactions are named `/projects/$id`
  rather than one per project id. Connected to the API's trace through the
  `sentry-trace` and `baggage` headers, which is why both are in the CORS
  `allowHeaders` — without them the browser's preflight fails and *every* API
  call breaks, not just the tracing.
- **Session Replay**, masked (`maskAllText`, `maskAllInputs`, `blockAllMedia`)
  and only kept for sessions that errored.

### What is deliberately not sent

`sendDefaultPii` is off on both halves. This is a multi-tenant CRM: default PII
would attach headers, cookies and bodies, which here means client phone
numbers, addresses and auth tokens. Events carry the **user id** and
**`company_id`** tag and nothing else about a person. `beforeSend` on the API
additionally redacts connection strings and anything shaped like a JWT out of
messages and stack traces.

### Turning it off

Unset `SENTRY_DSN` (API) or `VITE_SENTRY_DSN` (web) and redeploy. The API falls
back to structured logs; the web falls back to the `/health/client-errors`
beacon, which is what it used before. With no DSN at build time the SDK
tree-shakes out of the bundle almost entirely (~7 kB gzip remains).

## Logging, request ids, error tracking

- Every request gets an `X-Request-Id` (an inbound one from a trusted proxy is
  kept). It is echoed on the response, stamped on every log line the request
  produces, and written into `audit_logs.correlation_id`.
- Logs are JSON lines on stdout (pino-shaped: `level`, `time`, `msg`, fields).
  `docker compose logs api | grep <request-id>` finds everything about one call.
- Any failing operation goes through `attempt()` (`services/api/src/lib/attempt.ts`):
  it logs the Postgres code and message, sets `X-Correlation-Id`, reports to
  Sentry when configured, and maps `42501`→403, `23505`/`23503`→409,
  `22023`/`P0001`→422, connection loss→503 instead of a blanket 400. There are no
  swallowed `.catch(() => null)` calls left in the API.
- The web client shows the id under any failed panel as "Reference: …" — ask
  the user for it.
- The web app beacons its own crashes (`window.onerror`, unhandled rejections)
  to `POST /health/client-errors` (public, 20/min, tiny schema, throttled
  client-side to one per message per minute). They land as `client error` log
  lines — grep those when a user reports something the API never saw.

## Audit trail

`audit_logs` records who did what to which row (`action`, `entity_type`,
`entity_id`, `before`, `after`, `ip`, `correlation_id`). Writes go through
`audit_log_write()` (SECURITY DEFINER, stamps the caller's own studio). The
owner reads it at **Settings → System**, or via `GET /settings/audit`.
Domain-specific trails remain: `access_audit_logs`, `billing_events`,
`crm_lead_events`, `razorpay_webhook_events`.

## Cron

The `cron` service (or any scheduler) calls `POST /cron/reminders` hourly with
`x-cron-secret: $CRON_SECRET`. One tick runs `run_reminder_cron()`,
`run_crm_followup_cron()` (overdue follow-ups → notifications + automation
rules) and sweeps expired refresh tokens. `?dry=1` is a no-op run. Every run
lands in `cron_runs`; read it at **Settings → System** or `GET /cron/runs`
(owner or platform admin). A row with no `finished_at` did not complete.

A second job, `POST /cron/attendance`, runs **once a night at `30 18 * * *`
UTC** — midnight in Asia/Kolkata, matching the old app's sweep. It calls
`mark_absent_backstop()`, which writes an `absent` row for every active member
with no attendance row for that date, in each company's own timezone.

It is deliberately not part of the hourly tick. Marking people absent at 1am
and letting check-in flip them back (0014 does flip absent → present) would
make any absence figure read during the day a lie. `?dry=1` counts what it
would write without writing it, and the job is idempotent — `on conflict do
nothing`, so a retried or doubled run adds nothing the first did not.

Until 2026-09-16 nothing called this function at all, so no studio had ever
had an absent day recorded: a date nobody touched was simply no row.

Its ticker is the `cron-attendance` service in `docker-compose.yml`. The deploy
workflow starts services **by name**, so a service added to the compose file is
defined and never started until it is added to that list too — which is exactly
what happened to this one on the day it was written. If a scheduled job stops
firing, check `docker compose ps` on the VPS before suspecting the job.

## Rate limiting

`services/api/src/middleware/security.ts`. Sign-in surfaces (`/auth/login`,
register, verify, reset, invite) share one bucket of 10/min per address;
session upkeep (`/auth/session`, `/auth/refresh`, sign-out) has its own
120/min bucket so an office NAT is never locked out of the app. The store is
in-process and bounded (stale keys swept, LRU-evicted past 10k keys). It is
per process: before running more than one API replica, move the store behind
something shared (Postgres unlogged table or Redis) — the `HitStore` interface
is the seam.

## Health

`GET /health` → `{ ok, service, version, uptime_s, db, db_latency_ms }`. `db` is
`ok`, `unreachable` (503) or `not_configured`. It names no environment and
repeats no driver error text. Point uptime monitors at it.

## RLS is the primary enforcement

Every tenant table has `company_id` and an RLS policy scoped to
`get_current_company_id()`. Since 0034 that oracle resolves for any live
member **regardless of plan**; the plan gate lives in `is_current_user_active()`,
which feature tables use. That is what keeps the subscription page reachable
when the plan has lapsed — the recovery path must not sit behind the thing it
recovers from. The API connects as the unprivileged `authenticator` role and
`SET ROLE`s to `authenticated` per request with the caller's id in a GUC, so the
database — not application code — is what keeps studios apart.

## DB verification

Migrations are logic-tested against pglite in `supabase/tests/tenancy.test.ts`
(0001–0039 applied in order). pglite runs as superuser, so RLS *enforcement* is
proven on real Postgres by `supabase/tests/rls-live.mjs` and by the CI `e2e`
job, which registers two throwaway studios over HTTP and asserts studio A
cannot read studio B's company, clients or users.

Run it against any environment:

```bash
API_URL=https://api.yourstudio.in bun supabase/tests/rls-live.mjs
```

## Payments

Checkout: `POST /subscription/order` prices the plan in SQL (+18% GST) and,
with Razorpay configured, registers the order with Razorpay and returns
`razorpay_order_id` + `key_id`. The browser opens Razorpay Checkout; on success
it posts `{order_id, payment_id, signature}` to `/subscription/activate`, which
verifies the HMAC before touching the plan. The webhook (`/webhooks/razorpay`)
is the belt-and-braces path: signature-checked, replay-proof
(`razorpay_webhook_events`), and activates by the provider order id.

## Web app (Cloudflare Workers static assets)

`apps/web/public/_redirects` rewrites every path to `index.html` (deep links
survive a refresh). `apps/web/public/_headers` sets HSTS, frame denial and a
CSP that permits only the app's own scripts plus Razorpay Checkout. Its
`connect-src` is `https:` because the build cannot template the API origin —
tighten it to `'self' https://api.<your-domain>` once known.

## Backups & restore

The `backup` service (`deploy/backup/`) runs `pg_dump -Fc` once at container
start and then daily at `BACKUP_AT_UTC` (default 02:30 UTC). Each dump is
verified with `pg_restore --list` before it counts as a success; local copies are
pruned after `BACKUP_KEEP_DAYS` (7).

**Off-box copies are opt-in and you want them on.** Set `BACKUP_S3_BUCKET` and
the rest of the `BACKUP_S3_*` block in `.env` (any S3-compatible bucket — R2, B2,
S3, MinIO) and each dump is uploaded with rclone and pruned after
`BACKUP_OFFSITE_KEEP_DAYS` (30). Without it every backup sits on the same disk as
the database it is protecting.

The container goes **unhealthy** if there has been no successful local backup in
26h (or no off-box copy in 72h, when configured), so a backup path that quietly
breaks shows up in `docker compose ps` and fails the next deploy's `--wait`.

```bash
docker compose logs backup                       # what it has been doing
docker compose run --rm backup once              # take one right now
docker compose run --rm backup restore list      # what exists, here + off-box
```

### Restore

Destructive — it drops and recreates the database, so stop the API first.

```bash
docker compose stop api cron
docker compose run --rm -e RESTORE_CONFIRM=yes backup restore latest
docker compose up -d migrate api cron
```

Without `RESTORE_CONFIRM=yes` it prints what it would do and stops. Pass a dump
filename instead of `latest` to pick one; a name that isn't on this box is pulled
from off-box storage automatically.

**Do a restore drill on a scratch VPS before you need one.** An untested backup
is a hope. What to check afterwards: `/health` is green, a studio owner can log
in, and a project's invoices and payments still add up.

## Incident response

- Start from the reference id the user quotes. It is the request id: grep the
  API logs for it, then `select * from audit_logs where correlation_id = '…'`.
- Payment disputes: `payment_orders`, `payment_transactions`,
  `razorpay_webhook_events`, `billing_events`, plus `audit_logs` rows with
  `entity_type = 'payment_order'`.
- Access disputes: `access_audit_logs` (profile/override changes) and
  `audit_logs` (`member.*`, `role.*`, `access.set`).
- A member removed from a studio loses their session at the next refresh
  (0034 `rotate_refresh_token`), and `revoke_all_sessions` is called on removal.

## Security posture notes

- No plaintext credentials are stored. Passwords are argon2id (Bun.password).
- Tokens: 30-minute access JWT + 30-day rotating refresh family; a reused
  refresh token revokes its family. Change-password and sign-out-everywhere
  bump `password_version`, stranding every earlier access token.
- Client links (`work_delivery`, `terms_ack`, invitations, resets) store only a
  sha256 hash of the token.
- Meta lead ads: signature-verified posts, lead fields fetched by `leadgen_id`
  (see below). Any plain JSON form can still post to the same source URL.

## Refresh-token cookie mode

`AUTH_COOKIE=1` moves the 30-day refresh token into an `HttpOnly; Secure`
cookie named `ipc_refresh`, scoped to `/auth` on the API origin. The response
body then carries `refresh_token: ""`; the SPA keeps only the 30-minute access
token (in memory, mirrored to sessionStorage per tab) and sends the cookie on
`/auth/*` calls. Turn it on when the app and the API share a registrable domain
(`app.studio.in` + `api.studio.in`, with `AUTH_COOKIE_SAMESITE=lax` and
optionally `AUTH_COOKIE_DOMAIN=.studio.in`). On split sites use
`AUTH_COOKIE_SAMESITE=none` (HTTPS only); Safari may still refuse the cookie
as third-party, so prefer a shared domain. Off (default), the body token is used
as before; the client handles both.

## Meta lead ads and WhatsApp

- `META_VERIFY_TOKEN` completes the subscription handshake; `META_APP_SECRET`
  verifies `X-Hub-Signature-256` on every post (a Meta-shaped post without one
  is refused once the secret is set). Each studio connects its own Facebook
  page (0204): `META_APP_ID` + `APP_URL/lead-sources` as an OAuth redirect give
  the "Connect with Facebook" button, the page tokens are sealed with
  `WHATSAPP_TOKEN_KEY`, and the Meta app's Page webhook points at
  `<API>/webhooks/meta` (field `leadgen`) once, for every studio. The page id
  in each post finds the studio. `META_PAGE_ACCESS_TOKEN` (one token for all)
  is legacy: it still serves `/webhooks/lead/:sourceKey` for a page nobody
  connected.
- `WHATSAPP_PHONE_NUMBER_ID` + `WHATSAPP_ACCESS_TOKEN` make "send template"
  deliver through the WhatsApp Cloud API (text messages). Unset, the API hands
  back a `wa.me` link and the person's own WhatsApp opens with the text.

## CRM cadences and the hourly sweep

A cadence is a sequence of follow-up steps (day offsets, optional template,
note). `start_lead_cadence()` puts a lead on one (also via the automation
action `start_cadence`); the hourly `/cron/reminders` tick calls
`run_crm_followup_cron()`, which advances due steps (next follow-up on the
lead, notification to its owner, history event), then handles overdue
follow-ups and their rules. Winning or losing a lead stops its cadence. There
is no `pg_cron`; the `cron` compose container is the scheduler.

Saved CRM views live in `crm_saved_views` per person; views saved in a browser
before this are pushed up the first time the inbox loads. Visibility is
`private` (default), `team` or `everyone`; the inbox offers both on save when
the person may edit the CRM, and the default view opens itself only when no
filter is already set. Per-person inbox layout (columns, density, default
view) lives in `crm_user_prefs` (`GET`/`PUT /crm/prefs`).

## CRM quotes and forecast

- A quote is built from invoice lines (`POST /crm/quotes`, totals from
  `@ipc/domain` `computeInvoice`); `POST /crm/quotes/:id/send` issues the
  public link (`/quote/accept?token=…`, `APP_URL` must be the web origin) and
  optionally delivers it on WhatsApp or by email the way templates do.
- The client page is public (`GET /public/quote/:token`, one-time
  `POST …/accept|decline`); acceptance stamps the deal's value and notifies
  its owner (skipped when the deal is unassigned). Sent quotes past
  `valid_until` expire on the hourly tick (`crm_expire_quotes()`); only drafts
  can be deleted. Converting with `quote_id` carries the quote's lines into
  the project as deliverables and takes the name and cost from the quote.
- `GET /crm/forecast` weights open deals by probability over their expected
  close (`close_date`, else arrival); the Forecast tab breaks it by stage,
  owner and month with win rate and average cycle. Reports adds lost analysis
  (`byLostReason`, `byCompetitor` from `crm_stats`).
