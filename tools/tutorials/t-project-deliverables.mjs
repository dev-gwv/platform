import { Tutorial, studio, sleep, api } from './lib.mjs'
const t = new Tutorial('project-deliverables', { title: 'Project step 3: what they get', subtitle: 'Album, film, teaser: tick what is in the package', steps: 3 })
const s = await studio({ name: 'Mehta Studios', owner: 'Asha Mehta', skipSetup: true })
await api('/clients', { token: s.token, method: 'POST', body: { name: 'Priya Sharma', phone: '9876501234' } })
const p = await t.open(s)
await t.goto('/projects/new')
const main = p.locator('main')
const next = p.getByRole('button', { name: /^Next/ })
// Steps 1 and 2 happen before recording: only Deliverables is taught.
await p.getByPlaceholder('e.g. Aanya & Rahul Wedding').fill("Priya & Rahul's Wedding")
await main.getByText('Priya Sharma').first().click(); await sleep(400)
await next.click(); await sleep(1000)
await main.getByTitle('Add Wedding Day').click(); await sleep(600)
await p.getByRole('button', { name: 'Pick a date' }).last().click(); await sleep(300)
await p.getByLabel('Type a date').fill('21/11/2026'); await p.getByLabel('Type a date').press('Enter'); await sleep(300)
await p.getByRole('button', { name: 'Pick a time' }).last().click(); await sleep(300)
await p.getByRole('dialog').last().getByRole('button', { name: '6:00 PM', exact: true }).click(); await sleep(300)
await main.getByRole('button', { name: '6', exact: true }).last().click(); await sleep(500)
await next.click()
await main.getByText('Step 3 of 5').waitFor({ timeout: 8000 })
await sleep(1200)

const chip = (n) => main.getByRole('button', { name: n, exact: true })
async function aim(loc, ms = 450) {
  const r = await loc.boundingBox({ timeout: 3000 }).catch(() => null)
  if (r) await t.layer('pointer', r.x + Math.min(r.width / 2, 60), r.y + r.height / 2, ms)
  await sleep(ms + 30)
}
async function tap(loc, after = 550) { await aim(loc); await t.layer('ripple'); await sleep(120); await loc.click(); await sleep(after) }
async function spotBox(...args) {
  const pad = typeof args[args.length - 1] === 'number' ? args.pop() : 8
  const rs = []
  for (const l of args) { const r = await l.boundingBox(); if (r) rs.push(r) }
  const x = Math.min(...rs.map((r) => r.x)), y = Math.min(...rs.map((r) => r.y))
  const x2 = Math.max(...rs.map((r) => r.x + r.width)), y2 = Math.max(...rs.map((r) => r.y + r.height))
  await t.layer('spot', { x, y, width: x2 - x, height: y2 - y }, pad)
}

await t.start()
await t.titleCard(2300)
await t.step('Tap each thing in the package', chip('Wedding Teaser'), { hold: 700 })
await spotBox(chip('Wedding Teaser'), chip('Edited Photos'), chip('Reel / Short Video'), 10)
for (const n of ['Wedding Teaser', 'Full Wedding Film', 'Edited Photos', 'Photo Album']) await tap(chip(n))
await sleep(400)
const rows = main.getByText(/days after/)
await t.step('Each gets a due date from the wedding day', null, { hold: 0 })
await spotBox(main.getByText('Wedding Teaser', { exact: true }).last(), rows.last(), main.getByRole('button', { name: 'Remove Photo Album' }), 12)
await t.layer('hidePointer')
await sleep(2600)
await t.step('Press Next: Price', next, { hold: 1100 })
await t.point(next); await t.layer('ripple'); await sleep(200)
await t.layer('spot', null)
await next.click()
await main.getByText('Step 4 of 5').waitFor({ timeout: 8000 })
await sleep(700)
await t.layer('hidePointer')
await t.say('Done. Next, the package price.', null, { hold: 2400 })
await t.endCard('What they get, with every due date set', 2800)
await t.stop()
t.build()
