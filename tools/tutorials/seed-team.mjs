import { api, phone } from './lib.mjs'
export async function seedTeam(s) {
  const out = []
  for (const [name, rate, wed] of [['Ravi Kumar', 8000, 12000], ['Neha Singh', 9000, 14000], ['Arjun Patel', 7000, 11000]]) {
    const r = await api('/team/members', { token: s.token, method: 'POST', body: { name, phone: phone(), engagement_type: 'freelancer', create_login: false } })
    const id = r.json.user_id ?? r.json.id
    if (!id) throw new Error('member ' + JSON.stringify(r.json))
    const u = await api(`/team/members/${id}`, { token: s.token, method: 'PATCH', body: { freelancer_rate: rate, rate_wedding_day: wed } })
    if (u.status >= 300) console.log('patch', u.status, JSON.stringify(u.json))
    out.push(id)
  }
  return out
}
