import { api, phone } from './lib.mjs'
const must = (r, what) => { if (r.status >= 300) throw new Error(what + ' ' + r.status + ' ' + JSON.stringify(r.json)); return r.json }
const rnd = () => Math.random().toString(36).slice(2, 7)
export const PLACE = { latitude: 19.0596, longitude: 72.8295 }
const ist = (d = new Date()) => new Date(d.getTime() + 330 * 60000).toISOString().slice(0, 10)
const addDays = (iso, n) => { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }
export async function seedDay(s) {
  const token = s.token
  const today = ist()
  // Attendance on: the studio's place and its hours.
  must(await api('/hr/location', { token, method: 'PATCH', body: { lat: PLACE.latitude, lng: PLACE.longitude, radius_m: 100, timezone: 'Asia/Kolkata', is_active: true, expected_checkin_time: '10:00', late_grace_minutes: 15, missed_cutoff_time: null } }), 'location')
  must(await api('/hr/policy', { token, method: 'PATCH', body: { enabled: true, day_start: '10:00', grace_min: 15, day_end: '19:00' } }), 'policy')
  const email = `ravi-${rnd()}@verma.studio`, password = 'ravi2026'
  const ravi = must(await api('/team/members', { token, method: 'POST', body: { name: 'Ravi Kumar', phone: phone(), engagement_type: 'in_house', create_login: true, email, password } }), 'ravi')
  const c = must(await api('/clients', { token, method: 'POST', body: { name: 'Priya Sharma', phone: phone() } }), 'client')
  const p = must(await api('/projects', { token, method: 'POST', body: { name: 'Priya & Rohan Wedding', client_id: c.id, package_cost: 250000 } }), 'project')
  const at = (h) => `${today}T${h}:00+05:30`
  const book = async (name, h1, h2, role, location) => {
    const sh = must(await api('/shoots', { token, method: 'POST', body: { project_id: p.id, name, shoot_date: today, start_at: at(h1), end_at: at(h2), location, requirements: [{ name: role, quantity: 1 }] } }), name)
    must(await api('/allocation', { token, method: 'POST', body: { user_id: ravi.user_id, shoot_id: sh.id, service_name: role, start_at: at(h1), end_at: at(h2), estimated_cost: 0 } }), 'book ' + name)
    return sh.id
  }
  // The Haldi starts at the next quarter hour, so reaching it now reads "on time".
  const nowIst = new Date(Date.now() + 330 * 60000)
  const startMin = Math.ceil((nowIst.getUTCHours() * 60 + nowIst.getUTCMinutes() + 1) / 15) * 15
  const hm = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
  if (startMin + 180 > 18 * 60) throw new Error('Record the team-day tutorial before 3 pm IST')
  await book('Haldi', hm(startMin), hm(startMin + 180), 'Candid Photographer', 'Sharma House, Juhu')
  await book('Sangeet', '18:00', '22:30', 'Candid Photographer', 'Sea Princess, Juhu')
  // An edit to start today: due in 6 days, 5 days of work.
  const c2 = must(await api('/clients', { token, method: 'POST', body: { name: 'Ananya Gupta', phone: phone() } }), 'client2')
  const p2 = must(await api('/projects', { token, method: 'POST', body: { name: 'Ananya & Karan Wedding', client_id: c2.id, package_cost: 180000 } }), 'project2')
  must(await api(`/projects/${p2.id}/deliverables`, { token, method: 'POST', body: { title: 'Wedding Teaser', assignee_id: ravi.user_id, estimated_date: addDays(today, 6), delivery_days_after_start: 5 } }), 'edit')
  must(await api(`/projects/${p2.id}/deliverables`, { token, method: 'POST', body: { title: 'Highlight Film', assignee_id: ravi.user_id, estimated_date: addDays(today, 14), delivery_days_after_start: 7 } }), 'edit2')
  const login = must(await api('/auth/login', { method: 'POST', body: { email, password } }), 'ravi login')
  const rt = login.session?.access_token ?? login.access_token
  // The guide's note is not what this video teaches.
  await api('/auth/hints/guide', { token: rt, method: 'PUT', body: { value: { shown: 1, closed: true } } })
  return { email, password, user_id: ravi.user_id, token: rt, today }
}
