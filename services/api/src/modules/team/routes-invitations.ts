import { Hono, type Context } from 'hono'
import { createInvitationRequest, updateInvitationRequest, invitation, invitationLink } from '@ipc/contracts'
import type { AppEnv } from '../../context'
import { rateLimit } from '../../middleware/security'
import { fail } from '../../middleware/errors'
import { uuidParam } from '../../lib/params'
import { withUser } from '../../lib/db'
import { attempt } from '../../lib/attempt'
import { audit } from '../../lib/audit'
import { newRawToken, sha256Hex } from '../../lib/auth-token'
import { sendInvitationEmail } from '../../lib/email'
import { duplicateCode, teamGate, mayGrant, mayTouchPay, inviteScope, asCaller } from './shared'

const INVITE_DAYS = 7

const inviteLink = (env: AppEnv['Bindings'], raw: string) =>
  `${env.APP_URL}/accept-invite?token=${raw}`

/** The studio's display name for the invitation email; never fails the send. */
async function companyName(c: Context<AppEnv>): Promise<string> {
  const rows = await attempt(c, 'team.company_name', () =>
    withUser(
      c.env,
      c.get('auth').userId,
      (sql) => sql<{ name: string }[]>`select name from companies where id = ${c.get('auth').companyId}`,
    ),
  )
  return rows?.[0]?.name ?? 'Your studio'
}

export const invitationRoutes = new Hono<AppEnv>()
  // ── Invitations ─────────────────────────────────────────────
  // The other way in: instead of the owner choosing a password and passing it
  // along, the invitee sets their own by following a 7-day link. Only the hash
  // is stored, so a database read never yields a usable invitation.
  .get('/invitations', teamGate('create'), async (c) => {
    const companyId = c.get('auth').companyId
    const rows = await attempt(c, 'team.invitations', () =>
      asCaller(
        c,
        (sql) => sql`
          select id, email, pending_name as name, role,
                 pending_phone as phone, expires_at, created_at,
                 last_sent_at, send_count, (expires_at <= now()) as expired,
                 case
                   when accepted_at is not null then 'accepted'
                   when revoked_at is not null then 'revoked'
                   when expires_at <= now() then 'expired'
                   else 'pending'
                 end as status
          from user_invitations
          where company_id = ${companyId} and ${inviteScope(c, sql)}
          order by created_at desc
          limit 200`,
      ),
    )
    if (!rows) fail(400, 'We could not load the invitations.')
    return c.json(invitation.array().parse(rows))
  })

  .post('/invitations', teamGate('create'), rateLimit({ windowMs: 60_000, limit: 10 }), async (c) => {
    const parsed = createInvitationRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Please check the invitation details.')
    const v = parsed.data
    if (!mayGrant(c, v.role)) fail(403, 'Only the owner can give that access level.')
    if (v.salary !== undefined && !mayTouchPay(c)) fail(403, 'Only someone who handles salaries can set pay.')
    const companyId = c.get('auth').companyId
    const raw = newRawToken()
    const hash = await sha256Hex(raw)

    const result = await attempt(
      c,
      'team.invite',
      () =>
        asCaller(c, async (sql) => {
          const [taken] = await sql<{ user_id: string }[]>`
            select user_id from users where company_id = ${companyId} and lower(email) = ${v.email} and deleted_at is null`
          if (taken) return 'member' as const
          const [row] = await sql<{ id: string; expires_at: string }[]>`
            insert into user_invitations ${sql({
              company_id: companyId,
              email: v.email,
              token_hash: hash,
              role: v.role,
              pending_name: v.name,
              pending_phone: v.phone ?? null,
              pending_alternate_phone: v.alternate_phone ?? null,
              pending_engagement_type: v.engagement_type ?? null,
              pending_salary: v.salary ?? null,
              pending_address: v.address ?? null,
              invited_by: c.get('auth').userId,
              expires_at: new Date(Date.now() + INVITE_DAYS * 86_400_000).toISOString(),
            })}
            returning id, expires_at`
          // pending_role_ids is a uuid[]; postgres.js needs it typed explicitly.
          await sql`
            update user_invitations set pending_role_ids = ${sql.array(v.role_ids)}::uuid[]
            where id = ${row!.id}`
          return row!
        }),
      { onCode: duplicateCode },
    )

    if (result === 'member') fail(409, 'Someone with that email is already on your team.')
    if (result === 'duplicate') fail(409, 'That address already has a pending invitation.')
    if (!result) fail(400, 'We could not create this invitation.')

    await sendInvitationEmail(c.env, v.email, inviteLink(c.env, raw), await companyName(c))
    await audit(c, { action: 'invitation.create', entityType: 'user_invitation', entityId: result.id, after: { email: v.email, role: v.role } })

    return c.json(
      invitationLink.parse({ id: result.id, invite_link: inviteLink(c.env, raw), expires_at: result.expires_at }),
      201,
    )
  })

  // Resending rotates the token, so the previous link dies here rather than
  // living on beside its replacement.
  .post('/invitations/:id/resend', teamGate('create'), rateLimit({ windowMs: 60_000, limit: 10 }), async (c) => {
    const id = uuidParam(c)
    const raw = newRawToken()
    const hash = await sha256Hex(raw)
    const companyId = c.get('auth').companyId

    const rows = await attempt(c, 'team.invite_resend', () =>
      asCaller(
        c,
        (sql) => sql<{ email: string; expires_at: string }[]>`
          update user_invitations
             set token_hash = ${hash},
                 expires_at = ${new Date(Date.now() + INVITE_DAYS * 86_400_000).toISOString()},
                 send_count = send_count + 1,
                 last_sent_at = now()
           where id = ${id} and company_id = ${companyId} and ${inviteScope(c, sql)}
             and accepted_at is null and revoked_at is null
           returning email, expires_at`,
      ),
    )
    if (!rows) fail(400, 'We could not resend this invitation.')
    if (!rows.length) fail(404, 'We could not find that invitation.')

    await sendInvitationEmail(c.env, rows[0]!.email, inviteLink(c.env, raw), await companyName(c))
    await audit(c, { action: 'invitation.resend', entityType: 'user_invitation', entityId: id })

    return c.json(
      invitationLink.parse({ id, invite_link: inviteLink(c.env, raw), expires_at: rows[0]!.expires_at }),
    )
  })

  .patch('/invitations/:id', teamGate('create'), async (c) => {
    const parsed = updateInvitationRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Please check the invitation details.')
    const { name, role } = parsed.data
    if (name === undefined && role === undefined) fail(422, 'Nothing to change.')
    if (!mayGrant(c, role)) fail(403, 'Only the owner can give that access level.')
    const id = uuidParam(c)
    const companyId = c.get('auth').companyId
    const rows = await attempt(c, 'team.invite_update', () =>
      asCaller(
        c,
        (sql) => sql<{ id: string }[]>`
          update user_invitations set ${sql({
            ...(name !== undefined ? { pending_name: name } : {}),
            ...(role !== undefined ? { role } : {}),
          })}
          where id = ${id} and company_id = ${companyId} and ${inviteScope(c, sql)}
            and accepted_at is null and revoked_at is null
          returning id`,
      ),
    )
    if (!rows) fail(400, 'We could not update this invitation.')
    if (!rows.length) fail(404, 'We could not find that invitation.')
    await audit(c, { action: 'invitation.update', entityType: 'user_invitation', entityId: id, after: parsed.data })
    return c.json({ ok: true })
  })

  .delete('/invitations/:id', teamGate('create'), async (c) => {
    const id = uuidParam(c)
    const companyId = c.get('auth').companyId
    const rows = await attempt(c, 'team.invite_revoke', () =>
      asCaller(
        c,
        (sql) => sql<{ id: string }[]>`
          update user_invitations set revoked_at = now()
          where id = ${id} and company_id = ${companyId} and ${inviteScope(c, sql)}
            and accepted_at is null and revoked_at is null
          returning id`,
      ),
    )
    if (!rows) fail(400, 'We could not revoke this invitation.')
    if (!rows.length) fail(404, 'We could not find that invitation.')
    await audit(c, { action: 'invitation.revoke', entityType: 'user_invitation', entityId: id })
    return c.json({ ok: true })
  })
