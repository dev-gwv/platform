# Studio AutoPilot: full UX audit (prompt for the Claude browser extension)

Paste everything below the line into the Claude extension in Chrome while you
are signed in to https://studioautopilot.in as the studio owner. It takes about
an hour. Change only the four values in `<angle brackets>` first.

---

You are auditing **Studio AutoPilot** (https://studioautopilot.in), software
that Indian photography and wedding studios use to run their whole business:
leads, projects, shoots, crew, post-production, money and the team. I am the
owner. I am signed in to my own studio in this browser. Your job is to **use the
product the way a busy studio owner would**, create one complete test project
end to end, try every feature on the way, and write me a report of what slows a
person down, confuses them or can be missed, with a concrete fix for each.

## What "better" means here (judge every screen by these)

1. **Fewer keystrokes, more taps.** Anything a studio types more than once
   (a price, a role, an event name, a city, a package, a note) should be
   offered back as a one-tap chip, preset or "save for next time". Count how
   many times you type the same thing; each repeat is a finding.
2. **Every control looks like a control.** A button or box that blends into
   the background, is white on near-white, is cut off at the edge, or is
   hidden behind a menu is a finding. The one next thing should be amber or
   pulsing; done should be green; red only for a real problem.
3. **Nothing important can be skipped by accident.** If a step lets you go on
   while something the rest of the flow needs is still empty (a function with
   no team, a project with no price, a shoot with no time), that is a finding.
4. **Say what the numbers mean.** A sentence beats three bare figures. When two
   numbers disagree, the screen should say why and offer the fix.
5. **Minimal first.** No explainer boxes that stay forever, at most 3-4 things
   under a heading, plain English. Too much on a page is a finding too.
6. **The next step is always obvious.** After every save, check that the page
   shows clearly what to do next, with one button.
7. **Nothing overlaps.** Watch the round help bubble in the bottom-right corner,
   sticky Save / Next bars, the top bar and dialogs. Anything covering or
   merging into a button is a finding.

## Rules (do not break these)

- **Test data only.** Every name you type starts with `AUDIT TEST` (for example
  client "AUDIT TEST Priya Sharma", project "AUDIT TEST Sharma Wedding"). Use
  the phone number `<a phone number of mine for testing>` and the email
  `<an email of mine for testing>` for every client, lead and person.
- **Never message a real person.** Do not press Send, WhatsApp, Email or Share
  on anything addressed to someone who is not one of my test contacts. Where a
  button would open WhatsApp or an email, stop at the preview and note what it
  would have sent.
- **Do not change, delete, archive or edit anything that does not start with
  `AUDIT TEST`.** Do not change Settings, plans, prices, team logins,
  attendance rules, Facebook connections or anything under Platform. Open
  those pages and look, but do not press Save.
- **Do not buy, pay, upgrade or press Talk to us on WhatsApp.**
- **Do not add team logins or send invites.** If a step needs a crew member,
  use someone already on my team, or add a team member **without a login**
  named `AUDIT TEST Crew`.
- Never print or copy a password, a token, a full bank or UPI detail, or any
  client's phone number other than my test number.
- If something errors, take a screenshot, write down the exact words on
  screen, and carry on with the next part. Do not retry more than once.

## The walk-through (in this order)

Take a screenshot at every numbered step and note how long it took, how many
times you typed, and anything that made you hesitate.

**A. First look.**
1. Home: read the greeting, the three tiles and anything below. Does each tile
   say what to do? Click each tile's button and come back.
2. Top bar, left to right: Leads, Projects, Shoots, search, + New, the late
   chip, Suggest an idea, Support call, the bell, the eye (hide amounts), the
   account menu. Note anything unclear. Resize the window to roughly 1024,
   1280 and 1920 px wide and note anything that wraps, overlaps or disappears.
3. The left menu: open every line once. Note any page that is slow, empty
   without explaining why, or has no clear first action.

**B. A lead, booked.**
4. Leads → add a lead `AUDIT TEST Priya Sharma` with my test phone, event
   Wedding, a date about two months out, city `<my city>`, budget ₹1,50,000.
   Count keystrokes. Were event, city and budget offered as chips?
5. Open the lead's drawer: give it to someone, add a label, set a follow-up for
   tomorrow, add a note. Then open **Follow-ups** (board) and find it.
6. Open **Form & QR** from Leads and look through its four chips (do not
   change anything). Is it clear how a studio would use it?
7. From the drawer press **Book it** and book the lead. Note where you land.

**C. A project through the wizard** (+ New → Project, or Projects → New).
Fill it for `AUDIT TEST Sharma Wedding` with three functions: Haldi, Wedding
Day, Reception.
8. *Who it's for*: pick or add the test client.
9. *Event days*: add the three functions from the chips. For each set date,
   start time, duration and guests, then **Add requirements** (for example
   2 Candid Photographers, 1 Cinematographer, 1 Drone). Try to press **Next**
   with one function still without requirements: does it stop you, and does
   it say why? Is **Add requirements** easy to see? Does the help bubble sit
   on or near the Next button? Try **Save as preset** and **Apply preset**.
10. *Deliverables*: add a Wedding Teaser, a Highlight film and an Album from
    the chips, and try **Load a set**. Note anything you had to type.
11. *Price*: type a package price. Did it offer your saved packages as chips,
    and offer to save this price as a package? Add an advance of ₹25,000.
12. *Review*: read it, then create the project. Note where you land.

**D. The project page.**
13. **Quotation**: read it, use **See it as the client**, open the ⋯ menu,
    Print preview. Do not press Send to client.
14. Press **Create the invoice** from the journey bar. Check the advance is
    ticked under "Already received" and the amount to collect is right. Save
    it. Try editing the invoice and the signature. Do not send it.
15. **Shoots** tab: is **Bulk assign team** clearly visible? Is each day's
    **Assign team** big enough? Book `AUDIT TEST Crew` (or an existing team
    member) on all three days with Bulk assign, then use Assign team on one
    day. Read what each person's line says ("Free all day", "Busy 3-6 PM").
16. **Post-Production**: give the Wedding Teaser to someone with
    **Start editing**, set a due date, then move it on the board.
17. **Post-Production → Gallery** (and **Gallery** under Post-Production in
    the left menu): is the "New" badge easy to see? Read **How it works**. Do
    not create a gallery unless I wrote `create gallery: yes` here: `<yes/no>`.
    Note whether the page explains the photo sharing app, Google Drive import
    and the PIN in plain words, and what a studio would not understand.
18. **Terms**: open it and look (do not send). **Finance**: Billing,
    Expenses (add a ₹500 `AUDIT TEST` expense), Cost sheet, Payouts.
    **Data**: record cards for one past-dated test shoot if possible.
    **Referrals** and **Wishes**: look only.
19. Overview: do the four money boxes agree with the invoice and the advance?
    Is every number explained in words?

**E. The rest of the studio.**
20. Shoots → Team Booking: the Shoots list, **Calendar**, People and
    Conflicts. Find the test project's days.
21. Post-Production (People, Stages, List), Tasks, Data & Backup.
22. Money: Payments (the four tiles), Invoices, Expenses, Profit & Loss; try
    the period switch.
23. Team: People, Attendance & leave, Pay, Roles & terms (look, do not save).
24. Reports, Settings (open every line of the rail, save nothing), Plan &
    billing.
25. The help bubble and the sidebar Help: open them, open one tutorial, check
    **Book a support call** opens the booking page (do not book).

**F. Clean up.**
26. Delete or archive everything named `AUDIT TEST` that you made: the
    expense, the invoice (if it lets you; if not, cancel it), the project, the
    lead and client, `AUDIT TEST Crew`, and the test gallery if you made one.
    List anything you could not remove.

## The report

Give me:

1. **The ten most important fixes**, ranked, each as:
   *Where* (page, step, button) · *What happened* · *Why it matters to a
   studio* · *The fix* (specific: "make X solid amber and move it above Y",
   not "improve visibility") · *Effort* (small / medium / large).
2. **Every finding** in a table: Area · Screen · Finding · Rule it breaks (1-7
   above) · Suggested fix · Severity (blocker / annoying / polish) ·
   Screenshot number.
3. **Typing you could remove**: every field you filled by hand that the app
   already knew or should remember, and how (chip, preset, default, copy from
   the last one).
4. **Steps that let you skip something important.**
5. **Anything that broke**: errors, blank pages, "Couldn't show", wrong
   numbers, buttons that did nothing, with the exact words on screen.
6. **What already works well**, in a few lines, so it is not changed by mistake.
7. **The clean-up list**: what you made, and whether each was removed.

Keep the language plain. No jargon, no code. Write it so I can paste the top
ten straight to my developer.
