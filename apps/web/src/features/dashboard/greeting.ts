/** India time, whatever the device's clock is set to: the studio's day. */
const istParts = (now: Date) => {
  const d = new Date(now.getTime() + 330 * 60_000)
  return { hour: d.getUTCHours(), d }
}

/** "Good morning" before noon, "Good afternoon" until 5 pm, then "Good evening" -- India time. */
export function greeting(name: string | null | undefined, now = new Date()): string {
  const { hour } = istParts(now)
  const part = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'
  const first = (name ?? '').trim().split(/\s+/)[0] ?? ''
  return first ? `${part}, ${first}.` : `${part}.`
}

/** "FRIDAY, 2 OCTOBER" -- the line above the greeting. */
export function todayLine(now = new Date()): string {
  const { d } = istParts(now)
  return d
    .toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' })
    .toUpperCase()
}
