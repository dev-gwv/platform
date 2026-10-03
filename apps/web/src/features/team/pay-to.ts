/**
 * What the pay dialog says when a person has no UPI or bank details. Someone
 * with a login is reminded every day to add them; someone the studio added
 * without one never sees a reminder, so the studio asks them itself.
 */
export function missingPayToText(name: string, hasLogin: boolean): string {
  if (hasLogin) return `${name} has not added UPI or bank details yet. They are reminded every day until they do.`
  return `${name} has no login, so they cannot add UPI or bank details themselves. Ask them for it, or give them a login from their Team row.`
}
