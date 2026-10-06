import { api, phone } from './lib.mjs'
const must = (r, what) => { if (r.status >= 300) throw new Error(what + ' ' + r.status + ' ' + JSON.stringify(r.json)); return r.json }
const rnd = () => Math.random().toString(36).slice(2, 7)
export const PLACE = { latitude: 19.0596, longitude: 72.8295 }
/** A spot about 2 km away (home), for before he reaches the studio. */
export const HOME = { latitude: 19.0760, longitude: 72.8400 }

/**
 * Attendance on at Mehta Studios: the studio's place with a 100 m radius,
 * the day starting at the last quarter hour (so a check-in now is on time),
 * Sunday off. Ravi Kumar is an in-house editor with his own login.
 */
export async function seedCheckIn(s) {
  const token = s.token
  const nowIst = new Date(Date.now() + 330 * 60000)
  const startMin = Math.floor((nowIst.getUTCHours() * 60 + nowIst.getUTCMinutes()) / 15) * 15
  const hm = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
  if (startMin + 60 > 23 * 60 + 59) throw new Error('Record the check-in tutorial before 11 pm IST')
  const dayStart = hm(startMin)
  const dayEnd = hm(Math.min(startMin + 9 * 60, 23 * 60 + 45))
  must(await api('/hr/location', { token, method: 'PATCH', body: { lat: PLACE.latitude, lng: PLACE.longitude, radius_m: 100, timezone: 'Asia/Kolkata', is_active: true, expected_checkin_time: dayStart, late_grace_minutes: 15, missed_cutoff_time: null } }), 'location')
  must(await api('/hr/policy', { token, method: 'PATCH', body: { enabled: true, day_start: dayStart, grace_min: 15, day_end: dayEnd, weekly_off: [0] } }), 'policy')
  const roles = must(await api('/team/roles', { token }), 'roles')
  const email = `ravi-${rnd()}@mehta.studio`, password = 'ravi2026'
  const ravi = must(await api('/team/members', { token, method: 'POST', body: { name: 'Ravi Kumar', phone: phone(), engagement_type: 'in_house', create_login: true, email, password, role_ids: roles.filter((r) => r.type_name === 'Video Editor').map((r) => r.id) } }), 'ravi')
  const login = must(await api('/auth/login', { method: 'POST', body: { email, password } }), 'ravi login')
  const rt = login.session?.access_token ?? login.access_token
  await api('/auth/hints/guide', { token: rt, method: 'PUT', body: { value: { shown: 1, closed: true } } })
  return { email, password, user_id: ravi.user_id, token: rt, dayStart }
}
