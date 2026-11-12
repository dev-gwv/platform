import type { HelpLang } from '@/features/help/tutorials'

/**
 * A new team member's first videos, on their own Home (owner, 12 Nov): their
 * day, handing in an edit, attendance (only while the studio has it on) and
 * leave. A video counts once it has played almost to the end; the card goes
 * once all are watched, when it is closed, or once the login is two months
 * old -- it is for people who are just starting.
 */
export const TEAM_VIDEO_DAYS = 60

export interface TeamVideo {
  key: string
  title: Record<HelpLang, string>
  /** Where it is done, when that is not Home itself. */
  to?: string
}

const ALL: readonly (TeamVideo & { attendance?: true })[] = [
  { key: 'team-day', title: { en: 'Your day in the app', hi: 'ऐप में आपका दिन' } },
  { key: 'hand-in', title: { en: 'Hand in your edit', hi: 'अपना एडिट जमा करें' }, to: '/my-work' },
  { key: 'check-in', title: { en: 'Mark your attendance', hi: 'अपनी अटेंडेंस लगाएँ' }, to: '/attendance/my', attendance: true },
  { key: 'ask-leave', title: { en: 'Ask for leave', hi: 'छुट्टी माँगें' }, to: '/leave' },
]

export function teamVideos(attendanceOn: boolean): TeamVideo[] {
  return ALL.filter((v) => attendanceOn || !v.attendance).map(({ attendance: _a, ...v }) => v)
}

export function showTeamVideos(
  videos: readonly TeamVideo[],
  watched: readonly string[],
  closed: boolean,
  since: string,
  now = new Date(),
): boolean {
  if (closed) return false
  const t = Date.parse(since)
  if (!Number.isNaN(t) && now.getTime() - t > TEAM_VIDEO_DAYS * 86_400_000) return false
  return videos.some((v) => !watched.includes(v.key))
}

/** "1 of 4 watched". */
export const watchedLine = (videos: readonly TeamVideo[], watched: readonly string[], lang: HelpLang): string => {
  const n = videos.filter((v) => watched.includes(v.key)).length
  return lang === 'hi' ? `${videos.length} में से ${n} देखे` : `${n} of ${videos.length} watched`
}
