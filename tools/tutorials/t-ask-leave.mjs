import { Tutorial, studio, sleep } from './lib.mjs'
import { withSpot, frozen, sayHere } from './helpers.mjs'
import { seedAskLeave } from './seed-ask-leave.mjs'
// Run with TZ=Asia/Kolkata. Signs in as the team member.
const t = new Tutorial('ask-leave', { title: 'Ask for leave', subtitle: 'For your team: see what is left, then ask in a minute', steps: 5 })
const s = await studio({ name: 'Mehta Studios', owner: 'Asha Mehta', skipSetup: true })
const m = await seedAskLeave(s)
const p = await t.open({ email: m.email, password: m.password })
const h = withSpot(t)
await t.goto('/dashboard')
await t.start()
await t.titleCard()

const att = p.getByRole('link', { name: 'Attendance & leave' }).first()
await t.step('Open Attendance & leave, then Leave', att, { hold: 600 })
await h.click(att, { after: 300 }); await h.unspot(); await sleep(900)
const tab = p.getByRole('link', { name: 'Leave', exact: true }).or(p.getByRole('button', { name: 'Leave', exact: true })).first()
await h.click(tab, { after: 300 }); await h.unspot()
const ask = p.getByRole('button', { name: 'Ask for leave' })
await ask.waitFor({ timeout: 10000 }); await sleep(900)

const chips = p.getByText(/of 12 casual left/).first().locator('xpath=..')
await t.step('Your balance: 11 of 12 casual days left', chips, { hold: 1200 })
await t.step('Tap Ask for leave', ask, { hold: 600 })
await h.click(ask, { after: 300 }); await h.unspot(); await sleep(800)

const dlg = p.getByRole('dialog').first()
await t.step('Pick the days: 22 to 23 October', dlg.locator('#lv-from').locator('xpath=ancestor::div[contains(@class,"grid")][1]'), { hold: 500 })
const cell = (d) => p.locator('[role="gridcell"]:visible').filter({ hasText: new RegExp(`^${d}$`) }).first()
await h.click(dlg.locator('#lv-from'), { after: 600 }); await h.click(cell('22'), { after: 500 })
await h.click(dlg.locator('#lv-to'), { after: 600 }); await h.click(cell('23'), { after: 500 }); await h.unspot()

const kind = dlg.locator('#lv-kind').locator('xpath=..')
await t.step('Casual, with a reason. Send request', kind, { hold: 500 })
await h.type(dlg.locator('#lv-reason'), 'Sister’s wedding in Jaipur', { delay: 45 }); await sleep(300)
await h.click(dlg.getByRole('button', { name: 'Send request' }), { after: 300 }); await h.unspot()
await p.getByText('Pending').first().waitFor({ timeout: 10000 }); await sleep(1000)
await t.layer('hidePointer')
await sayHere(t, 'Waiting for Asha. You hear back here', p.locator('main li').filter({ hasText: 'Pending' }).first(), 2400)
await t.endCard('Leave asked in a minute')
await t.stop()
frozen(t); t.build()
