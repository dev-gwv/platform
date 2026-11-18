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
  /**
   * The words a studio types, where they differ from the words we wrote.
   *
   * Scored by the assistant's retrieval, never shown. This is where lexical
   * search earns or loses: somebody asking "how do I add staff" must reach the
   * article called "Adding your team", and no amount of ranking gets there
   * without the synonym. We own the corpus, so we write them in rather than
   * reaching for embeddings to solve it.
   *
   * Include the Hinglish a studio actually uses ("paisa", "shaadi"), the old
   * app's words, and the plain-English near-misses. Do not repeat words already
   * in the title -- those are scored anyway.
   */
  keywords?: readonly string[]
  /** Short paragraphs or steps. */
  body: readonly string[]
}

export const KB: readonly KbArticle[] = [
  // ── Start: what the thing is ────────────────────────────────
  {
    key: 'what-it-is',
    title: 'What Studio AutoPilot is',
    area: 'Start',
    keywords: ['software', 'app', 'crm', 'overview', 'features'],
    body: [
      'Studio AutoPilot runs a photography or wedding studio from the first enquiry to the last payment.',
      'It holds your enquiries and follow-ups, your clients, your projects with their shoot days and deliverables, the crew you book for each day, the editing work and who has it, your invoices and the money in and out, and your team: attendance, leave and pay.',
      'The menu down the left is the order of the work: **Home**, **Leads**, **Clients**, **Projects**, **Shoots**, **Post-Production**, **Photo sharing**, **Tasks**, **Data & Backup**, **Money**, **Team**, **Reports**, **AI**, **Settings**. The owner also has **Plan & billing** just above Settings.',
      'Making something new is the **+ New** button in the top bar: a lead, a project, a payment received or an expense.',
    ],
  },
  {
    key: 'getting-started',
    title: 'Setting up a new studio',
    area: 'Start',
    menu: 'Home',
    to: '/dashboard',
    keywords: ['setup', 'set up', 'start', 'onboarding', 'first time', 'new studio'],
    body: [
      'A new studio starts on step 1: **Add your team**. The button opens the bulk list so you can put everyone in at once.',
      'Then add a client, then create your first project. Those three steps show once, in the setup bar at the top.',
      'Your email is never a gate — you can use everything before confirming it.',
      'The first card on an owner\'s Home is **Set up Studio AutoPilot, step by step**: six short videos (create your account, add your team, add your first client, create your first project, send the quotation, make it yours), each ticked by itself once done, with **Watch** and **Do this now**. The same steps are at studioautopilot.in/start.',
      'After setup, Home shows **Getting started**: five steps that tick themselves as you do them (logo and name, a saved package, a first enquiry, a booking with shoot days, a quotation sent). It closes itself at five of five, or after 60 days.',
    ],
  },
  {
    key: 'learn-and-help',
    title: 'The guide, the videos and getting a person',
    area: 'Start',
    menu: 'Help, at the foot of the menu',
    to: '/learn',
    keywords: ['support', 'support call', 'contact', 'tutorial', 'video', 'stuck', 'training', 'call', 'person', 'demo', 'setup call'],
    body: [
      'To talk to a person, press **Book a support call** (the teal button with the headphones) and pick a time that suits you. It is in the top bar as **Support call** on every page, in **Help** at the bottom of the menu, in the round help button in the corner, on **Plan & billing** and on **Getting started**. Everyone signed in sees it.',
      'Press **Help** at the bottom of the menu. It also has **WhatsApp us** and **Email us**, with your studio, your name and the page you are on already written into the message — you only press Send.',
      '**How to use Studio AutoPilot** is the whole app step by step with a short video for each job, in English and Hindi.',
      'Most screens also have **Watch how** beside the page title, which plays the recording for that screen.',
    ],
  },
  {
    key: 'assistant-language',
    title: 'Asking the assistant, in English or Hindi',
    area: 'Start',
    menu: 'Ask for help, in the top bar',
    keywords: ['assistant', 'ai', 'chat', 'language', 'bhasha', 'hindi', 'hinglish', 'english', 'ask'],
    body: [
      'Press **Ask for help** (the sparkle in the top bar), or the round help button in the corner, and type your question in your own words.',
      'The first time, it asks which language to answer in: **English**, **हिन्दी**, or **Hinglish** (Hindi in English letters). It remembers your choice on every device.',
      'To change it, press **English**, **हिन्दी** or **Hinglish** under the question box. Button and menu names always stay in English, because that is what the screen shows.',
      'It answers from this help only and cannot see your studio\'s data. When it cannot help, it offers **Book a support call**.',
    ],
  },

  {
    key: 'ai-tools',
    title: 'The AI tools',
    area: 'Start',
    menu: 'AI',
    to: '/ai',
    keywords: ['ai', 'artificial intelligence', 'write for me', 'designer', 'quotation design', 'canva', 'caption', 'instagram', 'ad script', 'reel script', 'meta ad', 'teleprompter', 'reply with ai'],
    body: [
      '**AI** in the menu has one card per tool: **Quotation Designer** (a premium quotation on six looks, filled from a project, sent as a link or PDF), **Ad scripts** (a Meta ad a model reads to camera, with a **Teleprompter**), **Social media captions** (Instagram, Facebook or WhatsApp status), **Follow-up sequences**, **Reply to a lead** and **Referral cards**.',
      'In the designer, **Write it for me** writes a page\'s words in a tone you pick. A project\'s quotation page has **Premium design** to start one for that project.',
      'The AI never invents prices or numbers; you check and edit every word before it goes anywhere. Starter makes 30 designs a plan year.',
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
    keywords: ['enquiry', 'enquiries', 'inquiry', 'prospect', 'pipeline', 'funnel', 'board'],
    body: [
      'Every enquiry is a lead, on a board of columns you name yourself — your stages, your colours.',
      'A lead carries as many **labels** as you like, one **quality** (hot, warm, cold — hot ranks your call list), a source, and as many events as the booking has.',
      'Open a lead to see everything about it and its whole history. **Book it** turns it into a project; **Lost** asks for a reason so the reports can tell you why bookings go.',
      'A lead can start with just a name. A lead with no number shows "Add their number" in amber, and **Book it** asks for the number in its own box.',
      'The top of the lead shows **Given to** someone (amber "Give to someone" while nobody has it). Only that person is told "New lead for you" in their bell, and they work it on **My leads** if they have no CRM access.',
      '**Reply with AI** beside WhatsApp in the lead writes one WhatsApp reply for you, in English, Hindi or Hinglish; you edit it, then open WhatsApp or copy it.',
    ],
  },
  {
    key: 'leads-add',
    title: 'Adding a lead, and where leads come from',
    area: 'Leads',
    menu: 'Leads → Add lead',
    to: '/follow-ups',
    keywords: ['new enquiry', 'create lead', 'capture', 'walk in', 'phone enquiry'],
    body: [
      'Press **Add lead** and fill in what you know — a name or a number is enough.',
      'Leads also arrive on their own: from your enquiry form and its QR codes (your own, a partner\'s, or a wedding QR), from Facebook lead ads, and from WhatsApp.',
      'To bring in many at once, or to download them as Google Sheets, Excel or CSV, use **Leads → More → Import leads** or **Download leads**.',
      'If the number is already in your CRM, it finds that lead instead of making a second one.',
      'On Starter you can hold 30 leads at a time, from every source. Archive or delete a lead you no longer need to make room, or move to Pro for no limit.',
    ],
  },
  {
    key: 'leads-stages',
    title: 'Changing your lead stages',
    area: 'Leads',
    menu: 'Leads → the column menu, or "+ Add stage"',
    to: '/follow-ups',
    keywords: ['column', 'pipeline stage', 'status', 'kanban'],
    body: [
      'Stages are yours. Add, rename, recolour, reorder or hide one from the board — use the menu on a column heading, or the **+ Add stage** column at the end.',
      'You can also change a lead\'s stage from the stage picker inside the lead.',
      'The same is true of every list in the app: qualities, sources, labels, event types, follow-up types. Type your own word in the picker and it joins the list for everyone in the studio.',
    ],
  },
  {
    key: 'leads-follow-ups',
    title: 'Follow-ups and today\'s calls',
    area: 'Leads',
    menu: 'Leads → Today\'s calls | Follow-ups',
    to: '/follow-ups/queue',
    keywords: ['callback', 'remind', 'chase', 'call list', 'pending calls', 'call queue', 'follow up board', 'overdue follow up'],
    body: [
      'A follow-up is a task on a lead with a date and a priority. The lead shows the next one due, and turns amber once it is past.',
      '**Today\'s calls** is the day\'s calls in the order worth making — hot leads first, then how long someone has been waiting — with any follow-up promised for today on its lead\'s row.',
      '**Follow-ups** (with an amber "2 late") is every follow-up on one board, in columns from Overdue to Later. Each card has **Call**, **WhatsApp**, a button to move it to the next day, and **Done**; Everyone / Mine picks whose.',
      'Only the person whose follow-up it is gets reminded: in the bell 15 minutes before, and on screen until they act. Leads also shows an amber **not contacted yet** count that opens just those.',
    ],
  },
  {
    key: 'leads-send',
    title: 'Changing many leads at once, and Send now',
    area: 'Leads',
    menu: 'Leads → tick leads for the bulk bar',
    to: '/follow-ups',
    keywords: ['bulk message', 'broadcast', 'blast', 'mass message', 'bulk', 'select many', 'send now'],
    body: [
      'Tick leads on the board or the list to get the bulk bar: move the stage, set labels, quality or owner, **Give to…** someone, or delete, all at once. There is no message to all of them from here.',
      '**Send now** is the list of messages your follow-up sequences wrote. Each waits for one tap, which opens WhatsApp or mail with the words typed in, from your own phone.',
      'Your own WhatsApp number sending by itself is part of Studio Max — **Plan & billing** says what yours includes.',
    ],
  },
  {
    key: 'leads-reports',
    title: 'Lead reports: funnel, team and forecast',
    area: 'Leads',
    menu: 'Leads → More → Reports',
    to: '/follow-ups/reports',
    keywords: ['conversion', 'funnel', 'source performance', 'win rate', 'lost reason'],
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
    menu: 'Leads → More → Setup',
    to: '/follow-ups/setup',
    keywords: ['assignment', 'round robin', 'distribute', 'sla', 'auto assign', 'rotation'],
    body: [
      'Set how long a new lead may wait before first contact and still count as on time.',
      'Choose how new leads are shared out: to one person, or round-robin across your team. The rota counts each person\'s open leads, not every lead they have ever had.',
      'This is also where your stages, sources and follow-up sequences live. **AI → Follow-up sequences** writes a sequence for you to check and save.',
    ],
  },
  {
    key: 'enquiry-forms',
    title: 'Your enquiry form and QR codes',
    area: 'Leads',
    menu: 'Leads → Enquiry form & QR (also Settings → Leads → Forms)',
    to: '/follow-ups/form',
    video: 'enquiry-form',
    keywords: ['qr code', 'website form', 'embed', 'vendor', 'landing', 'contact form', 'enquiry form', 'scan'],
    body: [
      'Every studio has one main enquiry form with its own link and QR. Open it from **Enquiry form & QR** in the Leads header. The page has the on/off switch and **Add partner**, then chips: **Your QR code**, **Wedding QR codes**, **Partners**, **After they send**, **Questions**.',
      '**Your QR code** shows the print card with **Download for print (HD)**, the link with WhatsApp, Copy link and Open form, and **Copy code** to put the form on your website.',
      '**Questions** sets what the form asks (name and mobile always). **After they send** sets what the client sees next: a WhatsApp chat with you (the default), a thank-you, or a link.',
      'Every form sent makes a lead. The same number while its lead is open never makes a second lead; a note "Enquired again" goes on it.',
    ],
  },
  {
    key: 'enquiry-partners',
    title: 'Partner QR codes for vendors and shops',
    area: 'Leads',
    menu: 'Leads → Enquiry form & QR → Partners',
    to: '/follow-ups/form',
    keywords: ['partner', 'vendor qr', 'venue', 'decorator', 'shop', 'flex', 'counter', 'via', 'make qr'],
    body: [
      '**Add partner** gives a shop or vendor its own QR to keep at its counter (or **Make QR** on a vendor). A lead from it reads **via** that partner, and Leads has a partners filter.',
      'Each partner can have its own after-send (or **Same as your main form**), what the QR is for, and up to ten questions of its own, and the answers show on the lead.',
      'Each partner row says its scans, enquiries and bookings. The partner gets a private page with their leads, which they can download.',
    ],
  },
  {
    key: 'wedding-qr',
    title: 'Wedding QR codes',
    area: 'Leads',
    menu: 'Leads → Enquiry form & QR → Wedding QR codes',
    to: '/follow-ups/form',
    keywords: ['wedding qr', 'guests', 'scan to book', 'qr at wedding', 'venue standee'],
    body: [
      'A wedding QR is one you print and place at a client\'s wedding, so guests who liked your work can enquire. **Add wedding QR** asks "Whose wedding?".',
      'Each one has **Download for print (HD)** ("Loved our work? Scan to book us for your wedding") and says its scans, enquiries and bookings. A lead from it reads "via Priya & Rahul\'s Wedding QR".',
    ],
  },
  {
    key: 'lead-sources',
    title: 'Lead sources',
    area: 'Leads',
    menu: 'Settings → Leads → Lead sources',
    to: '/lead-sources',
    keywords: ['instagram', 'referral source', 'channel', 'utm'],
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
    keywords: ['meta', 'fb', 'instagram ads', 'lead ads', 'page', 'social'],
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
    keywords: ['customer', 'couple', 'bride', 'groom', 'family', 'contact', 'party'],
    body: [
      'A client is the couple or family you are shooting for. Add them with **New client**, or let a booking make one.',
      'A client holds their projects, their payments, and their dates — birthdays and anniversaries, which the project\'s **Referrals & wishes → Wishes** uses.',
      'The wedding shoot day fills in the anniversary by itself.',
    ],
  },
  {
    key: 'client-details-form',
    title: 'Letting the client fill in their own details',
    area: 'Clients',
    menu: 'Project → More → Send details form',
    video: 'details-form',
    keywords: ['questionnaire', 'details link', 'client info', 'collect details'],
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
    keywords: ['share link', 'client link', 'client view', 'customer portal'],
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
    keywords: ['event', 'booking', 'job', 'wedding', 'order'],
    body: [
      'A project is one booking — a wedding, a pre-wedding, an event — with its days, its crew, its deliverables and its money.',
      'Every project page has eight tabs: **Overview**, **Quotation**, **Shoots**, **Post-Production** (Work, Work to review, Task Management, Gallery), **Terms**, **Finance** (Billing, Expenses, Cost sheet, Payouts), **Data** and **Referrals & wishes** (Referral card, Wishes).',
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
    keywords: ['create project', 'new booking', 'wizard', 'add event', 'new job'],
    body: [
      'Five steps: **Who it\'s for**, **Event days**, **Deliverables**, **Price** and **Review**.',
      'Each function is asked for its team before you go on. If a day has no shoot requirements yet, you choose **Add shoot requirements now** or **Add them later**.',
      'Each shoot day needs a date, a **Start time** and a **Duration** — your crew\'s hours are planned from them.',
      'The billing step takes one **Advance received (optional)**; any more money is recorded on the project afterwards.',
      'Creating a project always lands you on its quotation.',
    ],
  },
  {
    key: 'projects-overview',
    title: 'The project Overview',
    area: 'Projects',
    keywords: ['summary', 'project home', 'at a glance'],
    body: [
      'Money and work only: what the project is worth, what you have received and what is still to collect, and the editing work with who has each piece.',
      'Received says what share it is ("20% collected"); still to collect says what is promised. With profit access there is a fourth box, **Ongoing margin**, after crew and expenses.',
      'It also lists what the client has done lately — opened the quotation, accepted it, signed the terms.',
    ],
  },
  {
    key: 'quotation',
    title: 'The quotation',
    area: 'Projects',
    menu: 'Project → Quotation',
    video: 'quotation',
    keywords: ['quote', 'estimate', 'proposal', 'pricing document', 'package quote'],
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
    keywords: ['contract', 'agreement', 'signature', 'sign', 'conditions'],
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
    keywords: ['preset', 'reuse', 'standard package', 'task bundle', 'blueprint'],
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
    keywords: ['needs attention', 'overdue projects', 'pending'],
    body: [
      'The projects with something waiting: a day with no crew, work that is late, an unpaid invoice, data not backed up.',
      'Use it as the morning list rather than reading every project.',
    ],
  },
  {
    key: 'project-documents',
    title: 'Terms documents across projects',
    area: 'Projects',
    menu: 'Settings → Projects → Documents',
    to: '/project-documents',
    keywords: ['papers', 'files', 'records', 'documents', 'signed terms'],
    body: [
      'Every terms document you have sent, in one list: Agreed, Waiting, Link closed or Not sent, and the live projects that were never sent terms.',
      'Quotations live on each project\'s **Quotation** tab and invoices on **Money → Invoices**.',
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
    keywords: ['event day', 'function', 'assign', 'crew', 'book team', 'roster', 'call sheet'],
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
    keywords: ['same crew', 'duplicate team', 'repeat team', 'copy crew'],
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
    keywords: ['month view', 'availability', 'clash', 'double booked', 'schedule'],
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
    keywords: ['crew cost', 'freelancer rate', 'day rate', 'per shoot', 'wages'],
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
    menu: 'Project → Post-Production → Work',
    video: 'give-work',
    keywords: ['assign editor', 'allot', 'hand over', 'allocate'],
    body: [
      '**Start editing** on a deliverable with nobody on it asks "Who will edit Wedding Teaser?" — your editors first, each with how much they already have ("2 in hand · 1 late"), the due date filled in, and a line of brief.',
      'Then **Start editing with Nitin**. They see it on their own login.',
      'Tick several cards on the Work tab to give them all out at once.',
    ],
  },
  {
    key: 'editing-board',
    title: 'Post-Production: all the editing work',
    area: 'Editing',
    menu: 'Post-Production',
    to: '/production-board',
    video: 'board',
    keywords: ['kanban', 'production', 'workflow', 'progress', 'production board', 'editing board'],
    body: [
      'Every piece of editing work in the studio. It opens on **People** (what each editor is carrying).',
      'Four views: **People**, **Stages** (columns; drag a card to move it on), **List** (late first, then by due date) and **Tasks**. The teal **Photo gallery** button opens Photo sharing.',
      'Tick cards for the bulk bar. A row with nobody on it says **Give to…**.',
    ],
  },
  {
    key: 'editing-review',
    title: 'Work to review',
    area: 'Editing',
    menu: 'Project → Post-Production → Work to review',
    keywords: ['approve', 'check', 'qc', 'feedback', 'revision', 'changes'],
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
    keywords: ['workflow', 'approval flow', 'review step', 'simple delivery'],
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
    keywords: ['todo', 'to do', 'checklist', 'reminder', 'job list', 'assignments'],
    body: [
      'Tasks are the jobs that are not an edit: book the decorator, order the album, collect the balance.',
      '**Tasks** in the menu is every task in the studio; **My tasks** is your own. A project\'s own tasks are on **Post-Production → Task Management**.',
      'A task has someone on it, a due date and a priority, and the person sees it on their Home for that day.',
      'Add a ready-made set with a task bundle from **Settings → Projects → Templates**.',
    ],
  },
  {
    key: 'daily-tasks',
    title: 'Daily tasks that come back by themselves',
    area: 'Editing',
    menu: 'Tasks → Daily tasks',
    to: '/tasks',
    keywords: ['daily task', 'recurring', 'repeat', 'routine', 'every day', 'roz', 'weekly task', 'monthly task'],
    body: [
      'Press **Daily tasks** on Tasks, then **Add daily task**: what to do, who does it (one or several people), which days (Every day, Mon–Sat, Pick days or Once a month) and **Finish by** (end of the day, 7 pm, or a time).',
      'Each person gets their own copy each day and ticks **Done** on their Home. A copy still open after its time reminds them and whoever set it; the next day an open one is marked not done.',
      'Each card shows today per person (Done today, Still to do, Not done, late) and the last 7 days.',
    ],
  },
  {
    key: 'photo-sharing',
    title: 'Photo sharing: every gallery in one place',
    area: 'Editing',
    menu: 'Photo sharing (in the menu, under Post-Production)',
    to: '/galleries',
    keywords: ['photo sharing', 'photosharing', 'photo share', 'share photos', 'gallery', 'galleries', 'gallery app', 'frameline', 'wedding photos', 'guests', 'pin', 'qr', 'studio app', 'client photos', 'photo delivery'],
    body: [
      '**Photo sharing** is a line of its own in the left menu (the next line after Post-Production, not inside it). It opens every gallery the studio has, with the galleries, photos and visits at the top.',
      'Press **Create a gallery**, pick the wedding (the project), and it makes one gallery for it with a link and a PIN for guests. **How it works** beside it shows the steps.',
      'Each gallery has a card: the client, photos, visits, PIN and when it closes, with **Open gallery** (to upload photos), **WhatsApp** (sends the link and PIN), a copy-link-and-PIN button and a QR to download and print.',
      'Below the cards is **Google Drive**: the owner connects it here, then photos come straight from Drive on a project\'s Gallery tab (Pro and above). The **Studio app** tab opens the gallery app inside Studio AutoPilot; **Open the studio app** sets up the gallery account the first time.',
      'The same gallery is also on each project\'s **Post-Production → Gallery** tab, and the Post-Production page has a teal **Photo gallery** button that opens here.',
    ],
  },
  {
    key: 'project-gallery',
    title: 'A photo gallery for the project',
    area: 'Editing',
    menu: 'Photo sharing → Create a gallery, or a project → Post-Production → Gallery',
    keywords: ['gallery', 'frameline', 'kamero', 'selfie', 'face', 'guests', 'share photos', 'event photos', 'album', 'pin', 'qr', 'upload photos'],
    body: [
      'From **Photo sharing**, press **Create a gallery** and pick the project; or open the project, then **Post-Production → Gallery**, and press **Create gallery**. It makes one gallery for the project, with a link and a PIN for the guests. **See all galleries** goes back to Photo sharing.',
      'Press **Open gallery** to upload the photos. It opens the gallery app already signed in as you, at this project.',
      'Once the photos are up, hand the link and PIN on with **Send on WhatsApp**, or **Download QR** to print. Guests open the link, type the PIN, add their name and number, and can see and download the photos.',
      'The gallery also shows on the client\'s own page, under their progress, once it has photos and until it closes. The first gallery is made by the studio\'s owner; after that anyone who runs projects can. The gallery is an add-on with its own plan, renewed in the gallery app. A gallery deleted there can be made again with **Create gallery**.',
      'Press **How it works** beside the gallery\'s buttons for the steps. Finding your own photos with a selfie is not switched on yet.',
    ],
  },
  {
    key: 'gallery-google-drive',
    title: 'Import photos from Google Drive into the gallery',
    area: 'Editing',
    menu: 'A project → Post-Production → Gallery; connect it on Photo sharing',
    keywords: ['google drive', 'drive', 'gdrive', 'import', 'folder', 'originals', 'full size', 'storage', 'gallery', 'frameline', 'album', 'pro'],
    body: [
      'First the studio\'s owner connects Google Drive once, from the **Google Drive** card on **Photo sharing** (also on **Settings → Messages & lists → Messaging → Gallery**, or **Connect Google Drive** on a project\'s Gallery tab). Google asks to allow it. The gallery app only sees the files you pick. Anyone else reads that the studio owner connects it.',
      'Then open the project\'s **Post-Production → Gallery** and press **Import from Google Drive**. Google\'s own window opens right there: pick folders or photos and press Select.',
      'Check what will come in: each folder becomes an album (type a new name in its box), and RAW camera files, videos and files over 200 MB are left out. Pick **Standard** or **Original files** (full quality, counts double), then press **Import**. Photos already in the gallery are skipped.',
      'The import runs by itself: a line on the Gallery tab shows how many are in, with **Stop**, and you can leave the page. If Google would not let the app look inside a folder, press **Pick again**, open the folder and select the photos in it (Ctrl+A).',
      'Import from Google Drive comes with **Pro** and **Studio Max** (Diamond too) and the free trial, not Starter; on Starter the button shows a lock and **Upgrade**. Galleries, the link, PIN and QR work on every plan.',
      'To keep the full-size photos in your own Drive, turn on **Keep full-size photos in Google Drive** before **Create gallery**.',
    ],
  },
  {
    key: 'gallery-frameline',
    title: 'What the gallery app (Frameline) does',
    area: 'Editing',
    menu: 'A project → Post-Production → Gallery → Open gallery',
    keywords: ['frameline', 'gallery app', 'watermark', 'album', 'couple pin', 'full access', 'expiry', 'renew', 'download', 'visits', 'guests', 'wallet'],
    body: [
      'The photo gallery is Frameline, an add-on with its own plan and wallet. **Open gallery** signs you into it at that project; there you upload photos, make and order albums, add your watermark, set the couple\'s PIN that shows every photo, and renew how long the gallery stays open.',
      'Guests open the link, type the PIN, add their name and number, and view and download the photos. The Gallery tab shows the photos, visits and guests signed up.',
      '**Photo sharing** in the menu lists every project\'s gallery with its link and PIN. **Settings → Messages & lists → Messaging → Gallery** (owner) shows the Frameline plan and wallet, the Google Drive connection, and **Open Frameline**.',
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
    keywords: ['backup', 'copy', 'memory card', 'hard disk', 'drive', 'footage', 'rushes', 'dump'],
    body: [
      'After a shoot, record whose cards came in and which disk they went on.',
      'The dialog is short: who copied it and when, then one line per copy — the disk and whether it is done. Folder or link goes under **+ Folder or link**; type, size, cards, label and notes under **More details**.',
      'It starts from the last person who copied for you and your usual main and backup disks.',
      'A shoot day\'s line reads "Data: 1 of 2 handed in · 1 backed up" once the day has passed, and pressing it while any card is still out opens **Everyone\'s cards** for that day.',
    ],
  },
  {
    key: 'data-locations',
    title: 'Your disks and where they live',
    area: 'Data',
    menu: 'Data & Backup → Locations',
    to: '/data-management/locations',
    keywords: ['disk', 'drive', 'storage', 'hdd', 'ssd'],
    body: [
      'The register of your disks and drives, so "WD Red 03" means the same thing to everyone.',
      'Name them the way they are labelled on the shelf. The dialog suggests the shape, for example WD-001 or SEA-002.',
    ],
  },
  {
    key: 'data-pay-freelancer',
    title: 'Paying a freelancer when their cards come in',
    area: 'Data',
    keywords: ['pay crew', 'settle', 'freelancer payment'],
    body: [
      'For anyone on a shoot payout, the data dialog carries "{name}\'s payout ₹__ · Pay later / Paid ₹X / Part paid", filled in from their booking.',
      'So the usual order is: cards in, then paid, in the same place.',
      '**Everyone\'s cards** (from the amber data line on a past shoot day) has a Paid tick per person.',
    ],
  },

  // ── Money ───────────────────────────────────────────────────
  {
    key: 'money-what',
    title: 'Money: the five tabs',
    area: 'Money',
    menu: 'Money',
    to: '/billing/payments',
    keywords: ['finance', 'accounts', 'billing', 'cash', 'revenue'],
    body: [
      '**Payments** — money in, and what is due.',
      '**Invoices** — the GST invoices you have raised.',
      '**Expenses** — money out.',
      '**Crew payouts** — what you owe your crew, also by project.',
      '**Profit & Loss** — money in and out together for a period.',
      'Payments, Expenses and Profit & Loss (and Reports) share one period switch, so a period you pick on one holds on the next. Invoices keep their own dates, and Crew payouts\' Owed now is always as of today.',
    ],
  },
  {
    key: 'money-record-payment',
    title: 'Recording money received',
    area: 'Money',
    menu: 'Top bar + New → Payment received (or a project\'s Billing tab, or an invoice)',
    to: '/billing/payments',
    keywords: ['record payment', 'add payment', 'received money', 'utr', 'cheque', 'reference', 'move payment'],
    body: [
      'There is one form for money received, wherever you start: **+ New → Payment received**, a project\'s **Finance → Billing**, an invoice, or **Money → Payments**.',
      'It asks the amount, the date and the reference (UTR or cheque number).',
      'Editing a payment can move it to another of the client\'s invoices, or off an invoice; the amount stays the same.',
    ],
  },
  {
    key: 'money-invoice-changes',
    title: 'Changing, reopening or signing an invoice',
    area: 'Money',
    menu: 'Money → Invoices → an invoice',
    to: '/billing/invoices',
    keywords: ['edit invoice', 'change invoice', 'cancel invoice', 'reopen', 'draft', 'delete invoice', 'signature', 'signatory', 'invoice number change'],
    body: [
      'An invoice can be edited whatever is paid on it (lines, client, dates and its number) as long as its total stays at or above the money already received.',
      'A cancelled invoice has **Reopen invoice**; a sent invoice with no payment has **Move back to draft**; **Delete** works only while no payment is on it.',
      'Who signs it is set on the invoice: **Edit signature** beside "Authorised signatory" (or the **Signature** box in the invoice form) takes a name, a title and a drawn or uploaded signature, used on every invoice.',
    ],
  },
  {
    key: 'money-payments',
    title: 'Payments received, and what is due',
    area: 'Money',
    menu: 'Money → Payments',
    to: '/billing/payments',
    video: 'payments',
    keywords: ['received', 'collection', 'advance', 'balance', 'paid', 'receipt', 'due'],
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
    keywords: ['bill', 'gst invoice', 'tax invoice', 'raise invoice'],
    body: [
      'Make a GST invoice from a project, or from scratch with **New invoice**.',
      'If you have already taken an advance, tick it under "Already received for this project" — it is linked to the invoice so nothing is counted twice.',
      'Send the client a link, or print it. Numbering and your GST number are on **Settings → Studio → Company profile**; the invoice designs and terms are on **Settings → Money → Invoicing**.',
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
    keywords: ['spend', 'cost', 'purchase', 'outgoing', 'kharcha'],
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
    keywords: ['profit', 'loss', 'margin', 'earnings', 'income statement'],
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
    keywords: ['project cost', 'profitability', 'costing'],
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
    menu: 'Money → Crew payouts (also Team → Pay → Team payouts)',
    to: '/money/crew-payouts',
    video: 'payouts',
    keywords: ['crew payment', 'freelancer pay', 'settle crew', 'owed', 'crew payouts', 'by project'],
    body: [
      'The **By project** view shows each project\'s crew payouts, paid, owed now and after the shoot, with **Pay**. A project\'s **Finance → Cost sheet** shows who is paid and has **Pay the team**.',
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
    keywords: ['upi', 'bank account', 'account number', 'payment details'],
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
    keywords: ['hide price', 'privacy', 'blur', 'mask'],
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
    keywords: ['tax settings', 'invoice design', 'invoice terms', 'gst breakdown', 'bank details'],
    body: [
      'Your invoice designs (what each shows: the GST header, the GST breakdown, bank details) and the default terms and notes, plus **Saved items**, the packages you quote and invoice from.',
      'How invoices are numbered and your GST number are on **Settings → Studio → Company profile**.',
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
    keywords: ['supplier', 'printer', 'decorator', 'payee'],
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
    keywords: ['staff', 'employees', 'people', 'members', 'crew list'],
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
    keywords: ['staff', 'employee', 'new member', 'hire', 'add person', 'photographer', 'editor'],
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
    menu: 'Team → People → the row menu → Sign-in details (or Give a login)',
    keywords: ['password', 'username', 'sign in', 'access', 'credentials', 'give a login'],
    body: [
      'Your team needs no real email. Any email, even one you make up, is only a username: they sign in with it and the password you set.',
      'Nothing ever asks your team to confirm an email.',
      'For someone with no login yet, the row menu says **Give a login**. For someone who has one it says **Sign-in details**: it sets or changes their email and password and fixes a mistyped address, and it signs them out everywhere.',
      'Everyone changes their own password on **My profile**.',
    ],
  },
  {
    key: 'team-what-staff-see',
    title: 'What your team sees on their own login',
    area: 'Team',
    video: 'team-day',
    keywords: ['employee view', 'staff app', 'permissions view'],
    body: [
      'A team member sees their own work, not the studio\'s: their shoots, their edits, their tasks, the leads given to them, their attendance, their leave and their pay.',
      'Their menu is **Home · My work · My shoots · Attendance & leave · My leads · My payouts · My performance** (Attendance only while the studio has it on).',
      'They never see your money, your margins or a client\'s phone number.',
      'Their Home is their day: the attendance card, then **Today** in time order with one action per line (a shoot: **Confirm** or **I\'ve reached**; a task: **Start** or **Submit**; an edit: **I\'ve started**; cards: **Hand over**; a call given to them: **Call** or **Done**), then what is coming up in the next 7 days.',
      'Leads given to them are worked on **My leads**: Call, WhatsApp, the next follow-up and a note.',
      'Someone who runs projects for you can be widened through **Manage access**.',
    ],
  },
  {
    key: 'roles-access',
    title: 'Roles & access: who can see what',
    area: 'Team',
    menu: 'Settings → Team → Roles & access',
    to: '/settings/roles',
    keywords: ['permission', 'rights', 'restrict', 'admin', 'privileges'],
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
    keywords: ['present', 'absent', 'check in', 'punch', 'location', 'gps', 'haazri'],
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
    menu: 'Team → Attendance & leave → Leave & holidays',
    to: '/leave',
    video: 'leave',
    keywords: ['holiday', 'off', 'chutti', 'casual leave', 'sick', 'balance'],
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
    keywords: ['salary', 'payslip', 'wages', 'monthly pay', 'tankhwah'],
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
    keywords: ['scorecard', 'rating', 'productivity'],
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
    keywords: ['crew contract', 'freelancer agreement'],
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
    keywords: ['analytics', 'insights', 'numbers', 'statistics', 'mis'],
    body: [
      'The studio in numbers for a period: bookings and what they are worth, money in and out, which sources bring you work, how your team is carrying it.',
      'Lead-specific reports — the funnel, the team table and the forecast — are on **Leads → More → Reports**.',
    ],
  },
  {
    key: 'alerts',
    title: 'Alerts and reminders',
    area: 'Reports',
    menu: 'The bell in the top bar',
    to: '/notifications',
    keywords: ['notification', 'bell', 'reminder', 'ping', 'unread'],
    body: [
      'The bell carries your unread count and the latest few; tap one to go where it points.',
      'You are told when a client accepts a quotation, when an editor hands work in, when an invoice goes overdue, when a follow-up is due, and when your payment details are changed.',
      'Alerts stay in the bell; the app sends no email copy of them.',
      'The top bar also shows what is due — "1 late" in red or "3 due soon" in amber — hidden when nothing is close.',
    ],
  },
  {
    key: 'morning-email',
    title: 'Emails the app sends',
    area: 'Reports',
    keywords: ['daily email', 'digest', 'summary email', 'morning email', 'monday email', 'weekly email', 'automatic email', 'no email'],
    body: [
      'The app sends no email by itself: no morning or Monday summary, no "your plan is ending", no copies of alerts.',
      'An email goes only when someone presses for it: your own email confirmation or password reset, a team invite, or a quotation, invoice, receipt or terms someone pressed **Send** on.',
      'Your day is on **Home** and in the bell instead.',
    ],
  },
  {
    key: 'activity',
    title: 'Activity: who changed what',
    area: 'Settings',
    menu: 'Settings → Team → Activity',
    to: '/activity',
    keywords: ['audit', 'log', 'history', 'trail'],
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
    keywords: ['configuration', 'options', 'preferences'],
    body: [
      'Settings is a list down the side, not a row of tabs: **Studio**, **Team**, **Projects**, **Leads**, **Money**, **Messages & lists**.',
      'Studio holds your company profile, your theme and branding, and attendance. Team holds roles, crew terms and activity. Projects holds templates, documents and delivery stages. Leads holds forms, sources and referrals. Money holds invoicing, vendors, and Plan & billing (with Refer a studio). Messages & lists holds **Messaging** (Messages · WhatsApp · Gallery) and **Lists** (Lists · System).',
    ],
  },
  {
    key: 'studio-profile',
    title: 'Your studio name, logo and packages',
    area: 'Settings',
    menu: 'Settings → Studio → Company profile',
    to: '/settings/company',
    video: 'studio',
    keywords: ['logo', 'company name', 'branding', 'address', 'letterhead', 'package', 'gst number', 'invoice number', 'numbering', 'prefix'],
    body: [
      'Your studio name, your logo, your address and the contact details printed on your documents.',
      'The logo is an upload, under 1 MB, saved the moment it lands — there is no link box.',
      '**How invoices are numbered** is here too: a running number (INV-0042), by the invoice date, or typed by you on each invoice.',
      'Colours and the look of your documents are under **Theme & branding**.',
      'Your saved packages, the items you quote and invoice from, are on **Settings → Money → Invoicing → Saved items**.',
    ],
  },
  {
    key: 'lists',
    title: 'Lists',
    area: 'Settings',
    menu: 'Settings → Messages & lists → Lists',
    to: '/settings/lookups',
    keywords: ['dropdown', 'options', 'picklist', 'custom field', 'categories', 'master'],
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
    keywords: ['whatsapp', 'sms', 'email', 'templates', 'automation', 'sequence', 'wallet', 'recharge', 'credits'],
    body: [
      'What the app sends on your behalf, and the wording of each message. The **Wallet** tab shows the messaging wallet; a message that says **Recharge to send** waits until it is topped up.',
      'Follow-up sequences are made on **Leads → More → Setup**. Their messages wait in **Send now** for one tap, and a reply from the lead stops the sequence.',
      'The **Gallery** tab (owner) shows your photo gallery account, its plan and wallet, and **Open Frameline**.',
    ],
  },
  {
    key: 'whatsapp-own-number',
    title: 'Using your own WhatsApp number',
    area: 'Settings',
    menu: 'Settings → Messages & lists → WhatsApp',
    to: '/help/whatsapp',
    keywords: ['own number', 'business api', 'meta app', 'waba', 'sender'],
    body: [
      'Messages can go out from your studio\'s own WhatsApp number instead of a shared one. It takes about 30 minutes, once. **Plan & billing** says whether your plan includes it.',
      'You need a number that is **not** currently on the WhatsApp or WhatsApp Business app — if it is, delete that account first, or use a fresh number.',
      'Then: open a Meta Business account, connect (the easy way is the guided flow; the manual way is making your own Meta app), copy the two IDs it gives you, make a permanent token, point the webhook at us so replies come back in, and submit your templates before going live.',
      'The full step-by-step is on the WhatsApp setup page.',
    ],
  },
  {
    key: 'refer-a-studio',
    title: 'Referring another studio',
    area: 'Settings',
    menu: 'Plan & billing → Refer a studio (also Settings → Money → Plan & billing)',
    to: '/settings/refer-a-studio',
    keywords: ['referral', 'invite studio', 'affiliate', 'reward'],
    body: [
      'You get a link to share, with Copy and a WhatsApp share button, and a list of the studios that joined through it: on trial, on a paid plan, rewarded, or not counted.',
      'What a referral earns you is shown on that page.',
    ],
  },
  {
    key: 'referrals-clients',
    title: 'Asking a client for a referral',
    area: 'Settings',
    menu: 'AI → Referral cards, or a project → Referrals & wishes → Referral card',
    to: '/ai/referrals',
    keywords: ['ask for referral', 'word of mouth', 'recommend', 'referral card', 'gift', 'friend offer', 'refer a friend'],
    body: [
      'Every booked client gets a **Referral card**: a picture for WhatsApp with "A GIFT FROM" and their names, the offer for a friend, a gift code and a QR.',
      'Open it from **AI → Referral cards** (pick **Whose card?**) or from the project\'s **Referrals & wishes → Referral card**, then **Share on WhatsApp** or **Download**. The friend\'s offer can be changed right there; your defaults are on **Settings → Leads → Referrals → Cards & offers**.',
      'A friend who enquires through it becomes a lead marked **Referred by** your client. When that lead is booked, your client\'s reward is due and the friend\'s first invoice carries the offer by itself.',
    ],
  },
  {
    key: 'wishes',
    title: 'Wishes: birthdays and anniversaries',
    area: 'Settings',
    menu: 'A project → Referrals & wishes → Wishes',
    keywords: ['birthday', 'anniversary', 'greeting', 'occasion'],
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
    menu: 'Plan & billing',
    to: '/settings/subscription',
    keywords: ['free', 'demo', 'trial period', 'expiry', 'days left'],
    body: [
      'Everything works during the trial, with no number limits; a trial runs one studio (no extra brands).',
      'An IPC Diamond member gets 30 days from sign-up; otherwise it is 7 days. While on the trial, Home and **Plan & billing** show "IPC Diamond member? Activate your 30-day free trial" with a box for the mobile number registered with IPC and **Activate 30 days**.',
      'The days left show on the plan card at the foot of the sidebar; no email is sent.',
      'Nothing you have made is ever deleted when a trial ends. Your work waits for you.',
    ],
  },
  {
    key: 'plans-prices',
    title: 'What it costs',
    area: 'Plans',
    menu: 'Plan & billing',
    to: '/settings/subscription',
    keywords: ['cost', 'price', 'fee', 'charges', 'how much', 'subscription', 'rate'],
    body: [
      'There are three plans: **Starter** ₹35,988 a year (or ₹3,999 a month), **Pro** ₹59,988 a year (or ₹5,999 a month) and **Studio Max** ₹95,988 a year (or ₹9,999 a month).',
      'Every plan has every feature, except **Import from Google Drive** on the gallery, which is Pro and Studio Max only. Starter has number limits (30 projects, 30 invoices and 30 designs a plan year -- all of them can be used in one month, on a monthly plan too -- 30 leads held at a time, 3 team logins and 10 crew) and runs one studio. Pro and Studio Max have no number limits; Pro runs up to 3 brands on one login and Studio Max as many as you like, and Studio Max puts your own name, logo and WhatsApp number on it (white label).',
      'An IPC Diamond member pays about half for the very same plans: **Diamond Starter** ₹17,988 a year (₹1,999 a month), **Diamond Pro** ₹29,988 (₹2,999) and **Diamond Studio Max** ₹47,988 (₹4,999). **Plan & billing** shows both prices, the regular one on top and the members\' below it.',
      'All of those are before 18% GST.',
      'To buy or change a plan, press **Talk to us on WhatsApp** on **Plan & billing**: the message is already written, and we set it up on a short call.',
    ],
  },
  {
    key: 'plans-diamond',
    title: 'IPC Diamond membership',
    area: 'Plans',
    menu: 'Plan & billing',
    to: '/settings/subscription',
    keywords: ['member', 'ipc', 'discount', 'group', 'premium'],
    body: [
      'An IPC Diamond member gets the member prices (about half) and 30 days to try the app. **Plan & billing** shows them under the regular prices: Diamond Starter, Diamond Pro and Diamond Studio Max.',
      'Press **Talk to us on WhatsApp** on a Diamond plan (or **Already a member? Check your number**), type the mobile number you registered with IPC and press **Check my number**. If it is on the member list, **Continue on WhatsApp** opens and your trial becomes 30 days from sign-up.',
      'Only a number on the member list goes on to WhatsApp at the member price. One number opens one studio; a number that is not found can still take a regular plan.',
    ],
  },
  {
    key: 'plans-upgrade',
    title: 'Changing or renewing a plan',
    area: 'Plans',
    menu: 'Plan & billing',
    to: '/settings/subscription',
    keywords: ['change plan', 'renew', 'pro rata', 'switch plan', 'downgrade'],
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
    menu: 'Plan & billing',
    to: '/settings/subscription',
    keywords: ['expired', 'access ended', 'locked out', 'payment due'],
    body: [
      'Nothing is deleted. You can still sign in and open **Plan & billing**.',
      'There is no card payment in the app: press **Talk to us on WhatsApp** on the plan you want, and we set it up. Once the plan is given, everything is exactly as you left it.',
    ],
  },
  {
    key: 'plans-limits',
    title: 'Reaching a plan limit, and upgrading',
    area: 'Plans',
    menu: 'The plan card at the foot of the sidebar, and Plan & billing',
    to: '/settings/subscription',
    keywords: ['limit', 'upgrade', 'full', 'cannot add', 'more projects', 'more leads', 'quota'],
    body: [
      'On Starter, the next project, invoice, lead, login or design past the limit is refused with a message and an **Upgrade** button. Nothing you already made is touched.',
      '**Plan & billing** shows one bar per limit, for example "12 of 30 projects this year", and when the counts start again. Archiving or deleting a lead makes room for a new one.',
      '**Upgrade** lives on the plan card at the foot of the sidebar.',
    ],
  },
  {
    key: 'brands',
    title: 'More than one brand on one login',
    area: 'Plans',
    menu: 'The account menu → Add a brand',
    keywords: ['second studio', 'another brand', 'switch studio', 'multiple studios', 'two businesses'],
    body: [
      'A brand is a studio of its own (its own leads, projects, team and money) on the same login. Add one from **Add a brand** in the account menu and move between them with **Switch studio**.',
      'Starter and the trial run one studio, Pro up to 3 brands, Studio Max as many as you like. Every brand rides on the first studio\'s plan.',
    ],
  },

  // ── Problems ────────────────────────────────────────────────
  {
    key: 'problem-failed-to-fetch',
    title: '"Failed to fetch", or the app will not load',
    area: 'Problems',
    keywords: ['not loading', 'error', 'blank', 'cannot open', 'network', 'offline'],
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
    keywords: ['logged out', 'session expired', 'kicked out'],
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
    keywords: ['staff login', 'cannot login', 'wrong password', 'access denied'],
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
    keywords: ['logo missing', 'not showing', 'image', 'brand image'],
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
    keywords: ['message not sent', 'whatsapp failed', 'not delivered', 'credits', 'wallet', 'recharge'],
    body: [
      'Check the messaging wallet first (**Settings → Messages & lists → Messaging → Wallet**): a message marked **Recharge to send** waits until it is topped up.',
      'If you are on your own WhatsApp number, check **Settings → Messages & lists → WhatsApp**: the card says whether the connection is live and what the last error was.',
      'A brand new template has to be approved by Meta before it can be sent.',
    ],
  },
  {
    key: 'problem-facebook-leads',
    title: 'Facebook leads are not arriving',
    area: 'Problems',
    keywords: ['no leads', 'fb not working', 'meta disconnected', 'not syncing'],
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
    keywords: ['mail not received', 'spam', 'email failed'],
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
    keywords: ['rupee dots', 'cannot see price', 'amounts blurred'],
    body: [
      'That is the eye in the top bar — amounts are hidden on purpose, for when a client is beside you.',
      'Press it again to show them. The setting follows you to every device, which is why it is still on after you switch computers.',
    ],
  },
  {
    key: 'problem-attendance',
    title: 'Attendance is not marking',
    area: 'Problems',
    keywords: ['not marking', 'check in failed', 'location issue', 'gps'],
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
    keywords: ['mismatch', 'different totals', 'numbers wrong', 'not matching'],
    body: [
      'Usually one is counting a promise and the other counting money actually received — only a payment marked **paid** is money.',
      'The other common reason is the period: the money pages share one date range, and Invoices deliberately keep their own.',
      'Where the app knows two numbers disagree it says why and offers the one-tap fix. If you find two that disagree with no explanation, that is worth telling us about.',
    ],
  },
]
