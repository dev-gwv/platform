import { api, phone } from './lib.mjs'
const must = (r, what) => { if (r.status >= 300) throw new Error(what + ' ' + r.status + ' ' + JSON.stringify(r.json)); return r.json }

/** A wedding with no terms sent yet; the client has no email, so the link goes on WhatsApp. */
export async function seedTerms(s) {
  const token = s.token
  const c = must(await api('/clients', { token, method: 'POST', body: { name: 'Priya Sharma', phone: phone() } }), 'client')
  const p = must(await api('/projects', { token, method: 'POST', body: { name: 'Priya & Rohan Wedding', client_id: c.id, package_cost: 250000 } }), 'project')
  const d = '2026-12-12'
  must(await api('/shoots', { token, method: 'POST', body: { project_id: p.id, name: 'Wedding', shoot_date: d, start_at: `${d}T18:00:00+05:30`, end_at: `${d}T23:00:00+05:30`, location: 'Taj Lands End, Bandra' } }), 'shoot')
  return { projectId: p.id }
}
