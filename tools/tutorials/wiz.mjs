// Shared helpers for the Create project wizard tutorials.
import { studio, sleep, api } from './lib.mjs'

export async function setup(t) {
  const s = await studio({ name: 'Mehta Studios', owner: 'Asha Mehta', skipSetup: true })
  await api('/clients', { token: s.token, method: 'POST', body: { name: 'Priya Sharma', phone: '9876501234' } })
  const p = await t.open(s)
  await t.goto('/projects/new')
  const main = p.locator('main')
  await p.getByPlaceholder('e.g. Aanya & Rahul Wedding').waitFor({ timeout: 10000 })
  return { p, main }
}

export function kit(t, p) {
  const main = p.locator('main')
  const next = p.getByRole('button', { name: /^Next/ })
  async function spot(loc, pad = 8) {
    await loc.scrollIntoViewIfNeeded({ timeout: 3000 }).catch(() => {})
    const r = await loc.boundingBox({ timeout: 3000 }).catch(() => null)
    await t.layer('spot', r, pad)
  }
  async function spotUnion(a, b, pad = 10) {
    const ra = await a.boundingBox({ timeout: 3000 }).catch(() => null)
    const rb = await b.boundingBox({ timeout: 3000 }).catch(() => null)
    if (!ra || !rb) return
    const x = Math.min(ra.x, rb.x), y = Math.min(ra.y, rb.y)
    await t.layer('spot', { x, y, width: Math.max(ra.x + ra.width, rb.x + rb.width) - x, height: Math.max(ra.y + ra.height, rb.y + rb.height) - y }, pad)
  }
  const speed = { ms: 450 }
  async function aim(loc, ms = speed.ms) {
    await loc.scrollIntoViewIfNeeded({ timeout: 3000 }).catch(() => {})
    const r = await loc.boundingBox({ timeout: 3000 }).catch(() => null)
    if (r) await t.layer('pointer', r.x + Math.min(r.width / 2, 60), r.y + r.height / 2, ms)
    await sleep(ms + 30)
  }
  async function tap(loc, { after = 500, ms = speed.ms } = {}) {
    await aim(loc, ms); await t.layer('ripple'); await sleep(120)
    await loc.click(); await sleep(after)
  }
  async function key(loc, text, delay = 30) {
    await aim(loc); await t.layer('ripple')
    await loc.click(); await loc.pressSequentially(text, { delay }); await sleep(250)
  }
  async function goNext(hold = 0) {
    await spot(next)
    if (hold) await sleep(hold)
    await tap(next, { after: 200 })
    await t.layer('spot', null)
    await sleep(500)
  }
  const card = () => main.getByText('Shoot title').last()
  const durRow = () => main.getByRole('button', { name: 'Custom', exact: true }).last()
  async function date(d) {
    const dBtn = p.getByRole('button', { name: 'Pick a date' }).last()
    await tap(dBtn, { after: 300 })
    await key(p.getByLabel('Type a date'), d, 25)
    await p.getByLabel('Type a date').press('Enter'); await sleep(300)
  }
  async function time(tm) {
    await tap(p.getByRole('button', { name: 'Pick a time' }).last(), { after: 300 })
    await tap(p.getByRole('dialog').last().getByRole('button', { name: tm, exact: true }), { after: 300 })
  }
  async function hours(h, after = 600) {
    await tap(main.getByRole('button', { name: h, exact: true }).last(), { after })
  }
  async function roles(names, { slow = false } = {}) {
    await tap(main.getByRole('button', { name: 'Add requirements' }).last(), { after: 700 })
    const dlg = p.getByRole('dialog').last()
    await sleep(150); await spot(dlg, 4)
    for (const n of names) await tap(dlg.getByRole('button', { name: n, exact: true }), { after: slow ? 450 : 250 })
    const save = dlg.getByRole('button', { name: /^Save / })
    if (slow) { await spot(save); await sleep(500) }
    await tap(save, { after: 100 })
    await t.layer('spot', null)
    await sleep(500)
  }
  return { speed, main, next, spot, spotUnion, aim, tap, key, goNext, card, durRow, date, time, hours, roles }
}

/** Fill the wizard's early steps without recording (no pointer, no captions). */
export async function quickStep1(p) {
  const main = p.locator('main')
  await p.getByPlaceholder('e.g. Aanya & Rahul Wedding').fill('Priya & Arjun Wedding')
  await main.getByText('Priya Sharma').first().click(); await sleep(400)
  await p.getByRole('button', { name: 'Next: Event days' }).click(); await sleep(1200)
}
export async function quickDay(p, chip, d, tm, h, role) {
  const main = p.locator('main')
  await main.getByTitle('Add ' + chip).click(); await sleep(800)
  await p.getByRole('button', { name: 'Pick a date' }).last().click(); await sleep(300)
  await p.getByLabel('Type a date').fill(d); await p.getByLabel('Type a date').press('Enter'); await sleep(300)
  await p.getByRole('button', { name: 'Pick a time' }).last().click(); await sleep(300)
  await p.getByRole('dialog').last().getByRole('button', { name: tm, exact: true }).click(); await sleep(300)
  await main.getByRole('button', { name: h, exact: true }).last().click(); await sleep(300)
  if (role) {
    await main.getByRole('button', { name: 'Add requirements' }).last().click(); await sleep(600)
    await p.getByRole('dialog').last().getByRole('button', { name: role, exact: true }).click(); await sleep(200)
    await p.getByRole('dialog').last().getByRole('button', { name: /^Save / }).click(); await sleep(500)
  }
}
export async function quickToPrice(p) {
  const main = p.locator('main')
  await quickStep1(p)
  await quickDay(p, 'Haldi', '20/11/2026', '10:00 AM', '4', 'Candid Photographer')
  await quickDay(p, 'Wedding Day', '21/11/2026', '6:00 PM', '6', 'Candid Photographer')
  await p.getByRole('button', { name: 'Next: Deliverables' }).click(); await sleep(1200)
  await main.getByRole('button', { name: 'Wedding Teaser', exact: true }).click(); await sleep(300)
  await main.getByRole('button', { name: 'Photo Album', exact: true }).click(); await sleep(300)
  await p.getByRole('button', { name: 'Next: Price' }).click(); await sleep(1200)
  await p.mouse.move(5, 5)
  await p.evaluate(() => window.scrollTo(0, 0))
}
