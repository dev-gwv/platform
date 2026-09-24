import { Hono, type Context } from 'hono'
import { z } from '@ipc/contracts'
import type { AppEnv } from '../../context'
import { requireAuth } from '../../middleware/auth'
import { requireAction } from '../../middleware/permissions'
import { fail } from '../../middleware/errors'
import { textParam } from '../../lib/params'
import { withService, withUser } from '../../lib/db'
import { attempt } from '../../lib/attempt'
import { audit } from '../../lib/audit'
import { resolveClientIp } from '../../lib/client-ip'
import { sendClientDocEmail } from '../../lib/email'

const issueTermsRequest = z.object({
  project_id: z.string().uuid().nullable().default(null),
  rendered_body: z.string().min(1),
  // Lovable parity (additive): rich payload fields.
  title: z.string().trim().max(200).nullish(),
  payment_summary: z.string().trim().max(2000).nullish(),
  sections: z.array(z.record(z.string(), z.unknown())).nullish(),
  expiry_days: z.number().int().min(1).max(3650).nullish(),
  // The payment schedule the client is agreeing to, frozen at issue time so a
  // later edit to the project cannot change what they signed.
  payment_terms: z.array(z.record(z.string(), z.unknown())).max(20).nullish(),
  total_cost: z.number().nonnegative().nullish(),
  legal_note: z.string().trim().max(2000).nullish(),
  template_id: z.string().uuid().nullish(),
  /** Email the link as well (to `to_email`, or the client's address). */
  email: z.boolean().default(false),
  to_email: z.string().trim().email().max(200).nullish(),
})

/**
 * A draft carries everything the issue payload does, except that the body may
 * still be empty — the point is to save work that is not finished. project_id
 * is required: a draft belongs to the project you are writing it for, and that
 * is what it is looked up by.
 */
const saveTermsDraftRequest = z.object({
  project_id: z.string().uuid(),
  rendered_body: z.string().max(100_000).default(''),
  title: z.string().trim().max(200).nullish(),
  payment_summary: z.string().trim().max(2000).nullish(),
  sections: z.array(z.record(z.string(), z.unknown())).nullish(),
  payment_terms: z.array(z.record(z.string(), z.unknown())).max(20).nullish(),
  total_cost: z.number().nonnegative().nullish(),
  legal_note: z.string().trim().max(2000).nullish(),
  template_id: z.string().uuid().nullish(),
})

const termsDraft = z.object({
  id: z.string().uuid(),
  project_id: z.string().uuid().nullable(),
  rendered_body: z.string(),
  title: z.string().nullable(),
  payment_summary: z.string().nullable(),
  sections: z.array(z.record(z.string(), z.unknown())).nullable(),
  payment_terms: z.array(z.record(z.string(), z.unknown())).nullable(),
  total_cost: z.number().nullable(),
  legal_note: z.string().nullable(),
  template_id: z.string().uuid().nullable(),
  updated_at: z.string().nullable(),
})

const termsTemplate = z.object({
  id: z.string().uuid(),
  name: z.string(),
  body: z.string(),
  version: z.number().int(),
  created_at: z.string(),
})
const issueTermsResponse = z.object({ document_id: z.string().uuid(), token: z.string() })
const termsBody = z.object({ body: z.string() })
// Lovable parity: rich payload (title/project/client/company/payment/sections/expiry/status).
const termsPayload = z.object({
  title: z.string().nullable(),
  body: z.string(),
  project_name: z.string().nullable(),
  client_name: z.string().nullable(),
  client_phone: z.string().nullable(),
  company_name: z.string().nullable(),
  logo_url: z.string().nullable(),
  company_phone: z.string().nullable(),
  company_email: z.string().nullable(),
  company_address: z.string().nullable(),
  payment_summary: z.string().nullable(),
  sections: z.array(z.record(z.string(), z.unknown())).default([]),
  expires_at: z.string().nullable(),
  revoked: z.boolean().default(false),
  acknowledged_at: z.string().nullable(),
  acknowledged_by_name: z.string().nullable(),
  access_count: z.number().default(0),
  // Letterhead + bill-to, so the sheet reads as the legal document it is.
  company_legal_name: z.string().nullable().nullish(),
  company_website: z.string().nullable().nullish(),
  document_footer_note: z.string().nullable().nullish(),
  client_email: z.string().nullable().nullish(),
  client_address: z.string().nullable().nullish(),
  gstin: z.string().nullable().nullish(),
  document_number: z.string().nullable().nullish(),
  issued_at: z.string().nullable().nullish(),
  // The schedule and legal note the client agrees to. Without these here
  // zod stripped them and the client only ever saw the one-line summary.
  payment_terms: z.array(z.record(z.string(), z.unknown())).nullish(),
  total_cost: z.coerce.number().nullish(),
  legal_note: z.string().nullable().nullish(),
})
const ackRequest = z.object({ name: z.string().trim().min(1).max(160), email: z.string().max(200).optional() })

/** One row per project: its most recent terms document and whether it's been agreed to. */
const termsDocument = z.object({
  id: z.string().uuid(),
  project_id: z.string().uuid().nullable(),
  project_name: z.string().nullable(),
  client_name: z.string().nullable(),
  client_phone: z.string().nullable(),
  acknowledged_at: z.string().nullable(),
  acknowledged_by_name: z.string().nullable(),
  has_active_link: z.boolean(),
  link_expires_at: z.string().nullable(),
  created_at: z.string(),
})
const termsDocumentList = termsDocument.array()

/** Every version of one project's terms, newest first. */
const projectTermsVersion = z.object({
  id: z.string().uuid(),
  title: z.string().nullable(),
  created_at: z.string(),
  expires_at: z.string().nullable(),
  revoked_at: z.string().nullable(),
  acknowledged_at: z.string().nullable(),
  acknowledged_by_name: z.string().nullable(),
  acknowledged_by_email: z.string().nullable(),
  access_count: z.number().int(),
  link_live: z.boolean(),
  emailed_to: z.string().nullable(),
})

const sendLinkRequest = z.object({
  expiry_days: z.number().int().min(1).max(365).default(14),
  /** Also email the link: to this address, or the client's when blank. */
  email: z.boolean().default(false),
  to_email: z.string().trim().email().max(200).nullish(),
})

const linkResponse = z.object({
  document_id: z.string().uuid(),
  token: z.string(),
  url: z.string(),
  email_status: z.enum(['sent', 'provider_missing', 'failed', 'not_requested']),
  email_error: z.string().nullable(),
})

const termsLink = (env: { APP_URL?: string | undefined }, token: string) =>
  `${env.APP_URL ?? ''}/terms/acknowledge?token=${encodeURIComponent(token)}`

/** The name and email the terms go to, and who is sending them. */
async function emailTerms(
  c: Context<AppEnv>,
  documentId: string,
  url: string,
  toOverride: string | null | undefined,
): Promise<{ status: 'sent' | 'provider_missing' | 'failed'; error: string | null }> {
  const info = await attempt(c, 'terms.email_info', () =>
    withUser(c.env, c.get('auth').userId, async (sql) => {
      const rows = await sql<{ client_email: string | null; project_name: string | null; company_name: string | null }[]>`
        select cl.email as client_email, p.name as project_name, coalesce(co.display_name, co.name) as company_name
          from project_terms_documents d
          left join projects p on p.id = d.project_id
          left join clients cl on cl.id = p.client_id
          left join companies co on co.id = d.company_id
         where d.id = ${documentId}`
      return rows[0] ?? null
    }),
  )
  const to = toOverride || info?.client_email || null
  const result = await sendClientDocEmail(
    c.env,
    to,
    `Terms & conditions${info?.project_name ? ` for ${info.project_name}` : ''} — ${info?.company_name ?? 'Studio'}`,
    url,
    `${info?.company_name ?? 'The studio'} has shared the terms${info?.project_name ? ` for ${info.project_name}` : ''}. Please open the link, read them, and tap "I agree".`,
  )
  try {
    await withUser(c.env, c.get('auth').userId, async (sql) => {
      await sql`insert into project_terms_email_logs (company_id, document_id, to_email, status, error, created_by)
        values (${c.get('auth').companyId}, ${documentId}, ${to}, ${result.status}, ${result.error ?? null}, ${c.get('auth').userId})`
    })
  } catch { /* the log never blocks the send */ }
  return { status: result.status, error: result.error ?? null }
}

/** Studio side: issue a terms document + client acknowledgement link. */
export const termsRouter = new Hono<AppEnv>()
  .use('*', requireAuth)

  // The dashboard: every project's paperwork, one row each, newest document
  // first per project. `distinct on` picks that latest row without a second
  // query per project.
  .get('/documents', requireAction('projects', 'view'), async (c) => {
    const rows = await attempt(c, 'terms.documents', () =>
      withUser(c.env, c.get('auth').userId, (sql) => sql`select * from list_project_terms_documents()`),
    )
    if (!rows) fail(400, 'We could not load project documents.')
    return c.json(termsDocumentList.parse(rows))
  })

  /**
   * Read a document in the app, as the studio rather than as the client.
   *
   * Same payload the client link serves, addressed by document id and scoped
   * to the caller's company. The SQL function behind it is `stable` and bumps
   * no counters: the token version increments access_count on both the token
   * and the document, which the Documents page reports as "the client opened
   * it". Routing internal reads through that would have the studio inflating
   * its own engagement figure every time it checked what it had sent.
   *
   * Revoked and expired documents are returned rather than hidden — the flags
   * are in the payload and the viewer says so. What a studio most needs to
   * re-read is usually the one whose link has lapsed.
   */
  .get('/documents/:id/payload', requireAction('projects', 'view'), async (c) => {
    const id = c.req.param('id')
    if (!id || !z.string().uuid().safeParse(id).success) fail(422, 'Invalid document id.')
    const rows = await attempt(c, 'terms.document_payload', () =>
      withUser(
        c.env,
        c.get('auth').userId,
        (sql) => sql`select * from get_terms_payload_for_document(${id}::uuid)`,
      ),
    )
    if (!rows) fail(400, 'We could not open this document.')
    if (!rows[0]) fail(404, 'That document was not found.')
    return c.json(
      termsPayload.parse({
        ...(rows[0] as Record<string, unknown>),
        body: (rows[0] as { body?: string }).body ?? '',
      }),
    )
  })

  /** Every version of one project's terms, newest first. */
  .get('/projects/:projectId/documents', requireAction('projects', 'view'), async (c) => {
    const projectId = c.req.param('projectId') ?? ''
    if (!z.string().uuid().safeParse(projectId).success) fail(422, 'Invalid project id.')
    const rows = await attempt(c, 'terms.project_documents', () =>
      withUser(c.env, c.get('auth').userId, (sql) => sql`select * from list_project_terms(${projectId}::uuid)`),
    )
    if (!rows) fail(400, 'We could not load the terms for this project.')
    return c.json(projectTermsVersion.array().parse(rows))
  })

  /**
   * A fresh link for a document already sent -- "send again" -- with the old
   * link cancelled. Optionally emails it. The raw link is never stored, so
   * this is also how the studio gets a link to copy after the first send.
   */
  .post('/documents/:id/link', requireAction('projects', 'edit'), async (c) => {
    const id = c.req.param('id') ?? ''
    if (!z.string().uuid().safeParse(id).success) fail(422, 'Invalid document id.')
    const parsed = sendLinkRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Please check the email address.')
    const token = await attempt(
      c,
      'terms.new_link',
      () =>
        withUser(c.env, c.get('auth').userId, async (sql) => {
          const rows = await sql<{ token: string }[]>`
            select terms_document_new_link(${id}::uuid, ${parsed.data.expiry_days * 24}) as token`
          return rows[0]?.token ?? null
        }),
      {
        onCode: (code, err) =>
          code === '22023' || code === 'P0001' ? fail(422, err instanceof Error ? err.message : 'This link cannot be sent.') : undefined,
      },
    )
    if (!token) fail(400, 'We could not make a new link.')
    const url = termsLink(c.env, token)
    const email = parsed.data.email ? await emailTerms(c, id, url, parsed.data.to_email) : null
    await audit(c, { action: 'terms.new_link', entityType: 'terms_document', entityId: id, after: { emailed: !!email } })
    return c.json(
      linkResponse.parse({
        document_id: id,
        token,
        url,
        email_status: email?.status ?? 'not_requested',
        email_error: email?.error ?? null,
      }),
    )
  })

  /**
   * Email a link the studio already holds (just made, maybe already sent on
   * WhatsApp) without replacing it. The link must belong to this document and
   * still work -- the server checks the token, it never trusts the URL.
   */
  .post('/documents/:id/email', requireAction('projects', 'edit'), async (c) => {
    const id = c.req.param('id') ?? ''
    if (!z.string().uuid().safeParse(id).success) fail(422, 'Invalid document id.')
    const parsed = z
      .object({ token: z.string().min(10).max(200), to_email: z.string().trim().email().max(200).nullish() })
      .safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Please check the email address.')
    const live = await attempt(c, 'terms.email_check', () =>
      withUser(c.env, c.get('auth').userId, async (sql) => {
        const rows = await sql<{ ok: boolean }[]>`
          select terms_link_is_live(${id}::uuid, ${parsed.data.token}) as ok`
        return rows[0]?.ok ?? false
      }),
    )
    if (!live) fail(409, 'That link no longer works. Send the terms again to make a new one.')
    const url = termsLink(c.env, parsed.data.token)
    const email = await emailTerms(c, id, url, parsed.data.to_email)
    await audit(c, { action: 'terms.email', entityType: 'terms_document', entityId: id, after: { status: email.status } })
    return c.json({ status: email.status, error: email.error })
  })

  /** Kept for the Documents page: now a new link for the SAME document. */
  .post('/documents/:id/rotate', requireAction('projects', 'edit'), async (c) => {
    const id = c.req.param('id') ?? ''
    if (!z.string().uuid().safeParse(id).success) fail(422, 'Invalid document id.')
    const token = await attempt(
      c,
      'terms.rotate',
      () =>
        withUser(c.env, c.get('auth').userId, async (sql) => {
          const rows = await sql<{ token: string }[]>`select terms_document_new_link(${id}::uuid, 336) as token`
          return rows[0]?.token ?? null
        }),
      {
        onCode: (code, err) =>
          code === '22023' || code === 'P0001' ? fail(422, err instanceof Error ? err.message : 'This link cannot be sent.') : undefined,
      },
    )
    if (!token) fail(400, 'We could not rotate this link.')
    await audit(c, { action: 'terms.rotate', entityType: 'terms_document', entityId: id })
    return c.json(issueTermsResponse.parse({ document_id: id, token }), 201)
  })

  .post('/email-log', requireAction('projects', 'edit'), async (c) => {
    const parsed = z.object({
      document_id: z.string().uuid().nullable().optional(),
      to: z.string().max(200),
      subject: z.string().max(200),
      body: z.string().max(10000),
      status: z.enum(['draft', 'sent', 'failed']).default('sent'),
    }).safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Please check the email details.')
    const auth = c.get('auth')
    const row = await attempt(c, 'terms.email_log', () =>
      withUser(c.env, auth.userId, async (sql) => {
        const rows = await sql<{ id: string }[]>`
          insert into terms_email_logs ${sql({ company_id: auth.companyId, document_id: parsed.data.document_id ?? null, to_email: parsed.data.to, subject: parsed.data.subject, body: parsed.data.body, status: parsed.data.status })} returning id`
        return rows[0] ?? null
      }),
    )
    if (!row) fail(400, 'We could not log the email.')
    await audit(c, { action: 'terms.email_log', entityType: 'terms_document', entityId: parsed.data.document_id ?? 'none', after: { to: parsed.data.to } })
    return c.json({ id: row.id }, 201)
  })

  .get('/email-log', requireAction('projects', 'view'), async (c) => {
    const rows = await attempt(c, 'terms.email_log.list', () =>
      withUser(c.env, c.get('auth').userId, (sql) => sql`
        select id, document_id, to_email as "to", subject, body, status, sent_at from terms_email_logs order by sent_at desc limit 200`),
    )
    if (!rows) fail(400, 'We could not load email history.')
    return c.json(rows)
  })

  /** The studio's saved terms templates — the wizard opens from these. */
  .get('/templates', requireAction('projects', 'view'), async (c) => {
    const rows = await attempt(c, 'terms.templates', () =>
      withUser(c.env, c.get('auth').userId, (sql) => sql`
        select id, name, body, version, created_at
          from project_terms_templates order by name`),
    )
    if (!rows) fail(400, 'We could not load your terms templates.')
    return c.json(termsTemplate.array().parse(rows))
  })

  .post('/templates', requireAction('projects', 'edit'), async (c) => {
    const parsed = z
      .object({ name: z.string().trim().min(2).max(120), body: z.string().trim().min(1).max(20000) })
      .safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Give the template a name and some text.')
    const auth = c.get('auth')
    const rows = await attempt(c, 'terms.template_create', () =>
      withUser(c.env, auth.userId, (sql) => sql<{ id: string }[]>`
        insert into project_terms_templates (company_id, name, body)
        values (${auth.companyId}, ${parsed.data.name}, ${parsed.data.body})
        returning id`),
    )
    if (!rows?.length) fail(400, 'We could not save that template.')
    await audit(c, { action: 'terms.template_create', entityType: 'terms_template', entityId: rows[0]!.id })
    return c.json({ id: rows[0]!.id }, 201)
  })

  .delete('/templates/:id', requireAction('projects', 'edit'), async (c) => {
    const id = c.req.param('id') ?? ''
    if (!z.string().uuid().safeParse(id).success) fail(422, 'Invalid template id.')
    const rows = await attempt(c, 'terms.template_delete', () =>
      withUser(c.env, c.get('auth').userId, (sql) => sql`delete from project_terms_templates where id = ${id} returning id`),
    )
    if (!rows) fail(400, 'We could not remove that template.')
    if (!rows.length) fail(404, 'That template was not found.')
    await audit(c, { action: 'terms.template_delete', entityType: 'terms_template', entityId: id })
    return c.body(null, 204)
  })

  /** Three starting points, for a studio with an empty library. */
  .post('/templates/seed', requireAction('projects', 'edit'), async (c) => {
    const rows = await attempt(c, 'terms.template_seed', () =>
      withUser(c.env, c.get('auth').userId, (sql) => sql<{ n: number }[]>`select seed_terms_templates() as n`),
    )
    if (!rows) fail(400, 'We could not add the default templates.')
    const seeded = rows[0]?.n ?? 0
    await audit(c, { action: 'terms.template_seed', entityType: 'terms_template', after: { seeded } })
    return c.json({ seeded })
  })

  // ── drafts ──────────────────────────────────────────────────
  // Same table as a real document, minus the access token: nothing has been
  // sent, so there is nothing for a client to open.
  .get('/draft', requireAction('projects', 'view'), async (c) => {
    const projectId = c.req.query('project_id') ?? ''
    if (!/^[0-9a-f-]{36}$/i.test(projectId)) fail(422, 'A project is required.')
    const row = await attempt(c, 'terms.draft_get', () =>
      withUser(c.env, c.get('auth').userId, async (sql) => {
        const rows = await sql<Record<string, unknown>[]>`
          select id, project_id, rendered_body, title, payment_summary, sections,
                 payment_terms, total_cost, legal_note, template_id,
                 created_at::text as updated_at
            from project_terms_documents
           where project_id = ${projectId} and is_draft
           limit 1`
        return rows[0] ?? null
      }),
    )
    // No draft is the normal case, not an error.
    if (!row) return c.json(null)
    return c.json(termsDraft.parse(row))
  })

  .put('/draft', requireAction('projects', 'edit'), async (c) => {
    const parsed = saveTermsDraftRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Please check the draft.')
    const d = parsed.data
    const row = await attempt(c, 'terms.draft_save', () =>
      withUser(c.env, c.get('auth').userId, async (sql) => {
        const rows = await sql<Record<string, unknown>[]>`
          insert into project_terms_documents
            (company_id, project_id, is_draft, rendered_body, title, payment_summary,
             sections, payment_terms, total_cost, legal_note, template_id)
          values (get_current_company_id(), ${d.project_id}, true, ${d.rendered_body},
                  ${d.title ?? null}, ${d.payment_summary ?? null},
                  -- Both columns are NOT NULL: a draft with no sections or plan
                  -- yet is an empty list, not a missing one.
                  coalesce(${d.sections ? sql.json(d.sections as never) : null}::jsonb, '[]'::jsonb),
                  coalesce(${d.payment_terms ? sql.json(d.payment_terms as never) : null}::jsonb, '[]'::jsonb),
                  ${d.total_cost ?? null}, ${d.legal_note ?? null}, ${d.template_id ?? null})
          on conflict (company_id, project_id) where is_draft and project_id is not null
          do update set rendered_body = excluded.rendered_body,
                        title = excluded.title,
                        payment_summary = excluded.payment_summary,
                        sections = excluded.sections,
                        payment_terms = excluded.payment_terms,
                        total_cost = excluded.total_cost,
                        legal_note = excluded.legal_note,
                        template_id = excluded.template_id
          returning id, project_id, rendered_body, title, payment_summary, sections,
                    payment_terms, total_cost, legal_note, template_id,
                    created_at::text as updated_at`
        return rows[0] ?? null
      }),
    )
    if (!row) fail(400, 'We could not save the draft.')
    return c.json(termsDraft.parse(row))
  })

  .delete('/draft', requireAction('projects', 'edit'), async (c) => {
    const projectId = c.req.query('project_id') ?? ''
    if (!/^[0-9a-f-]{36}$/i.test(projectId)) fail(422, 'A project is required.')
    const ok = await attempt(c, 'terms.draft_delete', () =>
      withUser(
        c.env,
        c.get('auth').userId,
        (sql) => sql`delete from project_terms_documents where project_id = ${projectId} and is_draft`,
      ),
    )
    if (!ok) fail(400, 'We could not discard the draft.')
    return c.body(null, 204)
  })

  .post('/issue', requireAction('projects', 'edit'), async (c) => {
    const parsed = issueTermsRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Terms text is required.')
    const d = parsed.data
    const ttlHours = (d.expiry_days ?? 14) * 24
    // A project's terms go through the one call that also withdraws the older
    // version and its link. Loose documents (no project) keep the old path.
    if (d.project_id) {
      const made = await attempt(
        c,
        'terms.issue_client',
        () =>
          withUser(c.env, c.get('auth').userId, async (sql) => {
            const rows = await sql<{ document_id: string; token: string }[]>`
              select * from issue_client_terms(
                p_project_id => ${d.project_id},
                p_body => ${d.rendered_body},
                p_title => ${d.title ?? null},
                p_payment_terms => ${d.payment_terms ? sql.json(d.payment_terms as never) : null}::jsonb,
                p_total_cost => ${d.total_cost ?? null},
                p_legal_note => ${d.legal_note ?? null},
                p_ttl_hours => ${ttlHours},
                p_template_id => ${d.template_id ?? null}
              )`
            return rows[0] ?? null
          }),
        { onCode: (code, err) => (code === '22023' ? fail(422, err instanceof Error ? err.message : 'The terms are empty.') : undefined) },
      )
      if (!made) fail(400, 'We could not create the document.')
      const url = termsLink(c.env, made.token)
      const email = d.email ? await emailTerms(c, made.document_id, url, d.to_email) : null
      await audit(c, {
        action: 'terms.issue',
        entityType: 'terms_document',
        entityId: made.document_id,
        after: { project_id: d.project_id, emailed: !!email },
      })
      return c.json(
        linkResponse.parse({
          ...made,
          url,
          email_status: email?.status ?? 'not_requested',
          email_error: email?.error ?? null,
        }),
        201,
      )
    }
    const row = await attempt(c, 'terms.issue', () =>
      withUser(c.env, c.get('auth').userId, async (sql) => {
        const rows = await sql<{ document_id: string; token: string }[]>`
          select * from issue_terms_document(
            p_project_id => ${d.project_id},
            p_rendered_body => ${d.rendered_body},
            p_ttl_hours => ${ttlHours}
          )`
        return rows[0] ?? null
      }),
    )
    if (!row) fail(400, 'We could not create the document.')
    // Lovable parity extras (best-effort).
    try {
      await withUser(c.env, c.get('auth').userId, async (sql) => {
        await sql`update project_terms_documents set
            title = coalesce(${parsed.data.title ?? null}, title),
            payment_summary = coalesce(${parsed.data.payment_summary ?? null}, payment_summary),
            sections = coalesce(${parsed.data.sections ? sql.json(parsed.data.sections as never) : null}::jsonb, sections),
            payment_terms = coalesce(${parsed.data.payment_terms ? sql.json(parsed.data.payment_terms as never) : null}::jsonb, payment_terms),
            total_cost = coalesce(${parsed.data.total_cost ?? null}, total_cost),
            legal_note = coalesce(${parsed.data.legal_note ?? null}, legal_note),
            expires_at = coalesce((${parsed.data.expiry_days != null ? sql`now() + make_interval(days => ${parsed.data.expiry_days})` : sql`null`})::timestamptz, expires_at)
          where id = ${row.document_id}`
      })
    } catch { /* extras never fail issuance */ }
    // The draft became this document. Leaving it behind would offer the studio
    // a half-finished copy of something they have already sent.
    if (parsed.data.project_id) {
      await attempt(c, 'terms.draft_clear', () =>
        withUser(
          c.env,
          c.get('auth').userId,
          (sql) => sql`delete from project_terms_documents
                        where project_id = ${parsed.data.project_id} and is_draft`,
        ),
      )
    }
    await audit(c, {
      action: 'terms.issue',
      entityType: 'terms_document',
      entityId: row.document_id,
      after: { project_id: parsed.data.project_id },
    })
    return c.json(issueTermsResponse.parse(row), 201)
  })

  // Lovable parity: revoke + resend-email (logged to project_terms_email_logs).
  .post('/documents/:id/revoke', requireAction('projects', 'edit'), async (c) => {
    const id = textParam(c, 'id', 400)
    const ok = await attempt(c, 'terms.revoke', () =>
      withUser(c.env, c.get('auth').userId, async (sql) => {
        // The document AND its link: the client page checks both now.
        const rows = await sql<{ ok: boolean }[]>`select cancel_terms_document(${id}::uuid) as ok`
        return rows[0]?.ok ?? false
      }),
    )
    if (!ok) fail(409, 'This link cannot be cancelled — it was already agreed to or replaced.')
    await audit(c, { action: 'terms.revoke', entityType: 'terms_document', entityId: id })
    return c.json({ ok: true })
  })

  .get('/documents/:id/email-logs', requireAction('projects', 'view'), async (c) => {
    const id = textParam(c, 'id', 400)
    const rows = await attempt(c, 'terms.email_logs', () =>
      withUser(c.env, c.get('auth').userId, (sql) => sql`
        select id, to_email, status, error, created_at from project_terms_email_logs
        where document_id = ${id}::uuid order by created_at desc limit 50`),
    )
    if (!rows) fail(400, 'We could not load email logs.')
    return c.json(rows)
  })

/** PUBLIC (no auth): client views + acknowledges terms by token. */
export const publicTermsRouter = new Hono<AppEnv>()
  // Lovable parity: rich payload first; body-only kept for old clients.
  .get('/terms/:token/payload', async (c) => {
    const token = textParam(c, 'token', 400)
    const rows = await attempt(c, 'terms.public_payload', () =>
      withService(c.env, (sql) => sql`select * from get_terms_payload_for_token(p_raw => ${token})`),
    )
    if (!rows) fail(503, 'The service is temporarily unavailable. Please try again in a moment.')
    if (!rows[0]) fail(404, 'This link is invalid or has expired.')
    return c.json(termsPayload.parse({ ...rows[0] as Record<string, unknown>, body: (rows[0] as { body?: string }).body ?? '' }))
  })

  .get('/terms/:token', async (c) => {
    const token = textParam(c, 'token', 400)
    const rows = await attempt(c, 'terms.public_get', () =>
      withService(c.env, (sql) => sql<{ body: string | null }[]>`select get_terms_for_token(p_raw => ${token}) as body`),
    )
    if (!rows) fail(503, 'The service is temporarily unavailable. Please try again in a moment.')
    const body = rows[0]?.body
    if (!body) fail(404, 'This link is invalid or has expired.')
    return c.json(termsBody.parse({ body }))
  })

  .post('/terms/:token/ack', async (c) => {
    const parsed = ackRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Please enter your name to agree.')
    const token = textParam(c, 'token', 400)
    const ip = resolveClientIp(c.req.raw.headers, c.env.CLIENT_IP_HEADER)
    const ua = c.req.header('User-Agent') ?? null
    const rows = await attempt(c, 'terms.public_ack', () =>
      withService(
        c.env,
        (sql) => sql<{ ok: boolean }[]>`
          select acknowledge_terms(
            p_raw => ${token},
            p_name => ${parsed.data.name},
            p_email => ${parsed.data.email ?? null},
            p_ip => ${ip === 'unknown' ? null : ip},
            p_user_agent => ${ua}
          ) as ok`,
      ),
    )
    if (!rows) fail(400, 'We could not record your agreement.')
    if (rows[0]?.ok === false) fail(409, 'This link has already been used or has expired.')
    return c.json({ ok: true })
  })
