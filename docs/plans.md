# Studio AutoPilot plans

Status: **on sale since 0256** (owner, 10 Oct 2026, after the preview). The
₹1,00,000 yearly plan is off sale; studios already on it keep it. Buying is
"Talk to us on WhatsApp" for now: the message is written for the studio, and
the platform owner gives the plan in Studio Access Manager. Platform → Plans
lists every plan with an On sale switch. The cards no longer say "WhatsApp &
email from credits" -- credits are not built yet.

## The plans

| | **Starter** | **Pro** (Most popular) | **Studio Max** |
|---|---|---|---|
| Billed yearly | ₹1,499/mo · ₹17,988 a year · ₹49 a day | ₹2,499/mo · ₹29,988 · ₹82 a day | ₹3,999/mo · ₹47,988 · ₹131 a day |
| Billed monthly | ₹1,999 | ₹2,999 | ₹4,999 |
| On the card | 30 projects a year · 30 invoices a year · 3 team logins · 10 crew | Unlimited projects, leads and team · Every feature, no limits | Everything unlimited · Your own name, logo and WhatsApp number (white label) · Priority help |

Prices are before 18% GST.

**Every plan has every feature.** Starter carries number limits; Pro and
Studio Max are unlimited on everything. In Starter and Pro, WhatsApp and email
to clients go out in Studio AutoPilot's name and are paid from message credits
the studio recharges; Studio Max is white-label (its own name, its own
WhatsApp number).

## The plan year follows the billing date

A studio's plan year starts the day it pays (`companies.plan_period_start`),
never the calendar or the financial year: pay on 15 Oct, and Starter's 30
projects run to 14 Oct, then start again. A monthly plan counts the same yearly
numbers **for the whole year** (0267, owner 17 Oct: "you cannot bar that by
month"): its plan year runs from the first payment, renewing a month keeps it,
and all 30 projects can be made in one month.
Upgrading part-way costs only the difference (`plan_quote`): what is left of
the current plan comes off the new one, and the new plan year starts that day.
A lower plan waits until the current one ends.

## Starter's numbers

| Limit | Yearly | Monthly | Why |
|---|---|---|---|
| Projects | 30 | 30 (by the year) | 2–3 bookings a month; a working studio passes it in its first season, which is the move to Pro |
| Leads | 300 | 300 (by the year) | ~10 enquiries a booking. **Enquiries from forms, Facebook and WhatsApp always come in**; only adding by hand or import stops |
| GST invoices | 30 | 30 (by the year) | An advance and a final per project; recording money received is never stopped |
| Team logins (besides the owner) | 3 | 3 | An editor, a manager, one shooter |
| Crew (team without a login) | 10 | 10 | A wedding crew of 6–10 (owner, 17 Oct) |
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
- **Online payment for plans**: Razorpay checkout is still in the code; turn
  the plan buttons back to it when the owner says.
- **Auto-renew** through Razorpay Subscriptions, once Razorpay approves the domain.

## Personal offers (0268)

The platform owner can tick studios in Studio Access Manager and make them an
offer: a percent off the **first** plan they buy (never a renewal), on the
plans picked, until the end of a day. It is for the regular price; Diamond
members only when the offer says so. The studio sees it on Home and Plan &
billing, and the cards show the offer price. Buying is still a WhatsApp
conversation; the owner gives the plan at the offer price, which marks the
offer used.
