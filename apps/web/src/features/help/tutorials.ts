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
  /** A link from the platform console instead of the shipped file. */
  url?: string
}

export const TUTORIALS: readonly Tutorial[] = [
  { key: 'team', title: 'Add your team', blurb: 'The people who shoot and edit with you, in a minute.', seconds: 37, section: 'Get started', pages: ['/employees'] },
  { key: 'client', title: 'Add your first client', blurb: 'Name and number is enough to start.', seconds: 31, section: 'Get started', pages: ['/clients'] },
  { key: 'project', title: 'Create your first project', blurb: 'Events, deliverables and the price -- then the quotation is ready.', seconds: 53, section: 'Get started', pages: ['/projects/new'] },
  { key: 'leads', title: 'Add a lead and book it', blurb: 'From enquiry to booked project in one go.', seconds: 53, section: 'Clients & sales', pages: ['/follow-ups'] },
  { key: 'quotation', title: 'Send your quotation', blurb: 'See it as the client, then send it.', seconds: 43, section: 'Clients & sales', pages: [/^\/projects\/[^/]+\/quotation$/] },
  { key: 'assign', title: 'Book your team for a shoot', blurb: 'Who is free, what they cost, booked in a few taps.', seconds: 41, section: 'Shoots & team', pages: ['/team-allocation', '/shoots'] },
  { key: 'give-work', title: 'Give editing work', blurb: 'Pick the editor with the least on their plate.', seconds: 32, section: 'Editing', pages: [] },
  { key: 'board', title: 'Run the production board', blurb: 'Every edit by stage, late work first.', seconds: 49, section: 'Editing', pages: ['/production-board'] },
  { key: 'team-day', title: "Your team's day", blurb: 'What a team member sees and taps on their own login.', seconds: 40, section: 'Team', pages: ['/my-work'] },
  { key: 'payments', title: 'Record a payment', blurb: 'What is due, and money in, counted once.', seconds: 38, section: 'Money', pages: ['/billing/payments'] },
  { key: 'payouts', title: 'Pay your crew', blurb: 'Who you owe for shoots already done.', seconds: 34, section: 'Money', pages: ['/team-payouts'] },
  { key: 'attendance', title: 'Turn on attendance', blurb: 'Your place, your hours, done.', seconds: 43, section: 'Team', pages: ['/settings/attendance-location', '/attendance'] },
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

/** The tutorial about this page, if there is one. */
export function tutorialFor(path: string, list: readonly Tutorial[]): Tutorial | null {
  const clean = path.replace(/\/+$/, '') || '/'
  return list.find((t) => t.pages.some((p) => matches(p, clean))) ?? null
}

export const videoSrc = (t: Tutorial) => t.url ?? `/help/${t.key}.mp4`
export const posterSrc = (t: Tutorial) => (t.url ? undefined : `/help/${t.key}.jpg`)

/** "40 s", or "1 min 5 s". */
export function lengthLabel(seconds: number): string {
  if (!seconds) return ''
  if (seconds < 60) return `${seconds} s`
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return s ? `${m} min ${s} s` : `${m} min`
}

/** Which recordings are in apps/web/public/help. */
export const SHIPPED: readonly string[] = ['team', 'client', 'project', 'leads', 'quotation', 'assign', 'give-work', 'payments', 'payouts', 'attendance', 'board', 'team-day']
