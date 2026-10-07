import { api, phone } from './lib.mjs'
const must = (r, what) => { if (r.status >= 300) throw new Error(what + ' ' + r.status + ' ' + JSON.stringify(r.json)); return r.json }
const rnd = () => Math.random().toString(36).slice(2, 7)

/**
 * Mehta Studios gives 12 casual and 6 sick days a year. Ravi Kumar (in-house
 * editor, own login) already took 2 Oct off, approved, so he has 11 casual
 * days left when the video starts.
 */
export async function seedAskLeave(s) {
  const token = s.token
  must(await api('/hr/leave/allowances', { token, method: 'PUT', body: { allowances: [{ kind: 'casual', days_per_year: 12 }, { kind: 'sick', days_per_year: 6 }] } }), 'allowances')
  const roles = must(await api('/team/roles', { token }), 'roles')
  const email = `ravi-${rnd()}@mehta.studio`, password = 'ravi2026'
  const ravi = must(await api('/team/members', { token, method: 'POST', body: { name: 'Ravi Kumar', phone: phone(), engagement_type: 'in_house', create_login: true, email, password, role_ids: roles.filter((r) => r.type_name === 'Video Editor').map((r) => r.id) } }), 'ravi')
  const login = must(await api('/auth/login', { method: 'POST', body: { email, password } }), 'ravi login')
  const rt = login.session?.access_token ?? login.access_token
  await api('/auth/hints/guide', { token: rt, method: 'PUT', body: { value: { shown: 1, closed: true } } })
  const past = must(await api('/hr/leave', { token: rt, method: 'POST', body: { kind: 'casual', start_date: '2026-10-02', end_date: '2026-10-02', reason: 'Gandhi Jayanti with family' } }), 'past leave')
  must(await api(`/hr/leave/${past.id}/decide`, { token, method: 'POST', body: { approve: true } }), 'approve past')
  return { email, password, user_id: ravi.user_id, token: rt }
}
