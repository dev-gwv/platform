import { Hono } from 'hono'
import {
  csvImportCommitRequest,
  csvImportCommitResponse,
  csvImportPreviewRequest,
  csvImportPreviewResponse,
  normalizePhone,
  type CsvImportRow,
} from '@ipc/contracts'
import { leadsFromCsv, parseCsv, parseImportDate, parseImportMoney, parseImportQuality } from '@ipc/domain'
import type { AppEnv } from '../../context'
import { requireAction } from '../../middleware/permissions'
import { fail } from '../../middleware/errors'
import { withUser } from '../../lib/db'
import { attempt } from '../../lib/attempt'
import { audit } from '../../lib/audit'

export const crmImportRoutes = new Hono<AppEnv>()
  // ── CSV import ──────────────────────────────────────────────
  // Preview parses on the API with the same RFC 4180 parser the tests cover,
  // then asks the database one question per distinct number: is it known?
  .post('/imports/preview', requireAction('crm', 'create'), async (c) => {
    const parsed = csvImportPreviewRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Paste or upload a CSV first.')
    const { columns, records } = leadsFromCsv(parseCsv(parsed.data.csv))
    if (records.length === 0) fail(422, 'That file has no rows.')
    if (records.length > 500) fail(422, 'Up to 500 rows per import. Split the file and try again.')

    const norms = [...new Set(records.map((r) => (r.phone ? normalizePhone(r.phone) : null)).filter((n): n is string => !!n))]
    const known = await attempt(c, 'crm.import_preview', () =>
      withUser(c.env, c.get('auth').userId, async (sql) => {
        if (norms.length === 0) return new Set<string>()
        const rows = await sql<{ phone_norm: string }[]>`
          select distinct phone_norm from crm_leads
          where is_archived = false and phone_norm in ${sql(norms)}`
        return new Set(rows.map((r) => r.phone_norm))
      }),
    )
    if (!known) fail(400, 'Preview failed.')

    const seen = new Set<string>()
    const rows: CsvImportRow[] = records.map((r) => {
      const norm = r.phone ? normalizePhone(r.phone) : null
      let error: string | null = null
      if (!r.phone) error = 'Phone is required'
      else if (!norm) error = 'Not a valid phone number'
      const inFile = !!norm && seen.has(norm)
      if (norm) seen.add(norm)
      const source = r.source && ['facebook', 'webform', 'referral', 'manual', 'enquiry'].includes(r.source.toLowerCase())
        ? (r.source.toLowerCase() as CsvImportRow['source'])
        : 'manual'

      // A cell that is present and unreadable is a warning, not an error: the
      // lead is still worth importing, and silently binning the shoot date is
      // what this whole change exists to stop.
      const warnings: string[] = []
      const eventDate = parseImportDate(r.event_date)
      if (r.event_date && !eventDate) warnings.push(`Could not read the date "${r.event_date}"`)
      const dealValue = parseImportMoney(r.deal_value)
      if (r.deal_value && dealValue === null) warnings.push(`Could not read the value "${r.deal_value}"`)
      const quality = parseImportQuality(r.quality)
      if (r.quality && !quality) warnings.push(`Not a quality we know: "${r.quality}"`)

      return {
        row: r.row,
        name: r.name,
        phone: r.phone,
        email: r.email,
        source,
        notes: r.notes,
        city: r.city,
        event_type: r.event_type,
        event_date: eventDate,
        event_location: r.event_location,
        deal_value: dealValue,
        alternate_phone: r.alternate_phone,
        quality,
        warnings,
        valid: !error,
        error: error ?? (inFile ? 'Repeated in this file' : null),
        phone_norm: norm,
        is_duplicate: !!norm && (known.has(norm) || inFile),
      }
    })
    return c.json(
      csvImportPreviewResponse.parse({
        columns,
        rows,
        total: rows.length,
        valid: rows.filter((r) => r.valid).length,
        duplicates: rows.filter((r) => r.is_duplicate).length,
      }),
    )
  })

  .post('/imports/commit', requireAction('crm', 'create'), async (c) => {
    const parsed = csvImportCommitRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Invalid import rows.')
    const { rows, skip_duplicates, mode } = parsed.data
    const result = await attempt(c, 'crm.import_commit', () =>
      withUser(c.env, c.get('auth').userId, async (sql) => {
        const out = await sql<{ r: unknown }[]>`
          select crm_import_leads(${sql.json(rows)}, ${skip_duplicates}, ${mode}) as r`
        return out[0]?.r ?? null
      }),
    )
    if (!result) fail(400, 'Import failed. Nothing was saved.')
    const summary = csvImportCommitResponse.parse(result)
    await audit(c, { action: 'lead.import', entityType: 'crm_lead', after: { rows: rows.length, mode, ...summary, ids: undefined } })
    return c.json(summary, 201)
  })
