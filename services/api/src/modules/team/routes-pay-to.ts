import { Hono } from 'hono'
import { payTo, setPayToRequest } from '@ipc/contracts'
import type { AppEnv } from '../../context'
import { fail } from '../../middleware/errors'
import { uuidParam } from '../../lib/params'
import { withService } from '../../lib/db'
import { attempt } from '../../lib/attempt'
import { audit } from '../../lib/audit'

export const payToRoutes = new Hono<AppEnv>()
  // Where to send someone's pay, in full, for whoever is paying them: the
  // owner, or someone who edits salaries or payouts. member_profiles is the
  // member's and the owner's under RLS, so the read goes through the service
  // role after this check -- scoped to the caller's studio -- and is audited.
  .get('/members/:id/pay-to', async (c) => {
    const id = uuidParam(c)
    const auth = c.get('auth')
    if (!auth.isOwner && !auth.access.hasAction('team_salaries', 'edit') && !auth.access.hasAction('team_payouts', 'edit')) {
      fail(403, 'Only whoever pays the team can see payment details.')
    }
    const rows = await attempt(c, 'team.member_pay_to', () =>
      withService(c.env, (sql) => sql`
        select u.name, mp.upi_id, mp.bank_account_name, mp.bank_account_number, mp.bank_ifsc,
               coalesce(u.login_enabled, true) as login_enabled
          from users u
          left join member_profiles mp on mp.user_id = u.user_id
         where u.user_id = ${id} and u.company_id = ${auth.companyId} and u.deleted_at is null`),
    )
    if (!rows) fail(400, 'We could not load their payment details.')
    if (!rows.length) fail(404, 'That team member was not found.')
    await audit(c, { action: 'member.pay_details_viewed', entityType: 'user', entityId: id })
    return c.json(payTo.parse(rows[0]))
  })

  // Whoever pays the team can also fill these in: a freelancer with no login
  // cannot, and many send their UPI on WhatsApp. Same checks as the person's
  // own form. A delegate never changes the owner's own details. The audit
  // names the fields that changed, never their values, and the person (if
  // they can sign in) is told, so pay can never be quietly redirected.
  .put('/members/:id/pay-to', async (c) => {
    const id = uuidParam(c)
    const auth = c.get('auth')
    if (!auth.isOwner && !auth.access.hasAction('team_salaries', 'edit') && !auth.access.hasAction('team_payouts', 'edit')) {
      fail(403, 'Only whoever pays the team can change payment details.')
    }
    const parsed = setPayToRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, parsed.error.issues[0]?.message ?? 'Please check the details.')
    const next = parsed.data
    const keys = (['upi_id', 'bank_account_name', 'bank_account_number', 'bank_ifsc'] as const).filter((k) => k in next)
    if (keys.length === 0) fail(422, 'Nothing to change.')
    const result = await attempt(c, 'team.member_pay_to_set', () =>
      withService(c.env, async (sql) => {
        const [m] = await sql<{ name: string; is_owner: boolean; login_enabled: boolean }[]>`
          select u.name, (co.owner_user_id = u.user_id) as is_owner, coalesce(u.login_enabled, true) as login_enabled
            from users u join companies co on co.id = u.company_id
           where u.user_id = ${id} and u.company_id = ${auth.companyId} and u.deleted_at is null`
        if (!m) return 'missing' as const
        if (m.is_owner && !auth.isOwner) return 'owner' as const
        const [before] = await sql<Record<string, string | null>[]>`
          select upi_id, bank_account_name, bank_account_number, bank_ifsc from member_profiles where user_id = ${id}`
        const changed = keys.filter((k) => (before?.[k] ?? null) !== (next[k] ?? null))
        if (changed.length === 0) return { changed, notify: false, name: m.name }
        const row: Record<string, string | null> = {}
        for (const k of keys) row[k] = next[k] ?? null
        await sql`
          insert into member_profiles ${sql({ user_id: id, company_id: auth.companyId, ...row })}
          on conflict (user_id) do update set ${sql(row)}, updated_at = now()`
        const notify = id !== auth.userId && m.login_enabled
        if (notify) {
          await sql`
            insert into notifications (company_id, recipient_uid, type, title, body, entity_type, entity_id, dedupe_key)
            values (${auth.companyId}, ${id}, 'pay_details_changed', 'Your payment details were changed',
                    ${'Someone at the studio updated where your pay is sent. If this was not you or agreed with you, tell the studio now.'},
                    'user', ${id}, ${'pay_details_changed:' + Date.now()})
            on conflict do nothing`
        }
        return { changed, notify, name: m.name }
      }),
    )
    if (!result) fail(400, 'We could not save their payment details.')
    if (result === 'missing') fail(404, 'That team member was not found.')
    if (result === 'owner') fail(403, "Only the owner changes the owner's own payment details.")
    if (result.changed.length > 0) {
      await audit(c, { action: 'member.pay_details_set', entityType: 'user', entityId: id, after: { fields: result.changed } })
    }
    return c.json({ changed: result.changed, notified: result.notify })
  })
