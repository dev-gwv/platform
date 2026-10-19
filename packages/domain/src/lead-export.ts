/**
 * Leads as a file a studio opens in Excel or Google Sheets (0274; spec 3.12):
 * sixteen columns in a fixed order, an .xlsx with a bold frozen heading row
 * and a filter on every column, or a CSV that Excel reads as UTF-8. Text is
 * always text: a name like "=HYPERLINK(...)" can never run as a formula.
 *
 * The .xlsx is written by hand -- one sheet, inline strings, a stored (not
 * compressed) zip -- so the API carries no spreadsheet library.
 */

export interface LeadExportRow {
  created_at: string
  name: string | null
  phone: string | null
  email: string | null
  event_type: string | null
  event_date: string | null
  city: string | null
  venue: string | null
  guests: number | null
  budget: number | null
  said: string | null
  came_from: string | null
  partner: string | null
  stage: string | null
  handled_by: string | null
  follow_up_at: string | null
}

type Kind = 'text' | 'number'
export const LEAD_EXPORT_COLUMNS: readonly { title: string; kind: Kind; width: number }[] = [
  { title: 'Enquired on', kind: 'text', width: 17 },
  { title: 'Name', kind: 'text', width: 24 },
  { title: 'Mobile', kind: 'text', width: 13 },
  { title: 'Email', kind: 'text', width: 26 },
  { title: 'Event', kind: 'text', width: 16 },
  { title: 'Event date', kind: 'text', width: 12 },
  { title: 'City', kind: 'text', width: 14 },
  { title: 'Venue', kind: 'text', width: 20 },
  { title: 'Guests', kind: 'number', width: 9 },
  { title: 'Budget (₹)', kind: 'number', width: 13 },
  { title: 'What they said', kind: 'text', width: 40 },
  { title: 'Came from', kind: 'text', width: 16 },
  { title: 'Partner / QR code', kind: 'text', width: 20 },
  { title: 'Stage', kind: 'text', width: 14 },
  { title: 'Handled by', kind: 'text', width: 16 },
  { title: 'Next follow-up', kind: 'text', width: 17 },
]

const IST = 'Asia/Kolkata'

/** DD-MM-YYYY HH:MM in India time. */
export function istDateTime(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: IST,
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(d)
      .map((p) => [p.type, p.value]),
  )
  return `${parts.day}-${parts.month}-${parts.year} ${parts.hour}:${parts.minute}`
}

/** 2027-02-14 -> 14-02-2027 */
export function dmy(date: string | null): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(date ?? '')
  return m ? `${m[3]}-${m[2]}-${m[1]}` : ''
}

/** The cells of one lead, in column order. */
export function leadExportCells(r: LeadExportRow): (string | number | null)[] {
  const digits = (r.phone ?? '').replace(/\D/g, '')
  return [
    istDateTime(r.created_at),
    r.name ?? '',
    digits.length >= 10 ? digits.slice(-10) : digits,
    r.email ?? '',
    r.event_type ?? '',
    dmy(r.event_date),
    r.city ?? '',
    r.venue ?? '',
    r.guests ?? null,
    r.budget === null || r.budget === undefined ? null : Number(r.budget),
    r.said ?? '',
    r.came_from ?? '',
    r.partner ?? '',
    r.stage ?? '',
    r.handled_by ?? '',
    istDateTime(r.follow_up_at),
  ]
}

// ── CSV ─────────────────────────────────────────────────────────────
/** A cell Excel would run as a formula gets a leading apostrophe. */
export const defuse = (s: string): string => (/^[=+\-@\t\r]/.test(s) ? `'${s}` : s)

const csvCell = (v: string | number | null): string => {
  if (v === null) return ''
  const s = typeof v === 'number' ? String(v) : defuse(v)
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/** UTF-8 with a byte-order mark and CRLF line ends, so ₹ and Hindi names show in Excel. */
export function leadsCsv(rows: readonly LeadExportRow[]): string {
  const lines = [LEAD_EXPORT_COLUMNS.map((c) => csvCell(c.title)).join(',')]
  for (const r of rows) lines.push(leadExportCells(r).map(csvCell).join(','))
  return `\uFEFF${lines.join('\r\n')}\r\n`
}

// ── XLSX ────────────────────────────────────────────────────────────
const xml = (s: string): string =>
  s
    // Characters XML 1.0 cannot carry at all.
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')

const colName = (i: number): string => {
  let s = ''
  let n = i + 1
  while (n > 0) {
    const m = (n - 1) % 26
    s = String.fromCharCode(65 + m) + s
    n = Math.floor((n - 1) / 26)
  }
  return s
}

function sheetXml(rows: readonly LeadExportRow[]): string {
  const last = colName(LEAD_EXPORT_COLUMNS.length - 1)
  const cell = (ref: string, v: string | number | null, header: boolean): string => {
    if (v === null || v === '') return ''
    if (typeof v === 'number' && Number.isFinite(v)) return `<c r="${ref}" s="2"><v>${v}</v></c>`
    return `<c r="${ref}" t="inlineStr"${header ? ' s="1"' : ''}><is><t xml:space="preserve">${xml(String(v))}</t></is></c>`
  }
  const out: string[] = []
  out.push(
    `<row r="1">${LEAD_EXPORT_COLUMNS.map((c, i) => cell(`${colName(i)}1`, c.title, true)).join('')}</row>`,
  )
  rows.forEach((r, n) => {
    const rn = n + 2
    out.push(`<row r="${rn}">${leadExportCells(r).map((v, i) => cell(`${colName(i)}${rn}`, v, false)).join('')}</row>`)
  })
  const cols = LEAD_EXPORT_COLUMNS.map((c, i) => `<col min="${i + 1}" max="${i + 1}" width="${c.width}" customWidth="1"/>`).join('')
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
    `<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>` +
    `<cols>${cols}</cols>` +
    `<sheetData>${out.join('')}</sheetData>` +
    `<autoFilter ref="A1:${last}${rows.length + 1}"/>` +
    `</worksheet>`
  )
}

const STYLES =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
  `<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>` +
  `<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>` +
  `<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>` +
  `<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>` +
  `<cellXfs count="3">` +
  `<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>` +
  `<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>` +
  // Built-in format 3 is #,##0.
  `<xf numFmtId="3" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>` +
  `</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`

const WORKBOOK =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
  `<sheets><sheet name="Leads" sheetId="1" r:id="rId1"/></sheets>` +
  `<definedNames><definedName name="_xlnm._FilterDatabase" localSheetId="0" hidden="1">Leads!$A$1:$${colName(LEAD_EXPORT_COLUMNS.length - 1)}$1</definedName></definedNames>` +
  `</workbook>`

const WORKBOOK_RELS =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
  `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>` +
  `<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
  `</Relationships>`

const ROOT_RELS =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
  `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>` +
  `</Relationships>`

const CONTENT_TYPES =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
  `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
  `<Default Extension="xml" ContentType="application/xml"/>` +
  `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
  `<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>` +
  `<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>` +
  `</Types>`

const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

export function crc32(data: Uint8Array): number {
  let c = 0xffffffff
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]!) & 0xff]! ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

/** A zip with every file stored as is. Enough for an .xlsx; no compression library needed. */
export function storedZip(files: readonly { name: string; data: Uint8Array }[]): Uint8Array {
  const enc = new TextEncoder()
  const locals: Uint8Array[] = []
  const centrals: Uint8Array[] = []
  let offset = 0
  for (const f of files) {
    const name = enc.encode(f.name)
    const crc = crc32(f.data)
    const local = new Uint8Array(30 + name.length)
    const lv = new DataView(local.buffer)
    lv.setUint32(0, 0x04034b50, true)
    lv.setUint16(4, 20, true)
    lv.setUint16(6, 0x0800, true) // names are UTF-8
    lv.setUint16(8, 0, true) // stored
    lv.setUint16(10, 0, true)
    lv.setUint16(12, 0x21, true) // 1 Jan 1980
    lv.setUint32(14, crc, true)
    lv.setUint32(18, f.data.length, true)
    lv.setUint32(22, f.data.length, true)
    lv.setUint16(26, name.length, true)
    local.set(name, 30)
    locals.push(local, f.data)

    const central = new Uint8Array(46 + name.length)
    const cv = new DataView(central.buffer)
    cv.setUint32(0, 0x02014b50, true)
    cv.setUint16(4, 20, true)
    cv.setUint16(6, 20, true)
    cv.setUint16(8, 0x0800, true)
    cv.setUint16(10, 0, true)
    cv.setUint16(12, 0, true)
    cv.setUint16(14, 0x21, true)
    cv.setUint32(16, crc, true)
    cv.setUint32(20, f.data.length, true)
    cv.setUint32(24, f.data.length, true)
    cv.setUint16(28, name.length, true)
    cv.setUint32(42, offset, true)
    central.set(name, 46)
    centrals.push(central)
    offset += local.length + f.data.length
  }
  const centralSize = centrals.reduce((n, c) => n + c.length, 0)
  const end = new Uint8Array(22)
  const ev = new DataView(end.buffer)
  ev.setUint32(0, 0x06054b50, true)
  ev.setUint16(8, files.length, true)
  ev.setUint16(10, files.length, true)
  ev.setUint32(12, centralSize, true)
  ev.setUint32(16, offset, true)
  const parts = [...locals, ...centrals, end]
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let at = 0
  for (const p of parts) {
    out.set(p, at)
    at += p.length
  }
  return out
}

/** One sheet called "Leads". */
export function leadsXlsx(rows: readonly LeadExportRow[]): Uint8Array {
  const enc = new TextEncoder()
  return storedZip([
    { name: '[Content_Types].xml', data: enc.encode(CONTENT_TYPES) },
    { name: '_rels/.rels', data: enc.encode(ROOT_RELS) },
    { name: 'xl/workbook.xml', data: enc.encode(WORKBOOK) },
    { name: 'xl/_rels/workbook.xml.rels', data: enc.encode(WORKBOOK_RELS) },
    { name: 'xl/styles.xml', data: enc.encode(STYLES) },
    { name: 'xl/worksheets/sheet1.xml', data: enc.encode(sheetXml(rows)) },
  ])
}

export const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
export const CSV_TYPE = 'text/csv;charset=utf-8'

/** shubh-vivah-weddings-leads-kiran-florist-2026-10-18.xlsx */
export function leadsFileName(studio: string, part: string | null, day: string, format: 'xlsx' | 'csv'): string {
  const s = (x: string) =>
    x
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40)
      .replace(/-+$/g, '')
  return [s(studio) || 'studio', 'leads', part ? s(part) : null, day].filter(Boolean).join('-') + `.${format}`
}
