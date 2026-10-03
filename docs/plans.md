# Studio AutoPilot plans

Status: **built, switched off.** The plans below are in the database (0241,
0242) with `is_active = false`. They go live when the owner says "put the
plans live"; until then studios see the plans they see today and the home
page keeps its words.

## The plans

| | **Starter** | **Pro** (Most popular) | **Studio Max** |
|---|---|---|---|
| Billed yearly | ₹1,499/mo · ₹17,988 a year · ₹49 a day | ₹2,499/mo · ₹29,988 · ₹82 a day | ₹3,999/mo · ₹47,988 · ₹131 a day |
| Billed monthly | ₹1,999 | ₹2,999 | ₹4,999 |
| On the card | 30 projects a year · 3 team logins · 20 crew · WhatsApp & email from credits | Unlimited projects, leads and team · WhatsApp & email from credits | Everything unlimited · Your own name and WhatsApp number · Priority help |

Prices are before 18% GST.

**Every plan has every feature.** Starter carries number limits; Pro and
Studio Max are unlimited on everything. In Starter and Pro, WhatsApp and email
to clients go out in Studio AutoPilot's name and are paid from message credits
the studio recharges; Studio Max is white-label (its own name, its own
WhatsApp number).

## The plan year follows the billing date

A studio's plan year starts the day it pays (`companies.plan_period_start`),
never the calendar or the financial year: pay on 15 Oct, and Starter's 30
projects run to 14 Oct, then start again. A monthly plan carries the yearly
numbers **pro rata** for each 30-day pass (30 projects a year → 3 a month).
Upgrading part-way costs only the difference (`plan_quote`): what is left of
the current plan comes off the new one, and the new plan year starts that day.
A lower plan waits until the current one ends.

## Starter's numbers

| Limit | Yearly | Monthly | Why |
|---|---|---|---|
| Projects | 30 | 3 | 2–3 bookings a month; a working studio passes it in its first season, which is the move to Pro |
| Leads | 300 | 25 | ~10 enquiries a booking. **Enquiries from forms, Facebook and WhatsApp always come in**; only adding by hand or import stops |
| GST invoices | 60 | 5 | An advance and a final per project; recording money received is never stopped |
| Team logins (besides the owner) | 3 | 3 | An editor, a manager, one shooter |
| Team without a login | 20 | 20 | A wedding crew of 6–10 plus a regular bench |
| Enquiry forms | 2 | 2 | The website and one vendor |
| Facebook Pages | 1 | 1 | |
| Saved packages | 3 | 3 | The sample is not counted |
| File uploads | 2 GB | 2 GB | |
| Free emails a month | 100 | 100 | Then from credits (Pro 300; Max included, fair use) |

## What the studio sees (owner: "easy on the eyes, easy to understand")

No long table. `PlanPicker` on Settings → Subscription and the home page:

1. A Pay yearly / Pay monthly switch.
2. Three cards, at most three lines each, the price a month and a day.
3. "Every plan has every feature": eight chips.
4. "Compare plans", closed until pressed: only the nine rows that differ,
   with the numbers read from the plan rows (`features/billing/plan-features.ts`).

Starter's smaller limits (packages, uploads, free emails) show only in that
studio's own usage bars.

## Rules every plan keeps

- A free trial has no limits.
- Studios already paying keep what they bought until it ends.
- Nothing already made is touched; a limit stops the next one being made, in
  a sentence with **Upgrade** (402).
- The database checks every limit (`enforce_plan_limit`), not the screen.

## Still to come

- **Message credits in every plan** (0243): Razorpay recharge packs, ₹100 to
  start, client WhatsApp from our number (credits) or the studio's own
  (Studio Max), emails past the free allowance from credits.
- **Going live**: switch on the six rows and retire the ₹1,00,000 yearly
  outsider plan — only on the owner's word.
- **Auto-renew** through Razorpay Subscriptions, once Razorpay approves the domain.
