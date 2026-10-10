import type { HelpLang } from './tutorials'

/**
 * "How to use Studio AutoPilot" (/learn): the whole app as an ordered set of
 * chapters, each with its video and the steps written out, in English and
 * Hindi. Two tracks: the studio's (owner, managers) and the team's (what a
 * team member does on their own login). Button names stay in English in the
 * Hindi steps, because that is what is on the screen; `**x**` marks them.
 */
export type GuideTrack = 'studio' | 'team'
type Words = Record<HelpLang, string>

export interface GuidePart {
  track: GuideTrack
  title: Words
}

export interface GuideChapter {
  key: string
  part: number
  /** The tutorial that shows it (a key in TUTORIALS). */
  video?: string
  /** Shorter clips, one per step of a longer job. */
  clips?: readonly string[]
  /** Where it is done in the app. */
  to?: string
  title: Words
  steps: Record<HelpLang, readonly string[]>
}

export const PARTS: readonly GuidePart[] = [
  { track: 'studio', title: { en: 'Start here', hi: 'शुरुआत यहाँ से' } },
  { track: 'studio', title: { en: 'Get more enquiries', hi: 'ज़्यादा इन्क्वायरी पाएँ' } },
  { track: 'studio', title: { en: 'Win the booking', hi: 'बुकिंग पक्की करें' } },
  { track: 'studio', title: { en: 'Shoot and edit', hi: 'शूट और एडिट' } },
  { track: 'studio', title: { en: 'Money', hi: 'पैसा' } },
  { track: 'studio', title: { en: "Your team's time", hi: 'टीम का समय' } },
  { track: 'team', title: { en: 'Your day', hi: 'आपका दिन' } },
  { track: 'team', title: { en: 'Your work, leave and pay', hi: 'आपका काम, छुट्टी और पेमेंट' } },
]

export const TRACK_LABEL: Record<GuideTrack, Words> = {
  studio: { en: 'For the studio', hi: 'स्टूडियो के लिए' },
  team: { en: 'For your team', hi: 'टीम के लिए' },
}

export const CHAPTERS: readonly GuideChapter[] = [
  // ── Start here ──
  {
    key: 'team',
    part: 0,
    video: 'team-bulk',
    clips: ['team'],
    to: '/employees',
    title: { en: 'Add your team', hi: 'अपनी टीम जोड़ें' },
    steps: {
      en: [
        'Open **Team → People** in the menu.',
        'Press **Add Team Member**, then **All at once** (or **One by one** for a single person).',
        'One row per person: name and mobile, and the job they get booked for.',
        'Want them to sign in? Type any email as their username, and a password. Nothing is sent to that email.',
        'A freelancer? Set them to **Per shoot**. Then press **Add** and your team is in.',
      ],
      hi: [
        'मेन्यू में **Team → People** खोलें।',
        '**Add Team Member** दबाएँ, फिर **All at once** (एक व्यक्ति के लिए **One by one**)।',
        'हर व्यक्ति की एक लाइन: नाम, मोबाइल, और जिस काम के लिए वे बुक होते हैं।',
        'उन्हें साइन इन करवाना है? यूज़रनेम के लिए कोई भी ईमेल और एक पासवर्ड लिखें। उस ईमेल पर कुछ नहीं भेजा जाता।',
        'फ़्रीलांसर हैं? उन्हें **Per shoot** पर रखें। फिर **Add** दबाएँ, टीम जुड़ गई।',
      ],
    },
  },
  {
    key: 'client',
    part: 0,
    video: 'client',
    to: '/clients',
    title: { en: 'Add a client', hi: 'क्लाइंट जोड़ें' },
    steps: {
      en: [
        'Open **Clients** and press **New client**.',
        'Type their name and mobile number. Email is optional.',
        'Address, birthdays and GSTIN wait under **More details**, only if you need them.',
        'Press **Save client**. From now on you can pick them anywhere in the app.',
      ],
      hi: [
        '**Clients** खोलें और **New client** दबाएँ।',
        'उनका नाम और मोबाइल नंबर लिखें। ईमेल ज़रूरी नहीं है।',
        'पता, जन्मदिन और GSTIN **More details** में हैं, ज़रूरत हो तभी भरें।',
        '**Save client** दबाएँ। अब ऐप में कहीं भी उन्हें चुन सकते हैं।',
      ],
    },
  },
  {
    key: 'project',
    part: 0,
    video: 'project',
    clips: ['project-client', 'project-shoots', 'project-deliverables', 'project-billing'],
    to: '/projects/new',
    title: { en: 'Create a project', hi: 'प्रोजेक्ट बनाएँ' },
    steps: {
      en: [
        'Open **+ New → Project**.',
        "**Who it's for**: name the project (\"Priya & Rahul's Wedding\") and pick the client, or add a new one.",
        '**Event days**: tap each function (Haldi, Wedding…), then its date, start time and how many hours. Add who that day needs.',
        '**Deliverables**: tap what the client gets. Each due date counts from the wedding day.',
        '**Price**: the package price, and any advance already received. Then **Review → Create project**.',
        'The quotation opens, ready to send.',
      ],
      hi: [
        '**+ New → Project** खोलें।',
        "**Who it's for**: प्रोजेक्ट का नाम लिखें (\"Priya & Rahul's Wedding\") और क्लाइंट चुनें, या नया जोड़ें।",
        '**Event days**: हर फ़ंक्शन पर टैप करें (हल्दी, शादी…), फिर तारीख, शुरू होने का समय और कितने घंटे। उस दिन किसकी ज़रूरत है, वह जोड़ें।',
        '**Deliverables**: क्लाइंट को जो मिलेगा, उस पर टैप करें। हर ड्यू डेट शादी के दिन से गिनी जाती है।',
        '**Price**: पैकेज की कीमत, और जो एडवांस मिल चुका है। फिर **Review → Create project**।',
        'कोटेशन खुल जाता है, भेजने के लिए तैयार।',
      ],
    },
  },
  {
    key: 'studio',
    part: 0,
    video: 'studio',
    to: '/settings/company',
    title: { en: 'Your studio: name, logo and packages', hi: 'आपका स्टूडियो: नाम, लोगो और पैकेज' },
    steps: {
      en: [
        'Open **Settings → Company profile**, type your studio name and press **Save changes**.',
        'Under Brand identity, upload your logo (under 1 MB). It saves by itself and shows on every quotation and invoice.',
        'Open **Settings → Project templates** and press **New template**.',
        'Name your usual package, add its days and what the client gets, and press **Save**. Pick it with **Use for a new project**.',
      ],
      hi: [
        '**Settings → Company profile** खोलें, स्टूडियो का नाम लिखें और **Save changes** दबाएँ।',
        'Brand identity में अपना लोगो डालें (1 MB से कम)। यह अपने आप सेव होता है और हर कोटेशन और इनवॉइस पर दिखता है।',
        '**Settings → Project templates** खोलें और **New template** दबाएँ।',
        'अपने पैकेज का नाम, उसके दिन और क्लाइंट को क्या मिलेगा, लिखें और **Save** दबाएँ। **Use for a new project** से इसे चुनें।',
      ],
    },
  },

  // ── Win the booking ──
  {
    key: 'enquiry-form',
    part: 1,
    video: 'enquiry-form',
    to: '/enquiry-forms',
    title: { en: 'Your enquiry form and QR code', hi: 'आपका इन्क्वायरी फ़ॉर्म और QR कोड' },
    steps: {
      en: [
        'Open **Enquiry forms** and press **Add form**: **Your website**, or **A vendor** for a QR code.',
        '**Edit form** shows the form beside you: the heading, what it asks (Off, Ask or Required) and the button colour.',
        'Website: press **Copy code** and give it to whoever runs your site. Vendor: print the QR.',
        'Every enquiry lands in **Leads** by itself.',
      ],
      hi: [
        '**Enquiry forms** खोलें और **Add form** दबाएँ: **Your website**, या QR कोड के लिए **A vendor**।',
        '**Edit form** में फ़ॉर्म साथ में दिखता है: हेडिंग, क्या पूछना है (Off, Ask या Required) और बटन का रंग।',
        'वेबसाइट: **Copy code** दबाएँ और अपनी साइट चलाने वाले को दें। वेंडर: QR प्रिंट करें।',
        'हर इन्क्वायरी अपने आप **Leads** में आती है।',
      ],
    },
  },
  {
    key: 'facebook',
    part: 1,
    video: 'facebook',
    to: '/facebook',
    title: { en: 'Bring in your Facebook leads', hi: 'अपनी Facebook लीड्स लाएँ' },
    steps: {
      en: [
        'Open **CRM → Lead sources** and press **Connect with Facebook**.',
        'Log in to Facebook and pick the Page your lead ads run on.',
        'From then on, every lead from your Facebook and Instagram lead ads lands in **Leads** by itself.',
      ],
      hi: [
        '**CRM → Lead sources** खोलें और **Connect with Facebook** दबाएँ।',
        'Facebook में लॉगिन करें और वह Page चुनें जिस पर आपके लीड ऐड्स चलते हैं।',
        'इसके बाद Facebook और Instagram लीड ऐड्स की हर लीड अपने आप **Leads** में आती है।',
      ],
    },
  },
  {
    key: 'leads',
    part: 2,
    video: 'leads',
    to: '/follow-ups',
    title: { en: 'Track enquiries and book them', hi: 'इन्क्वायरी संभालें और बुक करें' },
    steps: {
      en: [
        'Open **Leads** and press **Add lead**.',
        'A name or a phone number is enough to start. Pick the event and its date.',
        'Set the next follow-up, so you are reminded when to call.',
        'Ready? Open the lead and press **Book it** at the top: name the project, set the price, done.',
        'Not happening? Press **Lost** and pick the reason.',
      ],
      hi: [
        '**Leads** खोलें और **Add lead** दबाएँ।',
        'शुरू करने के लिए नाम या फ़ोन नंबर काफ़ी है। इवेंट और उसकी तारीख चुनें।',
        'अगला फ़ॉलो-अप सेट करें, ताकि कॉल करने का समय याद रहे।',
        'पक्का हो गया? लीड खोलें और ऊपर **Book it** दबाएँ: प्रोजेक्ट का नाम, कीमत, बस।',
        'बात नहीं बनी? **Lost** दबाएँ और वजह चुनें।',
      ],
    },
  },
  {
    key: 'quotation',
    part: 2,
    video: 'quotation',
    to: '/projects',
    title: { en: 'Send the quotation', hi: 'कोटेशन भेजें' },
    steps: {
      en: [
        "A new project opens on its quotation. For any other project, open it and go to **Quotation**.",
        'Check it first: **Send to client ▾ → See it as the client** shows their exact copy.',
        'Press **Send to client**, then **Copy link**, and paste it on WhatsApp.',
        'When the client opens or accepts it, it shows on the project and in your bell.',
      ],
      hi: [
        'नया प्रोजेक्ट अपने कोटेशन पर ही खुलता है। किसी और प्रोजेक्ट के लिए उसे खोलें और **Quotation** पर जाएँ।',
        'पहले जाँचें: **Send to client ▾ → See it as the client** से क्लाइंट वाली कॉपी दिखती है।',
        '**Send to client** दबाएँ, फिर **Copy link**, और WhatsApp पर भेज दें।',
        'क्लाइंट जब खोलता या मंज़ूर करता है, तो प्रोजेक्ट पर और आपकी घंटी में दिखता है।',
      ],
    },
  },
  {
    key: 'terms',
    part: 2,
    video: 'terms',
    to: '/projects',
    title: { en: 'Send your terms, and get them signed', hi: 'अपनी शर्तें भेजें, और साइन करवाएँ' },
    steps: {
      en: [
        "Open the project's **Terms** tab and pick your usual terms. The payment plan fills in.",
        'Read them, then press **Create link & send**: send it on WhatsApp.',
        'Client with you? Press **Sign now**: they check their name and sign with a finger on your phone, then **I agree**.',
        'The tab turns green with their signature on file.',
      ],
      hi: [
        'प्रोजेक्ट का **Terms** टैब खोलें और अपनी शर्तें चुनें। पेमेंट प्लान अपने आप भरता है।',
        'पढ़ें, फिर **Create link & send** दबाएँ: WhatsApp पर भेजें।',
        'क्लाइंट साथ में हैं? **Sign now** दबाएँ: वे अपना नाम देखें और आपके फ़ोन पर उंगली से साइन करें, फिर **I agree**।',
        'टैब हरा हो जाता है, उनके साइन के साथ।',
      ],
    },
  },
  {
    key: 'details-form',
    part: 2,
    video: 'details-form',
    to: '/projects',
    title: { en: 'Let the client fill in their details', hi: 'क्लाइंट को अपनी डिटेल ख़ुद भरने दें' },
    steps: {
      en: [
        'On the project, press **⋯ → Send details form** and send the link on WhatsApp.',
        'The client adds names, dates and their events on their own phone, then presses **Send**.',
        'Their events wait on the **Shoots** tab, and fill only what you left blank.',
      ],
      hi: [
        'प्रोजेक्ट पर **⋯ → Send details form** दबाएँ और लिंक WhatsApp पर भेजें।',
        'क्लाइंट अपने फ़ोन पर नाम, तारीखें और अपने इवेंट भरकर **Send** दबाते हैं।',
        'उनके इवेंट **Shoots** टैब पर आते हैं, और सिर्फ़ वही भरते हैं जो आपने खाली छोड़ा था।',
      ],
    },
  },

  // ── Shoot and edit ──
  {
    key: 'assign',
    part: 3,
    video: 'assign',
    to: '/team-allocation',
    title: { en: 'Book your team for each day', hi: 'हर दिन के लिए टीम बुक करें' },
    steps: {
      en: [
        "Open the project's **Shoots** tab. Each day shows who it needs.",
        'Press **Assign team** on a day, and pick a person for each role.',
        'Each name says if they are free, busy or on leave that day. Their pay fills in from their usual rate.',
        'Press **Book**, then **Done**. To see every shoot at once, open **Shoots**.',
      ],
      hi: [
        'प्रोजेक्ट का **Shoots** टैब खोलें। हर दिन पर लिखा है किसकी ज़रूरत है।',
        'किसी दिन पर **Assign team** दबाएँ, और हर रोल के लिए एक व्यक्ति चुनें।',
        'हर नाम के साथ लिखा है कि उस दिन वे फ़्री हैं, बिज़ी हैं या छुट्टी पर। पेमेंट उनके रोज़ के रेट से भर जाता है।',
        '**Book** दबाएँ, फिर **Done**। सारे शूट एक साथ देखने हों तो **Shoots** खोलें।',
      ],
    },
  },
  {
    key: 'give-work',
    part: 3,
    video: 'give-work',
    to: '/projects',
    title: { en: 'Give editing work', hi: 'एडिटिंग का काम दें' },
    steps: {
      en: [
        "Open the project's **Post-production** tab.",
        'On a deliverable with nobody on it, press **Start editing**.',
        'Pick the editor: each one shows how much work they already have. The due date is filled in.',
        'Add a line of brief and press **Start editing with** them. You are told when it is handed in.',
      ],
      hi: [
        'प्रोजेक्ट का **Post-production** टैब खोलें।',
        'जिस डिलिवरेबल पर अभी कोई नहीं है, उस पर **Start editing** दबाएँ।',
        'एडिटर चुनें: हर एक के साथ दिखता है कि उनके पास पहले से कितना काम है। ड्यू डेट भरी हुई है।',
        'एक लाइन का ब्रीफ़ लिखें और **Start editing with** दबाएँ। काम जमा होने पर आपको पता चल जाएगा।',
      ],
    },
  },
  {
    key: 'board',
    part: 3,
    video: 'board',
    to: '/production-board',
    title: { en: 'Keep editing on track', hi: 'एडिटिंग समय पर रखें' },
    steps: {
      en: [
        'Open **Post-production**.',
        'The top counts late work, work due today and work with no editor.',
        'When a piece moves on, drag its card to the next stage.',
        '**List** puts late work first. Tick several and use **Give to…** to hand them out together.',
        'Let the couple follow along: on the project, **More → Share with client**, then **Send on WhatsApp**. Their page shows each film move from Being edited to Delivered, with no login.',
        'Press **See it as the client** to check what they see. Opening it there is not counted as their visit.',
      ],
      hi: [
        '**Post-production** खोलें।',
        'ऊपर गिनती है: लेट काम, आज ड्यू काम, और बिना एडिटर वाला काम।',
        'काम आगे बढ़े तो उसका कार्ड अगले स्टेज पर खींच दें।',
        '**List** में लेट काम सबसे ऊपर है। कई पर टिक करें और **Give to…** से एक साथ सौंप दें।',
        'कपल को सब दिखता रहे: प्रोजेक्ट पर **More → Share with client**, फिर **Send on WhatsApp**। उनके पेज पर हर फ़िल्म Being edited से Delivered तक आगे बढ़ती दिखती है, बिना लॉगिन के।',
        'वे क्या देखते हैं, यह जाँचने के लिए **See it as the client** दबाएँ। वहाँ खोलना उनकी विज़िट में नहीं गिना जाता।',
      ],
    },
  },
  {
    key: 'data',
    part: 3,
    video: 'data',
    to: '/data-management',
    title: { en: 'Record the cards after a shoot', hi: 'शूट के बाद कार्ड दर्ज करें' },
    steps: {
      en: [
        'After the day, its card on the **Shoots** tab says how much data is in.',
        'Press **Add data** beside a person: who copied it, the main disk and the backup, each marked **Copied**.',
        'Press **Save**. The next person starts with the same disks.',
        'When every card is in and backed up, the day turns green.',
      ],
      hi: [
        'शूट के बाद **Shoots** टैब पर उस दिन के कार्ड में दिखता है कि कितना डेटा आया।',
        'किसी व्यक्ति के आगे **Add data** दबाएँ: किसने कॉपी किया, मेन डिस्क और बैकअप, हर एक **Copied**।',
        '**Save** दबाएँ। अगला व्यक्ति उन्हीं डिस्क से शुरू होता है।',
        'जब हर कार्ड आ जाए और बैकअप हो जाए, दिन हरा हो जाता है।',
      ],
    },
  },

  // ── Money ──
  {
    key: 'invoices',
    part: 4,
    video: 'invoices',
    to: '/billing/invoices',
    title: { en: 'Send an invoice', hi: 'इनवॉइस भेजें' },
    steps: {
      en: [
        "On the quotation press **Create the invoice**, or open the project's **Finance → Billing** and press **Create invoice**.",
        'The client, the project and the booked package are already filled in. Check the subject line.',
        'Press **Save and send**.',
        'Open the invoice and press **Client link**: a link the client opens without logging in.',
      ],
      hi: [
        'कोटेशन पर **Create the invoice** दबाएँ, या प्रोजेक्ट के **Finance → Billing** में **Create invoice** दबाएँ।',
        'क्लाइंट, प्रोजेक्ट और बुक किया पैकेज पहले से भरे हैं। बस सब्जेक्ट लाइन देख लें।',
        '**Save and send** दबाएँ।',
        'इनवॉइस खोलें और **Client link** दबाएँ: ऐसा लिंक जो क्लाइंट बिना लॉगिन के खोल सके।',
      ],
    },
  },
  {
    key: 'payments',
    part: 4,
    video: 'payments',
    to: '/billing/payments',
    title: { en: 'Record money in', hi: 'आया पैसा दर्ज करें' },
    steps: {
      en: [
        'Open **Money → Payments**.',
        'Four boxes: **Overdue**, **Due in 30 days**, **Later**, **Received**. Tap one to see who.',
        'Press **Open invoice**, then **Add payment from client**.',
        'The amount is filled in. Pick how they paid (UPI, cash, bank), add the UTR and save.',
      ],
      hi: [
        '**Money → Payments** खोलें।',
        'चार बॉक्स: **Overdue**, **Due in 30 days**, **Later**, **Received**। किसी पर टैप करके देखें किसका है।',
        '**Open invoice** दबाएँ, फिर **Add payment from client**।',
        'रकम भरी हुई है। कैसे पेमेंट किया (UPI, कैश, बैंक) चुनें, UTR डालें और सेव करें।',
      ],
    },
  },
  {
    key: 'payouts',
    part: 4,
    video: 'payouts',
    to: '/team-payouts',
    title: { en: 'Pay your crew', hi: 'टीम को पेमेंट करें' },
    steps: {
      en: [
        'Open **Team → Pay → Team payouts**. **Owed now** is money for shoots already done.',
        'Press **Pay** beside a person. Their UPI or bank is shown and the amount is filled in.',
        'Pick how you paid, add the UTR and save.',
        'They see it on their own **My payouts**.',
      ],
      hi: [
        '**Team → Pay → Team payouts** खोलें। **Owed now** में हो चुके शूट का बकाया है।',
        'किसी के आगे **Pay** दबाएँ। उनका UPI या बैंक दिखता है और रकम भरी हुई है।',
        'कैसे पेमेंट किया चुनें, UTR डालें और सेव करें।',
        'वे इसे अपने **My payouts** में देखते हैं।',
      ],
    },
  },
  {
    key: 'expenses',
    part: 4,
    video: 'expenses',
    to: '/company-expenses',
    title: { en: 'Add an expense', hi: 'खर्च जोड़ें' },
    steps: {
      en: [
        'Open **Money → Expenses** and press **Add expense**.',
        'Type the amount and pick a category.',
        'Who paid? If a team member paid from their own pocket, it waits under **To reimburse** until you pay them back.',
        'Put it on the project it belongs to, and press **Add expense**.',
      ],
      hi: [
        '**Money → Expenses** खोलें और **Add expense** दबाएँ।',
        'रकम लिखें और कैटेगरी चुनें।',
        'किसने दिया? अगर टीम के किसी ने अपनी जेब से दिया, तो लौटाने तक यह **To reimburse** में रहेगा।',
        'जिस प्रोजेक्ट का खर्च है, उस पर डालें, और **Add expense** दबाएँ।',
      ],
    },
  },

  // ── Your team's time ──
  {
    key: 'attendance',
    part: 5,
    video: 'attendance',
    to: '/settings/attendance-location',
    title: { en: 'Turn on attendance', hi: 'अटेंडेंस चालू करें' },
    steps: {
      en: [
        'Attendance is off until you turn it on: **Settings → Attendance**.',
        "Paste your studio's Google Maps link, and pick how close counts as in.",
        'Set when the day starts and ends, and the weekly off. Save.',
        'Your team then taps **Check in** on their Home. On a shoot day, **I\'ve reached** at the venue counts.',
      ],
      hi: [
        'अटेंडेंस तब तक बंद है जब तक आप चालू न करें: **Settings → Attendance**।',
        'स्टूडियो का Google Maps लिंक पेस्ट करें, और चुनें कितनी दूरी तक हाज़िर माना जाए।',
        'दिन कब शुरू और कब खत्म होता है, और हफ़्ते की छुट्टी सेट करें। सेव करें।',
        'फिर आपकी टीम अपने Home पर **Check in** दबाती है। शूट के दिन वेन्यू पर **I\'ve reached** ही अटेंडेंस है।',
      ],
    },
  },
  {
    key: 'leave',
    part: 5,
    video: 'leave',
    to: '/leave',
    title: { en: 'Approve leave', hi: 'छुट्टी मंज़ूर करें' },
    steps: {
      en: [
        'Open **Team → Attendance & leave → Leave & holidays**.',
        '**To approve** shows who is waiting. Each request says how many days they have left.',
        'Press **Approve**, and the person is told straight away.',
        'Set the days a year for each kind of leave under **Balances**.',
      ],
      hi: [
        '**Team → Attendance & leave → Leave & holidays** खोलें।',
        '**To approve** में दिखता है कौन इंतज़ार में है। हर अर्ज़ी में लिखा है कितनी छुट्टियाँ बची हैं।',
        '**Approve** दबाएँ, और उस व्यक्ति को तुरंत पता चल जाता है।',
        'हर तरह की छुट्टी के साल के दिन **Balances** में सेट करें।',
      ],
    },
  },
  {
    key: 'team-day',
    part: 5,
    video: 'team-day',
    title: { en: 'What your team sees', hi: 'आपकी टीम क्या देखती है' },
    steps: {
      en: [
        'Each team member signs in with the email and password you gave them.',
        'Their Home is their day: shoots, edits and tasks in time order, late first.',
        "At a shoot they tap **I've reached**; for an edit **I've started**, then hand it in.",
        "They see their own work and pay only: never your money or your clients' numbers.",
      ],
      hi: [
        'टीम का हर सदस्य आपके दिए ईमेल और पासवर्ड से साइन इन करता है।',
        'उनका Home उनका दिन है: शूट, एडिट और काम, समय के क्रम में, लेट सबसे ऊपर।',
        "शूट पर वे **I've reached** दबाते हैं; एडिट के लिए **I've started**, फिर काम जमा करते हैं।",
        'वे सिर्फ़ अपना काम और अपना पेमेंट देखते हैं: आपका पैसा या क्लाइंट के नंबर कभी नहीं।',
      ],
    },
  },
  {
    key: 'salaries',
    part: 5,
    video: 'salaries',
    to: '/payroll',
    title: { en: 'Salaries and payslips', hi: 'सैलरी और पे-स्लिप' },
    steps: {
      en: [
        'On **Team → People**, press **Edit** on a person, pick **Monthly salaried** and type the salary.',
        'Open **Team → Pay → Payroll**, pick the month and press **Work out pay**: days in, leave and absences are counted.',
        'Each line right? **Approve** the month, then **Mark paid** with the UTR.',
        'Each person sees their **Payslip** on their own login.',
      ],
      hi: [
        '**Team → People** पर किसी व्यक्ति पर **Edit** दबाएँ, **Monthly salaried** चुनें और सैलरी लिखें।',
        '**Team → Pay → Payroll** खोलें, महीना चुनें और **Work out pay** दबाएँ: हाज़िरी, छुट्टी और गैरहाज़िरी गिनी जाती है।',
        'हर लाइन सही है? महीना **Approve** करें, फिर UTR के साथ **Mark paid**।',
        'हर व्यक्ति अपने लॉगिन पर अपनी **Payslip** देखता है।',
      ],
    },
  },

  // ── The team's track ──
  {
    key: 'team-home',
    part: 6,
    video: 'team-day',
    to: '/dashboard',
    title: { en: 'Your Home', hi: 'आपका Home' },
    steps: {
      en: [
        'Sign in with the email and password your studio gave you. Forgot it? Ask your studio.',
        '**Home** is your day: everything for today in time order, late first, each with one button.',
        '**Coming up** shows the next 7 days.',
      ],
      hi: [
        'स्टूडियो के दिए ईमेल और पासवर्ड से साइन इन करें। भूल गए? अपने स्टूडियो से पूछें।',
        '**Home** आपका दिन है: आज का सब कुछ समय के क्रम में, लेट सबसे ऊपर, हर एक के साथ एक बटन।',
        '**Coming up** में अगले 7 दिन दिखते हैं।',
      ],
    },
  },
  {
    key: 'team-attendance',
    part: 6,
    video: 'check-in',
    to: '/attendance/my',
    title: { en: 'Mark your attendance', hi: 'अपनी अटेंडेंस लगाएँ' },
    steps: {
      en: [
        'If your studio uses attendance, your Home has a card at the top.',
        'At the studio, press **Check in**. Your phone asks for your location once: allow it.',
        "On a shoot day you do not check in at the studio: tap **I've reached** at the venue.",
      ],
      hi: [
        'अगर आपका स्टूडियो अटेंडेंस लेता है, तो आपके Home पर सबसे ऊपर एक कार्ड है।',
        'स्टूडियो पहुँचकर **Check in** दबाएँ। फ़ोन एक बार लोकेशन माँगेगा: अनुमति दें।',
        "शूट के दिन स्टूडियो पर चेक इन नहीं करना: वेन्यू पर **I've reached** दबाएँ।",
      ],
    },
  },
  {
    key: 'team-shoots',
    part: 6,
    video: 'team-day',
    to: '/shoots/my',
    title: { en: 'Your shoots', hi: 'आपके शूट' },
    steps: {
      en: [
        'Booked for a shoot? Press **Confirm**, so the studio knows you will be there.',
        "At the venue, press **I've reached**.",
        'After the shoot, give your cards in: **Hand over** on Home, or open **My Shoots**.',
      ],
      hi: [
        'किसी शूट पर बुक हुए? **Confirm** दबाएँ, ताकि स्टूडियो को पता रहे कि आप आएँगे।',
        "वेन्यू पहुँचकर **I've reached** दबाएँ।",
        'शूट के बाद अपने कार्ड जमा करें: Home पर **Hand over**, या **My Shoots** खोलें।',
      ],
    },
  },
  {
    key: 'team-edits',
    part: 7,
    video: 'hand-in',
    to: '/my-work',
    title: { en: 'Your edits', hi: 'आपके एडिट' },
    steps: {
      en: [
        '**My work** lists every edit given to you, with the days left.',
        "Starting one? Press **I've started**.",
        'Finished? Press **Hand in work** and paste the link.',
        'If changes are asked, it comes back to the top under **Changes asked**.',
      ],
      hi: [
        '**My work** में आपको दिया हर एडिट है, बचे दिनों के साथ।',
        "शुरू कर रहे हैं? **I've started** दबाएँ।",
        'पूरा हो गया? **Hand in work** दबाएँ और लिंक पेस्ट करें।',
        'अगर बदलाव माँगे गए, तो वह **Changes asked** में सबसे ऊपर वापस आता है।',
      ],
    },
  },
  {
    key: 'team-leave',
    part: 7,
    video: 'ask-leave',
    to: '/leave',
    title: { en: 'Ask for leave', hi: 'छुट्टी माँगें' },
    steps: {
      en: [
        'Open **Attendance & leave → Leave** and press **Ask for leave**.',
        'Pick the dates and the kind of leave, and say why.',
        'You see how many days you have left before you ask. Your manager is told straight away.',
      ],
      hi: [
        '**Attendance & leave → Leave** खोलें और **Ask for leave** दबाएँ।',
        'तारीखें और छुट्टी की तरह चुनें, और वजह लिखें।',
        'माँगने से पहले दिखता है कितनी छुट्टियाँ बची हैं। आपके मैनेजर को तुरंत पता चल जाता है।',
      ],
    },
  },
  {
    key: 'team-pay',
    part: 7,
    to: '/payouts/my',
    title: { en: 'Your pay', hi: 'आपका पेमेंट' },
    steps: {
      en: [
        '**My payouts** shows each shoot you were paid for, and what is still to come.',
        'Add your UPI or bank on **My profile**, so the studio can pay you.',
      ],
      hi: [
        '**My payouts** में हर शूट का पेमेंट है जो मिला, और जो अभी आना है।',
        '**My profile** में अपना UPI या बैंक डालें, ताकि स्टूडियो आपको पेमेंट कर सके।',
      ],
    },
  },
]

export const chaptersOf = (track: GuideTrack) => CHAPTERS.filter((c) => PARTS[c.part]?.track === track)

/** A step's words, split into plain text and **button names**. */
export function stepParts(step: string): { text: string; strong: boolean }[] {
  return step
    .split('**')
    .map((text, i) => ({ text, strong: i % 2 === 1 }))
    .filter((p) => p.text !== '')
}

/** The first chapter of a track not yet done: the one that opens. */
export function nextChapter(track: GuideTrack, done: ReadonlySet<string>): GuideChapter | null {
  return chaptersOf(track).find((c) => !done.has(c.key)) ?? null
}
