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

- **Bookings come from one Google Calendar** that holds only support calls,
  filled by a Google Calendar **appointment schedule** -- the page the Support
  call button opens. Studio AutoPilot reads the
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

1. **Calendar and booking page.** In Google Calendar make a calendar called
   "Support calls", then Create → **Appointment schedule** and pick that
   calendar for the bookings. Copy the schedule's booking page link into
   Platform → Help → "Where Book a support call goes". Then that calendar's Settings →
   **Secret address in iCal format** → copy → Platform → Support calls →
   **Connect**. Anyone with that address can read that calendar, so use one
   that holds only support calls and never share the address.
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
