import { Hono } from 'hono'
import {
  createEnquiryFormRequest,
  enquiryForm,
  enquiryFormLead,
  enquiryFormPageRequest,
  publicEnquiryForm,
  publicEnquiryView,
  submitEnquiryRequest,
  updateEnquiryFormRequest,
} from '@ipc/contracts'
import type { TransactionSql } from 'postgres'
import type { AppEnv } from '../../context'
import { requireAuth } from '../../middleware/auth'
import { requireAction, requireModule } from '../../middleware/permissions'
import { fail } from '../../middleware/errors'
import { textParam, uuidParam } from '../../lib/params'
import { withService, withUser } from '../../lib/db'
import { attempt } from '../../lib/attempt'
import { audit } from '../../lib/audit'
import { newRawToken } from '../../lib/auth-token'
import { enquiryEmbedCode } from '@ipc/domain'

/**
 * Enquiry forms (0195): one QR per vendor the studio works with.
 *
 * Studio side, under /enquiry-forms, on the CRM permissions -- a form is a
 * lead source with a face. Public side, under /public/enquiry: the form the
 * QR opens, and the vendor's own page of what their QR brought in. Both go
 * through SECURITY DEFINER functions as service_role and take nothing but the
 * code or token in the link.
 */

const base = (appUrl: string | undefined) => (appUrl ?? '').replace(/\/+$/, '')

const selectForms = (sql: TransactionSql) => sql`
  select f.id, f.name, f.kind, f.phone, f.notes, f.code, f.source_id, f.show_phone, f.is_active,
         f.archived_at, f.created_at, f.scans, f.page_views, f.page_viewed_at, f.view_token,
         f.purpose, f.title, f.intro, f.thank_you, f.accent, f.show_logo, f.fields,
         coalesce(st.enquiries, 0)::int as enquiries, coalesce(st.booked, 0)::int as booked,
         st.last_enquiry_at
    from enquiry_forms f
    left join enquiry_form_stats st on st.form_id = f.id`

type FormRow = Record<string, unknown> & { code: string; view_token: string | null }

const toForm = (appUrl: string | undefined, r: FormRow) => {
  const { view_token, ...rest } = r
  const formUrl = `${base(appUrl)}/enquire/${r.code}`
  return enquiryForm.parse({
    ...rest,
    form_url: formUrl,
    // A relative APP_URL (local runs) still gets a code to look at.
    embed_code: enquiryEmbedCode(/^https?:/.test(formUrl) ? formUrl : `https://example.invalid${formUrl}`),
    page_url: view_token ? `${base(appUrl)}/enquiry-view/${view_token}` : null,
  })
}

const edit = requireAction('crm', 'edit')

export const enquiryFormsRouter = new Hono<AppEnv>()
  .use('*', requireAuth)
  .use('*', requireModule('crm'))

  .get('/', async (c) => {
    const rows = await attempt(c, 'enquiry_forms.list', () =>
      withUser(c.env, c.get('auth').userId, (sql) => sql<FormRow[]>`
        ${selectForms(sql)}
         order by (f.archived_at is null) desc, f.is_active desc, f.created_at desc`),
    )
    if (!rows) fail(400, 'We could not load your enquiry forms.')
    return c.json(rows.map((r) => toForm(c.env.APP_URL, r)))
  })

  .get('/:id', async (c) => {
    const id = uuidParam(c)
    const rows = await attempt(c, 'enquiry_forms.get', () =>
      withUser(c.env, c.get('auth').userId, (sql) => sql<FormRow[]>`${selectForms(sql)} where f.id = ${id}`),
    )
    if (!rows) fail(400, 'We could not load this form.')
    if (!rows[0]) fail(404, 'That form was not found.')
    return c.json(toForm(c.env.APP_URL, rows[0]))
  })

  .post('/', requireAction('crm', 'create'), async (c) => {
    const parsed = createEnquiryFormRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, parsed.error.issues[0]?.message ?? 'Please check the form.')
    const d = parsed.data
    const rows = await attempt(c, 'enquiry_forms.create', () =>
      withUser(c.env, c.get('auth').userId, async (sql) => {
        const [made] = await sql<{ id: string }[]>`
          select (create_enquiry_form(${d.name}, ${d.kind ?? null}, ${d.phone ?? null}, ${d.notes ?? null})).id`
        // A form for the studio's own website starts asking for the email too.
        if (d.purpose === 'website') {
          await sql`update enquiry_forms
                       set purpose = 'website',
                           fields = fields || '{"email":"optional"}'::jsonb
                     where id = ${made!.id}`
        }
        return sql<FormRow[]>`${selectForms(sql)} where f.id = ${made!.id}`
      }),
    )
    if (!rows?.[0]) fail(400, 'We could not make the form.')
    const form = toForm(c.env.APP_URL, rows[0])
    await audit(c, { action: 'enquiry_form.create', entityType: 'enquiry_form', entityId: form.id, after: { name: form.name } })
    return c.json(form, 201)
  })

  .patch('/:id', edit, async (c) => {
    const id = uuidParam(c)
    const parsed = updateEnquiryFormRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, parsed.error.issues[0]?.message ?? 'Please check the form.')
    const { archived, ...fields } = parsed.data
    const patch: Record<string, unknown> = Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined))
    if (archived !== undefined) patch.archived_at = archived ? new Date().toISOString() : null
    const rows = await attempt(c, 'enquiry_forms.update', () =>
      withUser(c.env, c.get('auth').userId, async (sql) => {
        const row = patch.fields ? { ...patch, fields: sql.json(patch.fields as never) } : patch
        const done = await sql`update enquiry_forms set ${sql(row)} where id = ${id} returning id`
        if (!done[0]) return []
        return sql<FormRow[]>`${selectForms(sql)} where f.id = ${id}`
      }),
    )
    if (!rows) fail(400, 'We could not save the form.')
    if (!rows[0]) fail(404, 'That form was not found.')
    await audit(c, { action: 'enquiry_form.update', entityType: 'enquiry_form', entityId: id, after: parsed.data })
    return c.json(toForm(c.env.APP_URL, rows[0]))
  })

  /** The vendor's page: on makes a new link (the old one stops), off stops it. */
  .post('/:id/page', edit, async (c) => {
    const id = uuidParam(c)
    const parsed = enquiryFormPageRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Please say whether the page is on or off.')
    const token = parsed.data.on ? newRawToken().replace(/-/g, '') : null
    const rows = await attempt(c, 'enquiry_forms.page', () =>
      withUser(c.env, c.get('auth').userId, async (sql) => {
        const [r] = await sql<{ ok: boolean }[]>`select enquiry_form_set_page(${id}, ${token}) as ok`
        if (!r?.ok) return []
        return sql<FormRow[]>`${selectForms(sql)} where f.id = ${id}`
      }),
    )
    if (!rows) fail(400, 'We could not change the page link.')
    if (!rows[0]) fail(404, 'That form was not found.')
    await audit(c, { action: parsed.data.on ? 'enquiry_form.page_on' : 'enquiry_form.page_off', entityType: 'enquiry_form', entityId: id })
    return c.json(toForm(c.env.APP_URL, rows[0]))
  })

  /** The leads this QR brought in, newest first. */
  .get('/:id/leads', async (c) => {
    const id = uuidParam(c)
    const rows = await attempt(c, 'enquiry_forms.leads', () =>
      withUser(c.env, c.get('auth').userId, (sql) => sql`
        select l.id, l.name, l.phone, l.status, l.event_type, l.event_date, l.created_at
          from enquiry_forms f
          join crm_webhook_sources s on s.id = f.source_id
          join crm_leads l on l.company_id = f.company_id and l.source_key = s.source_key
         where f.id = ${id} and l.merged_into is null
         order by l.created_at desc
         limit 200`),
    )
    if (!rows) fail(400, 'We could not load the enquiries.')
    return c.json(enquiryFormLead.array().parse(rows))
  })

const NOT_OPEN = 'This form is not taking enquiries right now.'
const GONE = 'This page is not available. Please ask the studio for a new link.'

function formCode(c: Parameters<typeof textParam>[0]): string {
  const code = textParam(c, 'code', 20).toLowerCase()
  if (!/^[a-z0-9]{7}$/.test(code)) fail(404, NOT_OPEN)
  return code
}

export const publicEnquiryFormsRouter = new Hono<AppEnv>()
  .get('/enquiry/:code', async (c) => {
    const code = formCode(c)
    const rows = await attempt(c, 'enquiry_forms.public_get', () =>
      withService(c.env, (sql) => sql`select * from enquiry_form_public(${code})`),
    )
    if (!rows) fail(503, 'The service is temporarily unavailable. Please try again in a moment.')
    if (!rows[0]) fail(404, NOT_OPEN)
    c.header('Cache-Control', 'no-store')
    return c.json(publicEnquiryForm.parse(rows[0]))
  })

  .post('/enquiry/:code', async (c) => {
    const code = formCode(c)
    const parsed = submitEnquiryRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, parsed.error.issues[0]?.message ?? 'Please check the form.')
    const d = parsed.data
    // A bot filled the hidden field: say thanks and keep nothing.
    if (d.website) return c.json({ ok: true })
    const rows = await attempt(
      c,
      'enquiry_forms.public_submit',
      () =>
        withService(c.env, (sql) => sql<{ lead_id: string }[]>`
          select * from enquiry_form_submit(
            ${code}, ${d.name}, ${d.phone}, ${d.email || null}, ${d.event_type ?? null},
            ${d.event_date || null}, ${d.city ?? null}, ${d.message ?? null}, ${d.budget ?? null})`),
      {
        onCode: (pg, err) =>
          pg === 'P0002'
            ? fail(404, NOT_OPEN)
            : pg === '22023'
              ? fail(422, (err as { message?: string }).message ?? 'Please check the form.')
              : undefined,
      },
    )
    if (!rows) fail(503, 'The service is temporarily unavailable. Please try again in a moment.')
    // The lead id stays with the studio; the person only needs to know it arrived.
    return c.json({ ok: true })
  })

  .get('/enquiry-view/:token', async (c) => {
    const token = textParam(c, 'token', 100)
    if (!/^[A-Za-z0-9_-]{20,100}$/.test(token)) fail(404, GONE)
    const rows = await attempt(c, 'enquiry_forms.public_view', () =>
      withService(c.env, (sql) => sql<{ doc: unknown }[]>`select enquiry_form_page(${token}) as doc`),
    )
    if (!rows) fail(503, 'The service is temporarily unavailable. Please try again in a moment.')
    if (!rows[0]?.doc) fail(404, GONE)
    c.header('Cache-Control', 'no-store')
    return c.json(publicEnquiryView.parse(rows[0].doc))
  })
