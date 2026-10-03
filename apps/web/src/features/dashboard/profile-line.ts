/**
 * The staff Home's profile nudge in one short line: the first two things
 * still needed, then how many more -- never the whole list.
 */
export function profileLine(percent: number, missing: readonly string[]): string {
  const shown = missing.slice(0, 2)
  const more = missing.length - shown.length
  return `Profile ${percent}% done · add ${shown.join(', ')}${more > 0 ? ` +${more} more` : ''}`
}
