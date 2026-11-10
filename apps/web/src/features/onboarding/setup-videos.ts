import type { HelpLang } from '@/features/help/tutorials'

/**
 * The setup videos a new studio watches before (or while) it starts: one
 * numbered step each, in the order the app walks them, with its video and
 * every click written out in English and Hindi (button names stay in English,
 * in bold). Shown on /help/setup (also /start), linked from the sign-in page,
 * the setup bar and Help (owner, 10 Nov: new studios felt unsure the first
 * time they signed in).
 *
 * `key` is the page anchor; the setup emails link #team, #client and #project,
 * so those three never change.
 */
type Words = Record<HelpLang, string>

export interface SetupVideoStep {
  key: string
  /** The tutorial that plays (apps/web/public/help/<video>.mp4, hi/ for Hindi). */
  video: string
  /** Shorter videos of the same step, one part each. */
  parts?: string[]
  title: Words
  why: Words
  /** Every click, in order. */
  steps: Record<HelpLang, string[]>
  /** Where "Do this now" goes. */
  action: { label: Words; to: string; search?: Record<string, string> }
  optional?: boolean
}

const w = (en: string, hi: string): Words => ({ en, hi })

export const SETUP_VIDEOS: readonly SetupVideoStep[] = [
  {
    key: 'account',
    video: 'signup',
    title: w('Create your account and sign in', 'अपना अकाउंट बनाएँ और साइन इन करें'),
    why: w(
      'Two minutes, no card. Your studio opens straight away on its first step.',
      'दो मिनट, कोई कार्ड नहीं। आपका स्टूडियो तुरंत अपने पहले स्टेप पर खुलता है।',
    ),
    steps: {
      en: [
        'Open **studioautopilot.in** and press **Start your free trial**.',
        'Type your **Company name** (your studio, as clients know it) and **Your name**.',
        'Type your **Email** and **Phone**. The email is your username for signing in.',
        'Choose a **Password** (at least 8 characters) and type it again in **Confirm password**.',
        'Press **Create account**. You are signed in and the app opens on **Add your team**.',
        'A yellow strip asks you to confirm your email. It is safe to do it later: nothing is blocked.',
        'Next time, open the site, press **Sign in**, and type the same email and password. Forgot it? Press **Forgot password?** and a reset link comes to your email.',
      ],
      hi: [
        '**studioautopilot.in** खोलें और **Start your free trial** दबाएँ।',
        '**Company name** में अपने स्टूडियो का नाम (जिस नाम से क्लाइंट जानते हैं) और **Your name** में अपना नाम लिखें।',
        '**Email** और **Phone** लिखें। साइन इन करते समय यही ईमेल आपका यूज़रनेम है।',
        '**Password** चुनें (कम से कम 8 अक्षर) और **Confirm password** में दोबारा लिखें।',
        '**Create account** दबाएँ। आप साइन इन हो जाते हैं और ऐप **Add your team** पर खुलता है।',
        'एक पीली पट्टी ईमेल कन्फ़र्म करने को कहती है। इसे बाद में भी कर सकते हैं: कुछ भी रुकता नहीं।',
        'अगली बार साइट खोलें, **Sign in** दबाएँ और वही ईमेल और पासवर्ड लिखें। भूल गए? **Forgot password?** दबाएँ, रीसेट लिंक आपके ईमेल पर आएगा।',
      ],
    },
    action: { label: w('Create my account', 'मेरा अकाउंट बनाएँ'), to: '/login', search: { mode: 'register' } },
  },
  {
    key: 'team',
    video: 'team-bulk',
    parts: ['team'],
    title: w('Add your team', 'अपनी टीम जोड़ें'),
    why: w(
      'Your photographers, cinematographers and editors, so you can book them on shoots and give them work.',
      'आपके फ़ोटोग्राफ़र, सिनेमैटोग्राफ़र और एडिटर, ताकि आप उन्हें शूट पर बुक कर सकें और काम दे सकें।',
    ),
    steps: {
      en: [
        'Right after sign-up the app opens on **Add your team**. Press **Add your team**.',
        'A list opens with one line per person. Type their **name** and **mobile number**.',
        'Pick their **job role**: Candid Photographer, Cinematographer, Video Editor… Not in the list? Type it and press **+ Add new**.',
        'Freelancer? Switch **Works as** from On salary to **Per shoot**.',
        'Want them to use the app on their phone? Give them a **login**: any email works as a username, and you set the password.',
        'Have a list in Excel or Google Sheets? Copy the rows and paste them into the list.',
        'Press the blue button at the bottom, **Add 2 people** (it counts them). Everyone is added at once, and setup moves on to your first client.',
      ],
      hi: [
        'साइन-अप के तुरंत बाद ऐप **Add your team** पर खुलता है। **Add your team** दबाएँ।',
        'एक लिस्ट खुलती है, हर व्यक्ति की एक लाइन। उनका **नाम** और **मोबाइल नंबर** लिखें।',
        'उनका **काम (job role)** चुनें: Candid Photographer, Cinematographer, Video Editor… लिस्ट में नहीं है? लिखें और **+ Add new** दबाएँ।',
        'फ़्रीलांसर हैं? **Works as** को On salary से **Per shoot** कर दें।',
        'क्या वे अपने फ़ोन पर ऐप चलाएँगे? उन्हें **लॉगिन** दें: कोई भी ईमेल यूज़रनेम बन सकता है, और पासवर्ड आप तय करते हैं।',
        'Excel या Google Sheet में लिस्ट है? लाइनें कॉपी करके लिस्ट में पेस्ट कर दें।',
        'नीचे का नीला बटन दबाएँ, **Add 2 people** (यह गिनती बताता है)। सब एक साथ जुड़ जाते हैं, और सेटअप आपके पहले क्लाइंट पर चला जाता है।',
      ],
    },
    action: { label: w('Add my team', 'मेरी टीम जोड़ें'), to: '/employees', search: { add: 'bulk' } },
  },
  {
    key: 'client',
    video: 'client',
    title: w('Add your first client', 'अपना पहला क्लाइंट जोड़ें'),
    why: w(
      'Every project, quotation and payment belongs to a client. A name and a number is enough to start.',
      'हर प्रोजेक्ट, कोटेशन और पेमेंट किसी क्लाइंट का होता है। शुरू करने के लिए नाम और नंबर काफ़ी है।',
    ),
    steps: {
      en: [
        'Setup opens **Clients** with the new-client form. Or open **Clients** in the menu and press **New client**.',
        'Type the client\'s **name**, for example the bride or the person who booked: "Priya Sharma".',
        'Type their **mobile number**. WhatsApp messages and reminders go to this number.',
        'City and email are optional. You can add them later.',
        'Press **Save client**. Setup moves on to your first project.',
      ],
      hi: [
        'सेटअप **Clients** को नए क्लाइंट के फ़ॉर्म के साथ खोलता है। या मेन्यू में **Clients** खोलें और **New client** दबाएँ।',
        'क्लाइंट का **नाम** लिखें, जैसे दुल्हन या जिसने बुक किया: "Priya Sharma"।',
        'उनका **मोबाइल नंबर** लिखें। WhatsApp मैसेज और रिमाइंडर इसी नंबर पर जाते हैं।',
        'शहर और ईमेल ज़रूरी नहीं हैं। बाद में भी जोड़ सकते हैं।',
        '**Save client** दबाएँ। सेटअप आपके पहले प्रोजेक्ट पर चला जाता है।',
      ],
    },
    action: { label: w('Add a client', 'क्लाइंट जोड़ें'), to: '/clients', search: { add: 'new' } },
  },
  {
    key: 'project',
    video: 'project',
    parts: ['project-client', 'project-shoots', 'project-deliverables', 'project-billing'],
    title: w('Create your first project', 'अपना पहला प्रोजेक्ट बनाएँ'),
    why: w(
      'A project is one booking: its event days, what the client gets, and the price. The quotation is made from it.',
      'प्रोजेक्ट मतलब एक बुकिंग: उसके इवेंट के दिन, क्लाइंट को क्या मिलेगा, और कीमत। कोटेशन इसी से बनता है।',
    ),
    steps: {
      en: [
        'Press **+ New** at the top and pick **Project** (setup opens it for you).',
        '**Step 1, who it is for**: type the project name, "Priya & Rahul Wedding", and pick the client you just added.',
        '**Step 2, the event days**: tap Haldi, Wedding, Reception… For each day set the **Date**, the **Start time** and the **Duration** (how many hours).',
        'For each day press **Add shoot requirements**: how many candid photographers, cinematographers, drone… This is the team you will book later.',
        '**Step 3, what they get**: tick the album, the film, the teaser, the edited photos. Add your own with **+ Add**.',
        '**Step 4, the price**: type the **Package cost**. Got an advance? Type it in **Advance received**.',
        'Press **Create project**. The project opens on its quotation, ready to send.',
      ],
      hi: [
        'ऊपर **+ New** दबाएँ और **Project** चुनें (सेटअप इसे आपके लिए खोल देता है)।',
        '**स्टेप 1, किसके लिए**: प्रोजेक्ट का नाम लिखें, "Priya & Rahul Wedding", और अभी जोड़ा क्लाइंट चुनें।',
        '**स्टेप 2, इवेंट के दिन**: हल्दी, शादी, रिसेप्शन… पर टैप करें। हर दिन की **Date**, **Start time** और **Duration** (कितने घंटे) डालें।',
        'हर दिन के लिए **Add shoot requirements** दबाएँ: कितने कैंडिड फ़ोटोग्राफ़र, सिनेमैटोग्राफ़र, ड्रोन… यही टीम आप बाद में बुक करेंगे।',
        '**स्टेप 3, क्लाइंट को क्या मिलेगा**: एल्बम, फ़िल्म, टीज़र, एडिट की हुई फ़ोटो पर टिक करें। अपना कुछ हो तो **+ Add** से जोड़ें।',
        '**स्टेप 4, कीमत**: **Package cost** लिखें। एडवांस मिला है? **Advance received** में लिखें।',
        '**Create project** दबाएँ। प्रोजेक्ट अपने कोटेशन पर खुलता है, भेजने के लिए तैयार।',
      ],
    },
    action: { label: w('Create a project', 'प्रोजेक्ट बनाएँ'), to: '/projects/new' },
  },
  {
    key: 'quotation',
    video: 'quotation',
    title: w('Send the quotation', 'कोटेशन भेजें'),
    why: w(
      'The quotation fills itself from the project. Check it as the client will see it, then send the link on WhatsApp.',
      'कोटेशन प्रोजेक्ट से अपने आप भरता है। क्लाइंट की नज़र से जाँचें, फिर लिंक WhatsApp पर भेजें।',
    ),
    steps: {
      en: [
        'A new project opens on its **Quotation**. For any other project, open it and press **Quotation**.',
        'Check it first: **Send to client ▾**, then **See it as the client**. This is exactly what they will see.',
        'Something to change? Each part has an **Edit** that takes you to the right place.',
        'Press **Back to my view**, then **Send to client** and **Copy link**.',
        'Paste the link in your WhatsApp chat with the client. When they open it or press Accept, your bell tells you.',
      ],
      hi: [
        'नया प्रोजेक्ट अपने **Quotation** पर ही खुलता है। किसी और प्रोजेक्ट के लिए उसे खोलें और **Quotation** दबाएँ।',
        'पहले जाँचें: **Send to client ▾**, फिर **See it as the client**। क्लाइंट को बिल्कुल यही दिखेगा।',
        'कुछ बदलना है? हर हिस्से में **Edit** है जो सही जगह ले जाता है।',
        '**Back to my view** दबाएँ, फिर **Send to client** और **Copy link**।',
        'लिंक क्लाइंट के WhatsApp चैट में पेस्ट करें। जब वे खोलते हैं या Accept दबाते हैं, आपकी घंटी बताती है।',
      ],
    },
    action: { label: w('Open my projects', 'मेरे प्रोजेक्ट खोलें'), to: '/projects' },
  },
  {
    key: 'studio',
    video: 'studio',
    optional: true,
    title: w('Make it yours: name, logo and your package', 'इसे अपना बनाएँ: नाम, लोगो और पैकेज'),
    why: w(
      'Your logo and details go on every quotation and invoice. Save the package you sell most, so the next project takes one tap.',
      'आपका लोगो और डिटेल हर कोटेशन और इनवॉइस पर आते हैं। जो पैकेज सबसे ज़्यादा बिकता है उसे सेव करें, ताकि अगला प्रोजेक्ट एक टैप में बने।',
    ),
    steps: {
      en: [
        'Open **Settings**, then **Company profile**.',
        'Upload your **logo** (keep it under 1 MB). It is saved the moment it lands.',
        'Fill in your address, phone, email and GST number if you have one. These print on quotations and invoices.',
        'Open **Settings**, then **Templates**, and press **New template**.',
        'Give it the name you use ("Gold Wedding Package"), its event days, deliverables and price, and save.',
        'Next time you create a project, pick this package and everything fills in.',
      ],
      hi: [
        '**Settings** खोलें, फिर **Company profile**।',
        'अपना **लोगो** अपलोड करें (1 MB से छोटा)। अपलोड होते ही सेव हो जाता है।',
        'अपना पता, फ़ोन, ईमेल और GST नंबर (अगर है) भरें। ये कोटेशन और इनवॉइस पर छपते हैं।',
        '**Settings** में **Templates** खोलें और **New template** दबाएँ।',
        'वह नाम दें जो आप इस्तेमाल करते हैं ("Gold Wedding Package"), उसके इवेंट के दिन, डिलिवरेबल और कीमत डालें, और सेव करें।',
        'अगली बार प्रोजेक्ट बनाते समय यह पैकेज चुनें, सब अपने आप भर जाएगा।',
      ],
    },
    action: { label: w('Open Company profile', 'Company profile खोलें'), to: '/settings/company' },
  },
]

/** "6 videos · about 6 minutes". */
export function setupLength(seconds: number[]): number {
  return Math.max(1, Math.round(seconds.reduce((a, b) => a + b, 0) / 60))
}
