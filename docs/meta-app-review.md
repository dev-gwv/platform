# Meta App Review pack

Everything the owner needs for Meta's review of Studio AutoPilot's Facebook lead-ads access,
in the order it is used. Written only from what the code does: where a statement depends on
something the owner controls, it says so and marks it **[owner to confirm]**.

| What | Where | Status |
| --- | --- | --- |
| Public home page, company named | `/` (`routes/home.tsx`, `features/marketing/Landing.tsx`) | in this PR |
| Legal pages name the product and the company | `routes/legal.tsx`, `features/legal/legal.ts` | in this PR |
| Reviewer demo studio and login | `deploy/demo/*.sh`, `demo-studio.sql` | in this PR; run after it is live (prompt A) |
| Lead Ads Testing check, timed | prompt B below | **needs the owner's Facebook login** |
| Screen-recording script | section 1 | ready |
| Data handling summary | section 2 | ready |

Three things the code cannot supply and Meta's business verification will ask for:
the company's **registered address**, **CIN / GSTIN** (put them in `features/legal/legal.ts`; the pages print a line
only when it is filled, so nothing untrue is shown), and the **hosting region** of the server.

---

## 1. Screen recording (2 min 45 s)

Record at 1440 × 900, browser only, no notifications. Use the demo studio for everything except step 4, which needs a
Facebook Page you manage and a Meta test lead. Say the words in *italics*; do the click after the dash.

| Time | Show | Say |
| --- | --- | --- |
| 0:00 – 0:20 | The home page at `/`, signed out. Scroll to "Leads from Facebook Lead Ads", then the footer. | *"Studio AutoPilot is software for photography studios, run by Grateful World Ventures (OPC) Private Limited. Studios use it to manage leads, shoots, team and billing."* |
| 0:20 – 0:35 | Press **Sign in**, sign in with the demo login. The dashboard opens. | *"This is a reviewer account with sample data only."* |
| 0:35 – 1:10 | Sidebar **CRM & Clients → Lead Sources**. Press **Connect with Facebook**. Show Facebook's permission dialog and read the four permissions. Pick the Page, press **Continue**. Back in the app, the Page is listed; press **Connect** on it. It turns green: **Connected**. | *"The studio connects its own Page. We ask for four permissions: see the Pages the person manages, subscribe the Page to lead notifications, read Page details, and read the lead form answers. Nothing is ever posted to the Page."* |
| 1:10 – 1:30 | Open Meta's **Lead Ads Testing** tool. Choose the Page and form. Press **Create lead**. | *"Meta's test tool now submits a lead the way a real ad would."* |
| 1:30 – 2:05 | Back to **Leads**. The new lead appears at the top of the **New** column, source Facebook. Open it: name, phone, email as entered on the form. Move it one stage, add a label. | *"It arrives in seconds, assigned by the studio's rota. Only these form answers are stored, and only for the studio that owns the Page."* |
| 2:05 – 2:30 | **Lead Sources → Import log**: the row says *imported*. Back on the Page row press **Disconnect** and confirm. | *"Disconnect stops new leads at once, deletes our stored access for the Page, and asks Facebook to stop sending. Leads already received stay until the studio deletes them."* |
| 2:30 – 2:45 | In **Leads**, tick the test lead, **Archive**, then **Delete permanently**. Then open `/data-deletion` and `/privacy-policy`. | *"A studio can delete a lead for good: its name, phone, email, notes, messages and import record are removed. Anyone who was a lead can ask through the Data Deletion page."* |

Before recording: run prompt A, connect nothing yet, and check the demo studio shows "Free trial · 14 days left".
After recording: disconnect the Page if you do not want it kept, and run `revoke-demo.sh` when the review is over.

---

## 2. Where lead data is stored, who sees it, how long, how it is deleted

Use this as the answer to Meta's data-handling questions. It matches the code as of this PR.

**What is collected.** From a Facebook lead form: the answers the person typed (name, phone, email and any custom
questions), the Page's name and id, and Meta's lead id. From the person connecting the Page: their Facebook user id and
the list of Pages they manage. We do not read friends, posts or the personal profile.

**Where it is stored.** In the studio's own rows of one PostgreSQL 16 database on the Studio AutoPilot server
**[owner to confirm: provider and region]**. The web app (Cloudflare) holds no lead data. Pages tokens are stored
encrypted (AES-256-GCM, key held only on the server) in a table no signed-in user can read, and never reach the browser.
Tokens for Pages a studio did not connect are deleted 30 minutes after they were fetched; a disconnected Page's token is
deleted at once.

**Who can access it.**
- The studio's own team, according to the permissions the studio owner gives each person. Every query is limited to the
  studio's own company by database row-level security; one studio cannot see another's leads.
- The CSV export button is offered only to people holding the export permission (owners have it).
- Studio AutoPilot's staff have no screen that lists a studio's leads. A person with server or database access could read
  the database; that is why access to the server is limited to the owner. The platform admin's message list shows
  recipient addresses of messages the app has sent.
- Processors that receive lead data to do their job: Meta (Graph API, and WhatsApp when a studio turns messaging on),
  Resend (email), Sentry (error reports, personal fields masked), and, only if a studio enables them, Twilio or a
  connected mailbox. Nightly backups may be copied to an off-site storage bucket **[owner to confirm whether one is configured]**.

**How long it is kept.** For as long as the studio keeps it: there is no automatic expiry of leads. A studio can delete
leads at any time (below). If a studio closes its account or asks us to delete it, we delete it within 30 days, apart from
payment records the law requires. Backups: nightly database dumps, kept 7 days on the server and 30 days off-site if
configured, so deleted data has left the backups within 30 days. We do not claim the backups are encrypted.

**How a studio disconnects.** Lead Sources → the Page → **Disconnect**. New leads stop at once, our stored access for
that Page is deleted, and we call Facebook to unsubscribe the Page. If Facebook does not confirm, the app says so and
points to Facebook Settings → Business Integrations, where the studio can also remove the app.

**How a studio deletes leads.** Leads → tick leads → **Archive** (with a reason), then **Delete permanently**
(`POST /crm/leads/erase`, migration 0213, at most 200 at a time). For each lead this removes the lead and anyone merged
into it, the contact record if no other lead uses it, the Facebook import-log rows, and the enquiry it came from; and it
scrubs, keeping the row for the books, the name/phone/email/notes in audit entries, the referral record, and the address
and text of messages sent to them. The audit entry for the deletion holds counts only.

**How a person who filled in a form gets their data removed.** Ask the studio, or email support@studioautopilot.in with
the studio's name and their phone number; `/data-deletion` says so. There is no Meta "data deletion callback" URL; the
instructions page is used instead.

---

## 3. Prompts for the Claude browser extension

Both prompts are complete. Fill only the values in `<angle brackets>` and paste. Neither may print a password, token,
secret or a full phone number in its report.

### A. Make the reviewer demo studio (after this PR is live)

> You are helping the owner of Studio AutoPilot prepare a reviewer login. Use the browser terminal for the production
> server (Coolify → the `platform` project → Terminal, or the VPS web console the owner already uses). Do exactly this and
> nothing else.
>
> Rules: never run `docker compose up`, `down`, `restart` or `--build`. Do not edit any file. Do not print the password,
> the contents of `.env`, or any token. If a command fails, stop and report the command and the error text.
>
> 1. `cd /root/ipc/platform` and run `ls deploy/demo`. It must list `demo-studio.sql`, `revoke-demo.sh`, `seed-demo.sh`.
>    If not, stop: the deploy has not finished.
> 2. Turn shell history off for this session: `set +o history`.
> 3. Run, on one line:
>    `DEMO_EMAIL='<reviewer email the owner chose>' DEMO_PASSWORD='<12+ character password the owner chose>' sh deploy/demo/seed-demo.sh`
> 4. Report only: whether it printed `done`, and the one result row (studio name, access until, sample_leads, import_rows).
>    Expected: `Demo Studio (sample data)`, a date 14 days ahead, 14, 16.
> 5. Open `<app URL>/login` in a new private window, sign in with that email and password, and report whether the
>    dashboard opens and whether the top bar says "Free trial · 14 days left". Then open Leads and report how many cards
>    show in the New column (expected 4). Sign out.
> 6. Run `set -o history` and close the terminal.

To end the login later: same steps with `DEMO_EMAIL='<email>' sh deploy/demo/revoke-demo.sh`; it refuses any account that
is not the demo studio.

### B. Meta Lead Ads Testing check, timed

> You are testing that a Facebook lead reaches Studio AutoPilot's CRM. The owner is signed in to Facebook and to
> Studio AutoPilot in this browser (signed in as the studio that has the Page connected). Do not change any setting, do
> not disconnect anything, and do not print any token, secret, or a full phone number (show only the last two digits).
>
> 1. In Studio AutoPilot open CRM & Clients → Lead Sources. Report the connected Page's name and the "last lead" line.
>    If no Page shows "Connected", stop and say so.
> 2. In a second tab open `https://developers.facebook.com/tools/lead-ads-testing`. Choose that Page and its lead form.
> 3. Note the current time to the second. Press **Create lead**. Write down the time you pressed it.
> 4. Immediately switch to Studio AutoPilot → Leads (List view, newest first). Reload every 2 seconds for up to 30 seconds.
>    Note the second the new lead first appears.
> 5. Report, in this format:
>    - Pressed at / appeared at / seconds between
>    - Lead name, source, stage, assigned to (or "nobody")
>    - Import log (Lead Sources → Import log): newest row's status, page name, time
>    - Meta tool's "Track status" text
> 6. Pass = the lead appears in 10 seconds or less, source shows Facebook, the Import log row says imported.
>    Fail = anything else; then also report the Import log row's error text and the Lead Sources "last error" line, and
>    stop. Do not retry more than once.
> 7. Afterwards, archive that test lead and press **Delete permanently**, and report that the lead is gone.

Until a run of prompt B comes back with a time, "within seconds" is a claim to test, not to make in the review notes.
