import { Hono } from 'hono'
import { assignRolesRequest, employeeRole, libraryRole, upsertEmployeeRoleRequest } from '@ipc/contracts'
import type { AppEnv } from '../../context'
import { requireModule, requireOwner, requireOwnerOr } from '../../middleware/permissions'
import { fail } from '../../middleware/errors'
import { uuidParam } from '../../lib/params'
import { withUser } from '../../lib/db'
import { attempt } from '../../lib/attempt'
import { audit } from '../../lib/audit'
import { duplicateCode, teamGate, guardTarget, asCaller } from './shared'

export const jobRoleRoutes = new Hono<AppEnv>()
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

  .post('/roles', requireOwnerOr('team_directory', 'create'), async (c) => {
    const parsed = upsertEmployeeRoleRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Please check the role name and code.')
    const { type_name, role_code, stage } = parsed.data
    const companyId = c.get('auth').companyId

    const rows = await attempt(
      c,
      'team.role_create',
      // Anyone adding people may add a job role on the way (no closed field);
      // a delegate writes through the service role, pinned to their studio.
      () =>
        asCaller(
          c,
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
  .patch('/members/:id/roles', teamGate('edit'), async (c) => {
    const id = uuidParam(c)
    const parsed = assignRolesRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Please check the selected roles.')
    const companyId = c.get('auth').companyId
    await guardTarget(c, id)

    const done = await attempt(c, 'team.assign_roles', () =>
      asCaller(c, async (sql) => {
        const [member] = await sql<{ user_id: string }[]>`
          select user_id from users where user_id = ${id} and company_id = ${companyId} and deleted_at is null`
        if (!member) return 'missing' as const
        await sql`delete from employee_role_assignments where user_id = ${id} and company_id = ${companyId}`
        for (const roleId of parsed.data.role_ids) {
          // Only this studio's own job roles.
          await sql`
            insert into employee_role_assignments (user_id, role_id, company_id)
            select ${id}, ${roleId}, ${companyId}
             where exists (select 1 from employee_roles where id = ${roleId} and company_id = ${companyId})
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
