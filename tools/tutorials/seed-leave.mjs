import { api, phone } from './lib.mjs'
const must = (r, what) => { if (r.status >= 300) throw new Error(what + ' ' + r.status + ' ' + JSON.stringify(r.json)); return r.json }
const rnd = () => Math.random().toString(36).slice(2, 7)

/**
 * 12 casual and 6 sick days a year. Ravi Kumar (own login) already took 22–24
 * Sep, approved, so 9 casual days are left; he now asks for 15–16 Oct.
 */
export async function seedLeave(s) {
  const token = s.token
  must(await api('/hr/leave/allowances', { token, method: 'PUT', body: { allowances: [{ kind: 'casual', days_per_year: 12 }, { kind: 'sick', days_per_year: 6 }] } }), 'allowances')
  const email = `ravi-${rnd()}@kapoor.films`, password = 'ravi2026'
  must(await api('/team/members', { token, method: 'POST', body: { name: 'Ravi Kumar', phone: phone(), engagement_type: 'in_house', create_login: true, email, password } }), 'ravi')
  const login = must(await api('/auth/login', { method: 'POST', body: { email, password } }), 'ravi login')
  const rt = login.session?.access_token ?? login.access_token
  const past = must(await api('/hr/leave', { token: rt, method: 'POST', body: { kind: 'casual', start_date: '2026-09-22', end_date: '2026-09-24', reason: 'Sister’s engagement' } }), 'past leave')
  must(await api(`/hr/leave/${past.id}/decide`, { token, method: 'POST', body: { approve: true } }), 'approve past')
  must(await api('/hr/leave', { token: rt, method: 'POST', body: { kind: 'casual', start_date: '2026-10-15', end_date: '2026-10-16', reason: 'Cousin’s wedding in Jaipur' } }), 'leave ask')
}
