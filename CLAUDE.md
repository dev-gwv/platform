# Working in this repo

Two Claude sessions work on this codebase at the same time, on the same
branch, most days. Everything below exists because something went wrong
without it.

## Before you start: pull

`git pull` first, every session, and again before you push. `main` moves
several times a day.

## Migration numbers collide — claim one before you write it

This has now happened three times: two sessions pick "the next free number"
against a moving target, both write it, and the second to merge breaks
`supabase/tests/apply-all.mjs`, which asserts the numbering is contiguous and
unique. A duplicate number breaks the **other** session's deploy, not only
your own.

Before writing a migration:

```bash
git fetch origin && git ls-tree --name-only origin/main supabase/migrations/ | sort | tail -3
```

Then take the next number **and push something that claims it within the
hour** — an unpushed migration number is not claimed. If your work is not
ready, push the migration file alone, empty but for its comment header.

Renumbering after the fact is cheap but easy to get half-right: the number
appears in the filename, in the test that reads the file by name, and in the
comments of every file that cites it. Grep for it.

## Do not run bare `docker compose` on the VPS

The production host is **Coolify-managed**. Its Traefik owns :80 and :443, and
the API is published by the Traefik labels in `docker-compose.coolify.yml` —
not by the `caddy` service in the base compose, which can never start there.

```bash
sh deploy/deploy.sh      # correct: applies the overlay
docker compose up -d api # WRONG: drops the labels, API vanishes behind a 503
```

A bare `up` recreates the container without the labels or the `coolify`
network. The API stays healthy and becomes unreachable, and the browser
reports "Failed to fetch" — the 503 comes from the proxy, so it carries no
CORS headers and the page cannot read it. This has taken the site down once.

`docs/vps-deploy.md` still describes the Caddy setup; that is the shape for a
host where IPC owns the ports, not for this one.

## SQL conventions that have bitten us

- **`create or replace` cannot change an argument list.** Always
  `drop function if exists name(old, arg, types);` first, or you leave two
  overloads and every later call fails ambiguous (42725).
- **Never rebuild a function body from an older migration.** Copy the latest
  definition and edit that. Rebuilding from an old base silently reverted the
  picklists in 0139 and broke `check_in()` once.
- A lost lead needs a `lost_reason` (0037) and it is checked on the way in.
- Only `status = 'paid'` counts as money (0146). Pending is a promise.

## Before you push

```bash
bun run typecheck && bun run lint && bun run test
```

The suite is the gate. If a dependency was added by the other session,
`bun install` first — a missing package looks like a type error in files you
never touched.

## Who is working on what

Keep this short and current. Delete a line when it lands.

| Area | Session | Notes |
| --- | --- | --- |
| CRM / Leads / availability | Claude (Opus, terminal) | 0193 taken. Date availability shipped; date holds, push alerts and open-tracking are planned next. |
| Tasks, Quotations, onboarding, payroll | Claude (client's session) | 0190–0192 |

If you are about to work in an area listed above that is not yours, pull
first and check the recent log for that path before assuming it is free.
