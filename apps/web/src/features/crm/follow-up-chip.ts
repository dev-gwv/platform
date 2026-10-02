const when = (iso: string) =>
  new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' })

/**
 * The next follow-up, said in the lead's header: "Follow up 3 Oct, 11:00 am",
 * "Follow-up was due 2 Oct, 10:00 am", or "No follow-up yet" (amber, the one
 * next thing). Nothing for a lead that is won or lost.
 */
export function followUpChip(followUpAt: string | null, open: boolean, now = new Date()): { text: string; late: boolean; missing: boolean } | null {
  if (!open) return null
  if (!followUpAt) return { text: 'No follow-up yet', late: false, missing: true }
  const late = Date.parse(followUpAt) < now.getTime()
  return { text: late ? `Follow-up was due ${when(followUpAt)}` : `Follow up ${when(followUpAt)}`, late, missing: false }
}
