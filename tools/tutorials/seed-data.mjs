import { api, phone } from './lib.mjs'
const must = (r, what) => { if (r.status >= 300) throw new Error(what + ' ' + r.status + ' ' + JSON.stringify(r.json)); return r.json }

/** A wedding shot two days ago with two freelancers on it, and the studio's two disks. */
export async function seedData(s) {
  const token = s.token
  const ravi = must(await api('/team/members', { token, method: 'POST', body: { name: 'Ravi Kumar', phone: phone(), engagement_type: 'freelancer', create_login: false, freelancer_rate: 12000 } }), 'ravi')
  const neha = must(await api('/team/members', { token, method: 'POST', body: { name: 'Neha Singh', phone: phone(), engagement_type: 'freelancer', create_login: false, freelancer_rate: 9000 } }), 'neha')
  for (const n of ['WD-001', 'SEA-002']) must(await api('/data/locations', { token, method: 'POST', body: { name: n, kind: 'drive' } }), 'disk ' + n)
  const c = must(await api('/clients', { token, method: 'POST', body: { name: 'Priya Sharma', phone: phone() } }), 'client')
  const p = must(await api('/projects', { token, method: 'POST', body: { name: 'Priya & Rohan Wedding', client_id: c.id, package_cost: 250000 } }), 'project')
  const d = '2026-10-04', w = { start_at: `${d}T16:00:00+05:30`, end_at: `${d}T23:00:00+05:30` }
  const sh = must(await api('/shoots', { token, method: 'POST', body: { project_id: p.id, name: 'Wedding', shoot_date: d, ...w, location: 'Taj Lands End, Bandra', requirements: [{ name: 'Candid Photographer', quantity: 1 }, { name: 'Cinematographer', quantity: 1 }] } }), 'shoot')
  must(await api('/allocation', { token, method: 'POST', body: { user_id: ravi.user_id, shoot_id: sh.id, service_name: 'Candid Photographer', ...w, estimated_cost: 12000 } }), 'book ravi')
  must(await api('/allocation', { token, method: 'POST', body: { user_id: neha.user_id, shoot_id: sh.id, service_name: 'Cinematographer', ...w, estimated_cost: 9000 } }), 'book neha')
  return { projectId: p.id }
}
