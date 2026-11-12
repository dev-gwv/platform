/**
 * The one-time welcome in the bell (owner, 12 Nov: "when a new person is
 * onboarded, there should be ... a notification which would tell them: Set up
 * your Studio AutoPilot ... It can take them step by step").
 *
 * Whoever sets a studio up (owner, super admin, admin) is pointed at the setup
 * videos while the studio is new; anyone else is pointed at their own videos
 * while their login is new. Older logins get nothing: this is for people who
 * are just starting, not a broadcast.
 */
export const WELCOME_DAYS = 30

export interface WelcomeFacts {
  isOwner: boolean
  role: string
  /** Days since the studio was made. */
  studioDays: number
  /** Days since this person's login was made. */
  loginDays: number
  studioName: string
}

export interface Welcome {
  kind: 'setup' | 'team'
  type: string
  title: string
  body: string
  link: string
  dedupe: string
}

const setsUp = (f: WelcomeFacts) => f.isOwner || f.role === 'super_admin' || f.role === 'admin'

export function welcomeFor(f: WelcomeFacts): Welcome | null {
  if (setsUp(f)) {
    if (f.studioDays > WELCOME_DAYS) return null
    return {
      kind: 'setup',
      type: 'welcome.setup',
      title: 'Welcome! Set up Studio AutoPilot in 6 short videos',
      body: 'Watch one, do it in the app, move to the next. Under a minute each, in English or हिन्दी.',
      link: '/start',
      dedupe: 'welcome:setup',
    }
  }
  if (f.loginDays > WELCOME_DAYS) return null
  const studio = f.studioName.trim()
  return {
    kind: 'team',
    type: 'welcome.team',
    title: studio ? `Welcome to ${studio}! Learn your side in a few short videos` : 'Welcome! Learn your side in a few short videos',
    body: 'Your day, your edits and your leave, each in under a minute. English or हिन्दी.',
    link: '/learn',
    dedupe: 'welcome:team',
  }
}

/** Whole days between two instants (0 for a bad date). */
export function daysBetween(from: Date | string, now: Date = new Date()): number {
  const t = new Date(from).getTime()
  if (Number.isNaN(t)) return 0
  return Math.max(0, Math.floor((now.getTime() - t) / 86_400_000))
}
