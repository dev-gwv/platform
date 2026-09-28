/**
 * CSV, as people actually export it: RFC 4180 quoting, commas and newlines
 * inside quotes, doubled quotes, CRLF or LF, a UTF-8 BOM, and a header row
 * whose names are whatever the spreadsheet called them.
 */

/** Split CSV text into rows of cells. Empty trailing lines are dropped. */
export function parseCsv(text: string): string[][] {
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  let i = 0
  while (i < src.length) {
    const ch = src[i]!
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          cell += '"'
          i += 2
          continue
        }
        quoted = false
        i++
        continue
      }
      cell += ch
      i++
      continue
    }
    if (ch === '"') {
      quoted = true
      i++
      continue
    }
    if (ch === ',') {
      row.push(cell)
      cell = ''
      i++
      continue
    }
    if (ch === '\r') {
      i++
      continue
    }
    if (ch === '\n') {
      row.push(cell)
      rows.push(row)
      row = []
      cell = ''
      i++
      continue
    }
    cell += ch
    i++
  }
  if (cell !== '' || row.length > 0) {
    row.push(cell)
    rows.push(row)
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ''))
}

/**
 * Every column an import can read.
 *
 * The first five were the whole list, and the importer sent only those five --
 * while crm_import_leads has accepted city, event type, event date, venue, deal
 * value, alternate phone and quality since 0107. So a studio importing its
 * enquiry spreadsheet had the shoot dates and budgets in the file, watched them
 * appear in the preview's column list, and lost every one of them on commit.
 * That is the worst kind of bug: it looks like it worked.
 */
/**
 * A date as an Indian studio writes it, turned into an ISO date.
 *
 * This matters more than it looks. The commit contract takes a strict ISO date,
 * and a spreadsheet from a studio in Indore says 12/03/2027 meaning 12 March.
 * Handing that to Postgres, or to `new Date()`, reads it month-first and stores
 * 3 December -- a shoot date wrong by nine months, with no error anywhere. So
 * nothing here guesses: day comes first, which is what every date written in
 * this country means, and anything that is not one of the shapes below is
 * refused so the studio can fix the file.
 *
 * Accepted: 2027-03-12, 12/03/2027, 12-03-2027, 12.3.2027, 12 Mar 2027,
 * 12 March 2027, and two-digit years (27 -> 2027).
 */
const MONTHS = [
  'jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec',
]

const iso = (y: number, m: number, d: number): string | null => {
  if (m < 1 || m > 12 || d < 1 || d > 31) return null
  // Reject 31 February rather than letting it roll into March.
  const probe = new Date(Date.UTC(y, m - 1, d))
  if (probe.getUTCMonth() !== m - 1 || probe.getUTCDate() !== d) return null
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

const fullYear = (n: number): number => (n >= 100 ? n : n >= 70 ? 1900 + n : 2000 + n)

export function parseImportDate(raw: string | null): string | null {
  if (!raw) return null
  const v = raw.trim()
  if (v === '') return null

  // Already ISO, which is also the only shape that is month-first.
  const isoMatch = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(v)
  if (isoMatch) return iso(Number(isoMatch[1]), Number(isoMatch[2]), Number(isoMatch[3]))

  // 12/03/2027, 12-03-27, 12.3.2027 -- day first, always.
  const numeric = /^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})$/.exec(v)
  if (numeric) return iso(fullYear(Number(numeric[3])), Number(numeric[2]), Number(numeric[1]))

  // 12 Mar 2027 / 12 March 2027 / 12-Mar-2027
  const named = /^(\d{1,2})[\s-]+([A-Za-z]+)[\s-]+(\d{2,4})$/.exec(v)
  if (named) {
    const m = MONTHS.indexOf(named[2]!.slice(0, 3).toLowerCase())
    if (m === -1) return null
    return iso(fullYear(Number(named[3])), m + 1, Number(named[1]))
  }

  return null
}

/**
 * Money as a spreadsheet writes it: "Rs 1,50,000", "₹2.5L" is NOT accepted --
 * lakh shorthand is ambiguous enough that guessing it wrong by a factor of
 * 100,000 is worse than asking. Indian digit grouping (1,50,000) is fine.
 */
export function parseImportMoney(raw: string | null): number | null {
  if (!raw) return null
  const v = raw.trim()
  if (v === '') return null
  // Anything other than currency marks, digit separators and a decimal point
  // means we do not understand the cell.
  const m = /^(?:rs\.?|inr|₹)?\s*([\d,\s]*\d(?:\.\d{1,2})?)\s*$/i.exec(v)
  if (!m) return null
  // Take the captured number, not the whole cell: stripping non-digits from
  // "Rs. 2,00,000" leaves the dot in "Rs." behind and yields 0.2.
  const n = Number(m[1]!.replace(/[,\s]/g, ''))
  return Number.isFinite(n) && n >= 0 ? n : null
}

/** hot / warm / cold, however the column spelled it. */
/**
 * A sheet's word for how warm a lead is. The usual synonyms map onto the
 * three defaults; anything else is the studio's own word and is kept as
 * typed (0209 opened the list), up to the column's 40 characters.
 */
export function parseImportQuality(raw: string | null): string | null {
  if (!raw) return null
  const typed = raw.trim()
  const v = typed.toLowerCase()
  if (!v) return null
  if (['hot', 'high', 'urgent', 'a'].includes(v)) return 'hot'
  if (['warm', 'medium', 'mid', 'b'].includes(v)) return 'warm'
  if (['cold', 'low', 'c'].includes(v)) return 'cold'
  return typed.slice(0, 40)
}

export type LeadColumn =
  | 'name'
  | 'phone'
  | 'email'
  | 'notes'
  | 'source'
  | 'city'
  | 'event_type'
  | 'event_date'
  | 'event_location'
  | 'deal_value'
  | 'alternate_phone'
  | 'quality'

const ALIASES: Record<LeadColumn, readonly string[]> = {
  name: ['name', 'full name', 'fullname', 'client', 'client name', 'lead', 'lead name', 'contact'],
  phone: ['phone', 'phone number', 'mobile', 'mobile number', 'number', 'contact number', 'whatsapp', 'tel', 'telephone'],
  email: ['email', 'e-mail', 'email address', 'mail'],
  notes: ['notes', 'note', 'remarks', 'comments', 'comment', 'message', 'enquiry', 'requirement', 'details'],
  source: ['source', 'lead source', 'channel', 'campaign'],
  city: ['city', 'town', 'location city', 'place'],
  // "Wedding", "Pre-wedding", "Birthday" -- the studio's own project types.
  event_type: ['event type', 'event', 'type', 'function', 'occasion', 'shoot type', 'project type', 'service'],
  event_date: ['event date', 'date', 'shoot date', 'function date', 'wedding date', 'date of event'],
  event_location: ['event location', 'venue', 'location', 'address', 'place of event'],
  deal_value: ['deal value', 'value', 'budget', 'amount', 'package', 'package value', 'quote', 'price'],
  alternate_phone: ['alternate phone', 'alt phone', 'second phone', 'other number', 'alternate number', 'phone 2'],
  quality: ['quality', 'rating', 'temperature', 'grade', 'priority'],
}

/** Columns beyond the original five, for a UI that wants to say what it found. */
export const EXTRA_LEAD_COLUMNS: readonly LeadColumn[] = [
  'city',
  'event_type',
  'event_date',
  'event_location',
  'deal_value',
  'alternate_phone',
  'quality',
]

const norm = (s: string) => s.trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

/**
 * Work out which column is which from the header row. Returns null when the
 * first row does not look like a header (no phone column anywhere), in which
 * case the caller falls back to positional name, phone, email, notes.
 */
export function mapLeadColumns(header: readonly string[]): Partial<Record<LeadColumn, number>> | null {
  const map: Partial<Record<LeadColumn, number>> = {}
  header.forEach((h, idx) => {
    const key = norm(h)
    for (const col of Object.keys(ALIASES) as LeadColumn[]) {
      if (map[col] === undefined && ALIASES[col].some((a) => norm(a) === key)) map[col] = idx
    }
  })
  return map.phone === undefined ? null : map
}

export interface LeadRecord {
  row: number
  name: string | null
  phone: string | null
  email: string | null
  notes: string | null
  source: string | null
  city: string | null
  event_type: string | null
  /** As written in the file; the server parses it, and rejects the row if it cannot. */
  event_date: string | null
  event_location: string | null
  deal_value: string | null
  alternate_phone: string | null
  quality: string | null
}

const POSITIONAL: Partial<Record<LeadColumn, number>> = { name: 0, phone: 1, email: 2, notes: 3 }

/**
 * Turn parsed rows into lead records. `row` is the 1-based line in the file,
 * so a validation message can point at the spreadsheet line.
 */
export function leadsFromCsv(rows: readonly string[][]): { columns: string[]; records: LeadRecord[] } {
  if (rows.length === 0) return { columns: [], records: [] }
  const header = rows[0]!
  const mapped = mapLeadColumns(header)
  const map = mapped ?? POSITIONAL
  const data = mapped ? rows.slice(1) : rows
  const offset = mapped ? 2 : 1
  const pick = (r: readonly string[], col: LeadColumn): string | null => {
    const idx = map[col]
    if (idx === undefined) return null
    const v = (r[idx] ?? '').trim()
    return v === '' ? null : v
  }
  const records = data.map((r, i) => ({
    row: i + offset,
    name: pick(r, 'name'),
    phone: pick(r, 'phone'),
    email: pick(r, 'email'),
    notes: pick(r, 'notes'),
    source: pick(r, 'source'),
    city: pick(r, 'city'),
    event_type: pick(r, 'event_type'),
    event_date: pick(r, 'event_date'),
    event_location: pick(r, 'event_location'),
    deal_value: pick(r, 'deal_value'),
    alternate_phone: pick(r, 'alternate_phone'),
    quality: pick(r, 'quality'),
  }))
  return {
    columns: mapped ? header.map((h) => h.trim()) : ['name', 'phone', 'email', 'notes'],
    records,
  }
}
