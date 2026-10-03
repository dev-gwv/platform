# Studio AutoPilot plans: the proposal

Status: **proposal, waiting on the owner's pick.** The limits engine, the
usage bars and monthly billing are built so any option below is a data change,
not a code change. The new plans go live only when the owner names an option
(and its prices) — until then studios see the plans they see today.

## What every option shares

- **Prices are before GST.** Checkout adds 18%, as it does today.
- **Two ways to pay for each plan:** yearly (the lower monthly price, paid at once)
  or monthly (a 30-day pass, renewed by the studio; reminders go 7 days and
  1 day before it ends, the emails that already exist).
- **Limits count what is made in a calendar month (India time)**: a studio on
  Starter sees "4 of 8 projects this month" and the count starts again on the 1st.
  Team logins and enquiry forms count what exists now, not per month.
- **Leads are never limited.** An enquiry from Facebook, the website form or a
  vendor's QR is the studio's customer. Refusing one would lose real money, so
  leads always come in on every plan.
- **Nothing is taken away.** Hitting a limit stops the next one being *made*
  ("Your plan makes 8 projects a month. Upgrade to make more."). Everything
  already there stays, opens and can be edited.
- **Studios already paying keep what they bought** until it ends; the limits
  apply from their next renewal. A free trial has no limits, so a new studio
  sees the whole app before it chooses.

## Option A — recommended: three plans, a gentle ladder

| | **Starter** | **Pro** | **Studio Max** |
|---|---|---|---|
| Billed yearly | ₹1,499 / month (₹17,988 a year) | ₹2,499 / month (₹29,988 a year) | ₹3,999 / month (₹47,988 a year) |
| Billed monthly | ₹1,999 / month | ₹2,999 / month | ₹4,999 / month |
| Projects | 8 a month | Unlimited | Unlimited |
| Invoices | 25 a month | Unlimited | Unlimited |
| Team logins | 5 | Unlimited | Unlimited |
| Enquiry forms (website + vendor QRs) | 3 | Unlimited | Unlimited |
| Leads | Unlimited | Unlimited | Unlimited |
| Everything else (shoots, crew, payouts, data, attendance, CRM, quotations) | ✓ | ✓ | ✓ |
| Emails sent in the studio's own name, no "Studio AutoPilot" footer (white-label) | — | — | ✓ |
| The studio's own WhatsApp Business number (Cloud API), with the setup guide | — | — | ✓ |
| Follow-up sequences that send by themselves | — | — | ✓ |

Why: Starter fits a studio doing up to ~8 shoots a month (a busy small studio
in season). The step to Pro is about the price of one album page, so a growing
studio does not feel pushed. Studio Max is for the studio that wants its own
brand and number in front of clients.

## Option B — a higher top

Same Starter. **Pro ₹2,999 / month yearly (₹3,999 monthly)**, **Studio Max
₹5,999 / month yearly (₹7,499 monthly)**. Fewer studios on Max, more revenue
from each; better if you plan to set up their WhatsApp for them by hand.

## Option C — two plans and an add-on

**Starter** and **Pro (unlimited)** as in Option A, and **"Your brand"** as an
add-on at ₹1,500 / month on top of Pro: white-label + own WhatsApp + sequences.
Simplest page to read; the add-on needs one more checkbox at checkout.

## Questions for the owner

1. **Which option, and are the prices right?**
2. **IPC Diamond members.** Today they pay ₹1,999 monthly / ₹18,000 yearly /
   ₹33,000 for 2 years with no limits. Suggested: Diamond members get **Pro at
   the Starter price** (₹1,499 / month yearly), which keeps their ₹18,000-a-year
   deal and gives them a reason to stay members. Or keep their current plans
   unchanged.
3. **The ₹1,00,000 yearly plan for outsiders** — retire it once these plans are
   live (suggested), or keep it as a "done-for-you setup" plan?
4. **Auto-renew.** Monthly is a 30-day pass today (the studio pays again). True
   auto-debit needs Razorpay Subscriptions (an e-mandate the customer approves
   once). Worth doing once the plans settle; it is its own piece of work.

## What is built (whatever option is picked)

- Each plan carries its **limits** and what it **includes** (white-label, own
  WhatsApp, sequences). `company_can()` reads the plan as well as the manual
  switches on `/platform/studios`, so a Studio Max studio gets them by paying.
- **The limits are checked by the database**, not the screen, so no route
  around the page can skip them.
- **Usage bars** on Settings → Subscription ("4 of 8 projects this month"), and
  a one-line nudge on the sidebar plan card only when a studio is close (80%).
- When a limit is reached, the button's message says so in a sentence with
  **Upgrade**.
- Paying for a plan now also records **which** plan the studio is on (before,
  only the end date was kept, so the sidebar said "Your plan").
- **WhatsApp setup guide**: a step-by-step page linked from Settings → WhatsApp.
