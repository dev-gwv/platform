import { Hono } from 'hono'
import {
  createEnquiryPartnerRequest,
  enquiryFormLead,
  enquiryPartner,
  enquiryVendor,
  updateEnquiryPartnerRequest,
} from '@ipc/contracts'
import { joinKinds, partnerFormUrl, toIndianMobile } from '@ipc/domain'
import type { TransactionSql } from 'postgres'
import type { AppEnv } from '../../context'
import { requireAuth } from '../../middleware/auth'
import { requireModule } from '../../middleware/permissions'
import { fail } from '../../middleware/errors'
import { uuidParam } from '../../lib/params'
import { withUser } from '../../lib/db'
import { attempt } from '../../lib/attempt'
import { audit } from '../../lib/audit'
import { newRawToken } from '../../lib/auth-token'
import { appBase, canManageLeads, mainFormRow } from './shared'

/**
 * Partner QR codes (0274): a boutique, jeweller, venue or one of the studio's
 * vendors keeps the studio's QR at their counter -- the main form with
 * ?p=<code>. Enquiries through it are credited to them, and they can be sent
 * a private page of those enquiries. Owners and managers only.
 */

const selectPartners = (sql: TransactionSql) => sql`
  select p.id, p.name, p.label, p.party_id, v.name as vendor_name, p.phone, p.notes, p.code, p.view_token,
         p.show_phone, p.scans, coalesce(st.enquiries, 0)::int as enquiries, coalesce(st.booked, 0)::int as booked,
         st.last_enquiry_at, p.page_viewed_at, p.archived_at, p.created_at,
         p.after_submit, p.whatsapp_phone, p.whatsapp_text, p.redirect_url, p.thank_you
    from enquiry_partners p
    left join parties v on v.id = p.party_id
    left join enquiry_partner_stats st on st.partner_id = p.id`

type Row = Record<string, unknown> & { code: string; view_token: string | null }

async function formUrlOf(sql: TransactionSql, appUrl: string | undefined): Promise<string> {
  const form = await mainFormRow(sql)
  return `${appBase(appUrl)}/f/${form.slug ?? form.code}`
}

const toPartner = (appUrl: string | undefined, formUrl: string, r: Row) => {
  const { view_token, ...rest } = r
  return enquiryPartner.parse({
    ...rest,
    form_url: partnerFormUrl(formUrl, r.code),
    page_url: view_token ? `${appBase(appUrl)}/enquiry-view/${view_token}` : null,
  })
}

const pageToken = () => newRawToken().replace(/-/g, '')

/** A Postgres error raised by create_enquiry_partner, in its own words. */
const clash = (pg: string | undefined, err: unknown) =>
  pg === '23505' || pg === '22023' ? fail(pg === '23505' ? 409 : 422, (err as { message?: string }).message ?? 'Please check the partner.') : undefined

export const enquiryPartnersRouter = new Hono<AppEnv>()
  .use('*', requireAuth)
  .use('*', requireModule('crm'))
  .use('*', async (c, next) => {
    if (!canManageLeads(c.get('auth'))) fail(403, "Partner QR codes aren't on your screens. Ask the owner if you need them.")
    await next()
  })

  /** Live partners, busiest first; ?archived=true for the ended ones. */
  .get('/', async (c) => {
    const archived = c.req.query('archived') === 'true'
    const out = await attempt(c, 'enquiry_partners.list', () =>
      withUser(c.env, c.get('auth').userId, async (sql) => {
        const formUrl = await formUrlOf(sql, c.env.APP_URL)
        const rows = await sql<Row[]>`
          ${selectPartners(sql)}
           where (p.archived_at is not null) = ${archived}
           order by coalesce(st.enquiries, 0) desc, p.scans desc, lower(p.name)`
        return { formUrl, rows }
      }),
    )
    if (!out) fail(400, 'We could not load your partners.')
    return c.json(out.rows.map((r) => toPartner(c.env.APP_URL, out.formUrl, r)))
  })

  /** Vendors (Settings → Vendors) and whether each has a partner QR yet. */
  .get('/vendors', async (c) => {
    const rows = await attempt(c, 'enquiry_partners.vendors', () =>
      withUser(c.env, c.get('auth').userId, (sql) => sql`
        select v.id, v.name, v.phone, v.categories, v.state,
               (select p.id from enquiry_partners p where p.party_id = v.id order by p.archived_at nulls first limit 1) as partner_id
          from parties v
         where v.kind = 'vendor' and coalesce(v.is_active, true)
         order by lower(v.name)`),
    )
    if (!rows) fail(400, 'We could not load your vendors.')
    return c.json(enquiryVendor.array().parse(rows))
  })

  .post('/', async (c) => {
    const parsed = createEnquiryPartnerRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, parsed.error.issues[0]?.message ?? 'Please check the partner.')
    const d = parsed.data
    const phone = d.phone ? toIndianMobile(d.phone) : null
    if (d.phone && !phone) fail(422, 'Enter a valid 10-digit mobile number')
    const out = await attempt(
      c,
      'enquiry_partners.create',
      () =>
        withUser(c.env, c.get('auth').userId, async (sql) => {
          const [made] = await sql<{ id: string }[]>`
            select (create_enquiry_partner(${d.name}, ${d.label ?? null}, ${phone}, ${d.party_id ?? null},
                                           ${d.notes ?? null}, ${pageToken()})).id`
          const formUrl = await formUrlOf(sql, c.env.APP_URL)
          const rows = await sql<Row[]>`${selectPartners(sql)} where p.id = ${made!.id}`
          return { formUrl, row: rows[0]! }
        }),
      { onCode: clash },
    )
    if (!out) fail(400, 'We could not add the partner.')
    const partner = toPartner(c.env.APP_URL, out.formUrl, out.row)
    await audit(c, { action: 'enquiry_partner.create', entityType: 'enquiry_partner', entityId: partner.id, after: { name: partner.name } })
    return c.json(partner, 201)
  })

  /** "Make QR" on a vendor: a partner with the vendor's name, phone and kinds. */
  .post('/from-vendor/:id', async (c) => {
    const vendorId = uuidParam(c)
    const out = await attempt(
      c,
      'enquiry_partners.from_vendor',
      () =>
        withUser(c.env, c.get('auth').userId, async (sql) => {
          const [v] = await sql<{ name: string; phone: string | null; categories: string[] }[]>`
            select name, phone, categories from parties where id = ${vendorId}`
          if (!v) return 'missing' as const
          const [had] = await sql<{ id: string }[]>`select id from enquiry_partners where party_id = ${vendorId} limit 1`
          const id = had?.id ?? (
            await sql<{ id: string }[]>`
              select (create_enquiry_partner(${v.name.trim().slice(0, 80)}, ${joinKinds(v.categories)},
                                             ${toIndianMobile(v.phone)}, ${vendorId}, null, ${pageToken()})).id`
          )[0]!.id
          const formUrl = await formUrlOf(sql, c.env.APP_URL)
          const rows = await sql<Row[]>`${selectPartners(sql)} where p.id = ${id}`
          return { formUrl, row: rows[0]! }
        }),
      { onCode: clash },
    )
    if (!out) fail(400, 'We could not make the QR code.')
    if (out === 'missing') fail(404, 'That vendor was not found.')
    const partner = toPartner(c.env.APP_URL, out.formUrl, out.row)
    await audit(c, { action: 'enquiry_partner.from_vendor', entityType: 'enquiry_partner', entityId: partner.id, after: { vendor: vendorId } })
    return c.json(partner, 201)
  })

  .get('/:id', async (c) => {
    const id = uuidParam(c)
    const out = await attempt(c, 'enquiry_partners.get', () =>
      withUser(c.env, c.get('auth').userId, async (sql) => {
        const formUrl = await formUrlOf(sql, c.env.APP_URL)
        const rows = await sql<Row[]>`${selectPartners(sql)} where p.id = ${id}`
        return { formUrl, row: rows[0] }
      }),
    )
    if (!out) fail(400, 'We could not load this partner.')
    if (!out.row) fail(404, 'That partner was not found.')
    return c.json(toPartner(c.env.APP_URL, out.formUrl, out.row))
  })

  /** Their enquiries, newest first. */
  .get('/:id/leads', async (c) => {
    const id = uuidParam(c)
    const rows = await attempt(c, 'enquiry_partners.leads', () =>
      withUser(c.env, c.get('auth').userId, (sql) => sql`
        select l.id, l.name, l.phone, l.email, l.status, l.event_type, l.event_date, l.created_at
          from crm_leads l
         where l.partner_id = ${id} and l.merged_into is null and coalesce(l.is_archived, false) = false
         order by l.created_at desc
         limit 500`),
    )
    if (!rows) fail(400, 'We could not load the enquiries.')
    return c.json(enquiryFormLead.array().parse(rows))
  })

  .patch('/:id', async (c) => {
    const id = uuidParam(c)
    const parsed = updateEnquiryPartnerRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, parsed.error.issues[0]?.message ?? 'Please check the partner.')
    const { archived, ...rest } = parsed.data
    const patch: Record<string, unknown> = Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined))
    if (typeof patch.name === 'string') patch.name = patch.name.trim()
    if (patch.phone !== undefined) {
      const raw = (patch.phone as string | null) ?? ''
      if (raw.trim() === '') patch.phone = null
      else {
        const phone = toIndianMobile(raw)
        if (!phone) fail(422, 'Enter a valid 10-digit mobile number')
        patch.phone = phone
      }
    }
    if (archived !== undefined) patch.archived_at = archived ? new Date().toISOString() : null
    // Their QR's own after-send (0281), checked the way the main form's is.
    if (patch.after_submit === null) {
      // "Same as your main form": nothing of their own is kept.
      Object.assign(patch, { whatsapp_phone: null, whatsapp_text: null, redirect_url: null, thank_you: null })
    } else {
      if (patch.whatsapp_phone !== undefined) {
        const raw = (patch.whatsapp_phone as string | null) ?? ''
        if (raw.trim() === '') patch.whatsapp_phone = null
        else {
          const wa = toIndianMobile(raw)
          if (!wa) return c.json({ error: 'Enter a valid 10-digit mobile number', field: 'whatsapp_phone' }, 422)
          patch.whatsapp_phone = wa
        }
      }
      if (patch.whatsapp_text !== undefined) patch.whatsapp_text = (patch.whatsapp_text as string | null)?.trim() || null
      if (patch.thank_you !== undefined) patch.thank_you = (patch.thank_you as string | null)?.trim() || null
      if (patch.redirect_url !== undefined) {
        const url = ((patch.redirect_url as string | null) ?? '').trim()
        if (url === '') patch.redirect_url = null
        else if (!/^https:\/\/[^\s<>"]+$/.test(url)) return c.json({ error: 'Paste a link that starts with https://', field: 'redirect_url' }, 422)
        else patch.redirect_url = url
      }
      if (patch.after_submit !== undefined || patch.whatsapp_phone !== undefined || patch.redirect_url !== undefined) {
        const check = await attempt(c, 'enquiry_partners.after_check', () =>
          withUser(c.env, c.get('auth').userId, async (sql) => {
            const form = await mainFormRow(sql)
            return sql<{ after_submit: string | null; whatsapp_phone: string | null; redirect_url: string | null; fallback: string | null }[]>`
              select p.after_submit, p.whatsapp_phone, p.redirect_url,
                     coalesce(f.whatsapp_phone, enquiry_default_whatsapp(p.company_id)) as fallback
                from enquiry_partners p, enquiry_forms f
               where p.id = ${id} and f.id = ${form.id}`
          }),
        )
        const cur = check?.[0]
        if (cur) {
          const after = patch.after_submit !== undefined ? (patch.after_submit as string | null) : cur.after_submit
          const wa = patch.whatsapp_phone !== undefined ? patch.whatsapp_phone : cur.whatsapp_phone
          const link = patch.redirect_url !== undefined ? patch.redirect_url : cur.redirect_url
          if (after === 'whatsapp' && !wa && !cur.fallback) return c.json({ error: 'Add the WhatsApp number', field: 'whatsapp_phone' }, 422)
          if (after === 'link' && !link) return c.json({ error: 'Paste the link to open', field: 'redirect_url' }, 422)
        }
      }
    }
    if (typeof patch.name === 'string') {
      const name = patch.name
      const dupes = await attempt(c, 'enquiry_partners.name_check', () =>
        withUser(c.env, c.get('auth').userId, (sql) => sql<{ archived_at: string | null }[]>`
          select archived_at from enquiry_partners
           where company_id = get_current_company_id() and lower(name) = lower(${name}) and id <> ${id}`),
      )
      const dupe = dupes?.[0]
      if (dupe) fail(409, dupe.archived_at ? 'An archived partner has this name. Bring them back instead.' : 'You already have a partner with this name.')
    }
    const out = await attempt(
      c,
      'enquiry_partners.update',
      () =>
        withUser(c.env, c.get('auth').userId, async (sql) => {
          const done = await sql`update enquiry_partners set ${sql(patch)} where id = ${id} returning id`
          if (!done[0]) return 'missing' as const
          const formUrl = await formUrlOf(sql, c.env.APP_URL)
          const rows = await sql<Row[]>`${selectPartners(sql)} where p.id = ${id}`
          return { formUrl, row: rows[0]! }
        }),
      { onCode: clash },
    )
    if (!out) fail(400, 'We could not save the partner.')
    if (out === 'missing') fail(404, 'That partner was not found.')
    const action = archived === true ? 'archive' : archived === false ? 'restore' : 'update'
    await audit(c, { action: `enquiry_partner.${action}`, entityType: 'enquiry_partner', entityId: id, after: parsed.data })
    return c.json(toPartner(c.env.APP_URL, out.formUrl, out.row))
  })

  /** Their page: on makes a new link (the old one stops at once); off stops sharing. */
  .post('/:id/sharing', async (c) => {
    const id = uuidParam(c)
    const body = (await c.req.json().catch(() => ({}))) as { on?: unknown }
    if (typeof body.on !== 'boolean') fail(422, 'Please say whether sharing is on or off.')
    const token = body.on ? pageToken() : null
    const out = await attempt(c, 'enquiry_partners.sharing', () =>
      withUser(c.env, c.get('auth').userId, async (sql) => {
        const done = await sql`update enquiry_partners set view_token = ${token} where id = ${id} returning id`
        if (!done[0]) return 'missing' as const
        const formUrl = await formUrlOf(sql, c.env.APP_URL)
        const rows = await sql<Row[]>`${selectPartners(sql)} where p.id = ${id}`
        return { formUrl, row: rows[0]! }
      }),
    )
    if (!out) fail(400, 'We could not change the page link.')
    if (out === 'missing') fail(404, 'That partner was not found.')
    await audit(c, { action: body.on ? 'enquiry_partner.shared' : 'enquiry_partner.sharing_stopped', entityType: 'enquiry_partner', entityId: id })
    return c.json(toPartner(c.env.APP_URL, out.formUrl, out.row))
  })
