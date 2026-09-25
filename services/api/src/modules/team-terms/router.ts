import { Hono } from 'hono'
import {
  acknowledgeTeamTermsRequest,
  publicTeamTerms,
  saveTeamTermsTemplateRequest,
  sendTeamTermsRequest,
  sendTeamTermsResponse,
  teamTermsSend,
  teamTermsTemplate,
  z,
} from '@ipc/contracts'
import { renderTeamTerms } from '@ipc/domain'
import type { AppEnv } from '../../context'
import { requireAuth } from '../../middleware/auth'
import { requireAction, requireModule } from '../../middleware/permissions'
import { fail } from '../../middleware/errors'
import { textParam, uuidParam, uuidQuery } from '../../lib/params'
import { withService, withUser } from '../../lib/db'
import { attempt } from '../../lib/attempt'
import { audit } from '../../lib/audit'
import { resolveClientIp } from '../../lib/client-ip'
import { sendTeamTermsEmail } from '../../lib/email'

const templates = teamTermsTemplate.array()
const sends = teamTermsSend.array()
const okResponse = z.object({ ok: z.boolean() })

/** Default link life when a template does not set one: two weeks. */
const DEFAULT_TTL_HOURS = 336

/**
 * Team terms — the crew-facing half of what 0017 built for clients.
 *
 * Templates and sends are gated on `projects.edit`: whoever books the shoot is
 * who puts the terms in front of the person booked -- and on the Team Terms
 * module itself, so a studio (or a person) with it switched off has none of
 * it. The public reader below is gated on nothing at all, because the crew
 * member reading it has no account.
 */
export const teamTermsRouter = new Hono<AppEnv>()
  .use('*', requireAuth)
  .use('*', requireModule('team_terms'))

  .get('/templates', requireAction('projects', 'view'), async (c) => {
    const archived = c.req.query('archived') === '1'
    const rows = await attempt(c, 'team_terms.templates', () =>
      withUser(
        c.env,
        c.get('auth').userId,
        (sql) => sql`
          select t.id, t.title, t.description, t.body, t.mode, t.validity_days,
                 t.category, t.version, t.is_active, t.archived_at,
                 coalesce(
                   array_agg(r.role_id) filter (where r.role_id is not null),
                   '{}'::uuid[]
                 ) as role_ids,
                 (select count(*)::int from team_terms_sends s where s.template_id = t.id)
                   as send_count
            from team_terms_templates t
            left join team_terms_template_roles r on r.template_id = t.id
           where ${archived ? sql`t.archived_at is not null` : sql`t.archived_at is null`}
           group by t.id
           order by t.category nulls last, t.title`,
      ),
    )
    if (!rows) fail(400, 'We could not load your team terms.')
    return c.json(templates.parse(rows))
  })

  .post('/templates', requireAction('projects', 'edit'), async (c) => {
    const parsed = saveTeamTermsTemplateRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Please check the title and the body of the terms.')
    const auth = c.get('auth')
    const d = parsed.data
    const rolesOk = await attempt(c, 'team_terms.roles_check', () =>
      withUser(c.env, auth.userId, (sql) => assertRolesBelong(sql, auth.companyId, d.role_ids)),
    )
    if (rolesOk === false) fail(422, 'One of those roles does not belong to this studio.')
    if (!rolesOk) fail(400, 'We could not save these terms.')
    const row = await attempt(c, 'team_terms.template_create', () =>
      withUser(c.env, auth.userId, async (sql) => {
        const rows = await sql<{ id: string }[]>`
          insert into team_terms_templates ${sql({
            company_id: auth.companyId,
            title: d.title,
            description: d.description ?? null,
            body: d.body,
            mode: d.mode,
            validity_days: d.validity_days ?? null,
            category: d.category ?? null,
            is_active: d.is_active,
            created_by: auth.userId,
          })}
          returning id`
        const made = rows[0]
        if (!made) return null
        await setRoles(sql, auth.companyId, made.id, d.role_ids)
        return made
      }),
    )
    if (!row) fail(400, 'We could not save these terms.')
    await audit(c, {
      action: 'team_terms.template_create',
      entityType: 'team_terms_template',
      entityId: row.id,
      after: { title: d.title, mode: d.mode },
    })
    return c.json({ id: row.id }, 201)
  })

  .patch('/templates/:id', requireAction('projects', 'edit'), async (c) => {
    const id = uuidParam(c)
    const parsed = saveTeamTermsTemplateRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Please check the title and the body of the terms.')
    const auth = c.get('auth')
    const d = parsed.data
    const rolesOk = await attempt(c, 'team_terms.roles_check', () =>
      withUser(c.env, auth.userId, (sql) => assertRolesBelong(sql, auth.companyId, d.role_ids)),
    )
    if (rolesOk === false) fail(422, 'One of those roles does not belong to this studio.')
    if (!rolesOk) fail(400, 'We could not save these terms.')
    const rows = await attempt(c, 'team_terms.template_update', () =>
      withUser(c.env, auth.userId, async (sql) => {
        // The version is what a send is stamped with, so an edit bumps it:
        // "acknowledged v2" has to mean something different from v1.
        const updated = await sql<{ id: string }[]>`
          update team_terms_templates
             set title = ${d.title},
                 description = ${d.description ?? null},
                 body = ${d.body},
                 mode = ${d.mode},
                 validity_days = ${d.validity_days ?? null},
                 category = ${d.category ?? null},
                 is_active = ${d.is_active},
                 version = version + 1
           where id = ${id}
           returning id`
        if (!updated[0]) return []
        await setRoles(sql, auth.companyId, id, d.role_ids)
        return updated
      }),
    )
    if (!rows) fail(400, 'We could not save these terms.')
    if (!rows.length) fail(404, 'We could not find those terms.')
    await audit(c, {
      action: 'team_terms.template_update',
      entityType: 'team_terms_template',
      entityId: id,
      after: { title: d.title, mode: d.mode },
    })
    return c.json({ ok: true })
  })

  /**
   * Permanent delete with a usage guard: a template that has ever been sent
   * cannot be deleted (archive instead), so acknowledgement history never
   * loses the words it points at. Unused drafts can go entirely.
   */
  .delete('/templates/:id', requireAction('projects', 'delete'), async (c) => {
    const id = uuidParam(c)
    const result = await attempt(
      c,
      'team_terms.template_delete',
      () =>
        withUser(c.env, c.get('auth').userId, async (sql) => {
          const [used] = await sql<{ n: string }[]>`
            select count(*)::text as n from team_terms_sends where template_id = ${id}`
          if (used && Number(used.n) > 0) return 'used' as const
          const rows = await sql<{ id: string }[]>`
            delete from team_terms_templates where id = ${id} returning id`
          if (!rows.length) return 'missing' as const
          return 'ok' as const
        }),
    )
    if (result === 'used')
      fail(409, 'These terms have been sent before. Archive them instead of deleting.')
    if (result === 'missing') fail(404, 'We could not find those terms.')
    if (!result) fail(400, 'We could not delete these terms.')
    await audit(c, { action: 'team_terms.template_delete', entityType: 'team_terms_template', entityId: id })
    return c.body(null, 204)
  })

  /**
   * Archive rather than delete: a send points at the template it went out
   * under, and the studio may need to show what that said a year later.
   */
  .post('/templates/:id/archive', requireAction('projects', 'edit'), async (c) => {
    const id = uuidParam(c)
    const restore = c.req.query('restore') === '1'
    const rows = await attempt(c, 'team_terms.template_archive', () =>
      withUser(
        c.env,
        c.get('auth').userId,
        (sql) => sql<{ id: string }[]>`
          update team_terms_templates
             set archived_at = ${restore ? null : new Date().toISOString()},
                 is_active = ${restore}
           where id = ${id} returning id`,
      ),
    )
    if (!rows) fail(400, 'We could not archive these terms.')
    if (!rows.length) fail(404, 'We could not find those terms.')
    await audit(c, {
      action: restore ? 'team_terms.template_restore' : 'team_terms.template_archive',
      entityType: 'team_terms_template',
      entityId: id,
    })
    return c.json(okResponse.parse({ ok: true }))
  })

  // ── sends ───────────────────────────────────────────────────
  .get('/sends', requireAction('projects', 'view'), async (c) => {
    const shoot = uuidQuery(c, 'shoot_id')
    const project = uuidQuery(c, 'project_id')
    const rows = await attempt(c, 'team_terms.sends', () =>
      withUser(
        c.env,
        c.get('auth').userId,
        (sql) => sql`
          select s.id, s.shoot_id, sh.name as shoot_name, sh.shoot_date,
                 s.project_id, s.user_id, s.role_name, s.template_id,
                 t.title as template_title, s.template_version, s.mode,
                 s.recipient_name, s.recipient_email, s.recipient_phone,
                 s.status, s.sent_via, s.sent_at, s.viewed_at, s.acknowledged_at,
                 s.acknowledged_by_name, s.expires_at, s.created_at
            from team_terms_sends s
            left join shoots sh on sh.id = s.shoot_id
            left join team_terms_templates t on t.id = s.template_id
           where ${shoot ? sql`s.shoot_id = ${shoot}` : sql`true`}
             and ${project ? sql`s.project_id = ${project}` : sql`true`}
           order by s.created_at desc`,
      ),
    )
    if (!rows) fail(400, 'We could not load what has been sent.')
    return c.json(sends.parse(rows))
  })

  /**
   * Render, store and issue the link in one call.
   *
   * The body is substituted here rather than in the browser: what the crew
   * member agreed to is evidence, and evidence assembled client-side is worth
   * nothing.
   */
  .post('/sends', requireAction('projects', 'edit'), async (c) => {
    const parsed = sendTeamTermsRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Please check who these terms are going to.')
    const auth = c.get('auth')
    const d = parsed.data

    const context = await attempt(c, 'team_terms.send_context', () =>
      withUser(c.env, auth.userId, async (sql) => {
        const rows = await sql<
          {
            body: string
            title: string
            mode: string
            validity_days: number | null
            shoot_name: string | null
            shoot_date: string | null
            project_name: string | null
            company_name: string | null
            company_address: string | null
          }[]
        >`
          -- companies has no single address column; the city/state/country
          -- trio is what a studio actually fills in, so the undertaking's
          -- "having its office at …" is built from those.
          select t.body, t.title, t.mode, t.validity_days,
                 sh.name as shoot_name, sh.shoot_date,
                 p.name as project_name,
                 c.name as company_name,
                 nullif(
                   concat_ws(', ', nullif(c.city, ''), nullif(c.state, ''), nullif(c.country, '')),
                   ''
                 ) as company_address
            from team_terms_templates t
            left join shoots sh on sh.id = ${d.shoot_id}
            left join projects p on p.id = sh.project_id
            left join companies c on c.id = ${auth.companyId}
           where t.id = ${d.template_id}`
        return rows[0] ?? null
      }),
    )
    if (!context) fail(404, 'We could not find those terms.')

    const rendered = renderTeamTerms(context.body, {
      company_name: context.company_name,
      company_address: context.company_address,
      team_member_name: d.recipient_name,
      role: d.role_name ?? null,
      shoot_name: context.shoot_name,
      shoot_date: context.shoot_date,
      project_name: context.project_name,
      agreement_date: new Date().toISOString().slice(0, 10),
    })

    const ttl = context.validity_days ? context.validity_days * 24 : DEFAULT_TTL_HOURS
    const issued = await attempt(c, 'team_terms.send', () =>
      withUser(c.env, auth.userId, async (sql) => {
        const rows = await sql<{ send_id: string; token: string; expires_at: string | null }[]>`
          select send_id, token, expires_at from issue_team_terms(
            p_shoot_id => ${d.shoot_id},
            p_template_id => ${d.template_id},
            p_rendered_body => ${rendered},
            p_recipient_name => ${d.recipient_name},
            p_recipient_email => ${d.recipient_email ?? null},
            p_recipient_phone => ${d.recipient_phone ?? null},
            p_user_id => ${d.user_id ?? null},
            p_role_id => ${d.role_id ?? null},
            p_role_name => ${d.role_name ?? null},
            p_ttl_hours => ${ttl}
          )`
        return rows[0] ?? null
      }),
    )
    if (!issued) fail(400, 'We could not send these terms.')

    // Query param, not a path: the public page reads `?token=` the same way
    // the client-terms page has since 0017, and one shape is enough.
    const link = `${c.env.APP_URL}/team-terms?token=${issued.token}`
    let email: 'sent' | 'skipped' | 'failed' = 'skipped'
    if (d.send_email && d.recipient_email) {
      const ok = await sendTeamTermsEmail(c.env, d.recipient_email, link, {
        companyName: context.company_name ?? 'Your studio',
        shootName: context.shoot_name,
        title: context.title,
        mustSign: context.mode === 'acknowledgement_required',
      })
      email = ok ? 'sent' : 'failed'
    }

    // Marked sent only once it has actually left: a link nobody has been given
    // is still a draft, and the shoot card says so.
    await attempt(c, 'team_terms.mark_sent', () =>
      withUser(
        c.env,
        auth.userId,
        (sql) => sql`
          update team_terms_sends
             set status = 'sent', sent_at = now(), sent_via = ${email === 'sent' ? 'email' : 'link'}
           where id = ${issued.send_id}`,
      ),
    )

    await audit(c, {
      action: 'team_terms.send',
      entityType: 'team_terms_send',
      entityId: issued.send_id,
      after: { template_id: d.template_id, recipient: d.recipient_name, email },
    })
    return c.json(
      sendTeamTermsResponse.parse({
        send_id: issued.send_id,
        link,
        expires_at: issued.expires_at,
        email,
      }),
      201,
    )
  })

  /** Pull a link back. The token stays valid but the send refuses to open. */
  .post('/sends/:id/revoke', requireAction('projects', 'edit'), async (c) => {
    const id = uuidParam(c)
    const rows = await attempt(c, 'team_terms.revoke', () =>
      withUser(
        c.env,
        c.get('auth').userId,
        (sql) => sql<{ id: string }[]>`
          update team_terms_sends
             set status = 'revoked', revoked_at = now()
           where id = ${id} and acknowledged_at is null
           returning id`,
      ),
    )
    if (!rows) fail(400, 'We could not revoke this.')
    if (!rows.length) fail(409, 'This has already been acknowledged, so it cannot be revoked.')
    await audit(c, { action: 'team_terms.revoke', entityType: 'team_terms_send', entityId: id })
    return c.json(okResponse.parse({ ok: true }))
  })

/**
 * Every mapped role must belong to this studio. The mapping row itself carries
 * the caller's company_id (so RLS passes either way) — without this check a
 * list of foreign role ids would link in names from another tenant wherever
 * the mapping is joined without re-scoping.
 */
async function assertRolesBelong(
  sql: Parameters<Parameters<typeof withUser>[2]>[0],
  companyId: string,
  roleIds: string[],
): Promise<boolean> {
  if (roleIds.length === 0) return true
  const found = await sql<{ n: number }[]>`
    select count(*)::int as n from employee_roles
    where company_id = ${companyId} and id = any(${sql.array([...new Set(roleIds)])})`
  return (found[0]?.n ?? 0) === new Set(roleIds).size
}

/** Replace a template's role mapping wholesale — the editor sends the full set. */
async function setRoles(
  sql: Parameters<Parameters<typeof withUser>[2]>[0],
  companyId: string,
  templateId: string,
  roleIds: string[],
) {
  await sql`delete from team_terms_template_roles where template_id = ${templateId}`
  for (const roleId of roleIds) {
    await sql`
      insert into team_terms_template_roles ${sql({
        template_id: templateId,
        role_id: roleId,
        company_id: companyId,
      })}
      on conflict do nothing`
  }
}

/**
 * PUBLIC (no auth): the crew member's side of the link.
 *
 * Runs as service_role because the reader has no session at all — every query
 * is scoped by the token itself, which resolves to exactly one send.
 */
export const publicTeamTermsRouter = new Hono<AppEnv>()
  .get('/team-terms/:token', async (c) => {
    const token = textParam(c, 'token', 400)
    const rows = await attempt(c, 'team_terms.public_get', () =>
      withService(c.env, (sql) => sql`select * from get_team_terms_for_token(p_raw => ${token})`),
    )
    if (!rows) fail(503, 'The service is temporarily unavailable. Please try again in a moment.')
    const row = rows[0]
    if (!row) fail(404, 'This link is invalid, expired or has been withdrawn.')
    return c.json(publicTeamTerms.parse(row))
  })

  .post('/team-terms/:token/ack', async (c) => {
    const parsed = acknowledgeTeamTermsRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Please type your name to agree.')
    const token = textParam(c, 'token', 400)
    const ip = resolveClientIp(c.req.raw.headers, c.env.CLIENT_IP_HEADER)
    const rows = await attempt(c, 'team_terms.public_ack', () =>
      withService(
        c.env,
        (sql) => sql<{ ok: boolean }[]>`
          select acknowledge_team_terms(
            p_raw => ${token},
            p_name => ${parsed.data.name},
            p_ip => ${ip === 'unknown' ? null : ip},
            p_user_agent => ${c.req.header('User-Agent') ?? null},
            p_email => ${parsed.data.email ?? null}
          ) as ok`,
      ),
    )
    if (!rows) fail(400, 'We could not record your agreement.')
    if (rows[0]?.ok === false) fail(409, 'This link has already been used or has expired.')
    return c.json(okResponse.parse({ ok: true }))
  })
