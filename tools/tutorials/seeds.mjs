import { api, phone } from './lib.mjs'
const must = (r, what) => { if (r.status >= 300) throw new Error(what + ' ' + r.status + ' ' + JSON.stringify(r.json)); return r.json }

export async function seedGiveWork(s) {
  const token = s.token
  const role = must(await api('/team/roles', { token, method: 'POST', body: { type_name: 'Video Editor', role_code: 'video_editor', stage: 'post' } }), 'role')
  const roleId = role.id
  const ed1 = must(await api('/team/members', { token, method: 'POST', body: { name: 'Nitin Verma', phone: phone(), engagement_type: 'in_house', create_login: true, email: `nitin-${Math.random().toString(36).slice(2,7)}@mehta.studio`, password: 'nitin2026', role_ids: roleId ? [roleId] : [] } }), 'ed1')
  const ed2 = must(await api('/team/members', { token, method: 'POST', body: { name: 'Kavya Iyer', phone: phone(), engagement_type: 'freelancer', create_login: true, email: `kavya-${Math.random().toString(36).slice(2,7)}@mehta.studio`, password: 'kavya2026', role_ids: roleId ? [roleId] : [] } }), 'ed2')
  const c = must(await api('/clients', { token, method: 'POST', body: { name: 'Priya Sharma', phone: phone() } }), 'client')
  const p = must(await api('/projects', { token, method: 'POST', body: { name: 'Priya & Rohan Wedding', client_id: c.id, package_cost: 250000 } }), 'project')
  must(await api(`/projects/${p.id}/deliverables`, { token, method: 'POST', body: { title: 'Wedding Teaser' } }), 'd1')
  must(await api(`/projects/${p.id}/deliverables`, { token, method: 'POST', body: { title: 'Highlight Film' } }), 'd2')
  // Nitin already has some work on another project
  const c2 = must(await api('/clients', { token, method: 'POST', body: { name: 'Ananya Gupta', phone: phone() } }), 'client2')
  const p2 = must(await api('/projects', { token, method: 'POST', body: { name: 'Ananya & Karan Wedding', client_id: c2.id, package_cost: 180000 } }), 'project2')
  must(await api(`/projects/${p2.id}/deliverables`, { token, method: 'POST', body: { title: 'Wedding Album', assignee_id: ed1.user_id } }), 'd3')
  must(await api(`/projects/${p2.id}/deliverables`, { token, method: 'POST', body: { title: 'Reels', assignee_id: ed1.user_id } }), 'd4')
  return { projectId: p.id, ed1: ed1.user_id, ed2: ed2.user_id }
}

export async function seedPayments(s) {
  const token = s.token
  const c = must(await api('/clients', { token, method: 'POST', body: { name: 'Priya Sharma', phone: phone() } }), 'client')
  const p = must(await api('/projects', { token, method: 'POST', body: { name: 'Priya & Rohan Wedding', client_id: c.id, package_cost: 150000 } }), 'project')
  const inv = must(await api('/billing/invoices', { token, method: 'POST', body: {
    client_id: c.id, project_id: p.id, place_of_supply: '27', intra_state: true, invoice_date: '2026-09-20', due_date: '2026-09-28', status: 'sent',
    subject: 'Advance for the wedding', lines: [{ description: 'Wedding Photography — advance', quantity: 1, rate: 50000, gst_rate: 0 }] } }), 'invoice')
  return { projectId: p.id, clientId: c.id, invoiceId: inv.id }
}

export async function seedPayouts(s) {
  const token = s.token
  const raviEmail = `ravi-${Math.random().toString(36).slice(2,7)}@mehta.studio`
  const fr = must(await api('/team/members', { token, method: 'POST', body: { name: 'Ravi Kumar', phone: phone(), engagement_type: 'freelancer', create_login: true, email: raviEmail, password: 'ravi2026', freelancer_rate: 12000 } }), 'ravi')
  const rl = must(await api('/auth/login', { method: 'POST', body: { email: raviEmail, password: 'ravi2026' } }), 'ravi login')
  const rt = rl.session?.access_token ?? rl.access_token
  must(await api('/settings/profile', { token: rt, method: 'PATCH', body: { upi_id: 'ravikumar@okhdfc' } }), 'ravi upi')
  const fr2 = must(await api('/team/members', { token, method: 'POST', body: { name: 'Neha Singh', phone: phone(), engagement_type: 'freelancer', create_login: false, freelancer_rate: 9000 } }), 'neha')
  const c = must(await api('/clients', { token, method: 'POST', body: { name: 'Priya Sharma', phone: phone() } }), 'client')
  const p = must(await api('/projects', { token, method: 'POST', body: { name: 'Priya & Rohan Wedding', client_id: c.id, package_cost: 250000 } }), 'project')
  const day = (d, h1, h2) => ({ shoot_date: d, start_at: `${d}T${h1}:00+05:30`, end_at: `${d}T${h2}:00+05:30` })
  const sh = must(await api('/shoots', { token, method: 'POST', body: { project_id: p.id, name: 'Wedding', ...day('2026-09-20', '16:00', '23:00'), requirements: [{ name: 'Candid Photographer', quantity: 1 }, { name: 'Cinematographer', quantity: 1 }] } }), 'shoot')
  const w = day('2026-09-20', '16:00', '23:00')
  must(await api('/allocation', { token, method: 'POST', body: { user_id: fr.user_id, shoot_id: sh.id, service_name: 'Candid Photographer', start_at: w.start_at, end_at: w.end_at, estimated_cost: 12000 } }), 'book1')
  must(await api('/allocation', { token, method: 'POST', body: { user_id: fr2.user_id, shoot_id: sh.id, service_name: 'Cinematographer', start_at: w.start_at, end_at: w.end_at, estimated_cost: 9000 } }), 'book2')
  // a coming shoot, so "Upcoming" is not empty
  const sh2 = must(await api('/shoots', { token, method: 'POST', body: { project_id: p.id, name: 'Reception', ...day('2026-11-14', '19:00', '23:30'), requirements: [{ name: 'Candid Photographer', quantity: 1 }] } }), 'shoot2')
  const w2 = day('2026-11-14', '19:00', '23:30')
  must(await api('/allocation', { token, method: 'POST', body: { user_id: fr.user_id, shoot_id: sh2.id, service_name: 'Candid Photographer', start_at: w2.start_at, end_at: w2.end_at, estimated_cost: 12000 } }), 'book3')
  return { projectId: p.id }
}
