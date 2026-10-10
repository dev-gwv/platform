import { Hono } from 'hono'
import {
  addMemberRequest,
  addMemberResponse,
  setMemberSignInRequest,
  setMemberSignInResponse,
  updateMemberRequest,
} from '@ipc/contracts'
import type { AppEnv } from '../../context'
import { rateLimit } from '../../middleware/security'
import { fail } from '../../middleware/errors'
import { uuidParam } from '../../lib/params'
import { withUser, withService } from '../../lib/db'
import { attempt } from '../../lib/attempt'
import { audit } from '../../lib/audit'
import { hashPassword } from '../../lib/auth-token'
import { sendPasswordResetEmail } from '../../lib/email'
import { duplicateCode, PAY_KEYS, teamGate, mayGrant, setsPay, mayTouchPay, guardTarget, asCaller } from './shared'

export const memberRoutes = new Hono<AppEnv>()
  // ── Members ─────────────────────────────────────────────────
  // Owner adds a member. Two shapes come through here: one with a login (an
  // auth identity + password the owner chose) and one without (a directory-only
  // person — bookable and assignable, with no credential to leak). Both need an
  // identity row, because `users.user_id` is the auth id; the offline one simply
  // has no password, which is what `/auth/login` already refuses on.
  .post('/members', teamGate('create'), async (c) => {
    const parsed = addMemberRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Please check the member details.')
    if (!mayGrant(c, parsed.data.role)) fail(403, 'Only the owner can give that access level.')
    if (setsPay(parsed.data) && !mayTouchPay(c)) fail(403, 'Only someone who handles salaries can set pay.')
    const {
      name,
      email,
      role,
      phone,
      alternate_phone,
      password,
      create_login,
      engagement_type,
      salary,
      freelancer_rate,
      address,
      role_ids,
      payout_type,
      commission_pct,
      commission_basis,
      stipend_amount,
      pay_effective_from,
      pay_effective_to,
      compensation_notes,
      payment_type,
      pay_components,
      payment_status,
    } = parsed.data

    const pwHash = create_login && password ? await hashPassword(password) : null
    const companyId = c.get('auth').companyId

    // One transaction: create the auth user and its tenant row together, so a
    // failed row insert rolls back the auth user (no orphan to clean up).
    //
    // An email that already signs in to IPC -- a freelancer another studio
    // added first, or an owner joining a second studio's team -- is not a
    // conflict any more (0159). This studio gets a profile on that login: they
    // sign in with the password they already have and pick the studio, and
    // the password typed here is not used. Only the same person twice in THIS
    // studio is refused.
    const added = await attempt(
      c,
      'team.member_add',
      () =>
        withService(c.env, async (sql) => {
          if (email) {
            // Serialize concurrent adds of one email, so two tabs cannot both
            // pass the "already on your team" check below.
            await sql`select pg_advisory_xact_lock(hashtext(${`member:${companyId}:${email}`}))`
            const [onTeam] = await sql<{ one: number }[]>`
              select 1 as one from users
               where company_id = ${companyId} and lower(email) = ${email} and deleted_at is null
               limit 1`
            if (onTeam) return 'on_team' as const
          }
          const [found] = email
            ? await sql<{ id: string; encrypted_password: string | null; email_verified: boolean; elsewhere: boolean; here: boolean }[]>`
                select au.id, au.encrypted_password, au.email_verified,
                       exists (select 1 from users u join auth.users p on p.id = u.user_id
                                where (p.id = au.id or p.identity_id = au.id) and u.company_id <> ${companyId}) as elsewhere,
                       exists (select 1 from users u join auth.users p on p.id = u.user_id
                                where (p.id = au.id or p.identity_id = au.id) and u.company_id = ${companyId}) as here
                  from auth.users au
                 where lower(au.email) = ${email} and au.identity_id is null`
            : []
          // 0223: an email that belongs to someone else -- another studio's
          // person, or a login with no studio at all -- is never taken over
          // from here. Linking it handed that identity the password typed
          // here, and with it the other studio's own profile (list_login_profiles
          // lists an identity's own row whatever its login switch says). The
          // same person on two teams joins through an invite instead, with
          // their own password. Only someone removed from THIS studio is
          // picked up again.
          const foreign = !!found && (found.elsewhere || !found.here)
          if (foreign && create_login) return 'taken' as const
          const existing = foreign ? undefined : found
          // A row that has never signed in (someone's offline directory entry)
          // is not a login yet: the password chosen here becomes its password.
          const isLogin = !!existing && (!!existing.encrypted_password || existing.email_verified)

          let id: string
          let linked = false
          if (foreign) {
            // A directory-only person whose email is someone else's: their own
            // identity, with no email on it, so it can never be signed in to.
            // The email stays on the studio's record for contact.
            const created = await sql<{ id: string }[]>`
              insert into auth.users (email, encrypted_password, email_verified, email_verified_at)
              values (null, null, false, null)
              returning id`
            id = created[0]!.id
          } else if (!existing) {
            const created = await sql<{ id: string }[]>`
              insert into auth.users (email, encrypted_password, email_verified, email_verified_at)
              values (
                ${email ?? null}, ${pwHash},
                ${create_login}, ${create_login ? new Date().toISOString() : null}
              )
              returning id`
            id = created[0]!.id
          } else {
            if (!isLogin && create_login && pwHash) {
              await sql`
                update auth.users
                   set encrypted_password = ${pwHash}, email_verified = true, email_verified_at = now()
                 where id = ${existing.id}`
            }
            const created = await sql<{ id: string }[]>`
              insert into auth.users (email, encrypted_password, email_verified, email_verified_at, identity_id)
              values (null, null, true, now(), ${existing.id})
              returning id`
            id = created[0]!.id
            linked = isLogin && create_login
          }
          await sql`
            insert into users ${sql({
              user_id: id,
              company_id: companyId,
              role,
              name,
              email: email ?? null,
              phone,
              alternate_phone: alternate_phone ?? null,
              status: 'active',
              employee_type: role === 'employee' ? 1 : 2,
              engagement_type,
              salary: salary ?? null,
              freelancer_rate: freelancer_rate ?? null,
              address: address ?? null,
              payout_type: payout_type ?? null,
              commission_pct: commission_pct ?? null,
              commission_basis: commission_basis ?? null,
              stipend_amount: stipend_amount ?? null,
              pay_effective_from: pay_effective_from ?? null,
              pay_effective_to: pay_effective_to ?? null,
              compensation_notes: compensation_notes ?? null,
              login_enabled: create_login,
              payment_type: payment_type ?? null,
              // Explicit oid (1009 = _text): an empty array has no element to
              // infer a type from and postgres.js falls back to "unspecified",
              // which a plain text[] column has no reason to accept.
              pay_components: sql.array(pay_components, 1009),
              payment_status,
            })}`
          for (const roleId of role_ids) {
            await sql`
              insert into employee_role_assignments (user_id, role_id, company_id)
              select ${id}, ${roleId}, ${companyId}
              where exists (
                select 1 from employee_roles where id = ${roleId} and company_id = ${companyId}
              )`
          }
          return { id, linked }
        }),
      { onCode: duplicateCode },
    )
    if (added === 'on_team') fail(409, 'Someone with that email is already on your team.')
    if (added === 'taken') {
      fail(
        409,
        'This email already signs in to Studio AutoPilot for another studio. Same person? Send them an invite — they join with their own password. Someone else? Use another email — any email works, it is just their username.',
      )
    }
    if (added === 'duplicate') fail(409, 'Someone with that email is already on your team.')
    if (!added) fail(400, 'We could not add this member.')
    const { id: userId, linked } = added

    await audit(c, {
      action: 'member.add',
      entityType: 'user',
      entityId: userId,
      after: { name, email, role, create_login, engagement_type, role_ids, linked_existing_login: linked },
    })
    // The owner picked the password, so there is nothing to hand back.
    return c.json(
      addMemberResponse.parse({ user_id: userId, temp_password: null, linked_existing_login: linked }),
      201,
    )
  })

  .patch('/members/:id', teamGate('edit'), async (c) => {
    const id = uuidParam(c)
    const parsed = updateMemberRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Please check the details.')
    const { pay_components, ...patch } = parsed.data
    if (Object.keys(parsed.data).length === 0) return c.json({ ok: true })
    const current = await guardTarget(c, id)
    if (patch.role !== undefined && patch.role !== current && !mayGrant(c, patch.role)) {
      fail(403, 'Only the owner can give that access level.')
    }
    // Any pay key at all -- clearing a salary is changing it.
    if (PAY_KEYS.some((k) => parsed.data[k] !== undefined) && !mayTouchPay(c)) {
      fail(403, 'Only someone who handles salaries can change pay.')
    }
    const companyId = c.get('auth').companyId

    const rows = await attempt(c, 'team.member_update', () =>
      asCaller(
        c,
        (sql) => sql<{ user_id: string }[]>`
          update users set ${sql({
            ...patch,
            ...(patch.role ? { employee_type: patch.role === 'employee' ? 1 : 2 } : {}),
            // Same empty-array oid caveat as the create path -- special-cased
            // rather than left to the generic spread's type inference.
            ...(pay_components !== undefined ? { pay_components: sql.array(pay_components, 1009) } : {}),
          })}
          where user_id = ${id} and company_id = ${companyId} and deleted_at is null
          returning user_id`,
      ),
    )
    if (!rows) fail(400, 'We could not update this member.')
    if (!rows.length) fail(404, 'We could not find that team member.')
    // Pay is sensitive: record that it changed, not what it changed to.
    const { salary, freelancer_rate, rate_wedding_day, rate_half_day, commission_pct, stipend_amount, compensation_notes, ...rest } = patch
    await audit(c, {
      action: 'member.update',
      entityType: 'user',
      entityId: id,
      after: {
        ...rest,
        ...(salary !== undefined ||
        freelancer_rate !== undefined ||
        rate_wedding_day !== undefined ||
        rate_half_day !== undefined ||
        commission_pct !== undefined ||
        stipend_amount !== undefined ||
        compensation_notes !== undefined ||
        pay_components !== undefined
          ? { compensation_changed: true }
          : {}),
      },
    })
    return c.json({ ok: true })
  })

  // Soft delete: the person stays on past shoots, tasks and payouts. Their
  // access dies at the next `authenticate()`, which reads deleted_at.
  // An optional { reason } body is recorded in the audit trail (Lovable parity).
  .delete('/members/:id', teamGate('delete'), async (c) => {
    const id = uuidParam(c)
    if (id === c.get('auth').userId) fail(409, 'You cannot remove your own account.')
    await guardTarget(c, id, 'You cannot remove your own account.')
    const companyId = c.get('auth').companyId
    const body = await c.req.json().catch(() => ({}))
    const reason =
      body && typeof body === 'object' && typeof (body as { reason?: unknown }).reason === 'string'
        ? ((body as { reason: string }).reason.trim().slice(0, 500) || null)
        : null

    const rows = await attempt(c, 'team.member_remove', () =>
      asCaller(
        c,
        (sql) => sql<{ user_id: string }[]>`
          update users
             set deleted_at = now(), deleted_by = ${c.get('auth').userId}, status = 'inactive'
           where user_id = ${id} and company_id = ${companyId} and deleted_at is null
           returning user_id`,
      ),
    )
    if (!rows) fail(400, 'We could not remove this member.')
    if (!rows.length) fail(404, 'We could not find that team member.')
    // Their sessions in this studio end now, not at the next access-token
    // mint (0034) -- and only in this studio: someone who is also on other
    // studios' teams stays signed in to those (0159).
    await attempt(c, 'team.member_remove_sessions', () =>
      withService(c.env, (sql) => sql`select revoke_profile_sessions(${id})`),
    )
    await audit(c, { action: 'member.remove', entityType: 'user', entityId: id, after: reason ? { reason } : {} })
    return c.json({ ok: true })
  })

  // Owner emails a staff member a reset link — the everyday "I'm locked out"
  // fix, without the owner ever handling their password.
  // Issuing supersedes the member's own outstanding link, and it sends mail, so
  // it needs a ceiling of its own — /team/* is outside the global /auth/* limit.
  .post('/members/:id/reset-password', teamGate('edit'), rateLimit({ windowMs: 60_000, limit: 5 }), async (c) => {
    const targetId = uuidParam(c)
    await guardTarget(c, targetId, 'Change your own password from your account.')

    // Read the target through the CALLER's RLS scope, so an owner can only ever
    // trigger this for someone in their own studio. A thrown query is a real
    // failure, not a miss — collapsing it into 404 would report a studio-wide
    // outage as "member not found".
    const rows = await attempt(c, 'team.reset_lookup', () =>
      withUser(
        c.env,
        c.get('auth').userId,
        (sql) => sql<{ email: string | null }[]>`
          select email from users where user_id = ${targetId} and deleted_at is null`,
      ),
    )
    if (!rows) fail(400, 'We could not look up that team member. Please try again.')
    const member = rows[0]
    if (!member) fail(404, 'We could not find that team member.')
    if (!member.email) fail(409, 'This member has no email address to send a link to.')

    const raw = await attempt(c, 'team.reset_issue', () =>
      withService(c.env, async (sql) => {
        // The password is the login's, which for someone on several studios'
        // teams is not this studio's profile id.
        const [t] = await sql<{ token: string }[]>`
          select issue_password_reset(auth_identity_of(${targetId})) as token`
        return t?.token ?? null
      }),
    )
    if (!raw) fail(400, 'We could not start a password reset for this member.')

    await sendPasswordResetEmail(c.env, member.email, `${c.env.APP_URL}/reset-password?token=${raw}`)
    await audit(c, { action: 'member.reset_password_sent', entityType: 'user', entityId: targetId })
    return c.json({ ok: true })
  })

  // The owner (or an admin) sets a member's sign-in themselves: a password,
  // and the email they sign in with if it changes. This is how a no-login
  // member gets a login later, how a typo'd email is fixed, and how someone
  // with a made-up email -- which cannot receive a reset link -- gets back in.
  // Any email works; it is only a username. The password is never stored or
  // logged in the clear, and every session the person had is signed out.
  //
  // A login that also belongs to another studio is refused: that password
  // opens the other studio too, so only the person can change it.
  .post('/members/:id/sign-in', teamGate('edit'), rateLimit({ windowMs: 60_000, limit: 5 }), async (c) => {
    const auth = c.get('auth')
    if (!auth.isOwner && auth.role !== 'admin' && auth.role !== 'super_admin') {
      fail(403, 'Only the owner or an admin can set someone else\'s sign-in.')
    }
    const targetId = uuidParam(c)
    if (targetId === auth.userId) fail(409, 'Change your own password from My profile.')
    await guardTarget(c, targetId, 'Change your own password from My profile.')
    const parsed = setMemberSignInRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Use a real-looking email and a password of at least 6 characters.')
    const pwHash = await hashPassword(parsed.data.password)
    const companyId = auth.companyId

    const done = await attempt(
      c,
      'team.sign_in_set',
      () =>
        withService(c.env, async (sql) => {
          const [m] = await sql<
            { name: string; email: string | null; identity: string; login_email: string | null; shared: boolean; is_owner: boolean }[]
          >`
            select u.name, u.email, ia.id as identity, ia.email as login_email,
                   exists (select 1 from users o join auth.users p on p.id = o.user_id
                            where (p.id = ia.id or p.identity_id = ia.id)
                              and o.company_id <> u.company_id and o.deleted_at is null) as shared,
                   (co.owner_user_id = u.user_id) as is_owner
              from users u
              join companies co on co.id = u.company_id
              join auth.users ia on ia.id = auth_identity_of(u.user_id)
             where u.user_id = ${targetId} and u.company_id = ${companyId} and u.deleted_at is null`
          if (!m) return 'missing' as const
          if (m.is_owner) return 'owner' as const
          if (m.shared) return { shared: m.name }
          const email = parsed.data.email ?? m.login_email?.toLowerCase() ?? m.email?.toLowerCase() ?? null
          if (!email) return 'no_email' as const
          await sql`select pg_advisory_xact_lock(hashtext(${`member:${companyId}:${email}`}))`
          const [taken] = await sql<{ one: number }[]>`
            select 1 as one from auth.users where lower(email) = ${email} and id <> ${m.identity} limit 1`
          if (taken) return 'taken' as const
          const [onTeam] = await sql<{ one: number }[]>`
            select 1 as one from users
             where company_id = ${companyId} and lower(email) = ${email}
               and user_id <> ${targetId} and deleted_at is null
             limit 1`
          if (onTeam) return 'on_team' as const
          await sql`
            update auth.users
               set email = ${email}, encrypted_password = ${pwHash}, password_changed_at = now(),
                   email_verified = true, email_verified_at = coalesce(email_verified_at, now())
             where id = ${m.identity}`
          await sql`update users set email = ${email}, login_enabled = true where user_id = ${targetId}`
          // Bumps password_version and revokes every refresh family: whoever
          // was signed in as them is signed out.
          await sql`select revoke_all_sessions(${m.identity})`
          return { email, name: m.name, changedEmail: (m.login_email ?? m.email ?? '').toLowerCase() !== email }
        }),
      { onCode: duplicateCode },
    )
    if (done === 'missing') fail(404, 'We could not find that team member.')
    if (done === 'owner') fail(403, 'Only the owner can change the owner\'s sign-in.')
    if (done === 'no_email') fail(422, 'Give them an email to sign in with. Any email works — it is just their username.')
    if (done === 'taken' || done === 'duplicate') {
      fail(409, 'That email already signs in to Studio AutoPilot for someone else. Use another email — any email works.')
    }
    if (done === 'on_team') fail(409, 'Someone else on your team already uses that email.')
    if (!done) fail(400, 'We could not set the sign-in. Please try again.')
    if ('shared' in done) {
      fail(409, `${done.shared} also signs in to another studio, so only ${done.shared} can change this password — from My profile, or with Forgot password.`)
    }
    // Never the password, not even its length.
    await audit(c, {
      action: 'member.sign_in_set',
      entityType: 'user',
      entityId: targetId,
      after: { email: done.email, email_changed: done.changedEmail },
    })
    return c.json(setMemberSignInResponse.parse({ email: done.email }))
  })
