/**
 * The knowledge base: what the app does, written out.
 *
 * The /learn guide (guide.ts) teaches the jobs a new studio must do in order,
 * and every chapter has a video. This file is the other half — the reference —
 * and it exists because the assistant cannot answer from a video. Measured
 * against the app's real surface, the guide covers about a third of it: Tasks,
 * Reports, Profit & Loss, Roles & access, the plans, twelve of sixteen settings
 * pages and every CRM sub-page had no written help at all, and a model asked
 * about a screen it has never been told about will invent one.
 *
 * So the rule for this file: if a studio can open it, it is described here.
 *
 * How to write an article:
 *   - Say where it is by the menu, the way the screen says it ("Team → People"),
 *     never by a path. A studio does not know what /employees is.
 *   - Short. Three or four sentences, or a few steps. These are read out by an
 *     assistant answering one question, not studied.
 *   - **Bold** a control, exactly as guide.ts does; the API strips the stars
 *     before the model sees them.
 *   - Plain English, and the studio's words: "shoot", "crew", "cards", not
 *     "resource", "asset", "media ingestion".
 *   - Never a price that is not in the `plans-*` articles, and never a promise
 *     about someone's own bill. Those belong to a person.
 *   - Nothing about the platform console. Everything here goes into every
 *     studio's prompt, so an article about our own vendor screens would both
 *     describe our internals to a customer and offer them a link that 403s.
 *
 * Plain data only — this package is loaded by the API, so nothing here may
 * import React or touch the DOM.
 */

export type KbArea =
  | 'Start'
  | 'Leads'
  | 'Clients'
  | 'Projects'
  | 'Shoots'
  | 'Editing'
  | 'Data'
  | 'Money'
  | 'Team'
  | 'Reports'
  | 'Settings'
  | 'Plans'
  | 'Problems'

export interface KbArticle {
  key: string
  title: string
  area: KbArea
  /** Where it is done, said the way the menu says it. */
  menu?: string
  /** The screen, so an answer can offer a link to it. */
  to?: string
  /** A tutorial key in TUTORIALS, when a recording shows it. */
  video?: string
  /** Short paragraphs or steps. */
  body: readonly string[]
}

export const KB: readonly KbArticle[] = [
  // ── Start: what the thing is ────────────────────────────────
  {
    key: 'what-it-is',
    title: 'What Studio AutoPilot is',
    area: 'Start',
    body: [
      'Studio AutoPilot runs a photography or wedding studio from the first enquiry to the last payment.',
      'It holds your enquiries and follow-ups, your clients, your projects with their shoot days and deliverables, the crew you book for each day, the editing work and who has it, your invoices and the money in and out, and your team: attendance, leave and pay.',
      'The menu down the left is the order of the work: **Leads**, **Clients**, **Projects**, **Shoots**, **Post-production**, **Tasks**, **Data & Backup**, **Money**, **Team**, **Reports**, **Settings**.',
    ],
  },
  {
    key: 'getting-started',
    title: 'Setting up a new studio',
    area: 'Start',
    menu: 'Home',
    to: '/dashboard',
    body: [
      'A new studio starts on step 1: **Add your team**. The button opens the bulk list so you can put everyone in at once.',
      'Then add a client, then create your first project. Those three steps show once, in the setup bar at the top.',
      'Your email is never a gate — you can use everything before confirming it.',
      'After setup, Home shows **Getting started**: five steps that tick themselves as you do them (logo and name, a saved package, a first enquiry, a booking with shoot days, a quotation sent). It closes itself at five of five, or after 60 days.',
    ],
  },
  {
    key: 'learn-and-help',
    title: 'The guide, the videos and getting a person',
    area: 'Start',
    menu: 'Help, at the foot of the menu',
    to: '/learn',
    body: [
      'Press **Help** at the bottom of the menu. It has **WhatsApp us** and **Email us**, with your studio, your name and the page you are on already written into the message — you only press Send.',
      '**How to use Studio AutoPilot** is the whole app step by step with a short video for each job, in English and Hindi.',
      'Most screens also have **Watch how** beside the page title, which plays the recording for that screen.',
    ],
  },

  // ── Leads ───────────────────────────────────────────────────
  {
    key: 'leads-what',
    title: 'Leads: tracking enquiries',
    area: 'Leads',
    menu: 'Leads',
    to: '/follow-ups',
    video: 'leads',
    body: [
      'Every enquiry is a lead, on a board of columns you name yourself — your stages, your colours.',
      'A lead carries as many **labels** as you like, one **quality** (hot, warm, cold — hot ranks your call list), a source, and as many events as the booking has.',
      'Open a lead to see everything about it and its whole history. **Book it** turns it into a project; **Lost** asks for a reason so the reports can tell you why bookings go.',
      'A lead can start with just a name — but it needs a phone number before you can book it.',
    ],
  },
  {
    key: 'leads-add',
    title: 'Adding a lead, and where leads come from',
    area: 'Leads',
    menu: 'Leads → Add lead',
    to: '/follow-ups',
    body: [
      'Press **Add lead** and fill in what you know — a name or a number is enough.',
      'Leads also arrive on their own: from your enquiry form or vendor QR code, from Facebook lead ads, and from WhatsApp.',
      'If the number is already in your CRM, it finds that lead instead of making a second one.',
      'Leads that arrive on their own are never refused, even if your plan is at its lead limit.',
    ],
  },
  {
    key: 'leads-stages',
    title: 'Changing your lead stages',
    area: 'Leads',
    menu: 'Leads → the column menu, or "+ Add stage"',
    to: '/follow-ups',
    body: [
      'Stages are yours. Add, rename, recolour, reorder or hide one from the board — use the menu on a column heading, or the **+ Add stage** column at the end.',
      'You can also change a lead\'s stage from the stage picker inside the lead.',
      'The same is true of every list in the app: qualities, sources, labels, event types, follow-up types. Type your own word in the picker and it joins the list for everyone in the studio.',
    ],
  },
  {
    key: 'leads-follow-ups',
    title: 'Follow-ups and the call queue',
    area: 'Leads',
    menu: 'Leads → Call queue',
    to: '/follow-ups/queue',
    body: [
      'A follow-up is a task on a lead with a date and a priority. The lead shows the next one due, and turns amber once it is past.',
      '**Call queue** is today\'s calls in the order worth making — hot leads first, then how long someone has been waiting.',
      'Leads shows an amber **not contacted yet** count that opens just those.',
      'A lead nobody has touched for a while is swept into "going cold" and appears in the morning email.',
    ],
  },
  {
    key: 'leads-send',
    title: 'Sending a message to many leads',
    area: 'Leads',
    menu: 'Leads → Send now',
    to: '/follow-ups/send',
    body: [
      'Pick the leads and send one message to all of them, on WhatsApp or email.',
      'Tick leads on the board or the list to get the bulk bar, which also sets labels, stage, owner or quality on all of them at once.',
      'Messages come out of your message credits. Your own WhatsApp number is part of the top plan — Settings → Money → Plan & billing says what yours includes.',
    ],
  },
  {
    key: 'leads-reports',
    title: 'Lead reports: funnel, team and forecast',
    area: 'Leads',
    menu: 'Leads → Reports',
    to: '/follow-ups/reports',
    body: [
      '**Funnel & sources** — where leads come from, which stage they stop at, and the reasons you lost them.',
      '**Team** — who is carrying what, how fast each person answers a new lead, and who converts.',
      '**Forecast** — what could still close, weighted by the stage each lead is in.',
      '**Checks** — whether leads are actually arriving and whether you can reach them.',
      'One date range covers the whole page.',
    ],
  },
  {
    key: 'leads-setup',
    title: 'Lead settings: who gets a new lead',
    area: 'Leads',
    menu: 'Leads → Setup',
    to: '/follow-ups/setup',
    body: [
      'Set how long a new lead may wait before first contact and still count as on time.',
      'Choose how new leads are shared out: to one person, or round-robin across your team. The rota counts each person\'s open leads, not every lead they have ever had.',
      'This is also where your stages, sources and automatic follow-up rules live.',
    ],
  },
  {
    key: 'enquiry-forms',
    title: 'Enquiry forms and vendor QR codes',
    area: 'Leads',
    menu: 'Settings → Leads → Forms',
    to: '/enquiry-forms',
    video: 'enquiry-form',
    body: [
      'Make a form for **your website** or for **a vendor** (a QR code a venue or decorator can show).',
      '**Edit form** opens the builder with the form beside it: the heading, the line under it, each field Off, Ask or Required (name and phone are always asked), the button colour, your logo on or off, and what the client sees after sending.',
      'A website form gives you **Copy code** — paste that into your site and the form appears there.',
      'Every form sent in makes a lead, with the vendor recorded as its source.',
    ],
  },
  {
    key: 'lead-sources',
    title: 'Lead sources',
    area: 'Leads',
    menu: 'Settings → Leads → Lead sources',
    to: '/lead-sources',
    body: [
      'The list of places your enquiries come from — Instagram, a venue, a referral, Facebook — so the reports can tell you which ones are worth your money.',
      'Add your own source any time; it joins the list for everyone.',
    ],
  },
  {
    key: 'facebook-leads',
    title: 'Facebook lead ads',
    area: 'Leads',
    menu: 'Settings → Leads → Lead sources',
    to: '/facebook',
    video: 'facebook',
    body: [
      'Press **Connect with Facebook** and pick the Pages you want. A new lead from a Facebook lead-ad form then arrives in your CRM by itself.',
      'Only the Pages you tick in Facebook\'s own dialog are listed.',
      '**Disconnect Facebook** removes every Page and token. It never deletes leads you already have.',
      'If the connection expires, the card says "Your Facebook connection expired. Please reconnect." — press Connect again.',
    ],
  },

  // ── Clients ─────────────────────────────────────────────────
  {
    key: 'clients',
    title: 'Clients',
    area: 'Clients',
    menu: 'Clients',
    to: '/clients',
    video: 'client',
    body: [
      'A client is the couple or family you are shooting for. Add them with **Add client**, or let a booking make one.',
      'A client holds their projects, their payments, and their dates — birthdays and anniversaries, which the Wishes tab uses.',
      'The wedding shoot day fills in the anniversary by itself.',
    ],
  },
  {
    key: 'client-details-form',
    title: 'Letting the client fill in their own details',
    area: 'Clients',
    menu: 'Project → More → Send details form',
    video: 'details-form',
    body: [
      'Instead of typing a client\'s details yourself, send them a form on WhatsApp and let them fill it in.',
      'From a project: **More → Send details form**. For one link and QR you can use with anyone: **Settings → Leads → Client details form**.',
      'What they send fills only the blanks — it never changes a date you typed. If they list events you do not have yet, those wait as **From the client** chips on the project\'s Shoots tab, one tap each to add.',
    ],
  },
  {
    key: 'client-portal',
    title: 'What the client can see',
    area: 'Clients',
    menu: 'Project → More → Share with client',
    body: [
      'Each project has a link you can send the client. It shows their quotation, their invoices, their terms to sign, and the work as it is delivered.',
      'Find it under **More → Share with client** on the project.',
      'To check what they will see without issuing anything, use **Send to client → See it as the client**. Opening it yourself is never counted as a client view.',
      'The project Overview tells you what they did: "Quotation opened · 2 Oct, 6:40 pm (3 times)", "Accepted by Priya".',
    ],
  },

  // ── Projects ────────────────────────────────────────────────
  {
    key: 'projects-what',
    title: 'Projects: the eight tabs',
    area: 'Projects',
    menu: 'Projects',
    to: '/projects',
    video: 'project',
    body: [
      'A project is one booking — a wedding, a pre-wedding, an event — with its days, its crew, its deliverables and its money.',
      'Every project page has eight tabs: **Overview**, **Quotation**, **Shoots**, **Post-production** (Work, Work to review, Task Management), **Terms**, **Finance** (Billing, Expenses, Cost sheet, Payouts), **Data** and **Wishes** (Wishes, Referrals).',
      'Across the top is the journey line — Quotation · Invoice · Team · Deliver — which always names the next step with one button.',
    ],
  },
  {
    key: 'projects-new',
    title: 'Creating a project',
    area: 'Projects',
    menu: 'Projects → New project',
    to: '/projects/new',
    video: 'project',
    body: [
      'Four steps: who it is for, the event days, what they get, and the price.',
      'Each shoot day needs a date, a **Start time** and a **Duration** — your crew\'s hours are planned from them.',
      'The billing step takes one **Advance received (optional)**; any more money is recorded on the project afterwards.',
      'Creating a project always lands you on its quotation.',
    ],
  },
  {
    key: 'projects-overview',
    title: 'The project Overview',
    area: 'Projects',
    body: [
      'Money and work only: what the project is worth, what you have received and what is still to collect, and the editing work with who has each piece.',
      'Received says what share it is ("20% collected"); still to collect says what is promised. With profit access there is a fourth box, **Margin**, after crew and expenses.',
      'It also lists what the client has done lately — opened the quotation, accepted it, signed the terms.',
    ],
  },
  {
    key: 'quotation',
    title: 'The quotation',
    area: 'Projects',
    menu: 'Project → Quotation',
    video: 'quotation',
    body: [
      'The quotation page shows the document and nothing else: one row of buttons across the top (Back, whether the client can see it, **Send to client**, Print, and ⋯ for terms and display options).',
      'It is compact on your screen and the full page when printed or opened by the client.',
      'When they are happy: **Create the invoice** on the journey bar opens the whole project with the client, the project and the package line already filled in, the advance already ticked, and "₹X to collect" said in a sentence.',
      'An invoice counts the quotation done, whether you sent a link or not.',
    ],
  },
  {
    key: 'terms',
    title: 'Terms, and getting them signed',
    area: 'Projects',
    menu: 'Project → Terms',
    video: 'terms',
    body: [
      'Send your terms to the client as a link. They read them and sign with their finger before **I agree**, and the signature appears on their copy and on yours.',
      'If the client is sitting with you, use **Sign now with Priya** on the Terms tab — the terms and the signature pad on your own phone or tablet. It is marked as signed in person.',
      'Your usual terms live in **Settings → Team → Team terms** for crew, and in the quotation\'s ⋯ menu for clients, where you can keep more than one preset and mark a default.',
    ],
  },
  {
    key: 'project-templates',
    title: 'Project templates and task bundles',
    area: 'Projects',
    menu: 'Settings → Projects → Templates',
    to: '/settings/project-templates',
    body: [
      'A template is a project shape you reuse: the deliverables, the tasks and the package line for "a wedding" or "a pre-wedding shoot".',
      'Every studio starts with **Sample — Wedding**, marked Sample until you edit it. A studio that deletes its sample does not get it back.',
      'Applying a template dates each new deliverable the way the wizard would, counting from the wedding day or the last shoot. A date you already set is never moved.',
      '**Task bundles** are the same idea for tasks — a set you add to a project in one go.',
    ],
  },
  {
    key: 'project-tracking',
    title: 'Projects that need attention',
    area: 'Projects',
    menu: 'Projects → Needs attention',
    to: '/project-tracking',
    body: [
      'The projects with something waiting: a day with no crew, work that is late, an unpaid invoice, data not backed up.',
      'Use it as the morning list rather than reading every project.',
    ],
  },
  {
    key: 'project-documents',
    title: 'Project documents',
    area: 'Projects',
    menu: 'Settings → Projects → Documents',
    to: '/project-documents',
    body: [
      'Every quotation, invoice, receipt and terms document you have issued, in one list, so you can find a paper without opening its project.',
    ],
  },

  // ── Shoots ──────────────────────────────────────────────────
  {
    key: 'shoots-what',
    title: 'Shoots and booking your crew',
    area: 'Shoots',
    menu: 'Shoots',
    to: '/team-allocation',
    video: 'assign',
    body: [
      'The Shoots tab of a project starts with the days. Each card shows the date, the hours ("4:00 pm–9:00 pm · 5 h") and the roles the day needs.',
      '**Assign team** books people. Each name tells you their day in plain words: "Free all day", "Free at this time · also booked 7–9 PM · Sangeet", "On leave that day", "Busy 3–6 PM". Hover or tap that line to see their whole day.',
      'A card stays plain until every seat is filled, then turns green.',
      'A shoot with no time set shows one amber **Set start time & duration** until you give it one.',
    ],
  },
  {
    key: 'shoots-copy-team',
    title: 'Booking the same crew for more days',
    area: 'Shoots',
    body: [
      'Once a day has its crew, the project offers **Book the same people for Wedding and Reception?** — it books them on the project\'s coming days in the same roles at each day\'s hours.',
      'Anyone busy, on leave or not needed is skipped, and the message names who and why.',
    ],
  },
  {
    key: 'shoots-calendar',
    title: 'The shoots calendar and clashes',
    area: 'Shoots',
    menu: 'Shoots → Calendar',
    to: '/team-allocation/calendar',
    body: [
      '**Calendar** is the month, Monday first. A day stays plain until every shoot on it has its team, then reads "Team set"; otherwise a quiet "2 to fill". Tap a shoot to assign.',
      '**Conflicts** lists anyone double-booked.',
      '**People** is the same month seen per person.',
    ],
  },
  {
    key: 'shoots-pay',
    title: 'What a shoot day costs you',
    area: 'Shoots',
    body: [
      'Each person booked on a day carries a payout, filled in from their usual rates: a wedding-day rate for a wedding function, a half-day rate for five hours or less, otherwise their day rate.',
      'The day\'s line reads "Crew ₹12,000 · not final" until the money is settled.',
      'Set a person\'s usual rates on their row: **Team → People → Edit → pay**. Only people who handle salaries can see or set them.',
    ],
  },

  // ── Editing / post-production ───────────────────────────────
  {
    key: 'editing-give-work',
    title: 'Giving editing work',
    area: 'Editing',
    menu: 'Project → Post-production → Work',
    video: 'give-work',
    body: [
      '**Start editing** on a deliverable with nobody on it asks "Who will edit Wedding Teaser?" — your editors first, each with how much they already have ("2 in hand · 1 late"), the due date filled in, and a line of brief.',
      'Then **Start editing with Nitin**. They see it on their own login.',
      'Tick several cards on the Work tab to give them all out at once.',
    ],
  },
  {
    key: 'editing-board',
    title: 'The production board',
    area: 'Editing',
    menu: 'Post-production',
    to: '/production-board',
    video: 'board',
    body: [
      'Every piece of editing work in the studio, in columns by stage. Drag a card to move it on.',
      'Three views: **Stages** (the columns), **List** (late first, then by due date) and **People** (what each editor is carrying).',
      'Tick cards for the bulk bar. A row with nobody on it says **Give to…**.',
    ],
  },
  {
    key: 'editing-review',
    title: 'Work to review',
    area: 'Editing',
    menu: 'Project → Post-production → Work to review',
    body: [
      'What your editors have handed in and is waiting for you. Open it, watch it, then approve it or send it back with what to change.',
      'Sent back, the work reopens for its editor with your note.',
      'Whoever gave the work is told when it is handed in.',
    ],
  },
  {
    key: 'delivery-stages',
    title: 'Delivery stages: with or without a review',
    area: 'Editing',
    menu: 'Settings → Projects → Delivery stages',
    to: '/projects/stages',
    body: [
      'Two ways to work, and it is the owner\'s choice.',
      '**Check before it goes** — a hand-in waits in Review until someone approves it.',
      '**Handed in is delivered** — a hand-in is approved and delivered as it lands, and the board reads To do · Editing · Delivered.',
      'Switching never removes a stage, and work already in Review keeps its Review lane until it moves on.',
    ],
  },
  {
    key: 'tasks',
    title: 'Tasks and Task Management',
    area: 'Editing',
    menu: 'Tasks',
    to: '/tasks',
    body: [
      'Tasks are the jobs that are not an edit: book the decorator, order the album, collect the balance.',
      '**Tasks** in the menu is every task in the studio; **My tasks** is your own. A project\'s own tasks are on **Post-production → Task Management**.',
      'A task has someone on it, a due date and a priority, and the person sees it on their Home for that day.',
      'Add a ready-made set with a task bundle from **Settings → Projects → Templates**.',
    ],
  },

  // ── Data ────────────────────────────────────────────────────
  {
    key: 'data-what',
    title: 'Data & Backup: the cards after a shoot',
    area: 'Data',
    menu: 'Data & Backup',
    to: '/data-management',
    video: 'data',
    body: [
      'After a shoot, record whose cards came in and which disk they went on.',
      'The dialog is short: who copied it and when, then one line per copy — the disk and whether it is done. Folder or link goes under **+ Folder or link**; type, size, cards, label and notes under **More details**.',
      'It starts from the last person who copied for you and your usual main and backup disks.',
      'A shoot day\'s line reads "Data: 1 of 2 handed in · 1 backed up" once the day has passed, and opens **Record everyone\'s cards** while any card is still out.',
    ],
  },
  {
    key: 'data-locations',
    title: 'Your disks and where they live',
    area: 'Data',
    menu: 'Data & Backup → Locations',
    to: '/data-management/locations',
    body: [
      'The register of your disks and drives, so "WD Red 03" means the same thing to everyone.',
      'Name them the way they are labelled on the shelf. The dialog suggests the shape, for example WD-001 or SEA-002.',
    ],
  },
  {
    key: 'data-pay-freelancer',
    title: 'Paying a freelancer when their cards come in',
    area: 'Data',
    body: [
      'For anyone on a shoot payout, the data dialog carries "{name}\'s payout ₹__ · Pay later / Paid ₹X / Part paid", filled in from their booking.',
      'So the usual order is: cards in, then paid, in the same place.',
      '**Record everyone\'s cards** has a Pay tick per person.',
    ],
  },

  // ── Money ───────────────────────────────────────────────────
  {
    key: 'money-what',
    title: 'Money: the four screens',
    area: 'Money',
    menu: 'Money',
    to: '/billing/payments',
    body: [
      '**Payments** — money in, and what is due.',
      '**Invoices** — the GST invoices you have raised.',
      '**Expenses** — money out.',
      '**Profit & Loss** — the two together for a period.',
      'All four share one date range, so a period you pick on one holds on the next.',
    ],
  },
  {
    key: 'money-payments',
    title: 'Payments received, and what is due',
    area: 'Money',
    menu: 'Money → Payments',
    to: '/billing/payments',
    video: 'payments',
    body: [
      'Four tiles: **Overdue**, **Due in 30 days**, **Later**, and **Received** for the period.',
      'Tap a tile to list its lines, each with the one thing to do: Open invoice, **Mark received**, or Open billing.',
      'What is due comes from your open invoices first, then promises with no invoice, then the rest of the payment plan by its dates — each rupee counted once.',
      'Only money marked **paid** counts as money. Pending is a promise.',
    ],
  },
  {
    key: 'money-invoices',
    title: 'Invoices',
    area: 'Money',
    menu: 'Money → Invoices',
    to: '/billing/invoices',
    video: 'invoices',
    body: [
      'Make a GST invoice from a project, or from scratch with **New invoice**.',
      'If you have already taken an advance, tick it under "Already received for this project" — it is linked to the invoice so nothing is counted twice.',
      'Send the client a link, or print it. Your numbering, your terms and your GST details come from **Settings → Money → Invoicing**.',
      'Invoices keep their own dates rather than following the money pages\' period, so last month\'s unpaid ones never disappear from the list you chase.',
    ],
  },
  {
    key: 'money-expenses',
    title: 'Expenses',
    area: 'Money',
    menu: 'Money → Expenses',
    to: '/company-expenses',
    video: 'expenses',
    body: [
      'Record money out, against a category and — where it matters — against a project, so a project\'s real cost is true.',
      'An expense can be itemised, carry a tax rate and name the vendor it was paid to.',
      'Categories are yours to add. A new studio gets a starting set.',
    ],
  },
  {
    key: 'money-pnl',
    title: 'Profit & Loss',
    area: 'Money',
    menu: 'Money → Profit & Loss',
    to: '/financials',
    body: [
      'Money in against money out for the period, with your studio costs shared across projects either by income or equally.',
      'It uses the same booked profit as a project\'s Margin and the Finance tab, so the app never shows you two different margins for the same thing.',
    ],
  },
  {
    key: 'money-cost-sheet',
    title: 'A project\'s cost sheet',
    area: 'Money',
    menu: 'Project → Finance → Cost sheet',
    body: [
      'What one project actually cost: the crew you booked, the expenses against it, and the studio costs shared onto it — against what the client is paying.',
      'This is the screen that answers "did we make anything on that wedding".',
      'It needs money access, so a project manager without it will not see it.',
    ],
  },
  {
    key: 'money-payouts',
    title: 'Paying your crew',
    area: 'Money',
    menu: 'Team → Pay → Team payouts',
    to: '/team-payouts',
    video: 'payouts',
    body: [
      'Crew money is owed once the shoot day has passed. The page opens on **Owed now**, with **Upcoming** and **All** beside it.',
      'Money paid before a shoot shows as "₹X paid in advance" and is never taken off what you owe for days already done.',
      'Home shows **Who you owe** — "₹12,000 to 2 people for shoots already done · Pay".',
      'Each project\'s own payouts are on **Finance → Payouts**, and each person sees their own on **My payouts**.',
    ],
  },
  {
    key: 'money-pay-to',
    title: 'Where someone\'s pay goes',
    area: 'Money',
    body: [
      'Every pay dialog has a **Pay to** card with **Add UPI or bank**, so whoever is paying can fill in the details there and then.',
      'Only the owner and people who handle salaries or payouts can change them.',
      'A change is recorded, and anyone who can sign in is told "Your payment details were changed" — so pay can never be quietly redirected.',
    ],
  },
  {
    key: 'money-hide-amounts',
    title: 'Hiding amounts on screen',
    area: 'Money',
    body: [
      'The eye in the top bar turns every rupee on your own screens into ₹ ••••, which is what you want with a client beside you.',
      'It follows you to every device. Tap a hidden headline to show just that one figure.',
      'Documents — quotations, invoices, receipts, payslips — are never hidden.',
    ],
  },
  {
    key: 'invoicing-settings',
    title: 'Invoicing settings and GST',
    area: 'Settings',
    menu: 'Settings → Money → Invoicing',
    to: '/settings/invoicing',
    body: [
      'Your invoice numbering, your GST number and the details printed on every invoice, plus the default terms.',
      'Invoice tax uses the GST slabs. Expense tax is a plain percentage.',
      'Money is always rupees.',
    ],
  },
  {
    key: 'vendors',
    title: 'Vendors',
    area: 'Settings',
    menu: 'Settings → Money → Vendors',
    to: '/settings/vendors',
    body: [
      'The people and firms you pay — the decorator, the album printer, the drone operator — so an expense can name who it went to and you can see what you spend with each.',
    ],
  },

  // ── Team ────────────────────────────────────────────────────
  {
    key: 'team-what',
    title: 'Team: the four places',
    area: 'Team',
    menu: 'Team',
    to: '/employees',
    body: [
      '**People** — everyone, their roles and their rates.',
      '**Attendance & leave** — who is in, and leave.',
      '**Pay** — team payouts and payroll.',
      '**Roles & terms** — who can see what, and your crew terms.',
    ],
  },
  {
    key: 'team-add',
    title: 'Adding your team',
    area: 'Team',
    menu: 'Team → People → Add Team Member',
    to: '/employees',
    video: 'team-bulk',
    body: [
      '**All at once** gives you one row per person — name, mobile and the job they get booked for. **One by one** is the full form for a single person.',
      'A freelancer goes on **Per shoot**.',
      'The job-role picker is always open, with a search box and a solid **+ Add new role** button on top, so you can add a role you do not have yet.',
    ],
  },
  {
    key: 'team-logins',
    title: 'Giving someone a login',
    area: 'Team',
    menu: 'Team → People → the row menu → Sign-in details',
    body: [
      'Your team needs no real email. Any email, even one you make up, is only a username: they sign in with it and the password you set.',
      'Nothing ever asks your team to confirm an email.',
      '**Sign-in details** sets or changes someone\'s email and password, gives a login to someone who had none, and fixes a mistyped address. It signs them out everywhere.',
      'Everyone changes their own password on **My profile**.',
    ],
  },
  {
    key: 'team-what-staff-see',
    title: 'What your team sees on their own login',
    area: 'Team',
    video: 'team-day',
    body: [
      'A team member sees their own work, not the studio\'s: their shoots, their edits, their tasks, their attendance, their leave and their pay.',
      'They never see your money, your margins or a client\'s phone number.',
      'Their Home is their day: the attendance card, then **Today** in time order with one action per line (Confirm, I\'ve reached, Start, Hand in), then what is coming up.',
      'Someone who runs projects for you can be widened through **Manage access**.',
    ],
  },
  {
    key: 'roles-access',
    title: 'Roles & access: who can see what',
    area: 'Team',
    menu: 'Settings → Team → Roles & access',
    to: '/settings/roles',
    body: [
      'Access is per module — Leads, Projects, Money, Billing, Salaries, Settings and so on — and per action: view, create, edit, delete.',
      'The money modules are sensitive and off for staff by default. A project manager can run projects and still see no money; the app sends money as zero rather than hiding it on screen only.',
      'Downloading the client book is its own permission, so not everyone can export your leads.',
      'Give someone exactly what they need rather than making them an admin.',
    ],
  },
  {
    key: 'attendance',
    title: 'Attendance',
    area: 'Team',
    menu: 'Settings → Studio → Attendance',
    to: '/settings/attendance-location',
    video: 'attendance',
    body: [
      'Attendance is off until you turn it on. While it is off nobody is marked, swept absent, reminded or cut a rupee.',
      'Turning it on takes one place (use your location, or paste a Google Maps link) with a radius, your working hours, a grace period, when a short day becomes a half day, the weekly off, and an optional selfie.',
      'The app marks attendance itself when someone opens it inside the radius.',
      'A shoot day counts through **I\'ve reached** and is never marked absent or cut.',
      'Read it on **Team → Attendance & leave**: **Today** in one sentence, and **Month** with the totals worked out the way payroll does.',
    ],
  },
  {
    key: 'leave',
    title: 'Leave and balances',
    area: 'Team',
    menu: 'Team → Attendance & leave → Leave',
    to: '/leave',
    video: 'leave',
    body: [
      'Set the days a year for each kind of leave — casual, sick, paid — under **Balances**. Everyone then reads as "9 of 12 casual left".',
      'An approval tells you the balance: "Has 2 days casual left · this is 3 days, 1 over", and offers **Approve, 1 day unpaid** — the covered days stay as asked and the rest becomes approved unpaid leave, which payroll already cuts.',
      'Days off inside a leave are not counted. A half day is 0.5.',
      'Your team asks for leave from **Attendance & leave → Ask for leave**.',
    ],
  },
  {
    key: 'payroll',
    title: 'Salaries and payslips',
    area: 'Team',
    menu: 'Team → Pay → Payroll',
    to: '/payroll',
    video: 'salaries',
    body: [
      'Run the month and the app works out each salaried person\'s pay from their attendance and their approved leave, then gives you a payslip per person.',
      'Unpaid leave and half days are already taken off.',
      'Shoot payouts for freelancers are separate, on **Team payouts**.',
    ],
  },
  {
    key: 'team-performance',
    title: 'Performance',
    area: 'Team',
    menu: 'Team → People → Performance',
    to: '/team/performance',
    body: [
      'How each person is doing: shoots done, edits handed in on time, tasks closed, attendance.',
      'Each person sees their own on **My performance**.',
    ],
  },
  {
    key: 'team-terms',
    title: 'Crew terms',
    area: 'Team',
    menu: 'Settings → Team → Team terms',
    to: '/settings/team-terms',
    body: [
      'The terms your crew agrees to — what they are booked for, what they are paid, what happens if they cancel.',
      'Set them once here and a booked person is asked to agree on their own login.',
    ],
  },

  // ── Reports and alerts ──────────────────────────────────────
  {
    key: 'reports',
    title: 'Reports',
    area: 'Reports',
    menu: 'Reports',
    to: '/reports',
    body: [
      'The studio in numbers for a period: bookings and what they are worth, money in and out, which sources bring you work, how your team is carrying it.',
      'Lead-specific reports — the funnel, the team table and the forecast — are on **Leads → Reports**.',
    ],
  },
  {
    key: 'alerts',
    title: 'Alerts and reminders',
    area: 'Reports',
    menu: 'The bell in the top bar',
    to: '/notifications',
    body: [
      'The bell carries your unread count and the latest few; tap one to go where it points.',
      'You are told when a client accepts a quotation, when an editor hands work in, when an invoice goes overdue, when a follow-up is due, and when your payment details are changed.',
      'An alert still unread after a while is emailed to you as well.',
      'The top bar also shows what is due — "1 late" in red or "3 due soon" in amber — hidden when nothing is close.',
    ],
  },
  {
    key: 'morning-email',
    title: 'The morning email',
    area: 'Reports',
    body: [
      'At 8 am you get the day in an email: today\'s shoots, the calls worth making, invoices gone overdue, and leads going cold.',
      'To stop it, use the link at the bottom of the email.',
    ],
  },
  {
    key: 'activity',
    title: 'Activity: who changed what',
    area: 'Settings',
    menu: 'Settings → Team → Activity',
    to: '/activity',
    body: [
      'Every change of consequence, with who made it and when — a price edited, a booking released, someone\'s pay details changed, a lead deleted.',
      'Values that are nobody else\'s business are not recorded, only the fact that the field changed.',
    ],
  },

  // ── Settings ────────────────────────────────────────────────
  {
    key: 'settings-where',
    title: 'Settings: the six groups',
    area: 'Settings',
    menu: 'Settings',
    to: '/settings/company',
    body: [
      'Settings is a list down the side, not a row of tabs: **Studio**, **Team**, **Projects**, **Leads**, **Money**, **Messages & lists**.',
      'Studio holds your company profile, your theme and branding, and attendance. Team holds roles, crew terms and activity. Projects holds templates, documents and delivery stages. Leads holds forms, sources and referrals. Money holds invoicing, vendors and your plan. Messages & lists holds messaging, WhatsApp and your lists.',
    ],
  },
  {
    key: 'studio-profile',
    title: 'Your studio name, logo and packages',
    area: 'Settings',
    menu: 'Settings → Studio → Company profile',
    to: '/settings/company',
    video: 'studio',
    body: [
      'Your studio name, your logo, your address and the contact details printed on your documents.',
      'The logo is an upload, under 1 MB, saved the moment it lands — there is no link box.',
      'Your saved packages live here too: the shapes you quote from, so a quotation is a few taps.',
      'Colours and the look of your documents are under **Theme & branding**.',
    ],
  },
  {
    key: 'lists',
    title: 'Lists',
    area: 'Settings',
    menu: 'Settings → Messages & lists → Lists',
    to: '/settings/lookups',
    body: [
      'Every list the app offers you a choice from, in one place: event types, lead stages and sources, qualities, labels, expense categories, deliverable types, crew roles.',
      'You can also add to any of these from the picker where you use it — type your own word and it joins the list for the whole studio.',
      'Each one carries a colour, which is what makes a screen readable at a glance.',
    ],
  },
  {
    key: 'messaging',
    title: 'Messaging: WhatsApp and email',
    area: 'Settings',
    menu: 'Settings → Messages & lists → Messaging',
    to: '/settings/messaging',
    body: [
      'What the app sends on your behalf, and the wording of each message.',
      'Messages come out of your message credits. Email in your own studio\'s name is part of the top plan — Settings → Money → Plan & billing says what yours includes.',
      'Automatic follow-up sequences are set up here, and a sequence never sends to a lead someone is already talking to.',
    ],
  },
  {
    key: 'whatsapp-own-number',
    title: 'Using your own WhatsApp number',
    area: 'Settings',
    menu: 'Settings → Messages & lists → WhatsApp',
    to: '/help/whatsapp',
    body: [
      'Messages can go out from your studio\'s own WhatsApp number instead of a shared one. It takes about 30 minutes, once. Settings → Money → Plan & billing says whether your plan includes it.',
      'You need a number that is **not** currently on the WhatsApp or WhatsApp Business app — if it is, delete that account first, or use a fresh number.',
      'Then: open a Meta Business account, connect (the easy way is the guided flow; the manual way is making your own Meta app), copy the two IDs it gives you, make a permanent token, point the webhook at us so replies come back in, and submit your templates before going live.',
      'The full step-by-step is on the WhatsApp setup page.',
    ],
  },
  {
    key: 'refer-a-studio',
    title: 'Referring another studio',
    area: 'Settings',
    menu: 'Settings → Money → Refer a studio',
    to: '/settings/refer-a-studio',
    body: [
      'You get a link to share, with Copy and a WhatsApp share button, and a list of the studios that joined through it: on trial, on a paid plan, rewarded, or not counted.',
      'What a referral earns you is shown on that page.',
    ],
  },
  {
    key: 'referrals-clients',
    title: 'Asking a client for a referral',
    area: 'Settings',
    menu: 'Project → Wishes → Referrals',
    body: [
      'Ask a happy client to pass your name on, per project, and see who came from whom.',
      'It is a tab on the project rather than a card on the Overview, so asking is something you choose to do.',
    ],
  },
  {
    key: 'wishes',
    title: 'Wishes: birthdays and anniversaries',
    area: 'Settings',
    menu: 'Project → Wishes',
    body: [
      'Your clients\' dates, so you can send a wish on the day. The wedding shoot fills in the anniversary by itself.',
      'If a client\'s dates are missing, the tab offers to ask them to fill them in.',
    ],
  },
  // ── Plans ───────────────────────────────────────────────────
  {
    key: 'plans-trial',
    title: 'The free trial',
    area: 'Plans',
    menu: 'Settings → Money → Plan & billing',
    to: '/settings/subscription',
    body: [
      'Everything works during the trial — there are no limits on it.',
      'An IPC Diamond member gets 30 days from sign-up; otherwise it is 7 days.',
      'You are emailed before access ends — a week before, the day before, and once when it has ended.',
      'Nothing you have made is ever deleted when a trial ends. Your work waits for you.',
    ],
  },
  {
    key: 'plans-prices',
    title: 'What it costs',
    area: 'Plans',
    menu: 'Settings → Money → Plan & billing',
    to: '/settings/subscription',
    body: [
      'An IPC Diamond member pays ₹1,999 a month, ₹18,000 a year, or ₹33,000 for two years.',
      'Everyone else pays ₹1,00,000 a year.',
      'All of those are before 18% GST.',
      'Your own page shows only the plans you can buy, with the exact amount including GST, so **Settings → Money → Plan & billing** is the figure to go by.',
    ],
  },
  {
    key: 'plans-diamond',
    title: 'IPC Diamond membership',
    area: 'Plans',
    menu: 'Settings → Money → Plan & billing',
    to: '/settings/subscription',
    body: [
      'A member of the "IPC Diamonds - Premium" WhatsApp group gets the member prices and 30 days to try the app.',
      'Prove it with a screenshot of that group on the verify card. It is checked automatically, and a person looks at anything the check cannot read.',
      'Until a claim is approved you see the ordinary price.',
    ],
  },
  {
    key: 'plans-upgrade',
    title: 'Changing or renewing a plan',
    area: 'Plans',
    menu: 'Settings → Money → Plan & billing',
    to: '/settings/subscription',
    body: [
      'Moving up part-way through only costs the difference — what is left of what you paid comes off the price — and the new plan year starts that day.',
      'Moving down waits until the plan you are on ends.',
      'Your plan year follows the day you paid, not the calendar: pay on 15 October and it runs to 15 October.',
      'For anything about your own bill, a refund, or ending a plan, ask for a call — that is not something to settle with an assistant.',
    ],
  },
  {
    key: 'plans-ends',
    title: 'When access ends',
    area: 'Plans',
    menu: 'Settings → Money → Plan & billing',
    to: '/settings/subscription',
    body: [
      'Nothing is deleted. You can still sign in and reach your plan page to pay.',
      'Once you pay, everything is exactly as you left it.',
    ],
  },

  // ── Problems ────────────────────────────────────────────────
  {
    key: 'problem-failed-to-fetch',
    title: '"Failed to fetch", or the app will not load',
    area: 'Problems',
    body: [
      'The app cannot reach its server. It is almost never your account.',
      'Try a different connection first — a phone hotspot instead of office Wi-Fi. Some home and office providers block the address the app talks to, and that is the commonest cause.',
      'If it works on the hotspot and not on Wi-Fi, it is that network. If it fails on both, tell us and we will check the server.',
    ],
  },
  {
    key: 'problem-signed-out',
    title: 'Was I signed out?',
    area: 'Problems',
    body: [
      'You should not be. A session keeps sliding: every time you open the app it is pushed 90 days on.',
      'It ends only if you sign out, your password is changed, you are removed from the studio, or you do not open the app for 90 days.',
      'If you were asked to sign in again without one of those happening, tell us — it is worth looking at.',
    ],
  },
  {
    key: 'problem-team-cannot-sign-in',
    title: 'A team member cannot sign in',
    area: 'Problems',
    body: [
      'Check it with **Team → People → the row menu → Sign-in details**: the email there is only a username and may be one you made up, so it must be typed exactly.',
      'Set a fresh password there and send it to them.',
      'If they are told "Your sign-in for your studio has been turned off", they have been switched off or removed — turn them back on from their row.',
      'Your team is never asked to confirm an email, so a missing confirmation email is not the problem.',
    ],
  },
  {
    key: 'problem-logo',
    title: 'My logo is not showing',
    area: 'Problems',
    body: [
      'Upload it again from **Settings → Studio → Company profile**, and keep it under 1 MB.',
      'It saves the moment it lands — there is no separate Save.',
      'A PNG or JPG works. If it still does not appear on your documents, tell us.',
    ],
  },
  {
    key: 'problem-whatsapp',
    title: 'A WhatsApp message did not go',
    area: 'Problems',
    body: [
      'Check your message credits first — sending stops when they run out.',
      'If you are on your own WhatsApp number, check **Settings → Messages & lists → WhatsApp**: the card says whether the connection is live and what the last error was.',
      'A brand new template has to be approved by Meta before it can be sent.',
    ],
  },
  {
    key: 'problem-facebook-leads',
    title: 'Facebook leads are not arriving',
    area: 'Problems',
    body: [
      'Open **Settings → Leads → Lead sources** and look at the Facebook card. If it says the connection expired, press Connect with Facebook again.',
      'Check the Page the ad runs on is one you ticked — Facebook only lists the Pages you picked in its dialog.',
      'If the card looks healthy and a lead you can see in Facebook never arrived, tell us the form and the time and we will trace it.',
    ],
  },
  {
    key: 'problem-email',
    title: 'A client did not get our email',
    area: 'Problems',
    body: [
      'Ask them to look in spam first.',
      'Then check the address on the client — a typo is the usual answer.',
      'Every send is recorded on our side, so if the address is right and it is not in their spam, tell us and we will tell you what the email service answered.',
    ],
  },
  {
    key: 'problem-amounts-hidden',
    title: 'All my amounts show as ₹ ••••',
    area: 'Problems',
    body: [
      'That is the eye in the top bar — amounts are hidden on purpose, for when a client is beside you.',
      'Press it again to show them. The setting follows you to every device, which is why it is still on after you switch computers.',
    ],
  },
  {
    key: 'problem-attendance',
    title: 'Attendance is not marking',
    area: 'Problems',
    body: [
      'Check it is switched on at all: **Settings → Studio → Attendance**. While it is off nobody is marked.',
      'Marking only happens inside the radius of the place you set, so check the place and widen the radius if your office is big.',
      'The phone must allow location. A very rough fix is refused rather than guessed at.',
      'On a shoot day attendance comes from **I\'ve reached** on the booking, not from the office location.',
    ],
  },
  {
    key: 'problem-two-numbers',
    title: 'Two screens show different money',
    area: 'Problems',
    body: [
      'Usually one is counting a promise and the other counting money actually received — only a payment marked **paid** is money.',
      'The other common reason is the period: the money pages share one date range, and Invoices deliberately keep their own.',
      'Where the app knows two numbers disagree it says why and offers the one-tap fix. If you find two that disagree with no explanation, that is worth telling us about.',
    ],
  },
]
