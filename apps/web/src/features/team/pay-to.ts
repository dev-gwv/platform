/**
 * What the pay dialog says when a person has no UPI or bank details. Someone
 * with a login is reminded every day to add them; someone the studio added
 * without one never sees a reminder, so the studio asks them itself.
 */
export function missingPayToText(name: string, hasLogin: boolean): string {
  if (hasLogin) return `${name} has not added UPI or bank details yet. They are reminded every day until they do, or you can add them here.`
  return `${name} has no login, so add their UPI or bank details here.`
}
