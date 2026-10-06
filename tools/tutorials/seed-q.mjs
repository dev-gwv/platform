import { api } from './lib.mjs'
export async function seedProject(s, { shoots = true } = {}) {
  const T = s.token
  await api('/settings/company', { token: T, method: 'PATCH', body: { invoice_address: '12 MG Road, Pune 411001', invoice_phone: '9822012345', invoice_email: 'hello@mehtastudios.in', invoice_gst_number: '27ABCDE1234F1Z5', city: 'Pune' } })
  const c = await api('/clients', { token: T, method: 'POST', body: { name: 'Priya Sharma', phone: '9876501234', city: 'Pune' } })
  const pr = await api('/projects', { token: T, method: 'POST', body: { name: 'Priya & Rahul Wedding', client_id: c.json.id ?? c.json.client?.id, package_cost: 285000,
    deliverables: [{ title: 'Wedding Film (8–10 min)' }, { title: 'Teaser (1 min)' }, { title: 'Premium Album, 40 sheets' }, { title: 'All edited photos' }] } })
  const pid = pr.json.id ?? pr.json.project?.id
  if (!pid) throw new Error('project ' + JSON.stringify(pr))
  const ids = []
  if (shoots) for (const [name, d, h0, hrs, req] of [
    ['Haldi', '2026-12-11', '09:00', 4, [{ name: 'Candid Photographer', quantity: 1 }]],
    ['Wedding', '2026-12-12', '16:00', 6, [{ name: 'Candid Photographer', quantity: 1 }, { name: 'Cinematographer', quantity: 1 }]],
    ['Reception', '2026-12-13', '19:00', 4, [{ name: 'Candid Photographer', quantity: 1 }]],
  ]) {
    const start = new Date(`${d}T${h0}:00+05:30`); const end = new Date(start.getTime() + hrs * 3600e3)
    const r = await api('/shoots', { token: T, method: 'POST', body: { project_id: pid, name, shoot_date: d, start_at: start.toISOString(), end_at: end.toISOString(), location: 'Pune', requirements: req } })
    if (r.status >= 300) console.log('shoot', r.status, JSON.stringify(r.json)); ids.push(r.json.id ?? r.json.shoot?.id)
  }
  return { pid, shootIds: ids }
}
