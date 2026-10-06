import type { HelpVideo } from '@ipc/contracts'

/**
 * The tutorials: one short screen recording per job, made from the real app
 * (apps/web/public/help/<key>.mp4 with a <key>.jpg poster). A page shows
 * "Watch how" only when a tutorial is about it. The platform admin can add a
 * video for another page, or replace one, from /platform/help (help_videos,
 * 0236); those win over the shipped file.
 */
export interface Tutorial {
  key: string
  title: string
  blurb: string
  /** Length, for "Watch how · 40 s". */
  seconds: number
  section: 'Get started' | 'Clients & sales' | 'Shoots & team' | 'Editing' | 'Money' | 'Team'
  /** The pages it is about: whole path, or a prefix ending in /. */
  pages: readonly (string | RegExp)[]
  /** The project page's tabs it is about (`?tab=` view ids: shoots, deliverables, billing…). */
  views?: readonly string[]
  /** A link from the platform console instead of the shipped file. */
  url?: string
  /** The Hindi recording's title and line (captions in Hindi, the app in English). */
  hi?: { title: string; blurb: string }
}

/** The language a tutorial plays in: the same recording with English or Hindi captions. */
export type HelpLang = 'en' | 'hi'

export const TUTORIALS: readonly Tutorial[] = [
  { key: 'team', title: 'Add one person to your team', blurb: 'Name, phone, job role -- and a login if they need one.', seconds: 39, section: 'Get started', pages: ['/employees'], hi: { title: 'टीम में एक व्यक्ति जोड़ें', blurb: 'नाम, फ़ोन, काम -- और ज़रूरत हो तो लॉगिन।' } },
  { key: 'team-bulk', title: 'Add your whole team at once', blurb: 'One row per person, or paste them from a sheet.', seconds: 44, section: 'Get started', pages: [], hi: { title: 'पूरी टीम एक साथ जोड़ें', blurb: 'हर व्यक्ति की एक लाइन, या शीट से पेस्ट करें।' } },
  { key: 'client', title: 'Add your first client', blurb: 'Name and number is enough to start.', seconds: 27, section: 'Get started', pages: ['/clients'], hi: { title: 'अपना पहला क्लाइंट जोड़ें', blurb: 'शुरू करने के लिए नाम और नंबर काफ़ी है।' } },
  { key: 'project', title: 'Create your first project', blurb: 'Events, deliverables and the price -- then the quotation is ready.', seconds: 58, section: 'Get started', pages: ['/projects/new'], hi: { title: 'अपना पहला प्रोजेक्ट बनाएँ', blurb: 'इवेंट, डिलिवरेबल्स और कीमत -- फिर कोटेशन तैयार।' } },
  { key: 'project-client', title: "Project step 1: who it's for", blurb: 'Name the project and pick or add the client.', seconds: 24, section: 'Get started', pages: [], hi: { title: 'प्रोजेक्ट स्टेप 1: किसके लिए है', blurb: 'प्रोजेक्ट का नाम लिखें, क्लाइंट चुनें या जोड़ें।' } },
  { key: 'project-shoots', title: 'Project step 2: the event days', blurb: 'Haldi, Wedding, Reception -- date, start time, how long.', seconds: 50, section: 'Get started', pages: [], hi: { title: 'प्रोजेक्ट स्टेप 2: इवेंट के दिन', blurb: 'हल्दी, शादी, रिसेप्शन -- तारीख, समय, कितने घंटे।' } },
  { key: 'project-deliverables', title: 'Project step 3: what they get', blurb: 'Album, film, teaser -- tick what is in the package.', seconds: 24, section: 'Get started', pages: [], hi: { title: 'प्रोजेक्ट स्टेप 3: क्लाइंट को क्या मिलेगा', blurb: 'एल्बम, फ़िल्म, टीज़र -- पैकेज में जो है उस पर टिक करें।' } },
  { key: 'project-billing', title: 'Project step 4: the price', blurb: 'The package price, the advance, then Create.', seconds: 28, section: 'Get started', pages: [], hi: { title: 'प्रोजेक्ट स्टेप 4: कीमत', blurb: 'पैकेज की कीमत, एडवांस, फिर Create।' } },
  { key: 'leads', title: 'Add a lead and book it', blurb: 'From enquiry to booked project in one go.', seconds: 56, section: 'Clients & sales', pages: ['/follow-ups'], hi: { title: 'लीड जोड़ें और बुक करें', blurb: 'इन्क्वायरी से बुक हुए प्रोजेक्ट तक, एक बार में।' } },
  { key: 'quotation', title: 'Send your quotation', blurb: 'See it as the client, then send it.', seconds: 47, section: 'Clients & sales', pages: [/^\/projects\/[^/]+\/quotation$/], hi: { title: 'अपना कोटेशन भेजें', blurb: 'क्लाइंट की नज़र से देखें, फिर भेजें।' } },
  { key: 'assign', title: 'Book your team for a shoot', blurb: 'Who is free, what they cost, booked in a few taps.', seconds: 46, section: 'Shoots & team', pages: ['/team-allocation', '/shoots'], views: ['shoots'], hi: { title: 'शूट के लिए टीम बुक करें', blurb: 'कौन फ़्री है, कितना पेमेंट, कुछ टैप में बुक।' } },
  { key: 'give-work', title: 'Give editing work', blurb: 'Pick the editor with the least on their plate.', seconds: 38, section: 'Editing', pages: [], views: ['deliverables'], hi: { title: 'एडिटिंग का काम दें', blurb: 'जिस एडिटर के पास सबसे कम काम है, उसे दें।' } },
  { key: 'board', title: 'Run the production board', blurb: 'Every edit by stage, late work first.', seconds: 53, section: 'Editing', pages: ['/production-board'], hi: { title: 'प्रोडक्शन बोर्ड चलाएँ', blurb: 'हर एडिट स्टेज के हिसाब से, लेट काम सबसे ऊपर।' } },
  { key: 'team-day', title: "Your team's day", blurb: 'What a team member sees and taps on their own login.', seconds: 45, section: 'Team', pages: ['/my-work'], hi: { title: 'आपकी टीम का दिन', blurb: 'टीम मेंबर अपने लॉगिन पर क्या देखता और दबाता है।' } },
  { key: 'payments', title: 'Record a payment', blurb: 'What is due, and money in, counted once.', seconds: 44, section: 'Money', pages: ['/billing/payments'], views: ['billing'], hi: { title: 'पेमेंट दर्ज करें', blurb: 'क्या बाकी है, और आया पैसा, एक ही बार गिना।' } },
  { key: 'payouts', title: 'Pay your crew', blurb: 'Who you owe for shoots already done.', seconds: 43, section: 'Money', pages: ['/team-payouts'], views: ['payouts'], hi: { title: 'अपनी टीम को पेमेंट करें', blurb: 'हो चुके शूट का किसका कितना बकाया है।' } },
  { key: 'invoices', title: 'Make an invoice', blurb: 'The project fills it in; send it and see it paid.', seconds: 51, section: 'Money', pages: ['/billing/invoices', '/billing/invoices/new', /^\/billing\/invoices\/[^/]+\/edit$/], hi: { title: 'इनवॉइस बनाएँ', blurb: 'प्रोजेक्ट से अपने आप भरता है; भेजें और पेमेंट देखें।' } },
  { key: 'expenses', title: 'Add an expense', blurb: 'What you spent, on a project or the studio.', seconds: 52, section: 'Money', pages: ['/company-expenses'], views: ['expenses'], hi: { title: 'खर्च जोड़ें', blurb: 'क्या खर्च हुआ, किसी प्रोजेक्ट पर या स्टूडियो पर।' } },
  { key: 'attendance', title: 'Turn on attendance', blurb: 'Your place, your hours, done.', seconds: 50, section: 'Team', pages: ['/settings/attendance-location', '/attendance'], hi: { title: 'अटेंडेंस चालू करें', blurb: 'आपकी जगह, आपके घंटे, बस।' } },
  { key: 'leave', title: 'Leave and balances', blurb: 'Days a year, asked, approved -- and what is left.', seconds: 42, section: 'Team', pages: ['/leave'], hi: { title: 'छुट्टी और बैलेंस', blurb: 'साल की छुट्टियाँ, माँगी गईं, मंज़ूर -- और कितनी बचीं।' } },
]

const matches = (page: string | RegExp, path: string) =>
  typeof page === 'string' ? (page.endsWith('/') ? path.startsWith(page) : path === page) : page.test(path)

/** The shipped tutorials with the console's added or replaced videos laid over them. */
export function tutorialsWith(videos: readonly HelpVideo[] = [], shipped: readonly string[] = SHIPPED): Tutorial[] {
  const byKey = new Map(videos.map((v) => [v.page_key, v]))
  const list: Tutorial[] = TUTORIALS.filter((t) => shipped.includes(t.key) || byKey.has(t.key)).map((t) => {
    const v = byKey.get(t.key)
    return v ? { ...t, title: v.title, url: v.url } : t
  })
  for (const v of videos) {
    if (!TUTORIALS.some((t) => t.key === v.page_key)) {
      list.push({ key: v.page_key, title: v.title, blurb: '', seconds: 0, section: 'Get started', pages: [], url: v.url })
    }
  }
  return list
}

/** A project's own page, where the open tab (`?tab=`) picks the tutorial. */
const PROJECT_PAGE = /^\/projects\/(?!new$)[^/]+$/

/** The tutorial about this page (and, on a project, its open tab), if there is one. */
export function tutorialFor(path: string, list: readonly Tutorial[], tab?: string | null): Tutorial | null {
  const clean = path.replace(/\/+$/, '') || '/'
  if (tab && PROJECT_PAGE.test(clean)) return list.find((t) => t.views?.includes(tab)) ?? null
  return list.find((t) => t.pages.some((p) => matches(p, clean))) ?? null
}

/** Whether this tutorial has a Hindi recording (a console link never does). */
export const hasHindi = (t: Tutorial) => !t.url && !!t.hi && SHIPPED_HI.includes(t.key)
/** The language it will really play in: Hindi only when there is a Hindi recording. */
export const playsIn = (t: Tutorial, lang: HelpLang): HelpLang => (lang === 'hi' && hasHindi(t) ? 'hi' : 'en')
const dir = (t: Tutorial, lang: HelpLang) => (playsIn(t, lang) === 'hi' ? '/help/hi' : '/help')
export const videoSrc = (t: Tutorial, lang: HelpLang = 'en') => t.url ?? `${dir(t, lang)}/${t.key}.mp4`
export const posterSrc = (t: Tutorial, lang: HelpLang = 'en') => (t.url ? undefined : `${dir(t, lang)}/${t.key}.jpg`)
export const titleIn = (t: Tutorial, lang: HelpLang) => (playsIn(t, lang) === 'hi' ? t.hi!.title : t.title)
export const blurbIn = (t: Tutorial, lang: HelpLang) => (playsIn(t, lang) === 'hi' ? t.hi!.blurb : t.blurb)

/** "40 s", or "1 min 5 s". */
export function lengthLabel(seconds: number): string {
  if (!seconds) return ''
  if (seconds < 60) return `${seconds} s`
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return s ? `${m} min ${s} s` : `${m} min`
}

/** Which recordings are in apps/web/public/help. */
export const SHIPPED: readonly string[] = ['team', 'team-bulk', 'client', 'project', 'project-client', 'project-shoots', 'project-deliverables', 'project-billing', 'leads', 'quotation', 'assign', 'give-work', 'payments', 'payouts', 'attendance', 'board', 'team-day', 'invoices', 'expenses', 'leave']

/** Which of them also have a Hindi recording, in apps/web/public/help/hi. */
export const SHIPPED_HI: readonly string[] = SHIPPED
