import { Tutorial, studio, sleep } from './lib.mjs'
import { withSpot, frozen, sayHere } from './helpers.mjs'
import { seedHandIn } from './seed-hand-in.mjs'
// Run with TZ=Asia/Kolkata. Signs in as the editor.
const t = new Tutorial('hand-in', { title: 'Hand in your edit', subtitle: 'For your team: from My work to review, in one go', steps: 5 })
const s = await studio({ name: 'Mehta Studios', owner: 'Asha Mehta', skipSetup: true })
const m = await seedHandIn(s)
const p = await t.open({ email: m.email, password: m.password })
const h = withSpot(t)
await t.goto('/dashboard')
await t.start()
await t.titleCard()

const work = p.getByRole('link', { name: 'My Work' }).first()
await t.step('Ravi opens My work', work, { hold: 600 })
await h.click(work, { after: 300 }); await h.unspot()
const card = p.locator('main li').filter({ hasText: 'Wedding Teaser' }).filter({ has: p.getByRole('button', { name: 'Hand in work' }) }).first()
await card.waitFor({ timeout: 10000 }); await p.waitForLoadState('networkidle').catch(() => {}); await sleep(1500)

await t.step('The Wedding Teaser: 4 days left', card, { hold: 1200, pad: 4 })
const started = card.getByRole('button', { name: /I.ve started/ })
await t.step('Starting it? Tap “I’ve started”', started, { hold: 600 })
await h.click(started, { after: 300 }); await h.unspot(); await sleep(1300)

const hand = card.getByRole('button', { name: 'Hand in work' })
await t.step('Done? Hand in work, and paste the link', hand, { hold: 600 })
await h.click(hand, { after: 300 }); await h.unspot(); await sleep(900)
const dlg = p.getByRole('dialog')
await h.type(dlg.getByPlaceholder('https://drive.google.com/…'), 'https://drive.google.com/file/d/priya-rohan-teaser', { delay: 30 })
await h.type(dlg.getByPlaceholder('What is this?'), 'Teaser, 1 min, final colour', { delay: 40 }); await h.unspot(); await sleep(300)

const send = dlg.getByRole('button', { name: 'Send for review' })
await t.step('Tap Send for review. Asha is told', send, { hold: 600 })
await h.click(send, { after: 300 }); await h.unspot()
const waiting = p.locator('main li').filter({ hasText: 'Wedding Teaser' }).filter({ hasText: 'Waiting for review' }).first()
await waiting.waitFor({ timeout: 10000 }); await p.waitForLoadState('networkidle').catch(() => {}); await sleep(2000)
await t.layer('hidePointer')
await sayHere(t, 'Waiting for review, with the manager', waiting, 2400, 4)
await t.endCard('Hand in your work in one go')
await t.stop()
frozen(t); t.build()
