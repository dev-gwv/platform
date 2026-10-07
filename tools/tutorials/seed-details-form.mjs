import { api, phone } from './lib.mjs'
const must = (r, what) => { if (r.status >= 300) throw new Error(what + ' ' + r.status + ' ' + JSON.stringify(r.json)); return r.json }

/** A booking with only the client's name and phone: no dates, no days yet. */
export async function seedDetailsForm(s) {
  const token = s.token
  const c = must(await api('/clients', { token, method: 'POST', body: { name: 'Priya Sharma', phone: phone() } }), 'client')
  const p = must(await api('/projects', { token, method: 'POST', body: { name: 'Priya & Rohan Wedding', client_id: c.id, package_cost: 250000 } }), 'project')
  return { projectId: p.id }
}

/**
 * In development React mounts the details dialog twice, so two links are made
 * at once and the one shown may not be the live one. Let them reach the API one
 * after the other, so the link on screen (the second) is the one that works.
 */
export async function oneLinkAtATime(page) {
  let chain = Promise.resolve()
  await page.route('**/client-details/projects/*', (route) => {
    if (route.request().method() !== 'POST') return route.continue()
    chain = chain.then(async () => { const res = await route.fetch(); await route.fulfill({ response: res }) })
    return chain
  })
}
