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

**A deploy can run your empty claim.** `deploy/db/migrate.sh` marks each file
done by its name, so if anyone deploys between your claim and your body, the
header-only file is recorded as applied and the body that follows never runs
(0265: every quote failed until 0266 ran the body again). Once your claim has
been pushed for a while, or you are not sure nobody has deployed since, put the
body in the next free number, written so it is safe to run twice.

**Since 0314 (audit, 21 Nov) the runner and CI guard this too.** `deploy/db/migrate.sh`
skips a header-only file without recording it (so a deployed claim is harmless), records
each file in the same transaction that applies it, and refuses a number below the highest
already applied (`MIGRATE_ALLOW_OUT_OF_ORDER=1` overrides). `tools/check-migrations.mjs` in
CI fails a shared number, a SQL change to a migration already on `main`, or a new number
not above `main`'s highest. Still claim first -- the checks catch a collision, they do not
prevent the wasted work.

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

`api.studioautopilot.in` goes through Cloudflare's proxy (orange cloud), not
straight to the VPS address: a home Wi-Fi provider that could not reach
72.61.239.209 left the app on "Failed to fetch" while a phone hotspot worked.
`lib/client-ip.ts` trusts `CF-Connecting-IP` only from Cloudflare's own ranges.

The box is a Hostinger VPS (srv1185214.hstgr.cloud) with Coolify, and other
projects run on it too (wedding-yantra-*, Coolify apps). Touch only the Compose
project `platform`, checked out at `/root/ipc/platform`; its `.env` lives there.
To change a setting: back up `.env`, edit it, then `sh deploy/deploy.sh`, which
rebuilds what is checked out and never pulls. Frameline's `FRAMELINE_API_URL`
and `FRAMELINE_SECRET` were added on 12 Oct and must stay equal to Frameline's
Cloudflare secret `STUDIOAUTOPILOT_SECRET` (rotate both together). An untracked
deploy key `ci_deploy` sits in that checkout: move it out, and never `git add -A`
there.

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

## Deploys wait for CI

Production deploys only after the CI workflow passes on `main` (`deploy.yml` runs on
`workflow_run`), and only the commit CI tested. `deploy/deploy.sh` builds, runs `migrate`
alone while the old API keeps serving, and only then replaces the API -- a failed migration
leaves the site up. A red `main` therefore means nothing ships until it is green.

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
- **The brand is Studio AutoPilot**, drawn with `shared/ui/wordmark.tsx` ("Studio" navy, "AutoPilot" gold, the email wordmark's font). The legal operator is **Grateful World Ventures (OPC) Private Limited** (`features/legal/legal.ts`), which is what the public pages and the home page (`/`, public since the Meta review pack) name; "IPC Studios" stays only in Meta-approved WhatsApp templates and none of the public or legal pages.
- **Picking several from a list looks like `features/team/JobRolePicker.tsx`**: always open, a search box with a solid "+ Add new …" button on top, coloured chips grouped below, amber dashed until something is picked and green with "2 chosen · …" after. Never fold the list behind a "Change" button or put the add control in grey text. (The owner could not find where to add a job role.)
- **Labels are the pick-many field; quality is one temperature.** A lead carries as many labels as it needs (drawer, Add lead, pipeline bulk bar -- all through `features/crm/LabelMenu.tsx`); quality stays single because 'hot' ranks the call queue. A lead holds several events (`crm_lead_functions`, 0212) -- edit them with `LeadEvents`, never a single event box.
- **Every filter chip and every bulk-bar list has "+ Add".** `MultiSelectFilter` takes `onCreate`; the new value joins the studio's list and the filter switches to it.
- **Anything shown as cards can be ticked and changed many at once** (`LeadBulkBar` on the leads pipeline and list; `BulkBar` on the production board, in its Stages, **List** and People views). The production board's List (`features/board/ListView.tsx`, `sortForList`) is late first, then by due date; a row with nobody on it says "Give to…" (Give work), and its ⋯ moves it to another stage.
- **Settings is a grouped rail, never a tab strip.** Every settings page is listed once in `features/settings/SettingsNav.tsx` (`SETTINGS_GROUPS`: Studio, Team, Projects, Leads, Money, Messages & lists; at most four each, sixteen lines in all) and `AppShell` wraps it in the rail. Pages that belong together share one line and a tab row (`tabs` + `also` on the item: Company profile · Theme & branding, Templates, Forms, Plan & billing · Refer a studio, Messaging · WhatsApp, Lists · System); a new settings page joins a line's tabs before it adds a line. (The owner: sixteen tabs across the top were "draining"; the audit: twenty-two lines were too many.)
- **The Team menu is four hubs** (`shared/layout/hubs.ts`): People, Attendance & leave, Pay, Roles & terms. A new team page joins a hub's tab row instead of adding a sidebar line. The plan card at the foot of the sidebar (`features/billing/PlanCard.tsx`) is where "Upgrade" lives.
- **Money is rupees.** Use `IndianRupee`, never `DollarSign`; a test fails on any `DollarSign` in `apps/web`.
- **Neutral by default; green = done; amber = the one next thing; red only for a real problem** (a cancelled day, an issue) **or on hover for delete.** A shoot card is plain until every seat is filled, then green. Data chips appear only once the shoot day has passed. (The owner called the old Shoots tab "a lot of colours, a lot of chaos".)
- **Teach once, then get out of the way.** A note that explains the app (e.g. "Nitin will see this on their own login") shows for a person's first few times only, through `users.hints` (0216), with a plain close and a "don't show again". Never a box that shows forever.
- **`Select` shows `<optgroup>` groups** (`shared/ui/select.tsx`, `itemsFrom`). Before this it dropped them, and the data dialog's "Copied by" lost the team and every saved helper.
- **Money needs money access.** A project's value, payments, Billing and Cost sheet show only to people with billing or money access (`seesMoney` in `services/api/src/lib/scope.ts`, `visibleViews`); a Project Manager runs projects and sees none of it -- the API sends money as 0 and answers 403.
- **The top bar fits at every width.** Below 1800px its items ride compact (search an icon, "3 due", "23 days left", the Suggest bulb, the avatar without the name); the shortcut pills keep their labels from 1360px. Nothing is removed and the bar never gets `overflow-hidden` (the account menu is not portalled). A new header item ships its compact form and is checked at 1024, 1250, 1280, 1440, 1536 and 1920px, sidebar open and collapsed.
- **Dates on screen are India dates.** `todayInIndia()` (`shared/ui/days-left.ts`; `services/api/src/lib/dates.ts` on the server), never `new Date().toISOString().slice(0, 10)`, which is still yesterday until 5:30 am IST.
- **Pages load when they are opened.** Every page in `app/router.tsx` is `lazyRouteComponent(() => import('@/routes/x'), 'X')`, never a static import, so the first load carries only the shell (1 MB, was 3.3 MB). A new page joins the same way.
- **Page state in the address follows the router.** `useUrlParam` reads `useRouterState` and writes with `navigate({ to: '.', replace: true })`; never `window.history.replaceState`, which a later link to the same page with another `?tab=` or `?d=` could not move.
- **Amounts can be hidden.** The eye in the top bar (`shared/money/MoneyMask.tsx`, `HideAmountsButton`) turns every rupee on the studio's own screens into "₹ ••••", remembered per person on every device (`users.hints.hide_amounts`, closed = hidden); a headline drawn with `<Money value>` shows just that one figure on a tap. Studio screens format money with `useINR()` (components) or `screenINR` (helpers), never `formatINR`; documents (quotation, invoice, receipt, payslip, terms, a lead's quote), public pages, CSVs and the text sent to a client keep `formatINR` and are never masked. `shared/money/no-raw-inr.test.ts` fails on a `formatINR(` outside its allow-list -- a new document joins the list, a new screen uses `useINR`.
- **Picking a project searches as you type** (`features/projects/ProjectPicker.tsx`): it asks the server twenty at a time (name, client or phone) only while open, and with a `clientId` lists that client's projects. Never load every project into a dialog or filter with `useProjects()` and a `<select>`.
- **Big files are split by route group.** The projects, crm, billing and team API modules are a `router.ts` that keeps the middleware and mounts `routes-*.ts` files with `.route('/', group)` in order (literal paths before `/:id`), with shared helpers in `shared.ts`; the Create project wizard's steps live in `features/projects/wizard/`. A new route joins its group's file; keep each file under ~600 lines.
- **An effect has a block body.** `useEffect(() => { … }, deps)`; an expression body returns its value as the cleanup, which crashed the deliverable drawer ("Couldn't show this deliverable") when a voice note was added. ESLint fails on it.
- **A word added in a picker is kept for next time** (owner, 26 Oct: "it should show in the suggestions next time"). Whoever may grow the studio's list adds it there for everyone; anyone else gets it on their own quick list (`users.hints` `q_<category>`, `PUT /auth/quick-words`, at most 30 a list), offered to them in every picker of that list. New pickers add words through `useAddLookupWord(category)` and read them with `usePersonalWords` / `useLookupOptions` (`features/settings/quick-words.ts`).
- **Whatever a studio sets up, it can edit again later** (owner, 25 Oct: "there should be an option to re-edit the form all the time"). A form, a partner QR, its questions, a template, a list: once saved it keeps a plain, solid **Edit** where it is seen (its own page, and the row in any list of them), never only on the screen that made it. Changing questions never touches answers already given: a lead keeps each answer with the words it was asked in (`crm_leads.enquiry_answers`, `{question, answer}`), so only enquiries after the change get the new questions. A partner's page carries **Questions on <name>'s QR** with **Edit questions**, and every partner row has an Edit pencil.
- **A reminder that waits for an action never covers a header.** Follow-up reminders go to their own toaster at the bottom right, above the help bubble (`<Toaster id="reminders">` in `main.tsx`, `toasterId: 'reminders'`); other toasts stay top centre.
- **When the owner gives a standing instruction, write it down** -- in its area's file under `docs/decisions/` (or in this list, if it is a general UI rule), so the next session follows it without being told again.

## Decisions by area -- read the file before you touch that area

The owner's decisions for each area live in `docs/decisions/`. They are as binding as this file;
they moved there on 21 Nov 2026 only because one file had grown past 25,000 words. Before changing
a screen, a rule or a flow, read its area's file (or grep `docs/decisions/` for a word from the
screen). A new standing instruction goes into its area's file, with its title added to the list below.

- **`docs/decisions/shell-and-navigation.md`** -- Menu, top bar, Home and app-wide screens: The menu is fourteen lines · What is due shows in the top bar · An open tab moves to the newest release by itself · The dashboard greets by the time of day · Getting started on the dashboard · Studio Max puts the studio's own name and logo top left · Something new reads "New" for a week · Audit clean-up (21 Nov) changed these screens · Second clean-up pass (21 Nov).
- **`docs/decisions/onboarding-and-help.md`** -- Sign-up, setup, tutorials, help and the assistant: The help bubble is teal with a white ring, never the page's purple, and never sits on a sticky Save / Next bar · A new account starts at step 1 of setup: Add your team · Book a support call is the way to a person · Help is one message away · Help shows where people get stuck, then steps back · Every tutorial is in English and Hindi, and the whole app is one guide away · A video always matches the screen it shows · Platform → Usage → Where people stop · The assistant answers in English, हिन्दी or Hinglish · The sign-in and sign-up page credits its maker · New studios get the setup videos before they meet the app · A new person is walked through the videos, never sent a demo · A new studio's first screens stay uncluttered.
- **`docs/decisions/leads-and-enquiry.md`** -- Leads, follow-ups, enquiry forms, partners and wedding QR codes: Facebook lead ads can always be reset · A lead is booked or lost from the top of its drawer · A studio builds its own enquiry form · The enquiry form follows Wedding Yantra's hand-off spec · A lead can start with just a name · Today's calls is one list · Forms & QR clean-up · A partner sees their leads' real details and can download them · A lead is given to one person, and only they are told · Every follow-up is on one board, and rings one person · The Leads header is minimal · Wedding QR codes are not partners.
- **`docs/decisions/projects-and-shoots.md`** -- Projects, quotation, shoots, crew booking, post-production and the client link: Every project page carries the journey line · The project page has eight tabs · The Overview is money and work only · The Shoots tab starts with the days · The data dialog is short and remembers · A function has a Start time and a Duration (अवधि) · Every function is asked for its team before the wizard goes on · The Billing step takes one advance · Assign team shows each person's day in plain words; there is no gap setting · The studio logo and a person's photo are uploads, under 1 MB · After Book, Done is the next thing · Start editing asks who · A project's money says what share it is · A shoot day's line carries its crew cost and its data in one sentence · What the quotation shows from the project has an Edit that goes there · A client's Accept rings the bell · A person has usual rates; a day's crew can be copied · See it as the client; plan parts carry dates · Team Booking has a Calendar · A studio picks how work is delivered · A project from a template gets its due dates · The Overview says what the client did · The client fills their own details · The client never sees unchecked work as ready · The client's link is a tracker · A reply to a note goes to whoever sent it · A project has one editor · Shoots are in Google Calendar by a link, never a file per booking · A deliverable carries a note for the team · A booked person can carry a note, like a comment on a cell · Upload a quotation, and the project makes itself.
- **`docs/decisions/team-and-staff.md`** -- Team logins, staff screens, attendance, leave, daily tasks and pay details: Nobody is signed out unless they sign out · Team logins need no email at all · Staff see their own work, not the studio's · A team member's Home is their day · Attendance is off until the owner turns it on · A freelancer is paid when their cards come in · Whoever pays the team can fill in where the pay goes · Leave has a balance · A team member's project page is their work, the days and the data · A login never opens on an expired studio while another of its studios is open · Daily tasks come back by themselves, and crew money is one tap from Money.
- **`docs/decisions/money-and-billing.md`** -- Invoices, payments, payouts, expenses and money pages: A client agrees to terms by signing · A payout is picked, not typed · Crew money is owed once the shoot day has passed · One period for the money pages · Payments received opens on what is due · A lead's quote is on the studio's letterhead · The client can sign in front of you · Recording money received is one form · Money records can be changed and undone too · Invoices are numbered three ways · Who signs the invoice is set on the invoice. · What a project still owes is one rule
- **`docs/decisions/plans-and-pricing.md`** -- Plans, limits, Diamond, offers, brands and Studio Access Manager: Two price lists, one above the other, and Diamond by phone number · A plan has limits, and says them · Refer a studio · Studio Access Manager is the old app's board · The platform owner sees what each studio does, and can make some of them an offer · A yearly price leads with the price a day · More than one brand on one login, by plan.
- **`docs/decisions/support-and-messages.md`** -- Support calls, tickets, WhatsApp support and email: The owner gets a Monday email · No email goes out by itself · Support call alerts are ours, careful, and the platform admins' alone · Every support call is a ticket, and the assistant keeps it · Studios can write to support on WhatsApp, and the assistant answers first · A missed support call gets the booking page, when the owner says so.
- **`docs/decisions/gallery.md`** -- Frameline photo sharing and Google Drive: Frameline is the gallery add-on, joined by sign-in and links, never merged · Studios do not see the Drive gallery numbers yet · Pro and Studio Max cover Google Drive galleries in Frameline, up to a number of photos kept.
- **`docs/decisions/ai-tools.md`** -- Quotation Designer, AI writers and referral cards: The Quotation Designer is the first AI tool · AI tools 2 and 3: Reply to a lead and the Follow-up sequence maker · Referral cards: the friend gets an offer, the client gets a reward · AI tools are two panes, and the hub has no "Coming soon" · Ad scripts: a Meta ad a model reads to camera · A list of designs shows its actions on the card · The designer's colours are one picker, with gradients.
- **`docs/decisions/engineering.md`** -- Speed, reliability, apps and the bug-sweep rules: The browser smoke test is a CI job · Backups prove themselves weekly · The apps are the live site in a window · Bug sweep rules (6 Nov, 0294) · Speed rules (audit, 11 Nov: "tabs are opening a bit late").

## Who is working on what

Keep this short and current: only work that is not on `main` yet. Delete a line when it lands.
The table used to keep notes like "copy `fn` from 0299"; that is never needed -- the
latest body of any SQL function is in the highest-numbered migration that defines it:
`grep -l "function fn_name" supabase/migrations/* | sort | tail -1`.

| Area | Session | Notes |
| --- | --- | --- |

If you are about to work in an area listed above that is not yours, pull
first and check the recent log for that path before assuming it is free.
