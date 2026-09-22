import {
  addMemberRequest,
  type AddMemberRequest,
  type EmployeeRole,
  type LibraryRole,
  type ProductionStage,
} from '@ipc/contracts'
import { stageOf } from './role-stages'

/**
 * Bulk add — many people in one table instead of the six-step wizard once per
 * person. Kept pure and out of the component so the rules (what a row needs,
 * how a pasted spreadsheet maps onto columns, which rows clash) are testable
 * without rendering anything.
 *
 * A bulk row asks only what a studio has to hand for everyone at once: who
 * they are, how to reach them, whether and how they sign in, and what they
 * do. Pay is deliberately absent — it differs per person, is sensitive, and
 * is one Edit away once the team exists.
 */

export type BulkAccess = 'employee' | 'manager' | 'admin'
export type BulkEngagement = 'in_house' | 'freelancer'
export type BulkStatus = 'draft' | 'saving' | 'added' | 'failed'

export interface BulkRow {
  /** Local identity for React and for matching results back to rows. */
  key: string
  name: string
  phone: string
  /** Blank means "no login": the person is bookable but cannot sign in. */
  email: string
  password: string
  role: BulkAccess
  engagement: BulkEngagement
  /** Job roles, each a {@link PickableRole.key}. */
  roleKeys: string[]
  status: BulkStatus
  /** The server's reason, when this row was sent and refused. */
  error: string | null
}

/**
 * A job role that can be put on a row: either one the studio already has
 * (`key` is its id) or a library default it has not taken yet (`key` is
 * `lib:<role_code>`, created the first time a row that uses it is sent).
 *
 * The same single list the wizard offers, for the same reason: whether
 * "Candid Photographer" is already one of the studio's roles is not a
 * question the person typing a team in has any reason to hold an answer to.
 */
export interface PickableRole {
  key: string
  type_name: string
  role_code: string
  stage: ProductionStage
  owned: boolean
}

export type RowField = 'name' | 'phone' | 'email' | 'password'
export type RowErrors = Partial<Record<RowField, string>>

let seq = 0
export const newRow = (): BulkRow => ({
  key: `row-${++seq}`,
  name: '',
  phone: '',
  email: '',
  password: '',
  role: 'employee',
  engagement: 'in_house',
  roleKeys: [],
  status: 'draft',
  error: null,
})

/**
 * A row nobody has started. Ignored on submit rather than reported as invalid.
 *
 * Only who-they-are counts. "Same password for everyone" and "use these job
 * roles for every row" fill the spare empty rows too, and a password or a job
 * role with nobody attached to it is not a person to add.
 */
export const isBlankRow = (r: BulkRow): boolean => !r.name.trim() && !r.phone.trim() && !r.email.trim()

/** Rows that still need sending: typed-in and not already added. */
export const pendingRows = (rows: readonly BulkRow[]): BulkRow[] =>
  rows.filter((r) => r.status !== 'added' && !isBlankRow(r))

const LIB = 'lib:'
export const isLibraryKey = (key: string): boolean => key.startsWith(LIB)
export const libraryKey = (roleCode: string): string => LIB + roleCode

export function pickableRoles(
  owned: readonly EmployeeRole[],
  library: readonly LibraryRole[],
): PickableRole[] {
  const taken = new Set(owned.map((r) => r.role_code))
  return [
    ...owned.map((r) => ({
      key: r.id,
      type_name: r.type_name,
      role_code: r.role_code,
      stage: stageOf(r),
      owned: true,
    })),
    ...library
      .filter((r) => !taken.has(r.role_code))
      .map((r) => ({
        key: libraryKey(r.role_code),
        type_name: r.type_name,
        role_code: r.role_code,
        stage: r.stage,
        owned: false,
      })),
  ]
}

/**
 * The request a row becomes. An email is what makes it a login: with one, the
 * person signs in with the password beside it; without one, they are added
 * directory-only, which is exactly how the wizard treats a member without a
 * login. `resolveRoleId` turns a pickable key into a real role id, and drops
 * anything it cannot resolve rather than failing the whole row over it.
 */
export function toRequest(row: BulkRow, resolveRoleId: (key: string) => string | null): AddMemberRequest {
  const email = row.email.trim()
  const login = email.length > 0
  return {
    engagement_type: row.engagement,
    create_login: login,
    name: row.name.trim(),
    phone: row.phone.trim(),
    ...(login ? { email, password: row.password } : {}),
    role: row.role,
    role_ids: row.roleKeys.map(resolveRoleId).filter((id): id is string => !!id),
    pay_components: [],
    payment_status: 'active',
  }
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/**
 * Every problem on every row, in words the person can act on — plus the two
 * clashes a spreadsheet produces and a single form never can: the same email
 * or phone typed on two rows.
 *
 * The field checks mirror `addMemberRequest`; the contract is then run as a
 * final gate so a rule this function forgot can never reach the server as a
 * surprise 422.
 */
export function validateRows(rows: readonly BulkRow[]): Map<string, RowErrors> {
  const out = new Map<string, RowErrors>()
  const live = pendingRows(rows)
  const firstEmail = new Map<string, number>()
  const firstPhone = new Map<string, number>()

  live.forEach((r) => {
    const n = rows.indexOf(r) + 1
    const e: RowErrors = {}
    const name = r.name.trim()
    const phone = r.phone.trim()
    const email = r.email.trim().toLowerCase()

    if (name.length < 2) e.name = name ? 'At least 2 letters' : 'Name is required'
    else if (name.length > 120) e.name = 'Too long'

    if (!phone) e.phone = 'Phone is required'
    else if (phone.length < 6) e.phone = 'Too short'
    else if (phone.length > 20) e.phone = 'Too long'

    if (email && !EMAIL.test(email)) e.email = "Doesn't look like an email"
    if (email && r.password.length < 6) {
      e.password = r.password ? 'At least 6 characters' : 'Needed to sign in'
    } else if (email && r.password.length > 72) {
      e.password = 'Too long'
    }

    if (email && !e.email) {
      const seen = firstEmail.get(email)
      if (seen !== undefined) e.email = `Same as row ${seen}`
      else firstEmail.set(email, n)
    }
    if (phone && !e.phone) {
      const key = phone.replace(/\D/g, '')
      const seen = firstPhone.get(key)
      if (seen !== undefined) e.phone = `Same as row ${seen}`
      else firstPhone.set(key, n)
    }

    if (Object.keys(e).length === 0 && !addMemberRequest.safeParse(toRequest(r, () => null)).success) {
      e.name = 'Please check this row'
    }
    if (Object.keys(e).length > 0) out.set(r.key, e)
  })
  return out
}

// ── Paste from a spreadsheet ──────────────────────────────────────────

/** Column order assumed when a pasted block has no header row. */
export const DEFAULT_PASTE_COLUMNS = ['Name', 'Phone', 'Email', 'Password', 'Job roles'] as const

type Column = 'name' | 'phone' | 'email' | 'password' | 'roles' | 'access' | 'type'

/**
 * Header words mapped to columns. "Role" means job role here — in a studio's
 * own sheet it is "Photographer", not "Manager". The access level only has
 * its own column if the sheet says "access".
 */
const HEADER_WORDS: Record<Column, readonly string[]> = {
  name: ['name', 'full name', 'member', 'person', 'employee', 'team member'],
  phone: ['phone', 'mobile', 'phone number', 'mobile number', 'contact', 'whatsapp', 'number'],
  email: ['email', 'e-mail', 'mail', 'email id', 'email address'],
  password: ['password', 'pass', 'pwd'],
  roles: ['role', 'roles', 'job role', 'job roles', 'designation', 'position', 'skill', 'skills'],
  access: ['access', 'access level', 'permission', 'permissions'],
  type: ['type', 'engagement', 'employment', 'employment type'],
}

const DEFAULT_ORDER: Column[] = ['name', 'phone', 'email', 'password', 'roles']

/** One line of CSV or TSV into cells. Handles quoted cells with commas and doubled quotes. */
function splitLine(line: string, delimiter: string): string[] {
  if (delimiter === '\t') return line.split('\t').map((c) => c.trim())
  const cells: string[] = []
  let cur = ''
  let quoted = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"'
        i++
      } else if (ch === '"') quoted = false
      else cur += ch
    } else if (ch === '"') quoted = true
    else if (ch === delimiter) {
      cells.push(cur.trim())
      cur = ''
    } else cur += ch
  }
  cells.push(cur.trim())
  return cells
}

function columnFor(header: string): Column | null {
  const h = header.trim().toLowerCase().replace(/[*:]/g, '').trim()
  for (const [col, words] of Object.entries(HEADER_WORDS) as [Column, readonly string[]][]) {
    if (words.includes(h)) return col
  }
  return null
}

const toAccess = (v: string): BulkAccess => {
  const s = v.trim().toLowerCase()
  return s === 'admin' || s === 'manager' ? s : 'employee'
}

const toEngagement = (v: string): BulkEngagement =>
  /free|vendor|contract|part/i.test(v) ? 'freelancer' : 'in_house'

/**
 * Turn a block copied out of Excel or Google Sheets (tab-separated) or a CSV
 * into rows. A header row, if there is one, decides which column is which, in
 * any order; without one, the columns are read as {@link DEFAULT_PASTE_COLUMNS}.
 *
 * Job-role names are matched to the studio's roles and the library by name,
 * ignoring case. Names that match nothing are returned, not silently dropped,
 * so the screen can say which ones it could not place.
 */
export function parsePastedTeam(
  text: string,
  pickable: readonly PickableRole[],
): { rows: BulkRow[]; unknownRoles: string[] } {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0)
  if (lines.length === 0) return { rows: [], unknownRoles: [] }

  const delimiter = lines[0]!.includes('\t') ? '\t' : ','
  const first = splitLine(lines[0]!, delimiter)
  const mapped = first.map(columnFor)
  const hasHeader = mapped.includes('name') && mapped.filter(Boolean).length >= 2
  const order: (Column | null)[] = hasHeader ? mapped : DEFAULT_ORDER
  const body = hasHeader ? lines.slice(1) : lines

  const byName = new Map<string, string>()
  for (const r of pickable) {
    byName.set(r.type_name.trim().toLowerCase(), r.key)
    byName.set(r.role_code.trim().toLowerCase(), r.key)
  }
  const unknown = new Set<string>()

  const rows = body.map((line) => {
    const cells = splitLine(line, delimiter)
    const row = newRow()
    order.forEach((col, i) => {
      const v = cells[i] ?? ''
      if (!col || !v) return
      if (col === 'name') row.name = v
      else if (col === 'phone') row.phone = v
      else if (col === 'email') row.email = v
      else if (col === 'password') row.password = v
      else if (col === 'access') row.role = toAccess(v)
      else if (col === 'type') row.engagement = toEngagement(v)
      else if (col === 'roles') {
        for (const part of v.split(/[,/;|]/)) {
          const name = part.trim()
          if (!name) continue
          const key = byName.get(name.toLowerCase())
          if (key) {
            if (!row.roleKeys.includes(key)) row.roleKeys.push(key)
          } else unknown.add(name)
        }
      }
    })
    return row
  })

  return { rows: rows.filter((r) => !isBlankRow(r)), unknownRoles: [...unknown] }
}
