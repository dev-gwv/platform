# Support call bookings → Studio AutoPilot (0280)

How the support call booking app tells Studio AutoPilot about each booking,
and how Studio AutoPilot then sends the WhatsApp messages. The booking app
sends **no WhatsApp itself**; it only sends this one notice.

## 1. What the booking app sends

`POST https://api.studioautopilot.in/webhooks/support-call`

Send it for every booking of the support-call event: when it is **booked**,
**moved** (rescheduled) and **cancelled**. JSON body:

```json
{
  "id": "evt_01HZX…",                 // unique per notice (a retry reuses it)
  "event": "booking.created",          // booking.created | booking.rescheduled | booking.cancelled
  "booking": {
    "id": "bk_01HZX…",                 // the booking's own id; a reschedule keeps it
    "start": "2026-10-23T09:30:00Z",   // ISO 8601 with a time zone
    "end": "2026-10-23T09:50:00Z",
    "timezone": "Asia/Kolkata",
    "event_type": "support-call",
    "meeting_url": "https://meet.google.com/abc-defg-hij",
    "notes": "What the person typed, if anything",
    "invitee": {
      "name": "Asha Rao",
      "email": "asha@mehta.in",
      "phone": "+91 98765 43210",
      "whatsapp_ok": true              // they ticked "remind me on WhatsApp"
    },
    "utm": {                            // the utm_* the embed passed in, as received
      "source": "studioautopilot",
      "medium": "app",
      "campaign": "support-call",
      "content": "Mehta Studio",        // the studio's name
      "term": "6f1c2d3e-…"              // the studio's id in Studio AutoPilot
    },
    "parent": "https://studioautopilot.in/projects/9"   // the embed's parent page
  }
}
```

`whatsapp_ok` matters: **without it nothing is sent to that person's phone.**
Only `id`, `event`, `booking.id`, `booking.start` and `booking.invitee` are
required; send the rest when you have it.

### Signing

Header: `X-Signature: t=<unix seconds>,v1=<hex>` where

```
v1 = hex( HMAC-SHA256( SUPPORT_CALL_WEBHOOK_SECRET, "<t>.<raw request body>" ) )
```

Sign the exact bytes you send. A notice older than 5 minutes, or with a wrong
signature, is refused with 401. Node example:

```js
import crypto from 'node:crypto'
const body = JSON.stringify(notice)
const t = Math.floor(Date.now() / 1000)
const v1 = crypto.createHmac('sha256', process.env.STUDIOAUTOPILOT_WEBHOOK_SECRET).update(`${t}.${body}`).digest('hex')
await fetch('https://api.studioautopilot.in/webhooks/support-call', {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'x-signature': `t=${t},v1=${v1}` },
  body,
})
```

### Answers

| Status | Meaning | Retry? |
| --- | --- | --- |
| 200 `{ ok: true }` | Saved (or `duplicate: true`: already had this `id`) | No |
| 400 | The body is not a booking notice | No: fix the body |
| 401 | Missing, wrong or old signature | No: fix the signing |
| 503 | We could not save it just now | Yes, with the same `id` |

Retry a 503 (or a network failure) a few times with a growing gap, always with
the **same `id`**, so it is never counted twice.

## 2. What Studio AutoPilot sends

All of it is switched on and off on **Platform → Support calls** (platform
admins only). Everything starts off.

**To the person who booked** (official WhatsApp API, our business number), only
when `whatsapp_ok` is true, at most 4 messages per booking:

- booked or moved → `support_call_booked`
- one reminder an hour before (not for a call booked inside the hour) → `support_call_reminder`
- cancelled → `support_call_cancelled` (any reminder still waiting is dropped)

**To the support team:** one post in the support WhatsApp group by the group
bot (a spare SIM, linked like WhatsApp Web, running on our server), and at 9 am
the day's calls when there are any. When the bot is off or cannot post, each
support team number gets `support_call_team` from the official number instead.

## 3. Templates to submit in Meta (category: Utility, language: English)

Names can be changed on the Platform page if Meta asks for others.

**support_call_booked**
> Hi {{1}}, your Studio AutoPilot support call is confirmed for {{2}}. Join here: {{3}}. Reply STOP to stop these messages.

**support_call_reminder**
> Hi {{1}}, a reminder that your Studio AutoPilot support call is at {{2}}. Join here: {{3}}. Reply STOP to stop these messages.

**support_call_cancelled**
> Hi {{1}}, your Studio AutoPilot support call on {{2}} has been cancelled. You can book another from Support call in the app.

**support_call_team**
> Support call {{1}}: {{2}} from {{3}} on {{4}}. Join: {{5}}

(`{{1}}` in the team template is booked / moved / cancelled.)

## 4. Keeping the numbers safe from bans

- The official number sends only these utility templates, only to people who
  booked and ticked WhatsApp, and honours STOP.
- The group bot uses a **spare SIM, never the business number**. Use it from a
  phone normally for a week or two before linking it, and add it to the support
  group by hand. It posts only into that one group, never to a person, at most
  20 an hour and 100 a day (the Platform page; the bot itself stops at 30/150),
  at least 5 seconds apart with a random pause and a moment of "typing…", one
  post per event, plain text. It never reads or answers messages.
- No AI writes or decides any message: they are fixed wording filled from the
  booking.

## 5. Setting it up on the VPS

1. In `/root/ipc/platform/.env` (back it up first), add two secrets made with
   `openssl rand -hex 32`: `SUPPORT_CALL_WEBHOOK_SECRET` and `WA_BOT_SECRET`.
   Give the first to the booking app's developer; the second never leaves the box.
2. `sh deploy/deploy.sh` (never a bare `docker compose up`). It now also starts
   `wa-bot`.
3. Platform → Support calls: scan the QR with the spare phone (WhatsApp →
   Linked devices), pick the support group, send a test, switch the group on.
4. When Meta has approved the four templates: add the support team numbers,
   switch official messages on, send a test.
5. Ask the developer to start sending the notice, and book a test call.
