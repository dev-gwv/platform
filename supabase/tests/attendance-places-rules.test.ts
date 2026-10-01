import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'

/**
 * 0206: places and rules. A person is marked only inside the radius their
 * rule sets -- their own rule first, then their position's, then the studio's
 * -- and the refusal says how far away they are. Freelancers are not tracked
 * daily. Shifts nobody closed are closed by the nightly sweep.
 */
const migDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations')

const OWNER = 'a6000000-0000-4000-8000-000000000001'
const PHOTO = 'a6000000-0000-4000-8000-000000000002'
const EDITOR = 'a6000000-0000-4000-8000-000000000003'
const FREE = 'a6000000-0000-4000-8000-000000000004'
const COMPANY = 'a6000000-0000-4000-8000-0000000000aa'
const ROLE_PHOTO = 'a6000000-0000-4000-8000-0000000000c1'
const ROLE_EDIT = 'a6000000-0000-4000-8000-0000000000c2'
// The studio in Mumbai; ~1.1 km east of it; the edit suite ~5 km north.
const STUDIO = [19.076, 72.8777] as const
const NEAR = [19.076, 72.8881] as const
const SUITE = [19.121, 72.8777] as const

let db: PGlite
const q = async <T>(sql: string) => (await db.query<T>(sql)).rows
const as = async <T>(user: string, sql: string) => {
  await db.exec(`set role authenticated; set request.jwt.claim.sub = '${user}';`)
  try {
    return await q<T>(sql)
  } finally {
    await db.exec(`reset role; reset request.jwt.claim.sub;`)
  }
}
const checkIn = (user: string, [lat, lng]: readonly [number, number], auto = false) =>
  as<{ id: string }>(user, `select check_in(${lat}, ${lng}, ${auto}) as id`)
const refusal = (user: string, at: readonly [number, number]) =>
  checkIn(user, at).then(
    () => null,
    (e: Error) => e.message,
  )

beforeAll(async () => {
  db = new PGlite()
  await db.exec(`create schema if not exists auth;`)
  await db.exec(`create table auth.users (id uuid primary key default gen_random_uuid(), email text unique not null, encrypted_password text);`)
  await db.exec(`create or replace function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;`)
  for (const r of ['authenticated', 'anon', 'service_role', 'authenticator']) await db.exec(`create role ${r};`)
  for (const f of readdirSync(migDir).filter((x) => x.endsWith('.sql') && !x.startsWith('0000_')).sort()) {
    await db.exec(readFileSync(join(migDir, f), 'utf8'))
  }
  await db.exec(`
    insert into auth.users (id, email) values ('${OWNER}', 'o@s.test'), ('${PHOTO}', 'p@s.test'), ('${EDITOR}', 'e@s.test'), ('${FREE}', 'f@s.test');
    insert into companies (id, name, owner_user_id) values ('${COMPANY}', 'Asha Studio', '${OWNER}');
    -- 0224: attendance is off until a studio turns it on; these studios have.
    insert into attendance_policy (company_id, enabled, enabled_at) values ('${COMPANY}', true, '2020-01-01')
      on conflict (company_id) do update set enabled = true, enabled_at = '2020-01-01';
    insert into users (user_id, company_id, role, name, email, status, engagement_type) values
      ('${OWNER}', '${COMPANY}', 'super_admin', 'Asha', 'o@s.test', 'active', 'in_house'),
      ('${PHOTO}', '${COMPANY}', 'employee', 'Ravi', 'p@s.test', 'active', 'in_house'),
      ('${EDITOR}', '${COMPANY}', 'employee', 'Meera', 'e@s.test', 'active', 'in_house'),
      ('${FREE}', '${COMPANY}', 'employee', 'Kabir', 'f@s.test', 'active', 'freelancer');
    insert into employee_roles (id, company_id, type_name, role_code) values
      ('${ROLE_PHOTO}', '${COMPANY}', 'Photographer', 'photographer'),
      ('${ROLE_EDIT}', '${COMPANY}', 'Editor', 'editor');
    insert into employee_role_assignments (user_id, role_id, company_id) values
      ('${PHOTO}', '${ROLE_PHOTO}', '${COMPANY}'), ('${EDITOR}', '${ROLE_EDIT}', '${COMPANY}');
    grant usage on schema auth to authenticated;
  `)
})

beforeEach(async () => {
  await db.exec(`delete from attendance; delete from attendance_rules; delete from attendance_places where not is_primary; delete from company_location;`)
  await db.exec(`insert into company_location (company_id, lat, lng, radius_m, timezone) values ('${COMPANY}', ${STUDIO[0]}, ${STUDIO[1]}, 150, 'Asia/Kolkata')`)
})

describe('the studio as a place', () => {
  it('follows company_location, and goes when it goes', async () => {
    const [p] = await q<{ name: string; radius_m: number; is_active: boolean }>(`select name, radius_m, is_active from attendance_places where company_id = '${COMPANY}'`)
    expect(p).toEqual({ name: 'Studio', radius_m: 150, is_active: true })
    await db.exec(`update company_location set radius_m = 300, is_active = false where company_id = '${COMPANY}'`)
    expect(await q(`select radius_m, is_active from attendance_places where is_primary`)).toEqual([{ radius_m: 300, is_active: false }])
    await db.exec(`delete from company_location`)
    expect(await q(`select 1 from attendance_places where is_primary`)).toEqual([])
  })

  it('cannot be edited as a place: it is the studio’s own spot', async () => {
    const n = await as<{ id: string }>(OWNER, `update attendance_places set radius_m = 999 where is_primary returning id`)
    expect(n).toEqual([])
  })
})

describe('checking in', () => {
  it('marks someone inside the studio’s radius, and says so when automatic', async () => {
    await checkIn(PHOTO, STUDIO, true)
    const [a] = await q<{ source: string; check_in_distance_m: number; place: string }>(
      `select a.source, a.check_in_distance_m, p.name as place from attendance a join attendance_places p on p.id = a.check_in_place_id where a.user_id = '${PHOTO}'`,
    )
    expect(a).toEqual({ source: 'auto_login', check_in_distance_m: 0, place: 'Studio' })
  })

  it('does not mark someone outside it, and says how far and from where', async () => {
    expect(await refusal(PHOTO, NEAR)).toMatch(/outside_fence: 1\.1 km from Studio \(allowed 150 m\)/)
    expect(await q(`select 1 from attendance where user_id = '${PHOTO}'`)).toEqual([])
  })

  it('uses the position’s radius', async () => {
    await db.exec(`insert into attendance_rules (company_id, scope, role_id, mode, radius_m) values ('${COMPANY}', 'role', '${ROLE_PHOTO}', 'required', 2000)`)
    expect(await refusal(PHOTO, NEAR)).toBeNull()
    expect(await refusal(EDITOR, NEAR)).toMatch(/1\.1 km from Studio/)
  })

  it('lets a position be marked anywhere, and a person’s own rule wins over it', async () => {
    await db.exec(`insert into attendance_rules (company_id, scope, role_id, mode) values ('${COMPANY}', 'role', '${ROLE_EDIT}', 'anywhere')`)
    expect(await refusal(EDITOR, [28.6, 77.2])).toBeNull()
    await db.exec(`delete from attendance`)
    await db.exec(`insert into attendance_rules (company_id, scope, user_id, mode) values ('${COMPANY}', 'user', '${EDITOR}', 'required')`)
    expect(await refusal(EDITOR, [28.6, 77.2])).toMatch(/outside_fence: .* km from Studio/)
  })

  it('measures from the rule’s own place, or the nearest active one', async () => {
    const [{ id }] = await q<{ id: string }>(
      `insert into attendance_places (company_id, name, lat, lng, radius_m) values ('${COMPANY}', 'Edit suite', ${SUITE[0]}, ${SUITE[1]}, 200) returning id`,
    )
    // No rule: either place will do.
    expect(await refusal(EDITOR, SUITE)).toBeNull()
    await db.exec(`delete from attendance`)
    // Tied to the suite: the studio no longer counts.
    await db.exec(`insert into attendance_rules (company_id, scope, role_id, mode, place_id) values ('${COMPANY}', 'role', '${ROLE_EDIT}', 'required', '${id}')`)
    expect(await refusal(EDITOR, STUDIO)).toMatch(/outside_fence: 5\.0 km from Edit suite \(allowed 200 m\)/)
    expect(await refusal(EDITOR, SUITE)).toBeNull()
  })

  it('does not track freelancers, or anyone the studio switches off', async () => {
    expect(await refusal(FREE, STUDIO)).toMatch(/not_tracked/)
    await db.exec(`insert into attendance_rules (company_id, scope, user_id, mode) values ('${COMPANY}', 'user', '${PHOTO}', 'off')`)
    expect(await refusal(PHOTO, STUDIO)).toMatch(/not_tracked/)
  })

  it('uses the position’s start of day for lateness', async () => {
    await db.exec(`insert into attendance_rules (company_id, scope, role_id, mode, expected_checkin_time, late_grace_minutes)
                   values ('${COMPANY}', 'role', '${ROLE_PHOTO}', 'required', '00:00', 0)`)
    const [r] = await q<{ expected: string; grace: number; rule_from: string }>(`select expected, grace, rule_from from attendance_rule_for('${PHOTO}')`)
    expect(r).toEqual({ expected: '00:00:00', grace: 0, rule_from: 'position' })
  })

  it('keeps an open fence open: no active place means no fence', async () => {
    await db.exec(`update company_location set is_active = false`)
    expect(await refusal(PHOTO, [28.6, 77.2])).toBeNull()
  })
})

describe('rules and places', () => {
  it('are set by the owner only', async () => {
    await expect(as(PHOTO, `insert into attendance_rules (company_id, scope, user_id, mode) values ('${COMPANY}', 'user', '${PHOTO}', 'anywhere')`)).rejects.toThrow()
    await as(OWNER, `insert into attendance_rules (company_id, scope, user_id, mode) values ('${COMPANY}', 'user', '${PHOTO}', 'anywhere')`)
    expect((await as<{ mode: string }>(PHOTO, `select mode from attendance_rule_for('${PHOTO}')`))[0]!.mode).toBe('anywhere')
  })
})

describe('checking out, and the shifts nobody closed', () => {
  it('stores where the check-out happened', async () => {
    await checkIn(PHOTO, STUDIO)
    await as(PHOTO, `select check_out(${NEAR[0]}, ${NEAR[1]})`)
    expect(await q(`select check_out_lat, check_out_lng from attendance where user_id = '${PHOTO}'`)).toEqual([{ check_out_lat: NEAR[0], check_out_lng: NEAR[1] }])
  })

  it('closes a shift left open past 20 hours at the end of its day, and says the system did it', async () => {
    await db.exec(`insert into attendance (company_id, user_id, a_date, check_in_at, status)
                   values ('${COMPANY}', '${PHOTO}', ((now() at time zone 'Asia/Kolkata') - interval '3 days')::date, now() - interval '3 days', 'present'),
                          ('${COMPANY}', '${EDITOR}', (now() at time zone 'Asia/Kolkata')::date, now() - interval '2 hours', 'present')`)
    expect((await q<{ n: number }>(`select auto_checkout_sweep() as n`))[0]!.n).toBe(1)
    const rows = await q<{ user_id: string; out: string | null; closed_by_system: boolean }>(
      `select user_id, case when check_out_at is null then null
                            when to_char(check_out_at at time zone 'Asia/Kolkata', 'YYYY-MM-DD HH24:MI') = to_char(a_date, 'YYYY-MM-DD') || ' 23:59' then 'end of day'
                            else 'other' end as out,
              closed_by_system from attendance order by user_id`,
    )
    expect(rows).toEqual([
      { user_id: PHOTO, out: 'end of day', closed_by_system: true },
      { user_id: EDITOR, out: null, closed_by_system: false },
    ])
  })
})

describe('the absent sweep', () => {
  it('leaves out people the studio does not track', async () => {
    await db.exec(`insert into attendance_rules (company_id, scope, role_id, mode) values ('${COMPANY}', 'role', '${ROLE_EDIT}', 'off')`)
    await db.exec(`update users set created_at = now() - interval '10 days'`)
    await q(`select mark_absent_backstop()`)
    const marked = (await q<{ user_id: string }>(`select user_id from attendance where status = 'absent' order by user_id`)).map((r) => r.user_id)
    expect(marked).toEqual([PHOTO])
  })
})
