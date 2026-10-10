import { api, phone } from './lib.mjs'
const must = (r, what) => { if (r.status >= 300) throw new Error(what + ' ' + r.status + ' ' + JSON.stringify(r.json)); return r.json }

/**
 * Kapoor Films: Ravi Kumar (crew), Priya & Rahul Wedding, and ₹20,500 spent
 * this month already, so the new ₹8,500 makes ₹29,000.
 */
export async function seedExpenses(s) {
  const token = s.token
  const ravi = must(await api('/team/members', { token, method: 'POST', body: { name: 'Ravi Kumar', phone: phone(), engagement_type: 'freelancer', create_login: false } }), 'ravi')
  const c = must(await api('/clients', { token, method: 'POST', body: { name: 'Priya Sharma', phone: phone() } }), 'client')
  const p = must(await api('/projects', { token, method: 'POST', body: { name: 'Priya & Rahul Wedding', client_id: c.id, package_cost: 285000 } }), 'project')
  const month = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }).slice(0, 8)
  for (const [category, description, amount, day] of [['Equipment', 'Hard disk, 4 TB', 12000, '02'], ['Rent', 'Studio electricity', 8500, '05']]) {
    must(await api('/financials/expenses', { token, method: 'POST', body: { category, description, amount, expense_date: month + day } }), 'expense')
  }
  return { projectId: p.id, raviId: ravi.user_id }
}
