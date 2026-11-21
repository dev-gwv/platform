# Outstanding — deliberately deferred

Work that is decided and understood but not done yet. Each entry says what it
is, why it was left, and what "done" looks like, so picking it up later does
not mean re-deriving the decision.

Last updated 2026-09-17.

## Sentry: source maps

Browser stack traces arrive minified. The Vite plugin is already wired and
skips silently when the credentials are absent, which is why builds succeed
without them.

**To finish:** set three variables in **Cloudflare's build environment** (not
the VPS `.env`, which never needs them):

| Variable | Value |
|---|---|
| `SENTRY_AUTH_TOKEN` | an **organisation** auth token, scopes `project:releases` + `org:read` |
| `SENTRY_ORG` | the org slug |
| `SENTRY_PROJECT` | `ipc-web` |

Create the token at **Settings → Auth Tokens** at the *organisation* level —
not the personal one under the user menu. A personal token carries one human's
access to every project they can see and stops working the day their account
is disabled.

`apps/web/vite.config.ts` uploads the maps and deletes them from `dist` after
upload, and `build.sourcemap` is `'hidden'` so no `sourceMappingURL` ships to
visitors.

## Sentry: frontend build variables

The browser DSN is in `apps/web/src/shared/config.ts` (public by design — it
ships in the bundle), and the release is read from Cloudflare's own commit
variable, so the frontend reports correctly without configuration today.

**Optional overrides**, if the defaults ever stop fitting:

| Variable | Effect |
|---|---|
| `VITE_SENTRY_DSN` | overrides the in-source DSN |
| `VITE_ENVIRONMENT` | defaults to `production` for a production build |
| `VITE_SENTRY_REPLAY=1` | puts Session Replay in the bundle (~40 kB gzip; off by default since 21 Nov) |
| `VITE_APP_VERSION` | overrides the commit the build reports |

## Sentry: alerting

Events arrive but nothing announces them, which makes the whole thing a log
file with a nicer font.

**To finish:**
- **Crons** → alert on a **missed** check-in for `crm-followup-cron` and
  `attendance-absent-sweep`. This is the one that matters: a job that is not
  running cannot report that it is not running, which is how `cron-attendance`
  sat unstarted for months.
- One alert rule on **new issue in production** → email or Slack.

## Deploy: self-hosted runner

Deploys work again, but the failure that broke three of them in a row is
intermittent, not fixed. `dial tcp ***:22: i/o timeout` means packets dropped
before sshd saw them; GitHub's runner addresses rotate every run, so a jail
that reacts to that will keep re-banning them. It will work, silently stop for
an hour, then work again.

`.github/workflows/deploy.yml` already supports the fix: install a self-hosted
runner on the VPS and set the repo **variable** `DEPLOY_RUNNER` to its label.
The job then deploys in place with no inbound connection at all — the runner
polls GitHub outbound.

Worth ruling out first: an `i/o timeout` is also what a stale `VPS_HOST`
secret looks like. Compare it against what the API's hostname resolves to.

## Sentry: Node profiling

`@sentry/profiling-node` was deliberately not added. It is a native module and
the API runs on `oven/bun:1.3-slim`; native bindings under Bun in a slim image
can stop the container starting, and that cannot be verified without building
and booting the image. If profiling is wanted, add it behind a build that is
tested before it reaches a deploy.

## Decisions already made (not tasks)

- `ZZ Parity —` records in the live app are deliberate test fixtures. Leave
  them.
- `team_payout_settlements` stays as a table. Nothing reads or writes it; it is
  commented SUPERSEDED because a table drop cannot be undone.
- `/hr/attendance/auto-check-in` exists and nothing calls it. That is a
  product decision about tracking staff, not an oversight to fix.
