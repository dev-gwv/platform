import { api } from './lib.mjs'
export async function seedEnquiryStudio(s) {
  await api('/settings/company', { token: s.token, method: 'PATCH', body: { display_name: 'Mehta Studios', city: 'Pune' } })
}
/** A client sends the studio's newest form, as from its website. */
export async function sendEnquiry(s) {
  const r = await api('/enquiry-forms', { token: s.token })
  const list = Array.isArray(r.json) ? r.json : (r.json.forms ?? r.json.items ?? [])
  const f = list[0]
  const code = f?.form_url?.match(/enquire\/([a-z0-9]+)/i)?.[1]
  if (!code) throw new Error('no form ' + JSON.stringify(r.json).slice(0, 300))
  const res = await api('/public/enquiry/' + code, { method: 'POST', body: { name: 'Priya Sharma', phone: '9876501234', email: 'priya.sharma@example.com', event_type: 'Wedding', event_date: '2026-12-12', city: 'Pune', budget: 300000, message: 'Haldi, wedding and reception' } })
  if (res.status >= 300) throw new Error('submit ' + res.status + ' ' + JSON.stringify(res.json))
}
