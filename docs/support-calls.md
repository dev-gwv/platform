# Support calls → WhatsApp (0280, 0283)

How Studio AutoPilot learns of support calls and tells the support team on
WhatsApp. Only platform admins see or change any of it: **Platform → Support
calls**. Everything starts off.

## How it works

```
Google appointment schedule ──► "Support calls" calendar ──► Studio AutoPilot reads it every 5 min
(the Support call button)                                    │
                                                             ▼
                                        new = booked · time changed = moved · gone = cancelled
                                                         │
                                                         ▼
                                  one post in the support WhatsApp group (the group bot)
```

- **Bookings come from each person's main Google Calendar** (owner, 30 Oct),
  filled by their Google Calendar **appointment schedule** -- the page the
  Support call button opens. Only entries the schedule made count ("Booked by"
  in the description, `isBooking`); the person's other events are never posted. Studio AutoPilot reads the
  calendar's private address ("Secret address in iCal format"); no Google login
  is stored. The first read only notes what is already there, so connecting it
  never floods the group.
- **Which studio** is found from the email the person booked with, matched to a
  Studio AutoPilot owner, so the post can say "Asha · Mehta Studio (Pro)".
- **The group post** is fixed wording filled from the booking -- no AI:

  > 🎧 New support call
  > Asha Rao · Mehta Studio (Pro)
  > Fri 30 Oct, 3:00–3:20 pm
  > Join: https://meet.google.com/abc-defg-hij

  plus "🔁 moved" and "❌ cancelled", and at 9 am the day's calls when there are any.

## Setting it up

1. **Booking page, once per person (two since 0290).** In each person's Google
   Calendar, Create → **Appointment schedule** (it books into their main
   calendar). On Platform → Support calls → **Google Calendars**, fill that
   person's row: the name studios see on the button, the schedule's booking
   page link, and the main calendar's Settings → **Secret address in iCal
   format**, then **Save**.
   With two booking pages set, Book a support call opens a small chooser
   (one button per person), and each opens Google's page in a new tab. Anyone
   with an iCal address can read that whole calendar, so never share it.
2. **The group bot (VPS).** Back up `/root/ipc/platform/.env`, add
   `WA_BOT_SECRET=` with a value from `openssl rand -hex 32`, then
   `sh deploy/deploy.sh` (never a bare `docker compose up`).
3. **Link a phone.** Platform → Support calls shows a QR: on the phone,
   WhatsApp → Settings → Linked devices → Link a device. For testing your own
   number is fine; for real use a **spare SIM, never the business number**.
   Add that number to the support group, **Pick the group**, switch on **Post
   support calls in the group**, **Save**, then **Send a test** and **Try a
   sample booking**.

## Keeping the number safe from bans

The bot posts only into the one group it is in, never to a person, one post per
event, at least 5 seconds apart with a random pause and a moment of
"typing…", at most 20 an hour and 100 a day (the page; the bot itself stops at
30/150), plain text. It never reads or answers messages and is not shown online.

## Later: messages to the person who booked

Built and switched off. It needs Meta's official WhatsApp API (`WHATSAPP_*` in
`.env`) and four approved utility templates, and a calendar entry carries no
phone number or "remind me on WhatsApp", so today nothing goes to the booker.
When the API exists, add the support team numbers under **Official messages**:
they then also get each alert when the bot cannot post.

Templates (Utility, English), if and when:

- `support_call_booked`: "Hi {{1}}, your Studio AutoPilot support call is confirmed for {{2}}. Join here: {{3}}. Reply STOP to stop these messages."
- `support_call_reminder`: "Hi {{1}}, a reminder that your Studio AutoPilot support call is at {{2}}. Join here: {{3}}. Reply STOP to stop these messages."
- `support_call_cancelled`: "Hi {{1}}, your Studio AutoPilot support call on {{2}} has been cancelled. You can book another from Support call in the app."
- `support_call_team`: "Support call {{1}}: {{2}} from {{3}} on {{4}}. Join: {{5}}"

## Tickets and the assistant (0300)

Every booking opens a ticket, and an assistant keeps it so the one person who
takes the calls has almost nothing to write:

1. **75 minutes before the call** it writes a three-line brief from the
   studio's own data (plan and days left, what it has made, how often it is in
   the app, where it got stuck, earlier calls, what they wrote when booking)
   and posts it in the support group with a link to the ticket. With the AI
   down, the plain facts are posted instead.
2. **10 minutes after the call** it posts "How did the call go?" with the link.
3. **On the ticket page** you record one voice note (Hindi or English) or type
   it. Groq's Whisper hears it with the same `AI_API_KEY` as the assistant;
   the AI writes the summary, the type of call, where it stands, the next step
   and a date. Every part can be changed with a tap; a later note adds to the
   first and the ticket is written again from both.
4. **At 9 am** the group post adds how many tickets are open and which steps
   wait on you, late ones marked ⏰.

AI text only ever reaches your own support group, never a studio, and it is
counted against the platform's token budget, not a studio's allowance. Only
booked calls make tickets: there is still no support inbox (0273).

## Step 2: follow-ups, bugs, tickets that close themselves, Monday (0301)

- **Message to the studio.** On a ticket with notes, **Write the follow-up for
  me** drafts a short WhatsApp in the call's language (Hinglish if you spoke
  Hindi): thanks, what was done, what is next, and up to two how-to videos,
  each a link that opens the video at once (`/help?play=<key>`). Read it,
  change it, then **Send on WhatsApp** (your own WhatsApp opens with it
  written, to the booking's number, else the studio owner's) or **Copy**.
- **Bugs.** A ticket of type Bug has **Create GitHub issue**: a new issue in
  dev-gwv/platform, filled in with the studio, plan, what happened and a link
  back -- never the studio's phone or email.
- **Tickets that close themselves.** When your note says the studio is to do
  something the app can see (make a project, an invoice, a lead, a shoot day,
  a client, a gallery, add their team, buy their plan), the ticket watches
  for it from the start of the call and, once their data shows it, closes
  itself and says so in the group.
- **Monday from 9 am**, one post: last week's calls, solved (and how many
  closed by themselves), still open, by type, open bugs, the screens studios
  got stuck on, studios that called more than once, and the screen to fix
  first.

### When the official WhatsApp API is connected

Set `WHATSAPP_PHONE_NUMBER_ID` and `WHATSAPP_ACCESS_TOKEN`, switch on
**Official messages**, and get these Utility templates approved in Meta
(English). Then:

- the person who booked gets the confirmation, the reminder an hour before
  and a note if it moves or is cancelled (when they ticked WhatsApp);
- every ticket's follow-up shows **Send from our number**, which sends:
  - `support_call_followup`: "Hi {{1}}, following up on your Studio AutoPilot support call: {{2}}"

  ({{2}} is the drafted message on one line, links included).
