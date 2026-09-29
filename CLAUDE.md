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

## UI rules the owner asked for

These come from the owner reviewing the live app. Apply them to anything you touch.

- **Every control looks like a control.** Anything that can be clicked or typed into has a visible border or fill -- never white on near-white. An empty box that needs filling gets a colour nudge (amber), and turns calm (green) once filled. (The Assign team payout box was invisible; that is the bug this rule exists for.)
- **Counters move the moment the user acts.** A pick, a tick or a choice shows in the count and the progress bar straight away, with "pending" told apart from "saved" (e.g. "1 of 6 chosen · press Book").
- **Use the icon family.** `shared/ui/icon-tile.tsx` + `shared/kinds.ts`: `EventTile` for shoots/events (haldi = sun, wedding = heart…), `RoleTile` for crew roles, `DeliverableTile` / `KindTile` for deliverables, `IconTile` for anything else (money rows). The owner likes these; the CRM deal cards could use `EventTile` for `event_type` too.
- **Say what the numbers mean.** A sentence beats three bare figures; when two numbers disagree (an unpaid invoice beside a received payment), say why and offer the one-tap fix.
- At most 3-4 things under a heading; plain English; no jargon.
- **No closed field. Every list gets "+ Add" where it is used.** A stage, a quality, a source, an event type, a follow-up type or priority, a tag: the studio types its own word in the picker and it joins the list for everyone. Use `shared/ui/quick-select.tsx` (`QuickSelect`) or the CRM wrappers in `features/crm/fields.tsx` (`LookupChip`, `EventTypeChip`, `StagePicker`), backed by `custom_lookups` (which carries a colour since 0209). Never a bare enum `<select>`. (The owner: "any studio should be able to add that customisation".)
- **Edit a thing where it is seen.** Stages are added, renamed, recoloured, moved and hidden from the board's column menu and "+ Add stage" column, and from the drawer's stage picker -- not only on a settings page.
- **Colour everywhere, from the seven tones** (`shared/ui/tones.ts`: blue, green, violet, amber, rose, teal, slate). Stages, qualities, sources, tags and priorities each carry one; draw them as chips, dots and tinted column headers so a screen reads at a glance. The owner compared ours to the Control Center and called it "boring"; that is the bar.
- **Minimal first. Less on screen beats more explanation.** No "What to do here" guide boxes and no explainer lines under headings; filters stay hidden until Filter is pressed, and then show only what is needed. Button names still say what they do in the studio's words ("Add another function", not "Full form"). When cleaning a page, take things off **that page only** -- never remove a feature from anywhere else. **Remove exactly what the owner names and nothing else**: "take off the guide boxes" means the boxes, not the tabs, strips or headings around them. (Hiding the project's Work to review / Terms / Billing / Expenses / Tasks tabs and the delivery strip along with the guides had to be undone the next day.)
- **The brand is Studio AutoPilot**, drawn with `shared/ui/wordmark.tsx` ("Studio" navy, "AutoPilot" gold, the email wordmark's font). "IPC Studios" stays only as the legal operator name (`features/legal/legal.ts`) and in Meta-approved WhatsApp templates.
- **When the owner gives a standing instruction, write it here** in this list, so the next session follows it without being told again.

## Who is working on what

Keep this short and current. Delete a line when it lands.

| Area | Session | Notes |
| --- | --- | --- |
| Subscriptions: 30-day trial, plans | Claude (client's session) | **0210 taken.** Every studio not paying (and not a platform admin's) gets 30 days (`grandfathered_until`), 2-Year plan is Rs 33,000 + GST, `company_access_until()` is the one "access ends on" rule; `platform_list_studios()` gains `access_until`. **0211 taken**: `access_email_due()` / `access_email_mark()` send the owner an email 7 days and 1 day before access ends and once when it has ended, once per end date (`lib/access-email.ts`, hourly cron). |
| CRM overhaul: colour, open fields, drawer, follow-ups | Claude (client's session) | **0209 taken.** Stages carry `color`/`is_active`; `custom_lookups.color`; quality and source are open text (only 'hot' ranks calls); follow-ups are tasks (`crm_activities` type 'task' + `priority`), with `crm_leads.follow_up_at` kept equal to the earliest open task by trigger. The owner asked this session to take the CRM over: `features/crm/*` (LeadDrawer, DealCard, BoardTabs, fields, drawer/*), `routes/follow-ups*.tsx`, `crm/objects.ts`, `crm/activities.ts` and the lookups block of `settings/router.ts` are this session's -- pull first. 75352d2's pipeline layout is the base. |
| CRM / Leads / availability | Claude (Opus, terminal) | **0196, 0197, 0200 shipped.** 0196: the rota counts open leads, not every lead ever, and `crm_settings.assign_strategy` is real. 0197 is CRM tags; 0200 the archive reason. **0199 is free again**: the owner asked the client's session to build the Meta per-studio connection now (0204, below); drop the unpushed 0199 and pull. |
| Team side: attendance, bookings, scorecard | Claude (client's session) | **0206, 0207, 0208 taken.** 0206: attendance places and per-position/per-person rules, the app marks attendance itself on open (inside the radius only), auto check-out. 0207: crew confirm/decline a booking and "I've reached"; tasks get started_at/completed_at. 0208: `member_scorecard()` and the Performance page. `hr/router.ts`, `routes/attendance*.tsx`, `features/dashboard/EmployeeDashboard.tsx`, `routes/shoots/my.tsx` and `modules/allocation/*` are this session's until these land -- pull first if you need them. |
| Meta lead ads per studio, "My day", leads going cold | Claude (client's session) | **0204 and 0205 shipped.** 0204: `fb_page_tokens` (service-only, sealed page token per page) and `meta_page_company()`; `POST /webhooks/meta` routes Meta's posts by page id; `lib/meta.ts`, `modules/webhooks/router.ts` (Meta parts) and `features/facebook/*` are this session's now. 0205: `crm_day_report()` for Today's calls, `crm_cold_sweep()` on the CRM cron, and the morning email's "Leads going cold". |
| Heads up: CSV export is now gated | Claude (Opus, terminal) | `crm_export` was a sensitive, staff-denied permission that nothing read, so any employee could download the whole client book. It is enforced as of 0196's commit. Owners keep it; grant it to anyone who needs it. |
| Tasks, Quotations, onboarding, payroll | Claude (client's session) | 0190–0192, 0194 (onboarding emails), 0198 (overdue-invoice alerts on the cron, 8 am morning email) |
| Studio WhatsApp (own number), sequences, calling, white-label | Claude (client's session) | 0201/0202 live (PR #51). **0203 (studio WhatsApp) pushed on this session's branch.** 0203 rewrites `crm_advance_cadences` and `crm_sequence_can_auto` again -- copy from 0203 if you touch them. `company_whatsapp` holds each studio's sealed token (WHATSAPP_TOKEN_KEY) and is service-only. `POST /webhooks/whatsapp` now also routes studios' replies and receipts by phone_number_id; studios on their own Meta app post to `/webhooks/whatsapp/studio/:key`. In CRM files this session touches only the sequence editor/panel. |
| Enquiry forms (vendor QR codes) | Claude (client's session) | 0195. New `enquiry_forms` table and pages; touches CRM only in `selectLead` (`source_label`) and the LeadDrawer subtitle. |

If you are about to work in an area listed above that is not yours, pull
first and check the recent log for that path before assuming it is free.
