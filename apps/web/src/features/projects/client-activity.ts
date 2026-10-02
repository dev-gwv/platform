import type { ClientActivity } from '@ipc/contracts'

const KIND: Record<ClientActivity['views'][number]['kind'], string> = {
  quotation: 'Quotation',
  invoice: 'Invoice',
  terms: 'Terms',
}

/** "2 Oct, 6:40 pm", in India's time. */
export function whenShort(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const day = d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' })
  const time = d
    .toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' })
    .toLowerCase()
  return `${day}, ${time}`
}

/**
 * What the client did, in at most three lines, newest first: an answer to the
 * quotation, then the documents they opened -- "Quotation opened · 2 Oct,
 * 6:40 pm (3 times)". Nothing to say is an empty list, and the card hides.
 */
export function clientActivityLines(a: ClientActivity | undefined): string[] {
  if (!a) return []
  const lines: { at: string; text: string }[] = []
  if (a.accepted_at) {
    lines.push({ at: a.accepted_at, text: `Accepted${a.accepted_by ? ` by ${a.accepted_by}` : ''} · ${whenShort(a.accepted_at)}` })
  } else if (a.declined_at) {
    lines.push({ at: a.declined_at, text: `Quotation declined · ${whenShort(a.declined_at)}` })
  }
  for (const v of a.views) {
    const times = v.views > 1 ? ` (${v.views} times)` : ''
    lines.push({ at: v.last_viewed_at, text: `${KIND[v.kind]} opened · ${whenShort(v.last_viewed_at)}${times}` })
  }
  return lines
    .sort((x, y) => (x.at < y.at ? 1 : x.at > y.at ? -1 : 0))
    .slice(0, 3)
    .map((l) => l.text)
}
