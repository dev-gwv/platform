import { createSign } from 'node:crypto'
import type { Env } from '../context'
import { withService } from './db'
import { log, describeError } from './log'

/**
 * The IPC Diamond member list (0262). The platform owner keeps it in a Google
 * Sheet; every hour (and on "Refresh now") the phone numbers in it are copied
 * into diamond_roster, which is what an owner's number is checked against.
 *
 * Two ways in, whichever the sheet allows:
 *   * a Google service account (GOOGLE_SA_EMAIL + GOOGLE_SA_PRIVATE_KEY on the
 *     server, the sheet shared with that address), or
 *   * the sheet shared as "Anyone with the link can view", read as CSV.
 * Only the numbers (last ten digits) and a name beside them are kept.
 */

export interface RosterRow {
  phone: string
  name: string | null
}

/** Where a pasted sheet link points: the spreadsheet, and the tab when the link names one. */
export function sheetRef(url: string): { id: string; gid: string | null } | null {
  const m = /\/spreadsheets\/d\/([A-Za-z0-9_-]{20,})/.exec(url)
  if (!m) return null
  const gid = /[#?&]gid=([0-9]+)/.exec(url)
  return { id: m[1]!, gid: gid ? gid[1]! : null }
}

/** RFC 4180 CSV: quoted cells, doubled quotes, commas and newlines inside quotes. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"'
        i++
      } else if (ch === '"') quoted = false
      else cell += ch
    } else if (ch === '"') quoted = true
    else if (ch === ',') {
      row.push(cell)
      cell = ''
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++
      row.push(cell)
      rows.push(row)
      row = []
      cell = ''
    } else cell += ch
  }
  if (cell !== '' || row.length > 0) {
    row.push(cell)
    rows.push(row)
  }
  return rows
}

/** An Indian mobile at the head of a run of digits: an optional 91 or 0, then ten digits from 6 to 9. */
const MOBILE_AT_HEAD = /^(?:91|0)?([6-9]\d{9})/

/**
 * Every Indian mobile number in one cell, as its last ten digits. Forgiving
 * on purpose (owner, 20 Oct: members on the list were refused): "98765 43210 /
 * +91-91234-56780", two numbers with one space or a comma between them,
 * "98,765,43,210" from a number-formatted cell, and "9.87654321E+09".
 */
export function phonesIn(cell: string): string[] {
  let text = cell.trim()
  // A cell Google wrote out in scientific notation.
  if (/^\d(?:\.\d+)?e\+?\d{1,2}$/i.test(text)) {
    const n = Number(text)
    if (Number.isFinite(n)) text = n.toFixed(0)
  }
  // Grouping marks inside one number ("98,765,43,210", "9.876.543.210").
  text = text.replace(/(\d)[,.](?=\d)/g, '$1')
  const out: string[] = []
  for (const part of text.split(/[/,;|]|\s{2,}|\bor\b|\band\b|&/i)) {
    let d = part.replace(/[^0-9]/g, '')
    if (d.length >= 10 && d.length <= 13) {
      out.push(d.slice(-10))
      continue
    }
    // Two or more numbers run together: take each mobile from the front.
    while (d.length >= 10) {
      const m = MOBILE_AT_HEAD.exec(d)
      if (m) {
        out.push(m[1]!)
        d = d.slice(m[0].length)
      } else d = d.slice(1)
    }
  }
  return [...new Set(out)]
}

const PHONE_HEAD = /phone|mobile|mob\b|mob\.|whats ?app|contact|number|no\.|cell/i
const NAME_HEAD = /name/i

/** A column is a phone column when at least half of its filled cells hold a number. */
function mostlyPhones(rows: string[][], col: number): boolean {
  let filled = 0
  let hits = 0
  for (const r of rows) {
    const v = (r[col] ?? '').trim()
    if (!v) continue
    filled++
    if (phonesIn(v).length > 0) hits++
  }
  return filled > 0 && hits * 2 >= filled
}

/**
 * The member list out of a sheet's rows. Every column whose heading says
 * phone / mobile / WhatsApp / number, and every other column that is mostly
 * phone numbers (an "Alternate" or "Mob." column), is read. The first row is
 * data, not a heading, when it already holds a number. The name column, if
 * any, says "name".
 */
export function rosterFromRows(rows: string[][]): RosterRow[] {
  if (rows.length === 0) return []
  const head = rows[0]!.map((h) => h.trim())
  const width = Math.max(...rows.map((r) => r.length))
  const headed = head.map((h, i) => (PHONE_HEAD.test(h) && !NAME_HEAD.test(h) ? i : -1)).filter((i) => i >= 0)
  const firstIsData = head.some((h) => phonesIn(h).length > 0)
  const body = firstIsData ? rows : rows.slice(1)
  const phoneCols: number[] = []
  for (let i = 0; i < width; i++) {
    if (headed.includes(i) || mostlyPhones(body, i)) phoneCols.push(i)
  }
  if (phoneCols.length === 0) return []
  const nameCol = firstIsData ? -1 : head.findIndex((h, i) => NAME_HEAD.test(h) && !phoneCols.includes(i))
  const seen = new Map<string, RosterRow>()
  for (const r of body) {
    const name = nameCol >= 0 ? (r[nameCol] ?? '').trim().slice(0, 120) || null : null
    for (const col of phoneCols) {
      for (const phone of phonesIn(r[col] ?? '')) {
        if (!seen.has(phone)) seen.set(phone, { phone, name })
      }
    }
  }
  return [...seen.values()]
}

/** Every tab's members together, each number once (the first tab's name wins). */
export function rosterFromTabs(tabs: string[][][]): RosterRow[] {
  const seen = new Map<string, RosterRow>()
  for (const tab of tabs) for (const r of rosterFromRows(tab)) if (!seen.has(r.phone)) seen.set(r.phone, r)
  return [...seen.values()]
}

async function serviceToken(env: Env): Promise<string | null> {
  const email = env.GOOGLE_SA_EMAIL
  const key = (env.GOOGLE_SA_PRIVATE_KEY ?? '').replace(/\\n/g, '\n')
  if (!email || !key) return null
  const now = Math.floor(Date.now() / 1000)
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url')
  const unsigned = `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64({
    iss: email,
    scope: 'https://www.googleapis.com/auth/spreadsheets.readonly',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  })}`
  const sig = createSign('RSA-SHA256').update(unsigned).sign(key).toString('base64url')
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${unsigned}.${sig}`,
  })
  const j = (await res.json().catch(() => ({}))) as { access_token?: string }
  return j.access_token ?? null
}

/** The sheet's cells, by the service account when the server has one, else as a public CSV. */
async function readSheet(env: Env, url: string): Promise<string[][][]> {
  const ref = sheetRef(url)
  if (!ref) {
    // A "Publish to the web" CSV link is read as it is.
    if (!/^https:\/\/docs\.google\.com\//.test(url) || !/output=csv/.test(url)) {
      throw new Error('That is not a Google Sheet link. Copy the link from the sheet’s address bar.')
    }
    return [parseCsv(await fetchCsv(url))]
  }
  const token = await serviceToken(env).catch(() => null)
  if (token) {
    const auth = { Authorization: `Bearer ${token}` }
    const meta = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${ref.id}?fields=sheets.properties`, { headers: auth })
    const m = (await meta.json().catch(() => ({}))) as { sheets?: { properties?: { sheetId?: number; title?: string } }[] }
    // The linked tab only, or every tab when the link names none (members kept on several tabs).
    const titles = (m.sheets ?? [])
      .filter((t) => !ref.gid || String(t.properties?.sheetId) === ref.gid)
      .map((t) => t.properties?.title)
      .filter((t): t is string => !!t)
    const ranges = titles.length > 0 ? titles.map((t) => `'${t.replace(/'/g, "''")}'!A1:Z10000`) : ['A1:Z10000']
    const tabs: string[][][] = []
    for (const range of ranges) {
      // Unformatted, so a number cell is 9876543210, never "9.88E+09" or "98,765,43,210".
      const res = await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${ref.id}/values/${encodeURIComponent(range)}?valueRenderOption=UNFORMATTED_VALUE`,
        { headers: auth },
      )
      if (!res.ok) continue
      const j = (await res.json()) as { values?: unknown[][] }
      // Each tab keeps its own heading row, so each is read on its own.
      tabs.push((j.values ?? []).map((r) => r.map((v) => (typeof v === 'number' ? v.toFixed(0) : String(v ?? '')))))
    }
    if (tabs.length > 0) return tabs
    // Not shared with the service account: try the public way before giving up.
  }
  const csv = `https://docs.google.com/spreadsheets/d/${ref.id}/export?format=csv${ref.gid ? `&gid=${ref.gid}` : ''}`
  return [parseCsv(await fetchCsv(csv))]
}

async function fetchCsv(url: string): Promise<string> {
  const res = await fetch(url, { redirect: 'follow' })
  const type = res.headers.get('content-type') ?? ''
  if (!res.ok || type.includes('text/html')) {
    throw new Error(
      'Google would not share the sheet. In the sheet press Share → General access → “Anyone with the link” (Viewer), then refresh.',
    )
  }
  return res.text()
}

export interface SheetSync {
  ok: boolean
  rows: number
  error: string | null
}

/**
 * Copy the member list in. A sheet that reads but holds no numbers keeps the
 * old list (an emptied sheet by mistake must not lock every member out).
 */
export async function syncDiamondSheet(env: Env): Promise<SheetSync> {
  const [setting] = await withService(env, (sql) => sql<{ url: string | null }[]>`
    select diamond_sheet_url as url from platform_settings limit 1`)
  const url = setting?.url
  if (!url) return { ok: false, rows: 0, error: null }
  let roster: RosterRow[]
  try {
    roster = rosterFromTabs(await readSheet(env, url))
  } catch (e) {
    const error = e instanceof Error ? e.message.slice(0, 300) : 'The sheet could not be read.'
    log.warn({ err: describeError(e) }, 'diamond sheet read failed')
    await withService(env, (sql) => sql`update platform_settings set diamond_sheet_error = ${error}`)
    return { ok: false, rows: 0, error }
  }
  if (roster.length === 0) {
    const error = 'No phone numbers were found in the sheet. Keep the numbers in a column headed “Phone” or “Mobile”.'
    await withService(env, (sql) => sql`update platform_settings set diamond_sheet_error = ${error}`)
    return { ok: false, rows: 0, error }
  }
  // One transaction (withService): members are never looked up against a half-copied list.
  await withService(env, async (sql) => {
    await sql`delete from diamond_roster`
    for (let i = 0; i < roster.length; i += 500) {
      const chunk = roster.slice(i, i + 500)
      await sql`insert into diamond_roster ${sql(chunk, 'phone', 'name')} on conflict (phone) do nothing`
    }
    await sql`update platform_settings
                 set diamond_sheet_synced_at = now(), diamond_sheet_rows = ${roster.length}, diamond_sheet_error = null`
  })
  return { ok: true, rows: roster.length, error: null }
}
