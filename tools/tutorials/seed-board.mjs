import { api, phone } from './lib.mjs'
const must = (r, what) => { if (r.status >= 300) throw new Error(what + ' ' + r.status + ' ' + JSON.stringify(r.json)); return r.json }
const rnd = () => Math.random().toString(36).slice(2, 7)
export async function seedBoard(s) {
  const token = s.token
  const role = must(await api('/team/roles', { token, method: 'POST', body: { type_name: 'Video Editor', role_code: 'video_editor', stage: 'post' } }), 'role')
  const nitin = must(await api('/team/members', { token, method: 'POST', body: { name: 'Nitin Verma', phone: phone(), engagement_type: 'in_house', create_login: true, email: `nitin-${rnd()}@sharma.studio`, password: 'nitin2026', role_ids: [role.id] } }), 'nitin')
  const kavya = must(await api('/team/members', { token, method: 'POST', body: { name: 'Kavya Iyer', phone: phone(), engagement_type: 'freelancer', create_login: true, email: `kavya-${rnd()}@sharma.studio`, password: 'kavya2026', role_ids: [role.id] } }), 'kavya')
  const c = must(await api('/clients', { token, method: 'POST', body: { name: 'Priya Sharma', phone: phone() } }), 'client')
  const p = must(await api('/projects', { token, method: 'POST', body: { name: 'Priya & Rohan Wedding', client_id: c.id, package_cost: 250000 } }), 'project')
  const c2 = must(await api('/clients', { token, method: 'POST', body: { name: 'Ananya Gupta', phone: phone() } }), 'client2')
  const p2 = must(await api('/projects', { token, method: 'POST', body: { name: 'Ananya & Karan Wedding', client_id: c2.id, package_cost: 180000 } }), 'project2')
  const add = async (pid, body) => must(await api(`/projects/${pid}/deliverables`, { token, method: 'POST', body }), body.title).id
  const ids = {}
  ids.teaser = await add(p.id, { title: 'Wedding Teaser', status: 'in_progress', assignee_id: nitin.user_id, estimated_date: '2026-09-30' })
  ids.highlight = await add(p.id, { title: 'Highlight Film', status: 'pending', estimated_date: '2026-10-06' })
  ids.album = await add(p.id, { title: 'Wedding Album', status: 'pending', estimated_date: '2026-10-09' })
  ids.full = await add(p.id, { title: 'Full Film', status: 'pending', estimated_date: '2026-10-24' })
  ids.reels = await add(p2.id, { title: 'Haldi Reels', status: 'in_progress', assignee_id: kavya.user_id, estimated_date: '2026-10-05' })
  return { pid: p.id, nitin: nitin.user_id, kavya: kavya.user_id, ids }
}
