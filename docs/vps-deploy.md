# Self-hosting on a VPS (Docker Compose) — Postgres, no Supabase

The **backend** runs on your box: **self-hosted Postgres** + the Bun API + Caddy
(auto-HTTPS) + an hourly cron ticker. No Supabase. The **web frontend** deploys
separately to **Cloudflare Workers** (static SPA calling the VPS API). RLS is enforced
on plain Postgres exactly as before — the API connects as an unprivileged
`authenticator` role and `SET ROLE`s per request, binding `auth.uid()` from a JWT
claim, so every existing RLS policy / RPC / trigger works unchanged.

## What's in the box

| File | Role |
|---|---|
| `deploy/db/00_bootstrap.sql` | Recreates the Supabase surface on plain PG: `auth` schema + `auth.users`, `auth.uid()`, the role model, extensions, table grants. |
| `deploy/db/migrate.sh` | `migrate` service: idempotent bootstrap + applies any pending migrations (tracked in `schema_migrations`) on every deploy. |
| `docker-compose.yml` | `db` (postgres:16) + `api` (Bun) + `caddy` (TLS/proxy) + `cron`. |
| `services/api/src/server.ts` | Bun entrypoint — `Bun.serve` passing `process.env` as Hono's `env`. |
| `deploy/Caddyfile` / `deploy/.env.example` | API reverse-proxy config / all secrets. |
| `.github/workflows/deploy.yml` | Push-to-main CD: `api` job (SSH → compose). The web app deploys via Cloudflare Workers Builds. |

## One-time setup

1. **DNS**: point `api.yourstudio.in` (A/AAAA) at the VPS IP. Ports 80 + 443 open.
   (The `app.` domain is managed by the Cloudflare Worker that serves the SPA.)
2. **Install Docker** (Engine + Compose plugin).
3. **Clone + configure**:
   ```bash
   git clone https://github.com/IPC-Studios/platform.git && cd platform
   cp deploy/.env.example .env
   # edit .env — API_DOMAIN, POSTGRES_PASSWORD, DB_AUTHENTICATOR_PASSWORD,
   #             JWT_SECRET, ALLOWED_ORIGINS, RAZORPAY_*, CRON_SECRET
   ```
   `ALLOWED_ORIGINS` must include the web app origin or the browser is CORS-blocked.
4. **Launch** (the `migrate` service bootstraps + applies migrations):
   ```bash
   docker compose up -d --build
   ```
   Verify:
   ```bash
   curl https://api.yourstudio.in/health          # {"ok":true,"service":"ipc-api",...}
   API_URL=https://api.yourstudio.in bun supabase/tests/rls-live.mjs   # end-to-end auth + RLS
   ```
   `rls-live.mjs` registers two throwaway studios and proves one cannot read the
   other's data — the real cross-tenant RLS gate.

## First platform admin (no UI, by design)

```bash
docker compose exec db psql -U postgres -d ipc \
  -c "insert into platform_admins (user_id) select id from auth.users where email = 'you@studio.in';"
```

## The frontend (Cloudflare Workers static assets)

The web SPA is a static build served by a Cloudflare Worker
(`apps/web/wrangler.jsonc`, `assets.directory = dist`,
`not_found_handling = single-page-application`). It is built and deployed by
**Cloudflare Workers Builds** from the connected GitHub repo on every push to
`main` — not by GitHub Actions. In the Cloudflare dashboard the project needs:

- build command `bun install && bun run --filter @ipc/web build`, deploy
  command `wrangler deploy`, root directory `apps/web`
- build variable `VITE_API_BASE_URL=https://api.yourstudio.in` (baked into the
  bundle at build time; only `VITE_*` vars reach the browser)

`apps/web/public/_headers` ships the SPA's security headers (HSTS, CSP, frame
denial) and `_redirects` the history fallback; both are honoured by Workers
static assets. Auth is a bearer token in `localStorage`. Add the app origin to
the API's `ALLOWED_ORIGINS`.

## Continuous deploy (GitHub Actions)

Two workflows, both triggered by `main`:

- **`ci.yml`** runs on every push and pull request: install, typecheck, lint,
  unit tests (incl. the pglite migration suite), then an `e2e` job that applies
  the bootstrap + every migration to a real Postgres 16, boots the API with
  `ENVIRONMENT=ci`, and runs `supabase/tests/rls-live.mjs` (cross-tenant RLS,
  refresh rotation, password reset). A red CI does not block the deploy on its
  own — protect `main` in GitHub (require the `verify` and `e2e` checks) so a
  PR cannot merge red.
- **`deploy.yml`** runs on push to `main` (or manually via *Run workflow*) and
  has one job, **`api`**: it SSHes into the VPS, checks out `origin/main`, and
  runs `docker compose -f docker-compose.yml -f docker-compose.coolify.yml up
  -d --build --wait --remove-orphans db migrate api cron`. `--wait` blocks on
  the db + api healthchecks, so a broken build fails the run. The frontend is
  deployed by Cloudflare Workers Builds (above), not by this workflow.

Arm the deploy once with the repo **variable** `DEPLOY_ENABLED=true` and the
**secrets** `VPS_HOST`, `VPS_USER`, `VPS_SSH_KEY`, `VPS_PATH` (+ `VPS_PORT` if
not 22). These are the only values GitHub holds; application secrets never
pass through Actions.

### Where each environment variable lives

| Kind | Lives in | Examples |
|---|---|---|
| Backend runtime (API, cron, migrate) | `.env` in the checkout on the VPS, read by `docker compose` via `env_file`. Never in git, never in GitHub. Template: `deploy/.env.example`. | `JWT_SECRET`, `DATABASE_URL` parts, `RAZORPAY_*`, `META_VERIFY_TOKEN`, `CRON_SECRET`, `ALLOWED_ORIGINS`, `CLIENT_IP_HEADER`, `SENTRY_DSN`, `LOG_LEVEL`, `APP_VERSION` |
| Frontend build | Cloudflare Workers Builds → project settings → variables | `VITE_API_BASE_URL` |
| CI only | Hard-coded in `ci.yml` (throwaway values against a throwaway database) | `JWT_SECRET=ci-test-secret`, `ENVIRONMENT=ci` |
| Deploy plumbing | GitHub repo secrets / variables | `VPS_*`, `DEPLOY_ENABLED` |

Adding a variable means: add it to `deploy/.env.example` (documentation), add it
to `services/api/src/context.ts` (`Env`), then set it in the VPS `.env` and
`sh deploy/deploy.sh` (or let the next deploy restart it; never a bare
`docker compose up`, which drops the Coolify overlay's Traefik labels). Every variable
added in the 2026-09 audit is optional with a safe default, so a deploy before
the `.env` is updated still works.

### Migrations on deploy

The `migrate` service runs on every `up`: bootstrap (idempotent), then every
`supabase/migrations/*.sql` not yet recorded in `schema_migrations`, each in its
own transaction. **Check the ledger before the first deploy that carries new
migrations**: if `select count(*) from schema_migrations` is 0 on a database
that already has the schema, the migrator *baselines* every file — marks it
applied without running it — and the new ones would be skipped. In that case
insert the already-applied filenames into the ledger by hand first, then deploy.

## Webhooks

Update Razorpay (and Meta lead) webhook URLs to `https://api.yourstudio.in/webhooks/...`.
HMAC verification is runtime-agnostic; `RAZORPAY_WEBHOOK_SECRET` must match.

## Operating notes

- **Logs**: `docker compose logs -f api` / `... db`
- **Backups**: the `backup` service dumps nightly (02:30 UTC by default) into the
  `db_backups` volume and, once `BACKUP_S3_*` is set in `.env`, copies each dump
  off the box. It reports unhealthy if backups go stale. Restore drill and
  commands: see `docs/RUNBOOK.md` → "Backups & restore".
- **Migrations**: the `migrate` service runs bootstrap + pending migrations on every
  deploy (idempotent, tracked in `schema_migrations`); an already-migrated DB is
  baselined on first run so nothing re-applies. New migration files ship
  automatically — no manual `psql`. Roll back by restoring the pre-deploy dump.
- **Cron**: the `cron` service POSTs `/cron/reminders` hourly with `x-cron-secret`
  (idempotent, supports `?dry=1`). History at Settings → System or `GET /cron/runs`.
- **Auth**: 30-minute HS256 access token + 30-day rotating refresh token, email
  verification, password reset and change-password (all three need
  `RESEND_API_KEY` + `EMAIL_FROM` + `APP_URL`). Rotating `JWT_SECRET` signs
  everyone out.
- **Rate limiting**: in-process, bounded, one bucket per client address as
  resolved by `CLIENT_IP_HEADER` (behind Coolify/Traefik keep the default
  `X-Forwarded-For`). Multi-replica needs a shared store first.
- **Health**: `GET /health` returns 503 with `db: unreachable` when Postgres is
  down; point the uptime monitor at it.

## What you now own (vs Supabase + Cloudflare)

The database itself (backups, upgrades, tuning), TLS renewal (Caddy), process
supervision, OS patching, monitoring, firewall, and DDoS posture.
