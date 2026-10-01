import type { HintNote } from '@ipc/contracts'

/**
 * The note after assigning work ("Nitin will see this on their own login")
 * is for a studio's first few assignments. The owner: "for the first 5 or 6
 * assignments… otherwise they will get irritated", with a way to close it
 * for good.
 */
export const ASSIGN_NOTE_TIMES = 6

/** Whether the note still has showings left for this person. */
export function noteDue(hint: HintNote | undefined, times = ASSIGN_NOTE_TIMES): boolean {
  if (!hint) return true
  return !hint.closed && hint.shown < times
}

/** "never opened the app yet", "opened it today", "last opened 3 days ago". */
export function lastSeenText(iso: string | null, now: Date = new Date()): string {
  if (!iso) return 'has not opened the app yet'
  const days = Math.floor((startOfDay(now) - startOfDay(new Date(iso))) / 86_400_000)
  if (days <= 0) return 'opened the app today'
  if (days === 1) return 'last opened the app yesterday'
  if (days < 60) return `last opened the app ${days} days ago`
  return 'has not opened the app for a while'
}

function startOfDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
}

/** "Nitin", "Nitin and Priya", "Nitin, Priya and 2 others". */
export function namesText(names: readonly string[]): string {
  const first = names.map((n) => n.split(' ')[0] || n)
  if (first.length <= 1) return first[0] ?? ''
  if (first.length === 2) return `${first[0]} and ${first[1]}`
  if (first.length === 3) return `${first[0]}, ${first[1]} and ${first[2]}`
  return `${first[0]}, ${first[1]} and ${first.length - 2} others`
}

/**
 * The WhatsApp message that tells a member where their work is. It carries
 * no password and no reset link -- a set-password link is a live credential
 * for their login everywhere, not the studio's to forward.
 */
export function loginMessage({
  name,
  studio,
  email,
  loginUrl,
}: {
  name: string
  studio: string
  email: string | null
  loginUrl: string
}): string {
  const first = name.split(' ')[0] || name
  const how = email
    ? `Log in at ${loginUrl} with ${email} and the password we gave you. You can change it from My profile.`
    : `Log in at ${loginUrl}. Ask us for your login details if you do not have them.`
  return `Hi ${first}, your shoots and editing work for ${studio} are on Studio AutoPilot. ${how} Everything assigned to you is under "My work".`
}
