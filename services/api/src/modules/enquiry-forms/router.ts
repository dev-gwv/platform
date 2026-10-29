import { Hono } from 'hono'
import {
  createEnquiryFormRequest,
  enquiryForm,
  enquiryHub,
  setEnquiryServicesRequest,
  enquiryFormLead,
  enquiryFormPageRequest,
  publicEnquiryForm,
  publicEnquiryFormV2,
  publicPartnerView,
  submitEnquiryRequestV2,
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
import { enquiryEmbedCode, toIndianMobile, whatsappUrl } from '@ipc/domain'
import { canManageLeads, mainFormRow } from './shared'

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
         f.is_main, f.slug, f.after_submit, f.whatsapp_phone, f.whatsapp_text, f.redirect_url,
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

/** Owners and managers change the form; anyone with Leads can share it (spec 4.7). */
const manage = async (c: Parameters<typeof uuidParam>[0], next: () => Promise<void>) => {
  if (!canManageLeads(c.get('auth'))) fail(403, 'Ask the owner if you need to change the form.')
  await next()
}

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

  /** The studio's main form (made on first open), and what the hub needs around it. */
  .get('/hub', async (c) => {
    const auth = c.get('auth')
    const out = await attempt(c, 'enquiry_forms.hub', () =>
      withUser(c.env, auth.userId, async (sql) => {
        const form = await mainFormRow(sql)
        const rows = await sql<FormRow[]>`${selectForms(sql)} where f.id = ${form.id}`
        const [x] = await sql<{ studio: string; wa: string | null; services: string[] }[]>`
          select c.name as studio, enquiry_default_whatsapp(c.id) as wa, enquiry_services(c.id) as services
            from companies c where c.id = get_current_company_id()`
        return { row: rows[0]!, ...x! }
      }),
    )
    if (!out) fail(400, 'We could not load your enquiry form.')
    const form = toForm(c.env.APP_URL, out.row)
    return c.json(
      enquiryHub.parse({
        form,
        default_whatsapp_phone: out.wa ? `+${out.wa}` : null,
        studio: out.studio,
        share_url: form.slug ? `${base(c.env.APP_URL)}/f/${form.slug}` : form.form_url,
        services: out.services,
        can_manage: canManageLeads(auth),
      }),
    )
  })

  /** "What do you need?": the studio's own list, saved whole, in its order. */
  .put('/services', manage, async (c) => {
    const parsed = setEnquiryServicesRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Each choice needs a word, 60 letters at most.')
    const seen = new Set<string>()
    const values = parsed.data.values.filter((v) => !seen.has(v.toLowerCase()) && seen.add(v.toLowerCase()))
    const auth = c.get('auth')
    const out = await attempt(c, 'enquiry_forms.services', () =>
      withUser(c.env, auth.userId, async (sql) => {
        await sql`update custom_lookups set is_active = false
                   where company_id = ${auth.companyId} and category = 'enquiry_service'
                     and not (lower(value) = any(${values.map((v) => v.toLowerCase())}::text[]))`
        for (const [i, v] of values.entries()) {
          await sql`insert into custom_lookups (company_id, category, value, sort_order, is_active)
                    values (${auth.companyId}, 'enquiry_service', ${v}, ${i}, true)
                    on conflict (company_id, category, value) do update set sort_order = excluded.sort_order, is_active = true`
        }
        const [r] = await sql<{ services: string[] }[]>`select enquiry_services(${auth.companyId}) as services`
        return r!.services
      }),
    )
    if (!out) fail(400, 'We could not save the choices.')
    return c.json({ services: out })
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
        // Vendors get a partner QR now (0274); a new form is a website form.
        await sql`update enquiry_forms set purpose = 'website' where id = ${made!.id}`
        return sql<FormRow[]>`${selectForms(sql)} where f.id = ${made!.id}`
      }),
    )
    if (!rows?.[0]) fail(400, 'We could not make the form.')
    const form = toForm(c.env.APP_URL, rows[0])
    await audit(c, { action: 'enquiry_form.create', entityType: 'enquiry_form', entityId: form.id, after: { name: form.name } })
    return c.json(form, 201)
  })

  .patch('/:id', edit, manage, async (c) => {
    const id = uuidParam(c)
    const parsed = updateEnquiryFormRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, parsed.error.issues[0]?.message ?? 'Please check the form.')
    const { archived, ...fields } = parsed.data
    const patch: Record<string, unknown> = Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined))
    if (archived !== undefined) patch.archived_at = archived ? new Date().toISOString() : null
    // After sending (0274): a number to chat with, or an https:// link to open.
    if (patch.whatsapp_phone !== undefined) {
      const raw = (patch.whatsapp_phone as string | null) ?? ''
      if (raw.trim() === '') patch.whatsapp_phone = null
      else {
        const phone = toIndianMobile(raw)
        if (!phone) return c.json({ error: 'Enter a valid 10-digit mobile number', field: 'whatsapp_phone' }, 422)
        patch.whatsapp_phone = phone
      }
    }
    if (patch.whatsapp_text !== undefined) patch.whatsapp_text = (patch.whatsapp_text as string | null)?.trim() || null
    if (patch.redirect_url !== undefined) {
      const url = ((patch.redirect_url as string | null) ?? '').trim()
      if (url === '') patch.redirect_url = null
      else if (!/^https:\/\/[^\s<>"]+$/.test(url)) return c.json({ error: 'Paste a link that starts with https://', field: 'redirect_url' }, 422)
      else patch.redirect_url = url
    }
    if (patch.after_submit !== undefined || patch.whatsapp_phone !== undefined || patch.redirect_url !== undefined) {
      const check = await attempt(c, 'enquiry_forms.after_check', () =>
        withUser(c.env, c.get('auth').userId, (sql) => sql<{ after_submit: string; whatsapp_phone: string | null; redirect_url: string | null; wa: string | null }[]>`
          select after_submit, whatsapp_phone, redirect_url, enquiry_default_whatsapp(company_id) as wa
            from enquiry_forms where id = ${id}`),
      )
      const cur = check?.[0]
      if (cur) {
        const after = (patch.after_submit as string | undefined) ?? cur.after_submit
        const phone = patch.whatsapp_phone !== undefined ? patch.whatsapp_phone : cur.whatsapp_phone
        const link = patch.redirect_url !== undefined ? patch.redirect_url : cur.redirect_url
        if (after === 'whatsapp' && !phone && !cur.wa) return c.json({ error: 'Add your WhatsApp number', field: 'whatsapp_phone' }, 422)
        if (after === 'link' && !link) return c.json({ error: 'Paste the link to open', field: 'redirect_url' }, 422)
      }
    }
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
  .post('/:id/page', edit, manage, async (c) => {
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
        select l.id, l.name, l.phone, l.email, l.status, l.event_type, l.event_date, l.created_at
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

type SubmitDoc = {
  errors?: Record<string, string>
  wa_phone?: string | null
  wa_text?: string | null
  redirect_url?: string | null
}

/** A form's 7-letter code or its readable link (/f/<slug>). */
function formKey(c: Parameters<typeof textParam>[0]): string {
  const key = textParam(c, 'key', 80).toLowerCase()
  if (!/^[a-z0-9-]{4,60}$/.test(key)) fail(404, NOT_OPEN)
  return key
}

/** A partner's code from ?p=, or null for anything that is not one. */
const partnerCode = (p: string | null | undefined): string | null => {
  const v = (p ?? '').trim().toLowerCase()
  return /^[a-z0-9]{6,12}$/.test(v) ? v : null
}

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

  /** A partner's page (0274), else an older vendor form's (0195). */
  .get('/enquiry-view/:token', async (c) => {
    const token = textParam(c, 'token', 100)
    if (!/^[A-Za-z0-9_-]{20,100}$/.test(token)) fail(404, GONE)
    const rows = await attempt(c, 'enquiry_forms.public_view', () =>
      withService(c.env, (sql) => sql<{ doc: unknown }[]>`
        select coalesce(enquiry_partner_page(${token}), enquiry_form_page(${token})) as doc`),
    )
    if (!rows) fail(503, 'The service is temporarily unavailable. Please try again in a moment.')
    if (!rows[0]?.doc) fail(404, GONE)
    c.header('Cache-Control', 'no-store')
    return c.json(publicPartnerView.parse(rows[0].doc))
  })

  /**
   * The form (0274), by its code or readable link, through a partner's QR
   * with ?p=. Counts one scan, unless the page says it already counted this
   * visit (?seen=1, 0278); 404 when it is off or the link is wrong.
   */
  .get('/forms/:key', async (c) => {
    const key = formKey(c)
    const p = partnerCode(c.req.query('p'))
    const count = c.req.query('seen') !== '1'
    const rows = await attempt(c, 'enquiry_forms.public_get_v2', () =>
      withService(c.env, (sql) => sql<{ doc: unknown }[]>`select enquiry_public(${key}, ${p}, ${count}) as doc`),
    )
    if (!rows) fail(503, 'The service is temporarily unavailable. Please try again in a moment.')
    if (!rows[0]?.doc) fail(404, NOT_OPEN)
    c.header('Cache-Control', 'no-store')
    return c.json(publicEnquiryFormV2.parse(rows[0].doc))
  })

  .post('/forms/:key', async (c) => {
    const key = formKey(c)
    const parsed = submitEnquiryRequestV2.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) return c.json({ error: 'Please check the form.' }, 400)
    const { website, p, ...data } = parsed.data
    // A bot filled the hidden field: say thanks, keep nothing, send nowhere.
    if (website) return c.json({ received: true, redirect_url: null }, 201)
    const rows = await attempt(
      c,
      'enquiry_forms.public_submit_v2',
      () =>
        withService(c.env, (sql) => sql<{ doc: SubmitDoc }[]>`
          select enquiry_submit(${key}, ${partnerCode(p)}, ${sql.json(data as never)}) as doc`),
      { onCode: (pg) => (pg === 'P0002' ? fail(404, NOT_OPEN) : pg === '54000' ? ('plan_full' as const) : undefined) },
    )
    // 0289: the studio's plan holds no more leads. Tell the person to reach
    // the studio directly, and ring the owner's bell.
    if (rows === 'plan_full') {
      await withService(c.env, (sql) => sql`
        select plan_full_notice(enquiry_form_company(${key}), ${`${data.name ?? 'An enquiry'} (enquiry form)`})`).catch(() => undefined)
      fail(402, 'This studio cannot take new enquiries online right now. Please call or WhatsApp them directly.')
    }
    if (!rows?.[0]) fail(503, 'The service is temporarily unavailable. Please try again in a moment.')
    const doc = rows[0].doc
    if (doc.errors) return c.json({ error: 'Please check the form.', fields: doc.errors }, 400)
    const redirect = doc.wa_phone && doc.wa_text ? whatsappUrl(doc.wa_phone, doc.wa_text) : (doc.redirect_url ?? null)
    return c.json({ received: true, redirect_url: redirect }, 201)
  })
