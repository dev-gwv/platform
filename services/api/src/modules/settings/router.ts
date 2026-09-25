import { Hono } from 'hono'
import {
  auditLogPage,
  auditLogQuery,
  companyProfile,
  companyTheme,
  myProfile,
  updateCompanyRequest,
  updateMyProfileRequest,
  updateThemeRequest,
  integrationStatusList,
} from '@ipc/contracts'
import type { AppEnv } from '../../context'
import { requireAuth } from '../../middleware/auth'
import { requireOwner } from '../../middleware/permissions'
import { canQuickAddLookup } from '@ipc/permissions'
import { razorpayConfigured } from '../../lib/env'
import { whatsappConfigured } from '../../lib/whatsapp'
import { twilioConfigured } from '../../lib/twilio'
import { fail } from '../../middleware/errors'
import { withUser } from '../../lib/db'
import { attempt } from '../../lib/attempt'
import { audit } from '../../lib/audit'

const COMPANY_COLUMNS = [
  'name',
  'legal_name',
  'display_name',
  'city',
  'state',
  'country',
  'website',
  'invoice_gst_number',
  'invoice_sac_code',
  'avatar_url',
  'invoice_number_prefix',
  'invoice_next_number',
  'quote_number_prefix',
  'quote_next_number',
  'invoice_address',
  'invoice_phone',
  'invoice_email',
  'invoice_upi_id',
  'invoice_bank_details',
  'invoice_default_notes',
  'invoice_default_terms',
  'document_footer_note',
  'invoice_logo_url',
]

export const settingsRouter = new Hono<AppEnv>()
  .use('*', requireAuth)

  .get('/company', async (c) => {
    const auth = c.get('auth')
    const row = await attempt(c, 'settings.company', () =>
      withUser(c.env, auth.userId, async (sql) => {
        const rows = await sql`select ${sql(COMPANY_COLUMNS)} from companies where id = ${auth.companyId}`
        return rows[0] ?? null
      }),
    )
    if (!row) fail(404, 'Company not found.')
    return c.json(companyProfile.parse(row))
  })

  .patch('/company', requireOwner(), async (c) => {
    const parsed = updateCompanyRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Please check the details.')
    if (Object.keys(parsed.data).length === 0) fail(422, 'Nothing to change.')
    const auth = c.get('auth')
    const result = await attempt(c, 'settings.company_update', () =>
      withUser(c.env, auth.userId, async (sql) => {
        const [before] = await sql`select ${sql(COMPANY_COLUMNS)} from companies where id = ${auth.companyId}`
        const rows = await sql`
          update companies set ${sql(parsed.data)} where id = ${auth.companyId}
          returning ${sql(COMPANY_COLUMNS)}`
        return rows[0] ? { before: before ?? null, after: rows[0] } : null
      }),
    )
    if (!result) fail(400, 'We could not save your changes.')
    await audit(c, {
      action: 'company.update',
      entityType: 'company',
      entityId: auth.companyId,
      before: result.before,
      after: parsed.data,
    })
    return c.json(companyProfile.parse(result.after))
  })

  // Your own row, not the studio's. No owner gate: everyone may edit their own
  // name and phone, and RLS scopes the write to the caller either way.
  .get('/profile', async (c) => {
    const auth = c.get('auth')
    const row = await attempt(c, 'settings.profile', () =>
      withUser(c.env, auth.userId, async (sql) => {
        const rows = await sql`
          select name, email, phone, role, status, avatar_url from users where user_id = ${auth.userId}`
        return rows[0] ?? null
      }),
    )
    if (!row) fail(404, 'We could not load your profile.')
    return c.json(myProfile.parse(row))
  })

  .patch('/profile', async (c) => {
    const parsed = updateMyProfileRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Please check your details.')
    if (Object.keys(parsed.data).length === 0) fail(422, 'Nothing to change.')
    const auth = c.get('auth')
    const row = await attempt(c, 'settings.profile_update', () =>
      withUser(c.env, auth.userId, async (sql) => {
        const rows = await sql`
          update users set ${sql(parsed.data)} where user_id = ${auth.userId}
          returning name, email, phone, role, status, avatar_url`
        return rows[0] ?? null
      }),
    )
    if (!row) fail(400, 'We could not save your changes.')
    await audit(c, { action: 'profile.update', entityType: 'user', entityId: auth.userId, after: parsed.data })
    return c.json(myProfile.parse(row))
  })

  .get('/theme', async (c) => {
    const auth = c.get('auth')
    const row = await attempt(c, 'settings.theme', () =>
      withUser(c.env, auth.userId, async (sql) => {
        const rows = await sql`
          select preset_key, font_key, color_scheme, custom_color, border_radius,
                 is_custom_theme, primary_color, secondary_color, accent_color,
                 background_color, surface_color, text_color, muted_text_color, border_color
          from company_theme_settings where company_id = ${auth.companyId}`
        return rows[0] ?? null
      }),
    )
    return c.json(
      companyTheme.parse(
        row ?? { preset_key: 'ipc_classic', font_key: null, color_scheme: 'light', custom_color: null, border_radius: '0.5' },
      ),
    )
  })

  .patch('/theme', requireOwner(), async (c) => {
    const parsed = updateThemeRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Invalid theme.')
    const auth = c.get('auth')
    const row = await attempt(c, 'settings.theme_update', () =>
      withUser(c.env, auth.userId, async (sql) => {
        const rows = await sql`
          insert into company_theme_settings ${sql({
            company_id: auth.companyId,
            preset_key: parsed.data.preset_key,
            font_key: parsed.data.font_key ?? null,
            color_scheme: parsed.data.color_scheme,
            custom_color: parsed.data.custom_color ?? null,
            border_radius: parsed.data.border_radius ?? '0.5',
            is_custom_theme: parsed.data.is_custom_theme ?? false,
            primary_color: parsed.data.primary_color ?? null,
            secondary_color: parsed.data.secondary_color ?? null,
            accent_color: parsed.data.accent_color ?? null,
            background_color: parsed.data.background_color ?? null,
            surface_color: parsed.data.surface_color ?? null,
            text_color: parsed.data.text_color ?? null,
            muted_text_color: parsed.data.muted_text_color ?? null,
            border_color: parsed.data.border_color ?? null,
          })}
          on conflict (company_id) do update
            set preset_key        = excluded.preset_key,
                font_key          = excluded.font_key,
                color_scheme      = excluded.color_scheme,
                custom_color      = excluded.custom_color,
                border_radius     = excluded.border_radius,
                is_custom_theme   = excluded.is_custom_theme,
                primary_color     = excluded.primary_color,
                secondary_color   = excluded.secondary_color,
                accent_color      = excluded.accent_color,
                background_color  = excluded.background_color,
                surface_color     = excluded.surface_color,
                text_color        = excluded.text_color,
                muted_text_color  = excluded.muted_text_color,
                border_color      = excluded.border_color
          returning preset_key, font_key, color_scheme, custom_color, border_radius,
                    is_custom_theme, primary_color, secondary_color, accent_color,
                    background_color, surface_color, text_color, muted_text_color, border_color`
        return rows[0] ?? null
      }),
    )
    if (!row) fail(400, 'We could not save the theme.')
    await audit(c, { action: 'theme.update', entityType: 'company', entityId: auth.companyId, after: parsed.data })
    return c.json(companyTheme.parse(row))
  })

  // ── Audit trail ─────────────────────────────────────────────
  // Owner-only by RLS (audit_logs_select_owner) and by the gate here. Cursor
  // is the created_at of the last row seen; entries are newest first.
  /**
   * Which outside services this deployment can actually reach.
   *
   * Each of these degrades quietly rather than failing: with no WhatsApp
   * credentials the app opens wa.me for a human to press send, with no Twilio
   * it logs the call as one made by hand, with no Resend key it writes a line
   * to the log and carries on. All sensible fallbacks, and all invisible — a
   * studio can believe for months that the system is sending its messages.
   *
   * Owner-only, and booleans only. That a key exists is not a secret; the key
   * is, and it never leaves the server.
   */
  .get('/integrations', requireOwner(), (c) => {
    const env = c.env
    const items = [
      {
        key: 'email' as const,
        label: 'Email (Resend)',
        configured: !!env.RESEND_API_KEY && !!env.EMAIL_FROM,
        detail: env.RESEND_API_KEY
          ? 'Verification, invitations, quotations and receipts are delivered by the system.'
          : 'Nothing is emailed. Sends are written to the server log and skipped, including sign-up verification.',
        requires: ['RESEND_API_KEY', 'EMAIL_FROM'],
      },
      {
        key: 'whatsapp' as const,
        label: 'WhatsApp (Cloud API)',
        configured: whatsappConfigured(env),
        detail: whatsappConfigured(env)
          ? 'The system sends the message itself and the lead history records it as sent.'
          : 'Opens wa.me with the text filled in, for someone to press send by hand. Nothing is delivered automatically.',
        requires: ['WHATSAPP_PHONE_NUMBER_ID', 'WHATSAPP_ACCESS_TOKEN'],
      },
      {
        key: 'calls' as const,
        label: 'Click to call (Twilio)',
        configured: twilioConfigured(env),
        detail: twilioConfigured(env)
          ? 'Call rings your phone first, then bridges the lead.'
          : 'Call only logs an activity. Dial the number yourself — the timeline looks the same either way.',
        requires: ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_FROM_NUMBER'],
      },
      {
        key: 'payments' as const,
        label: 'Subscription payments (Razorpay)',
        configured: razorpayConfigured(env),
        detail: razorpayConfigured(env)
          ? 'Plan renewals take a real payment and the signature is verified.'
          : 'Renewal cannot take a payment. Outside production a plan can be activated without one; in production it is refused.',
        requires: ['RAZORPAY_KEY_ID', 'RAZORPAY_KEY_SECRET', 'RAZORPAY_WEBHOOK_SECRET'],
      },
      {
        key: 'meta_leads' as const,
        label: 'Meta lead ads',
        configured: !!env.META_APP_SECRET && !!env.META_PAGE_ACCESS_TOKEN,
        detail:
          env.META_APP_SECRET && env.META_PAGE_ACCESS_TOKEN
            ? "Facebook and Instagram lead forms arrive signed, and the lead's own fields are fetched."
            : 'Only a generic JSON webhook works. Posts are not signature-verified and form fields are not fetched from Meta.',
        requires: ['META_VERIFY_TOKEN', 'META_APP_SECRET', 'META_PAGE_ACCESS_TOKEN'],
      },
      {
        key: 'errors' as const,
        label: 'Error tracking (Sentry)',
        configured: !!env.SENTRY_DSN,
        detail: env.SENTRY_DSN
          ? 'Errors, traces and nightly job check-ins are reported.'
          : 'Errors reach the server log only, and a job that stops running says nothing.',
        requires: ['SENTRY_DSN'],
      },
    ]
    return c.json(integrationStatusList.parse({ items, environment: env.ENVIRONMENT ?? 'unknown' }))
  })

  .get('/audit', requireOwner(), async (c) => {
    const parsed = auditLogQuery.safeParse({
      cursor: c.req.query('cursor'),
      limit: c.req.query('limit'),
      entity_type: c.req.query('entity_type'),
    })
    if (!parsed.success) fail(422, 'Invalid query.')
    const { cursor, limit, entity_type } = parsed.data
    const rows = await attempt(c, 'settings.audit', () =>
      withUser(
        c.env,
        c.get('auth').userId,
        (sql) => sql`
          select a.id, a.actor_user_id, u.name as actor_name, a.action, a.entity_type, a.entity_id,
                 a.before, a.after, a.ip, a.correlation_id, a.created_at
          from audit_logs a
          left join users u on u.user_id = a.actor_user_id
          where ${cursor ? sql`a.created_at < ${cursor}` : sql`true`}
            and ${entity_type ? sql`a.entity_type = ${entity_type}` : sql`true`}
          order by a.created_at desc
          limit ${limit + 1}`,
      ),
    )
    if (!rows) fail(400, 'We could not load the audit log.')
    const page = rows.slice(0, limit)
    const last = page[page.length - 1] as { created_at?: string } | undefined
    return c.json(
      auditLogPage.parse({
        items: page,
        next_cursor: rows.length > limit && last?.created_at ? last.created_at : null,
      }),
    )
  })

  // ── Custom Lookups ─────────────────────────────────────────
  // Managing the list is owner-only, but reading the active values is not --
  // anyone logging an expense needs the category list, not just the owner.
  .get('/lookups/active', async (c) => {
    const category = c.req.query('category')
    if (!category) fail(422, 'Category is required.')
    const rows = await attempt(c, 'settings.lookups_active', () =>
      withUser(c.env, c.get('auth').userId, async (sql) => {
        return sql`
          select id, category, value, sort_order
            from custom_lookups
           where company_id = ${c.get('auth').companyId}
             and category = ${category}
             and is_active = true
           order by sort_order, value`
      }),
    )
    if (!rows) fail(400, 'We could not load lookups.')
    return c.json(rows)
  })

  .get('/lookups', requireOwner(), async (c) => {
    const category = c.req.query('category')
    const rows = await attempt(c, 'settings.lookups', () =>
      withUser(c.env, c.get('auth').userId, async (sql) => {
        return sql`
          select id, category, value, sort_order, is_active
            from custom_lookups
           where company_id = ${c.get('auth').companyId}
             and ${category ? sql`category = ${category}` : sql`true`}
           order by category, sort_order, value`
      }),
    )
    if (!rows) fail(400, 'We could not load lookups.')
    return c.json(rows)
  })

  // Adding one value is open to whoever may create records where the list is
  // used (an expense category to anyone who logs expenses); renaming,
  // hiding and removing stay with the owner.
  .post('/lookups', async (c) => {
    const body = await c.req.json().catch(() => ({}))
    const category = typeof body.category === 'string' ? body.category.trim() : ''
    const value = typeof body.value === 'string' ? body.value.trim() : ''
    if (!category || !value) fail(422, 'Category and value are required.')
    const auth = c.get('auth')
    if (!canQuickAddLookup(auth.access, auth.isOwner, category)) fail(403, 'You do not have access to this action.')
    const rows = await attempt(c, 'settings.lookup_create', () =>
      withUser(c.env, auth.userId, async (sql) => {
        const made = await sql<{ id: string }[]>`
          insert into custom_lookups (company_id, category, value, sort_order)
          values (${auth.companyId}, ${category}, ${value}, ${body.sort_order ?? 0})
          on conflict (company_id, category, value) do nothing
          returning id`
        return made
      }),
    )
    if (!rows?.[0]) fail(409, 'That lookup value already exists.')
    await audit(c, { action: 'lookup.create', entityType: 'custom_lookup', entityId: rows[0].id, after: { category, value } })
    return c.json({ id: rows[0].id }, 201)
  })

  .patch('/lookups/:id', requireOwner(), async (c) => {
    const id = c.req.param('id')
    if (!id) fail(422, 'ID is required.')
    const body = await c.req.json().catch(() => ({}))
    const patch: Record<string, unknown> = {}
    if (typeof body.value === 'string' && body.value.trim()) patch.value = body.value.trim()
    if (typeof body.sort_order === 'number') patch.sort_order = body.sort_order
    if (typeof body.is_active === 'boolean') patch.is_active = body.is_active
    if (Object.keys(patch).length === 0) fail(422, 'Nothing to change.')
    const auth = c.get('auth')
    const rows = await attempt(
      c,
      'settings.lookup_update',
      () =>
        withUser(c.env, auth.userId, (sql) => sql<{ id: string }[]>`
          update custom_lookups set ${sql(patch)} where id = ${id} and company_id = ${auth.companyId} returning id`),
      { onCode: (code) => (code === '23505' ? 'taken' : undefined) },
    )
    if (rows === 'taken') fail(409, 'That value already exists in this category.')
    if (!rows) fail(400, 'We could not update this lookup.')
    if (!rows.length) fail(404, 'We could not find that lookup.')
    await audit(c, { action: 'lookup.update', entityType: 'custom_lookup', entityId: id, after: patch })
    return c.json({ ok: true })
  })

  .delete('/lookups/:id', requireOwner(), async (c) => {
    const id = c.req.param('id')
    if (!id) fail(422, 'ID is required.')
    const auth = c.get('auth')
    const rows = await attempt(c, 'settings.lookup_delete', () =>
      withUser(c.env, auth.userId, async (sql) => {
        return sql<{ id: string }[]>`
          delete from custom_lookups where id = ${id} and company_id = ${auth.companyId} returning id`
      }),
    )
    if (!rows) fail(400, 'We could not delete this lookup.')
    if (!rows.length) fail(404, 'We could not find that lookup.')
    await audit(c, { action: 'lookup.delete', entityType: 'custom_lookup', entityId: id })
    return c.json({ ok: true })
  })
