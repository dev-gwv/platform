import { api, phone } from './lib.mjs'
const must = (r, what) => { if (r.status >= 300) throw new Error(what + ' ' + r.status + ' ' + JSON.stringify(r.json)); return r.json }
const rnd = () => Math.random().toString(36).slice(2, 7)
const ist = (d = new Date()) => new Date(d.getTime() + 330 * 60000).toISOString().slice(0, 10)
const addDays = (iso, n) => { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }

/**
 * Mehta Studios: Asha (owner) gave Ravi Kumar, an editor with his own login,
 * the Wedding Teaser for Priya & Rohan's wedding, due in 4 days, plus the
 * Highlight Film due later.
 */
export async function seedHandIn(s) {
  const token = s.token
  const today = ist()
  const roles = must(await api('/team/roles', { token }), 'roles')
  const email = `ravi-${rnd()}@mehta.studio`, password = 'ravi2026'
  const ravi = must(await api('/team/members', { token, method: 'POST', body: { name: 'Ravi Kumar', phone: phone(), engagement_type: 'in_house', create_login: true, email, password, role_ids: roles.filter((r) => r.type_name === 'Video Editor').map((r) => r.id) } }), 'ravi')
  const c = must(await api('/clients', { token, method: 'POST', body: { name: 'Priya Sharma', phone: phone() } }), 'client')
  const p = must(await api('/projects', { token, method: 'POST', body: { name: 'Priya & Rohan Wedding', client_id: c.id, package_cost: 250000 } }), 'project')
  const teaser = must(await api(`/projects/${p.id}/deliverables`, { token, method: 'POST', body: { title: 'Wedding Teaser', assignee_id: ravi.user_id, estimated_date: addDays(today, 4), delivery_days_after_start: 3 } }), 'teaser')
  must(await api(`/projects/${p.id}/deliverables`, { token, method: 'POST', body: { title: 'Highlight Film', assignee_id: ravi.user_id, estimated_date: addDays(today, 14), delivery_days_after_start: 7 } }), 'film')
  const login = must(await api('/auth/login', { method: 'POST', body: { email, password } }), 'ravi login')
  const rt = login.session?.access_token ?? login.access_token
  await api('/auth/hints/guide', { token: rt, method: 'PUT', body: { value: { shown: 1, closed: true } } })
  return { email, password, user_id: ravi.user_id, token: rt, projectId: p.id, teaserId: teaser.id }
}
