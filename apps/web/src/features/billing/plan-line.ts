const day = (iso: string) =>
  new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' })

/**
 * The line under the plan's name in the sidebar: how long is left and the day
 * it ends, so nobody has to count -- "6 days left · until 8 Oct".
 */
export function planLine(daysLeft: number | null | undefined, accessUntil: string | null | undefined): string {
  if (daysLeft == null) return 'See plans'
  const until = accessUntil ? day(accessUntil) : null
  if (daysLeft < 0) return until ? `Ended ${until} · renew to keep going` : 'Ended · renew to keep going'
  const left = daysLeft === 0 ? 'Last day today' : `${daysLeft} day${daysLeft === 1 ? '' : 's'} left`
  return until && daysLeft > 0 ? `${left} · until ${until}` : left
}
