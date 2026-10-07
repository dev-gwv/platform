import { execFileSync } from 'node:child_process'
import { api, phone } from './lib.mjs'
const must = (r, what) => { if (r.status >= 300) throw new Error(what + ' ' + r.status + ' ' + JSON.stringify(r.json)); return r.json }
const rnd = () => Math.random().toString(36).slice(2, 7)
// A month that has already happened needs its attendance: the local test
// database is written straight, for this studio only.
const PSQL = process.env.PSQL_URL ?? 'postgres://postgres@localhost:5432/ipc'
const sql = (q) => execFileSync('psql', [PSQL, '-v', 'ON_ERROR_STOP=1', '-qAt', '-c', q], { encoding: 'utf8' }).trim()

/**
 * Mehta Studios on 6 Oct 2026: three in-house people. Neha and Arjun are on
 * a monthly salary; Ravi joined in April and has no salary set yet (the video
 * sets it). September's attendance is in: Neha had one unpaid day off and one
 * absent day, so her line shows a cut.
 */
export async function seedSalaries(s) {
  const token = s.token
  const roles = must(await api('/team/roles', { token }), 'roles')
  const role = (n) => roles.filter((r) => r.type_name === n).map((r) => r.id)
  const add = async (name, salary, extra = {}) =>
    must(await api('/team/members', { token, method: 'POST', body: {
      name, phone: phone(), engagement_type: 'in_house', create_login: true,
      email: `${name.split(' ')[0].toLowerCase()}-${rnd()}@mehta.studio`, password: 'team2026',
      pay_effective_from: '2026-04-01',
      ...(salary ? { salary, payment_type: 'salaried', pay_components: ['monthly_salary'] } : {}),
      ...extra,
    } }), name)
  const ravi = await add('Ravi Kumar', null, { role_ids: role('Video Editor') })
  const neha = await add('Neha Joshi', 24000, { role_ids: role('Photo Editor') })
  const arjun = await add('Arjun Singh', 18000, { role_ids: role('Data Manager') })
  // Attendance on, counted from 1 September; Sunday off.
  must(await api('/hr/policy', { token, method: 'PATCH', body: { enabled: true, day_start: '10:00', grace_min: 15, day_end: '19:00', weekly_off: [0] } }), 'policy')
  const company = sql(`select company_id from users where user_id = '${ravi.user_id}'`)
  sql(`update attendance_policy set enabled_at = '2026-09-01T00:00:00+05:30' where company_id = '${company}'`)
  const ids = [ravi.user_id, neha.user_id, arjun.user_id]
  // Every working day of September present, but Neha absent on the 14th and on unpaid leave on the 21st; Arjun late twice.
  sql(`insert into attendance (company_id, user_id, a_date, check_in_at, check_out_at, status, source, late_minutes)
       select '${company}', u, g::date,
              (g::date + time '10:00' + (case when u = '${arjun.user_id}' and extract(day from g) in (8, 17) then interval '35 min' else interval '2 min' end)) at time zone 'Asia/Kolkata',
              (g::date + time '19:05') at time zone 'Asia/Kolkata',
              case when u = '${neha.user_id}' and extract(day from g) = 14 then 'absent'
                   when u = '${arjun.user_id}' and extract(day from g) in (8, 17) then 'late' else 'present' end,
              'manual',
              case when u = '${arjun.user_id}' and extract(day from g) in (8, 17) then 35 else 0 end
         from generate_series(date '2026-09-01', date '2026-09-30', interval '1 day') g
        cross join unnest(array['${ids.join("','")}']::uuid[]) u
        where extract(dow from g) <> 0
          and not (u = '${neha.user_id}' and extract(day from g) = 21)`)
  sql(`update attendance set check_in_at = null, check_out_at = null where company_id = '${company}' and status = 'absent'`)
  sql(`insert into leave_requests (company_id, user_id, kind, start_date, end_date, reason, status, decided_by, decided_at)
       values ('${company}', '${neha.user_id}', 'unpaid', '2026-09-21', '2026-09-21', 'Cousin’s wedding', 'approved',
               (select user_id from users where company_id = '${company}' and role = 'super_admin' limit 1), '2026-09-15T12:00:00+05:30')`)
  // Ravi's pay goes to UPI, so the Pay dialog shows where the money goes.
  await api(`/team/members/${ravi.user_id}/pay-to`, { token, method: 'PUT', body: { upi_id: 'ravikumar@okhdfc' } })
  return { ravi, neha, arjun, company }
}
