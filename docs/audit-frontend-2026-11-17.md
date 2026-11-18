# Front-end audit — 17 Nov 2026

**Status:** every finding below is **fixed** in the working copy (not committed yet). The second pass found nine more problems, and those are fixed too. Each line ends with what changed and where.

## How it was checked

The audit covers:

- every menu page in `e2e/smoke.mjs`
- the hub tabs and settings sub-pages
- the Platform pages
- the public pages: sign-in, help, `/start`, `/learn`, enquiry forms, and the client's links (tracker, quote, design, referral, terms, receipt)
- the staff pages and the project page's views
- these dialogs and drawers: Add lead, the lead drawer, Create project, Assign team, Bulk assign, Record payment, Add expense, New task, Add daily task, Ask for leave, New client, Add partner and Whose wedding?

Each was opened at **375 px** and **768 px** in the `web-mock` preview (`.claude/launch.json`, `VITE_MOCK=1`). The top bar was checked at every width from 320 to 1920 px.

For each one I measured:

- anything past the right edge, or cut off by a parent
- sideways scrolling
- tap targets under 24 px
- error boxes
- React Query errors

Hit-tests showed what a tap actually reaches.

**Gate on the owner's Windows PC, after the fixes:**

- `tsc --noEmit`: clean (it failed before, see finding 4)
- `eslint src`: clean
- `vitest run`: 155 files, 1,163 tests passed, up from 1,089; the new tests are listed at the end

Severity: **broken** = cannot do the thing · **wrong** = works but misleads or breaks a rule in CLAUDE.md · **ugly** = looks bad, still works.

> **A correction to the first pass.** The built-in browser pane was hidden, which froze every CSS transition halfway. The follow-up reminder was measured mid-slide, about 90 px lower than where it really rests. So it does **not** cover Create project's Cancel/Back/Next, as the first report said. It does cover dialogs, such as Add lead's buttons (finding 2). The help bubble over Next (finding 3) was real.

---

## Findings and fixes, worst first

### 1. The top bar ran off the screen from 375 px to about 1000 px — **broken** · fixed

The bell, Hide amounts and the account menu (Sign out, Switch studio) were past the right edge. At 768 px Support call was too.

**Fix** (`shared/layout/AppShell.tsx`, `AccountMenu.tsx`, `RefreshButton.tsx`, `MoneyMask.tsx`, `features/feedback/SuggestFeature.tsx`):
- The search is an icon until 1800 px (the 16 rem field at 640–1023 px caused the 768 overflow).
- Below 480 px the bar shows the two-letter "SA" mark the collapsed sidebar already uses; the drawer still shows the full wordmark.
- The account button shows only the avatar on a phone.
- On a phone the assistant lives in the help bubble.
- Items that have no room move into the account menu as "narrow" lines, so nothing is removed:
  - **Refresh this page**, below 640 px
  - **Hide / Show amounts**, below 1024 px
  - **Suggest a feature · सुझाव दें**, below 768 px
- The menu panel scrolls if it is taller than the screen.
- The hamburger is a 40 px target and has a name ("Open menu").

**Checked:** nothing past the edge at 320, 360, 375, 414, 480, 640, 768, 900, 1024, 1280, 1440 and 1920 px. `header.test.ts` now guards this.

### 2. The follow-up reminder sat on top of open dialogs — **broken** · fixed

At 375 px it covered Add lead's "More details", Cancel and Add lead buttons.

**Fix** (`main.tsx` gives the toaster the `ipc-reminders` class; the rules are in `styles.css`):
- While any dialog or drawer is open, the reminder steps aside and comes back when the dialog closes.
- On a phone it rests 140 px up, clear of the help bubble.
- On a page with a sticky Save / Next bar it rests 200 px up, above the bar.

### 3. On a phone the help bubble covered the wizard's Next button — **broken** · fixed

A tap on Next opened Help.

**Fix** (`styles.css`): the lane `[data-sticky-actions]` keeps free on the right now applies at every width (4.75 rem), not only from 768 px. The bulk bars (leads, production board, data, deliverables) and My profile's Save bar did not carry the attribute and had the same problem; all five now do.

**Checked:** at 375 px a hit-test on Next reaches Next (`06-after-wizard-375.jpg`).

### 4. Ad scripts crashed on Windows, and `tsc` failed there — **broken** · fixed

`features/ai/Teleprompter.tsx` sat beside `teleprompter.ts`. On a case-insensitive disk they are one name.

**Fix:**
- The helper file is now `teleprompter-pace.ts`, and its test is renamed to match.
- New test `app/file-names.test.ts` fails if two source files in one folder differ only in case or extension.

### 5. Pages scrolled sideways on a phone — **wrong** · fixed

| Page | Cause | Fix |
| --- | --- | --- |
| Payroll | A screen-reader-only "Actions" label escaped the table's scroll box | A global rule pins `.sr-only` to its box's corner, and `.table-wrap` is `position: relative` (`styles.css`). This also cured **Platform → Plans** (467/375). |
| Settings → Invoicing | The tab row was wider than the phone | `TabsList` scrolls inside itself (`shared/ui/tabs.tsx`) |
| Platform → Diamond members | The filter tabs were wider than the phone | `FilterTabs` scrolls inside itself, and its buttons keep their width (`shared/layout/filter-tabs.tsx`); Tasks' own tab row likewise (`routes/tasks.tsx`) |
| Theme & branding at 768 | `md:grid-cols-2` counted the screen, not the room beside the sidebar and the settings rail | The cards fill the room they have (`routes/settings/appearance.tsx`) |
| Plan & billing at 768 | Three price columns beside the rail pushed "₹49 a day" past the card's edge | The same room-based columns (`features/billing/PlanPicker.tsx`, also on the home page) |

### 6. Tables and rows were cut off with no way to scroll — **wrong** · fixed

- **Data & Backup → Locations:** the table sat in an `overflow-hidden` box, so the Status and Actions columns were unreachable on a phone. It now scrolls (`routes/data-management.tsx`). Saved items had the same box (`features/billing/SavedItemsManager.tsx`).
- **Wedding QR codes:** the row's link to the project was cut off. The line now wraps (`features/enquiry-forms/WeddingQr.tsx`).
- **Bulk assign:** the form was 41 px wider than a phone's dialog. Its grid gained `grid-cols-1` (`features/shoots/BulkAssignDialog.tsx`).

### 7. My profile could show loading rows forever — **wrong** · fixed

When the profile failed to load, the page stayed on loading rows with no heading and no retry. It now shows "This didn't load" with **Try again** (`routes/my-profile.tsx`).

### 8. Money typed with commas was saved as ₹0, or not at all — **wrong** · fixed

`Number("1,50,000")` is `NaN`. Text boxes then saved ₹0 or dropped the value without a word, against the `parseAmount` rule. Now fixed in:

- the lead budget and deal value (Add lead and the lead drawer)
- a saved item's rate
- the expense amount and its tax
- a studio overhead
- a deliverable's extra charge
- a referral reward, both on the project and on Platform
- Assign team's payout, its picker, and "Edit payout"
- Quick add member's rate
- Invite's salary
- the project's package cost on Edit project
- the referral campaign's reward
- the Team payouts amount

Where a form must refuse junk ("12a") rather than save ₹0, it uses the new `readAmount`, which strips commas, ₹ and spaces and returns NaN for anything else (`shared/money/parse-amount.ts`).

### 9. Tap targets were too small on a phone — **ugly / wrong** · fixed

- **Every dialog's ✕:** it was a 13 px target and is now 36 px, in the same corner (`shared/ui/dialog.tsx`).
- **Tick boxes, native and drawn:** on phones and touch screens they are 20 px, and the drawn ones get an invisible ring a thumb can find (`styles.css`).
- **Lead cards' tick:** it only appeared on hover, so **on a phone a lead could not be ticked at all**. It now shows wherever there is no hover.
- **Other small controls:**
  - the List / Board / Pipeline switch is 32 px tall (`shared/ui/segmented.tsx`)
  - the pipeline column's drag handle is 28 px (`features/crm/tabs/BoardTabs.tsx`)
  - Record payment's UPI / Cash… chips are 32 px
  - Assign team's ⋯ is 32 px

### 10. Assign team hid each booked person's payout on a phone — **wrong** · fixed

The payout now sits on its own line under the name (`features/shoots/AssignTeamDialog.tsx`).

### 11. Staff with leads lost the Attendance tab on the phone's bottom bar — **wrong** · fixed

Attendance is now placed before Calls, so the four-tab cut keeps it (`shared/layout/MobileTabBar.tsx`). This matches the CLAUDE.md rule.

### 12. The phone's first screen was spent on boxes — **ugly** · fixed

- **Project page:** the money boxes are two to a row on a phone, with the project value across the top (`routes/projects/detail.tsx`).
- **Figure tiles everywhere** (`MetricCard`, used on 38 screens, including the four on Post-Production): tighter padding and a smaller number on a phone (`shared/ui/metric-card.tsx`).

### 13. The lead drawer's footer floated 21 px above the bottom — **ugly** · fixed

The bar now cancels the scroller's bottom padding and allows for the phone's safe area (`features/crm/LeadDrawer.tsx`).

### 14. The + New button and other icon menus had no name — **ugly** · fixed

A `RowMenu` with its own icon or words is now always named by its `label` (`shared/ui/row-menu.tsx`).

### 15. "Today" read from UTC on a few screens — **wrong** · fixed

Before 5:30 am in India these took yesterday's date: Data & Backup's fallback shoot date, Platform's import and days-left checks, and five CSV file names. They now use `todayInIndia()`.

### 16. The preview could not show most money and team screens — **wrong** (dev tool) · fixed

The cause was mostly endpoints with no canned answer at all (about 45), plus six that had drifted. The old handlers matched exact paths, so `/billing/due?from=…` missed them.

**Fix:**
- `shared/dev/mock.ts` now matches on the path before `?` and answers every endpoint the menu pages call, with figures that agree across pages: Home's To collect and the Payments tiles come from the same `/billing/due`.
- New test `shared/dev/mock.test.ts`: 70 cases, each parsed with its real contract.
- In preview mode, `shared/api/client.ts` now logs `[mock] … no longer matches its contract` or `[mock] no canned answer for …`, so a gap in the mock is never mistaken for a page bug.

**Checked:** every menu page loads at 375 and 768 px. Still unmocked:

- Platform → Diamond members
- Platform → Email
- Platform → Usage
- Settings → System's health check
- My profile's two email-preference cards

---

## Re-check after the fixes

Every page below, at 375 and 768 px, showed:

- nothing past the right edge
- no sideways scroll
- the whole top bar on screen
- no error box

The only clipped items are the empty decorative circles on AI, Photo sharing and Plan & billing.

Pages covered: Home · Leads (Pipeline, Board, List) · Follow-ups · Today's calls · My leads · Enquiry form & QR (main, partners, wedding) · Clients · Projects · Needs attention · Shoots (+ Calendar) · Post-Production · Tasks (+ Daily) · Data & Backup (+ Locations) · Payments · Invoices · New invoice · Expenses · Profit & Loss · Crew payouts · Team · Attendance · Leave · Payroll · Team payouts · Performance · Roles & access · Reports · AI and its five tools · Photo sharing (+ app) · Plan & billing · Settings pages · My profile · My work · My shoots · My payouts · My attendance · the project page's views · Create project · Edit project · the public pages · the Platform pages.

**Referral cards at 768 px** reported a 7 px scroll, but no element reaches past the edge. It is most likely the frozen page-in animation in the hidden pane. Worth a look on a real tablet.

---

## Money numbers: Home, Payments and Invoices

Checked in the preview at 1280 px after the mock data was fixed.

| Figure | Home | Payments received | Invoices |
| --- | --- | --- | --- |
| Overdue | ₹40,000 | ₹40,000 (1 payment late) | ₹0, "Nothing late" |
| Due in 30 days | ₹72,000 | ₹72,000 | INV-0003 ₹72,000, due in 8 days |
| Invoiced / paid / pending | — | — | ₹3,02,400 / ₹1,90,000 / ₹1,12,400: these add up from its rows |

- **Home and Payments agree.** Both read `GET /billing/due`, by design.
- **Invoices' Overdue differs from Payments' Overdue, and that is correct.**
  - The ₹40,000 is a *promised* payment on Sharma Wedding that is tied to no invoice. Payments counts promises and plan parts; the Invoices tile counts only invoices past their due date (`services/api/src/modules/billing/routes-due.ts`, `/overview`).
  - The preview showed it the other way, "₹40,000 · 1 invoice past due" with no such invoice in the list, because the mock copied Payments' bucket. The mock now follows the server's rule.
- **Two server-side points to look at.** Neither can be checked in the preview.
  1. Profit & Loss and Reports show a "Still to collect" of their own: project value minus money received. Home and Payments count invoice balances, GST included. A project fully paid at its package price but invoiced with GST on top will show ₹0 on Profit & Loss and the GST amount on Home. Either word the two apart ("Project value not yet received", as P&L's hint already says) or make them one number.
  2. `/billing/overview` uses Postgres `current_date`, which is the server's UTC date. An invoice turns "overdue" at 5:30 am India time, not at midnight. `/billing/due` takes India's today.

## New tests

| Test | What it guards |
| --- | --- |
| `apps/web/src/app/file-names.test.ts` | no two files in a folder differ only in case or extension |
| `apps/web/src/shared/layout/header.test.ts` (3 new) | the narrow top bar; the help-bubble lane at every width; the staff Attendance tab |
| `apps/web/src/shared/dev/mock.test.ts` (70) | every preview answer fits its contract |

## Still to do

- **Check on a real phone and tablet.** The preview pane was hidden, so the motion (reminder slide, page-in) could not be seen.
- **Commit and push** after `git pull`. Nothing is committed; the changes touch the top bar, `styles.css` and `mock.ts`, which other sessions also edit.
- **Re-record two setup videos.** The setup video and the Create project videos show the old top bar on a phone. The desktop top bar looks the same from 1024 px except the search field, which is now an icon below 1800 px; tutorials recorded at 1920 px are unaffected.
