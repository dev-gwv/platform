import type { TransactionSql } from 'postgres'
import { Hono, type Context } from 'hono'
import {
  teamProfileGap,
  addMemberRequest,
  addMemberResponse,
  assignRolesRequest,
  createInvitationRequest,
  updateInvitationRequest,
  directoryMember,
  employeeRole,
  generateMonthlySalariesRequest,
  invitation,
  invitationLink,
  libraryRole,
  monthlySalaryList,
  teamMember,
  updateMemberRequest,
  updateMonthlySalaryRequest,
  upsertEmployeeRoleRequest,
} from '@ipc/contracts'
import type { AppEnv } from '../../context'
import { requireAuth } from '../../middleware/auth'
import { requireModule, requireOwner } from '../../middleware/permissions'
import { rateLimit } from '../../middleware/security'
import { fail } from '../../middleware/errors'
import { uuidParam } from '../../lib/params'
import { withUser, withService } from '../../lib/db'
import { attempt } from '../../lib/attempt'
import { audit } from '../../lib/audit'
import { hashPassword, newRawToken, sha256Hex } from '../../lib/auth-token'
import { sendInvitationEmail, sendPasswordResetEmail } from '../../lib/email'

const INVITE_DAYS = 7

const inviteLink = (env: AppEnv['Bindings'], raw: string) =>
  `${env.APP_URL}/accept-invite?token=${raw}`

const duplicateCode = (code: string) => (code === '23505' ? ('duplicate' as const) : undefined)

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

/** Team directory. /members backs pickers; /directory is the full staff list. */
export const teamRouter = new Hono<AppEnv>()
  .use('*', requireAuth)

  // Owner: who still has an incomplete profile, and what is missing (field
  // names only -- never the values, which stay private to the member).
  .get('/profile-gaps', requireOwner(), async (c) => {
    const rows = await attempt(c, 'team.profile_gaps', () =>
      withUser(c.env, c.get('auth').userId, (sql) => sql<{ user_id: string; missing: string[]; required: number }[]>`
        select user_id, missing, required from team_profile_gaps()`),
    )
    if (!rows) fail(400, 'We could not load profile gaps.')
    return c.json(
      teamProfileGap.array().parse(
        rows.map((r) => {
          const need = Math.max(1, Number(r.required))
          return { user_id: r.user_id, missing: r.missing, percent: Math.round((100 * (need - r.missing.length)) / need) }
        }),
      ),
    )
  })

  // Every caller of this endpoint uses it as a "who can this go to" picker
  // (a deal owner, a distribution rota, a workflow step, a booking slot) --
  // never a place to see who used to work here, so a deactivated member
  // (status = 'inactive', deleted_at still null) is excluded the same as a
  // removed one.
  // The crew picker's list. Job roles let it put the right people first for a
  // requirement; the pay basis lets a booking pre-fill its payout -- but only
  // for someone who plans crew, since this route is open to every member.
  .get('/members', async (c) => {
    const canPlan = c.get('auth').access.hasAction('projects', 'edit')
    const rows = await attempt(c, 'team.members', () =>
      withUser(
        c.env,
        c.get('auth').userId,
        (sql) => sql`
          select u.user_id, u.name, u.role, u.engagement_type, u.phone, u.email,
                 ${canPlan ? sql`u.payout_type` : sql`null::text`} as payout_type,
                 ${canPlan ? sql`u.freelancer_rate` : sql`null::numeric`} as freelancer_rate,
                 coalesce(
                   array_agg(er.type_name order by er.type_name) filter (where er.id is not null),
                   '{}'::text[]
                 ) as role_names
            from users u
            left join employee_role_assignments era on era.user_id = u.user_id
            left join employee_roles er on er.id = era.role_id
           where u.deleted_at is null and u.status = 'active'
           group by u.user_id
           order by u.name`,
      ),
    )
    if (!rows) fail(400, 'We could not load the team.')
    return c.json(teamMember.array().parse(rows))
  })

  // The directory carries compensation, so the row is assembled once and then
  // trimmed per caller: only team_salaries sees `salary`. Filtering client-side
  // would ship every studio's payroll to every manager's browser.
  //
  // Lovable parity: page/page_size/search/status are honoured on the server.
  // Without page/page_size the historical array shape is returned untouched;
  // with them a { items, total, page, page_size } page is returned instead.
  .get('/directory', requireModule('team_directory'), async (c) => {
    const pageRaw = c.req.query('page')
    const sizeRaw = c.req.query('page_size')
    const search = c.req.query('search')?.trim().toLowerCase() ?? ''
    const status = c.req.query('status')?.trim() ?? ''
    const paged = pageRaw !== undefined || sizeRaw !== undefined
    const page = Math.max(1, Number(pageRaw ?? 1) || 1)
    const pageSize = Math.min(200, Math.max(1, Number(sizeRaw ?? 25) || 25))
    const offset = (page - 1) * pageSize

    // Engagement, role and the salary range used to narrow the page the
    // browser already had, while `total` below went on counting everyone --
    // so filtering to freelancers could show an empty page 1 of 4 with the
    // freelancers on page 3. They narrow the query now, and the count agrees.
    const engagement = c.req.query('engagement_type')?.trim() ?? ''
    if (engagement && !['in_house', 'freelancer'].includes(engagement)) {
      fail(422, 'That engagement type is not one we use.')
    }
    // One control, two kinds of role: `app:<role>` is the access ladder,
    // `job:<uuid>` is one of the studio's own job roles.
    const roleParam = c.req.query('role')?.trim() ?? ''
    const [roleKind, roleValue] = roleParam ? roleParam.split(':') : [null, null]
    if (roleParam && roleKind !== 'app' && roleKind !== 'job') fail(422, 'That role filter is not valid.')
    if (roleKind === 'job' && !/^[0-9a-f-]{36}$/i.test(roleValue ?? '')) fail(422, 'That job role is not valid.')

    // A salary bound is only honoured for someone allowed to see salaries.
    // Applied for anyone else it would leak the figures it is hiding: page
    // through "min 80000" and you have the list without ever seeing a number.
    const canSeeSalary = c.get('auth').access.hasModule('team_salaries')
    const bound = (key: string): number | null => {
      const raw = c.req.query(key)?.trim()
      if (!raw || !canSeeSalary) return null
      const n = Number(raw)
      if (!Number.isFinite(n)) fail(422, 'That salary filter is not a number.')
      return n
    }
    const minSalary = bound('min_salary')
    const maxSalary = bound('max_salary')

    const narrow = (sql: TransactionSql) => sql`
      and ${engagement ? sql`u.engagement_type = ${engagement}` : sql`true`}
      and ${roleKind === 'app' ? sql`u.role = ${roleValue}` : sql`true`}
      and ${
        roleKind === 'job'
          ? sql`exists (select 1 from employee_role_assignments x where x.user_id = u.user_id and x.role_id = ${roleValue}::uuid)`
          : sql`true`
      }
      -- A bound only ever narrows. Someone with no salary recorded drops out
      -- of both directions rather than being counted as zero, which would put
      -- them inside every "under X" -- a claim about a figure nobody entered.
      and ${minSalary === null ? sql`true` : sql`(u.salary is not null and u.salary >= ${minSalary})`}
      and ${maxSalary === null ? sql`true` : sql`(u.salary is not null and u.salary <= ${maxSalary})`}`

    const rows = await attempt(c, 'team.directory', () =>
      withUser(
        c.env,
        c.get('auth').userId,
        (sql) => sql`
          select
            u.user_id, u.name, u.email, u.role, u.phone, u.alternate_phone, u.status,
            u.engagement_type, u.login_enabled, u.salary, u.address, u.created_at,
            u.freelancer_rate,
            u.payout_type, u.commission_pct, u.commission_basis, u.stipend_amount,
            u.pay_effective_from, u.pay_effective_to, u.compensation_notes,
            u.payment_type, u.pay_components, u.payment_status,
            coalesce(
              array_agg(er.type_name order by er.type_name) filter (where er.id is not null),
              '{}'::text[]
            ) as role_names,
            coalesce(
              array_agg(er.id order by er.type_name) filter (where er.id is not null),
              '{}'::uuid[]
            ) as role_ids
          from users u
          left join employee_role_assignments era on era.user_id = u.user_id
          left join employee_roles er on er.id = era.role_id
          where u.deleted_at is null
            and ${status ? sql`u.status = ${status}` : sql`true`}
            and ${search ? sql`(lower(u.name) like ${`%${search}%`} or lower(coalesce(u.email, '')) like ${`%${search}%`} or coalesce(u.phone, '') like ${`%${search}%`} or coalesce(u.alternate_phone, '') like ${`%${search}%`})` : sql`true`}
            ${narrow(sql)}
          group by u.user_id
          order by u.name
          ${paged ? sql`limit ${pageSize} offset ${offset}` : sql``}`,
      ),
    )
    if (!rows) fail(400, 'We could not load the team.')

    const list = directoryMember.array().parse(rows)
    const shaped = canSeeSalary
      ? list
      : list.map((m) => ({
          ...m,
          salary: null,
          commission_pct: null,
          stipend_amount: null,
          compensation_notes: null,
        }))
    if (!paged) return c.json(shaped)

    const counted = await attempt(c, 'team.directory_count', () =>
      withUser(
        c.env,
        c.get('auth').userId,
        (sql) => sql<{ n: string }[]>`
          select count(*)::text as n from users u
          where u.deleted_at is null
            and ${status ? sql`u.status = ${status}` : sql`true`}
            and ${search ? sql`(lower(u.name) like ${`%${search}%`} or lower(coalesce(u.email, '')) like ${`%${search}%`} or coalesce(u.phone, '') like ${`%${search}%`} or coalesce(u.alternate_phone, '') like ${`%${search}%`})` : sql`true`}
            ${narrow(sql)}`,
      ),
    )
    const total = Number(counted?.[0]?.n ?? shaped.length)
    return c.json({ items: shaped, total, page, page_size: pageSize })
  })

  // The catalogue behind the "add from the library" chips. Declared above
  // '/roles' shapes for clarity; it is platform data, so there is nothing
  // tenant-specific to gate beyond being signed in and holding the module.
  .get('/role-library', requireModule('team_roles'), async (c) => {
    const rows = await attempt(c, 'team.role_library', () =>
      withUser(
        c.env,
        c.get('auth').userId,
        (sql) => sql`
          select id, type_name, role_code, stage from role_library
          order by stage, sort_order, type_name`,
      ),
    )
    if (!rows) fail(400, 'We could not load the role library.')
    return c.json(libraryRole.array().parse(rows))
  })

  // ── Job roles (Photographer, Editor…) ───────────────────────
  .get('/roles', requireModule('team_roles'), async (c) => {
    const rows = await attempt(c, 'team.roles', () =>
      withUser(
        c.env,
        c.get('auth').userId,
        (sql) => sql`
          select r.id, r.type_name, r.role_code, r.stage, count(a.user_id)::int as member_count
          from employee_roles r
          left join employee_role_assignments a on a.role_id = r.id
          group by r.id
          order by r.type_name`,
      ),
    )
    if (!rows) fail(400, 'We could not load the roles.')
    return c.json(employeeRole.array().parse(rows))
  })

  .post('/roles', requireOwner(), async (c) => {
    const parsed = upsertEmployeeRoleRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Please check the role name and code.')
    const { type_name, role_code, stage } = parsed.data
    const companyId = c.get('auth').companyId

    const rows = await attempt(
      c,
      'team.role_create',
      () =>
        withUser(
          c.env,
          c.get('auth').userId,
          (sql) => sql<{ id: string }[]>`
            insert into employee_roles (company_id, type_name, role_code, stage)
            values (${companyId}, ${type_name}, ${role_code}, ${stage ?? null})
            returning id`,
        ),
      { onCode: duplicateCode },
    )
    if (rows === 'duplicate') fail(409, 'A role with that code already exists.')
    if (!rows || !rows[0]) fail(400, 'We could not create this role.')
    await audit(c, { action: 'role.create', entityType: 'employee_role', entityId: rows[0].id, after: parsed.data })
    return c.json(
      employeeRole.parse({ ...parsed.data, stage: stage ?? null, id: rows[0].id, member_count: 0 }),
      201,
    )
  })

  .patch('/roles/:id', requireOwner(), async (c) => {
    const id = uuidParam(c)
    const parsed = upsertEmployeeRoleRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Please check the role name and code.')
    const { type_name, role_code, stage } = parsed.data

    const rows = await attempt(
      c,
      'team.role_update',
      () =>
        withUser(
          c.env,
          c.get('auth').userId,
          // role_code is immutable after creation — other records store it, so only
          // type_name/stage are mutable. The code is still validated but ignored.
          (sql) => sql<{ id: string }[]>`
            update employee_roles
               set type_name = ${type_name}, stage = ${stage ?? null}
              where id = ${id} returning id`,
        ),
      { onCode: duplicateCode },
    )
    if (rows === 'duplicate') fail(409, 'A role with that code already exists.')
    if (!rows) fail(400, 'We could not update this role.')
    if (!rows.length) fail(404, 'We could not find that role.')
    await audit(c, { action: 'role.update', entityType: 'employee_role', entityId: id, after: { type_name, role_code, stage } })
    return c.json({ ok: true })
  })

  .delete('/roles/:id', requireOwner(), async (c) => {
    const id = uuidParam(c)
    // Parity with Lovable: assigned roles cannot be deleted outright.
    const assigned = await attempt(c, 'team.role_assigned_check', () =>
      withUser(
        c.env,
        c.get('auth').userId,
        (sql) => sql<{ n: string }[]>`select count(*)::text as n from employee_role_assignments where role_id = ${id}`,
      ),
    )
    if (assigned?.[0] && Number(assigned[0].n) > 0)
      fail(409, 'This role is still assigned to team members. Remove it from everyone first.')
    const rows = await attempt(c, 'team.role_delete', () =>
      withUser(
        c.env,
        c.get('auth').userId,
        (sql) => sql<{ id: string }[]>`delete from employee_roles where id = ${id} returning id`,
      ),
    )
    if (!rows) fail(400, 'We could not delete this role.')
    if (!rows.length) fail(404, 'We could not find that role.')
    await audit(c, { action: 'role.delete', entityType: 'employee_role', entityId: id })
    return c.json({ ok: true })
  })

  // Replace a member's job roles wholesale — the dialog sends the full set, so
  // a partial write would silently drop the ones it didn't mention.
  .patch('/members/:id/roles', requireOwner(), async (c) => {
    const id = uuidParam(c)
    const parsed = assignRolesRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Please check the selected roles.')
    const companyId = c.get('auth').companyId

    const done = await attempt(c, 'team.assign_roles', () =>
      withUser(c.env, c.get('auth').userId, async (sql) => {
        const [member] = await sql<{ user_id: string }[]>`
          select user_id from users where user_id = ${id} and deleted_at is null`
        if (!member) return 'missing' as const
        await sql`delete from employee_role_assignments where user_id = ${id}`
        for (const roleId of parsed.data.role_ids) {
          await sql`
            insert into employee_role_assignments (user_id, role_id, company_id)
            values (${id}, ${roleId}, ${companyId})
            on conflict do nothing`
        }
        return 'ok' as const
      }),
    )
    if (done === 'missing') fail(404, 'We could not find that team member.')
    if (!done) fail(400, 'We could not update their roles.')
    await audit(c, { action: 'member.roles_set', entityType: 'user', entityId: id, after: parsed.data })
    return c.json({ ok: true })
  })

  // ── Members ─────────────────────────────────────────────────
  // Owner adds a member. Two shapes come through here: one with a login (an
  // auth identity + password the owner chose) and one without (a directory-only
  // person — bookable and assignable, with no credential to leak). Both need an
  // identity row, because `users.user_id` is the auth id; the offline one simply
  // has no password, which is what `/auth/login` already refuses on.
  .post('/members', requireOwner(), async (c) => {
    const parsed = addMemberRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Please check the member details.')
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
          const [existing] = email
            ? await sql<{ id: string; encrypted_password: string | null; email_verified: boolean }[]>`
                select id, encrypted_password, email_verified from auth.users
                 where lower(email) = ${email} and identity_id is null`
            : []
          // A row that has never signed in (someone's offline directory entry)
          // is not a login yet: the password chosen here becomes its password.
          const isLogin = !!existing && (!!existing.encrypted_password || existing.email_verified)

          let id: string
          let linked = false
          if (!existing) {
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

  .patch('/members/:id', requireOwner(), async (c) => {
    const id = uuidParam(c)
    const parsed = updateMemberRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Please check the details.')
    const { pay_components, ...patch } = parsed.data
    if (Object.keys(parsed.data).length === 0) return c.json({ ok: true })

    const rows = await attempt(c, 'team.member_update', () =>
      withUser(
        c.env,
        c.get('auth').userId,
        (sql) => sql<{ user_id: string }[]>`
          update users set ${sql({
            ...patch,
            ...(patch.role ? { employee_type: patch.role === 'employee' ? 1 : 2 } : {}),
            // Same empty-array oid caveat as the create path -- special-cased
            // rather than left to the generic spread's type inference.
            ...(pay_components !== undefined ? { pay_components: sql.array(pay_components, 1009) } : {}),
          })}
          where user_id = ${id} and deleted_at is null
          returning user_id`,
      ),
    )
    if (!rows) fail(400, 'We could not update this member.')
    if (!rows.length) fail(404, 'We could not find that team member.')
    // Pay is sensitive: record that it changed, not what it changed to.
    const { salary, freelancer_rate, commission_pct, stipend_amount, compensation_notes, ...rest } = patch
    await audit(c, {
      action: 'member.update',
      entityType: 'user',
      entityId: id,
      after: {
        ...rest,
        ...(salary !== undefined ||
        freelancer_rate !== undefined ||
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
  .delete('/members/:id', requireOwner(), async (c) => {
    const id = uuidParam(c)
    if (id === c.get('auth').userId) fail(409, 'You cannot remove your own account.')
    const body = await c.req.json().catch(() => ({}))
    const reason =
      body && typeof body === 'object' && typeof (body as { reason?: unknown }).reason === 'string'
        ? ((body as { reason: string }).reason.trim().slice(0, 500) || null)
        : null

    const rows = await attempt(c, 'team.member_remove', () =>
      withUser(
        c.env,
        c.get('auth').userId,
        (sql) => sql<{ user_id: string }[]>`
          update users
             set deleted_at = now(), deleted_by = ${c.get('auth').userId}, status = 'inactive'
           where user_id = ${id} and deleted_at is null
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
  .post('/members/:id/reset-password', requireOwner(), rateLimit({ windowMs: 60_000, limit: 5 }), async (c) => {
    const targetId = uuidParam(c)

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

  // ── Invitations ─────────────────────────────────────────────
  // The other way in: instead of the owner choosing a password and passing it
  // along, the invitee sets their own by following a 7-day link. Only the hash
  // is stored, so a database read never yields a usable invitation.
  .get('/invitations', requireOwner(), async (c) => {
    const rows = await attempt(c, 'team.invitations', () =>
      withUser(
        c.env,
        c.get('auth').userId,
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
          order by created_at desc
          limit 200`,
      ),
    )
    if (!rows) fail(400, 'We could not load the invitations.')
    return c.json(invitation.array().parse(rows))
  })

  .post('/invitations', requireOwner(), rateLimit({ windowMs: 60_000, limit: 10 }), async (c) => {
    const parsed = createInvitationRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Please check the invitation details.')
    const v = parsed.data
    const companyId = c.get('auth').companyId
    const raw = newRawToken()
    const hash = await sha256Hex(raw)

    const result = await attempt(
      c,
      'team.invite',
      () =>
        withUser(c.env, c.get('auth').userId, async (sql) => {
          const [taken] = await sql<{ user_id: string }[]>`
            select user_id from users where lower(email) = ${v.email} and deleted_at is null`
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
  .post('/invitations/:id/resend', requireOwner(), rateLimit({ windowMs: 60_000, limit: 10 }), async (c) => {
    const id = uuidParam(c)
    const raw = newRawToken()
    const hash = await sha256Hex(raw)

    const rows = await attempt(c, 'team.invite_resend', () =>
      withUser(
        c.env,
        c.get('auth').userId,
        (sql) => sql<{ email: string; expires_at: string }[]>`
          update user_invitations
             set token_hash = ${hash},
                 expires_at = ${new Date(Date.now() + INVITE_DAYS * 86_400_000).toISOString()},
                 send_count = send_count + 1,
                 last_sent_at = now()
           where id = ${id} and accepted_at is null and revoked_at is null
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

  .patch('/invitations/:id', requireOwner(), async (c) => {
    const parsed = updateInvitationRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Please check the invitation details.')
    const { name, role } = parsed.data
    if (name === undefined && role === undefined) fail(422, 'Nothing to change.')
    const id = uuidParam(c)
    const rows = await attempt(c, 'team.invite_update', () =>
      withUser(
        c.env,
        c.get('auth').userId,
        (sql) => sql<{ id: string }[]>`
          update user_invitations set ${sql({
            ...(name !== undefined ? { pending_name: name } : {}),
            ...(role !== undefined ? { role } : {}),
          })}
          where id = ${id} and accepted_at is null and revoked_at is null
          returning id`,
      ),
    )
    if (!rows) fail(400, 'We could not update this invitation.')
    if (!rows.length) fail(404, 'We could not find that invitation.')
    await audit(c, { action: 'invitation.update', entityType: 'user_invitation', entityId: id, after: parsed.data })
    return c.json({ ok: true })
  })

  .delete('/invitations/:id', requireOwner(), async (c) => {
    const id = uuidParam(c)
    const rows = await attempt(c, 'team.invite_revoke', () =>
      withUser(
        c.env,
        c.get('auth').userId,
        (sql) => sql<{ id: string }[]>`
          update user_invitations set revoked_at = now()
          where id = ${id} and accepted_at is null and revoked_at is null
          returning id`,
      ),
    )
    if (!rows) fail(400, 'We could not revoke this invitation.')
    if (!rows.length) fail(404, 'We could not find that invitation.')
    await audit(c, { action: 'invitation.revoke', entityType: 'user_invitation', entityId: id })
    return c.json({ ok: true })
  })

  // ── Monthly salaries ledger ──────────────────────────────
  // One row per person per calendar month. Managers may view; only the
  // owner or an admin may generate or update (checked here, not just RLS).
  .get('/monthly-salaries', requireModule('team_salaries'), async (c) => {
    const month = c.req.query('month')
    const year = c.req.query('year')
    const status = c.req.query('status')
    const search = c.req.query('search')?.trim().toLowerCase() ?? ''
    const userId = c.req.query('user_id')
    const monthNum = month ? Number(month) : null
    const yearNum = year ? Number(year) : null
    if (month && !(monthNum && monthNum >= 1 && monthNum <= 12)) fail(422, 'Invalid month.')
    if (year && !(yearNum && yearNum >= 2000 && yearNum <= 2100)) fail(422, 'Invalid year.')

    const rows = await attempt(c, 'team.salaries_list', () =>
      withUser(c.env, c.get('auth').userId, (sql) => sql`
        select ms.id, ms.user_id, u.name, u.email, u.phone, u.engagement_type,
               coalesce(ms.pay_month, extract(month from ms.month)::int) as month,
               coalesce(ms.pay_year, extract(year from ms.month)::int) as year,
               coalesce(ms.base_amount, ms.gross, 0) as base_amount,
               coalesce(ms.paid_amount, 0) as paid_amount,
               case ms.status
                 when 'paid' then 'paid'::text
                 when 'partially_paid' then 'partially_paid'::text
                 when 'partial' then 'partial'::text
                 when 'finalised' then 'paid'::text
                 else 'unpaid'::text
               end as status,
               ms.generated_at as created_at
        from monthly_salaries ms
        join users u on u.user_id = ms.user_id
        where ${monthNum ? sql`coalesce(ms.pay_month, extract(month from ms.month)::int) = ${monthNum}` : sql`true`}
          and ${yearNum ? sql`coalesce(ms.pay_year, extract(year from ms.month)::int) = ${yearNum}` : sql`true`}
          and ${userId ? sql`ms.user_id = ${userId}` : sql`true`}
        order by u.name`),
    )
    if (!rows) fail(400, 'We could not load salaries.')
    let items = (rows as Record<string, unknown>[]).map((r) => ({
      ...r,
      month: Number((r as { month: unknown }).month),
      year: Number((r as { year: unknown }).year),
      base_amount: Number((r as { base_amount: unknown }).base_amount ?? 0),
      paid_amount: Number((r as { paid_amount: unknown }).paid_amount ?? 0),
    }))
    if (status && status !== 'all') {
      items = items.filter((r) => {
        const s = String((r as unknown as { status: unknown }).status)
        if (status === 'partial') return s === 'partial' || s === 'partially_paid'
        return s === status
      })
    }
    if (search) {
      items = items.filter((r) => {
        const hay = [ (r as { name?: unknown }).name, (r as { email?: unknown }).email, (r as { phone?: unknown }).phone ]
          .filter(Boolean).map((v) => String(v).toLowerCase()).join(' ')
        return hay.includes(search)
      })
    }
    const base = items.reduce((n, r) => n + Number((r as { base_amount: number }).base_amount ?? 0), 0)
    const paid = items.reduce((n, r) => n + Number((r as { paid_amount: number }).paid_amount ?? 0), 0)
    const countStatus = (s: string) => items.filter((r) => String((r as unknown as { status: unknown }).status) === s).length
    const partial = countStatus('partial') + countStatus('partially_paid')
    return c.json(
      monthlySalaryList.parse({
        items,
        totals: {
          base, paid, pending: Math.max(0, base - paid), count: items.length,
          paid_count: countStatus('paid'), partial_count: partial,
          unpaid_count: countStatus('unpaid'),
        },
      }),
    )
  })

  .post('/monthly-salaries/generate', requireModule('team_salaries'), async (c) => {
    const auth = c.get('auth')
    if (!auth.isOwner && auth.role !== 'admin') fail(403, 'You do not have access to this action.')
    const parsed = generateMonthlySalariesRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'A month and year are required.')
    const { month, year } = parsed.data

    const result = await attempt(c, 'team.salaries_generate', () =>
      withUser(c.env, auth.userId, async (sql) => {
        const members = await sql<{ user_id: string; salary: string | null }[]>`
          select user_id, salary::text as salary from users
          where deleted_at is null and status = 'active' and role <> 'super_admin'`
        let created = 0
        let skipped = 0
        for (const m of members) {
          const base = m.salary === null ? 0 : Number(m.salary)
          const first = `${year}-${String(month).padStart(2, '0')}-01`
          const existing = await sql<{ id: string }[]>`
            select id from monthly_salaries
            where user_id = ${m.user_id}
              and ((pay_year = ${year} and pay_month = ${month})
                or (pay_year is null and pay_month is null and month = ${first}::date))`
          if (existing.length) {
            skipped += 1
            continue
          }
          await sql`
            insert into monthly_salaries ${sql({
              company_id: auth.companyId,
              user_id: m.user_id,
              month: first,
              pay_month: month,
              pay_year: year,
              gross: base,
              deductions: 0,
              net: base,
              base_amount: base,
              paid_amount: 0,
              status: 'unpaid',
            })}`
          created += 1
        }
        return { created, skipped }
      }),
    )
    if (!result) fail(400, 'We could not generate salaries.')
    await audit(c, { action: 'salary.generate', entityType: 'monthly_salary', entityId: `${year}-${month}`, after: { ...parsed.data, ...result } })
    return c.json({ created_count: result.created, skipped_existing_count: result.skipped, errors: [] as string[] }, 201)
  })

  .patch('/monthly-salaries/:id', requireModule('team_salaries'), async (c) => {
    const auth = c.get('auth')
    if (!auth.isOwner && auth.role !== 'admin') fail(403, 'You do not have access to this action.')
    const id = uuidParam(c)
    const parsed = updateMonthlySalaryRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Please check the paid amount.')
    if (parsed.data.paid_amount === undefined && parsed.data.status === undefined)
      fail(422, 'Nothing to change.')

    const row = await attempt(c, 'team.salaries_update', () =>
      withUser(c.env, auth.userId, async (sql) => {
        const found = await sql<{ id: string; base_amount: string | null; gross: string | null; paid_amount: string | null }[]>`
          select id, base_amount::text, gross::text, paid_amount::text from monthly_salaries where id = ${id}`
        if (!found.length) return 'missing' as const
        const base = Number(found[0]!.base_amount ?? found[0]!.gross ?? 0)
        const nextPaid = parsed.data.paid_amount ?? Number(found[0]!.paid_amount ?? 0)
        if (nextPaid < 0) throw Object.assign(new Error('overpay'), { code: 'NEG' })
        // Overpay guard: refuse unless the caller already set status paid —
        // the UI confirms first, then resends with status paid to confirm.
        if (nextPaid > base + 0.001 && parsed.data.status !== 'paid') return 'overpay' as const
        const nextStatus =
          parsed.data.status ??
          (nextPaid <= 0.001 ? 'unpaid' : nextPaid + 0.001 >= base ? 'paid' : 'partial')
        await sql`
          update monthly_salaries set ${sql({ paid_amount: nextPaid, status: nextStatus })} where id = ${id}`
        return 'ok' as const
      }),
    )
    if (row === 'missing') fail(404, 'We could not find that salary row.')
    if (row === 'overpay')
      fail(409, 'Paid amount exceeds the base salary. Confirm the overpayment to save it.')
    if (!row) fail(400, 'We could not update this salary.')
    await audit(c, { action: 'salary.update', entityType: 'monthly_salary', entityId: id, after: parsed.data })
    return c.json({ ok: true })
  })
