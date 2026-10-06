import { Tutorial, studio, sleep } from './lib.mjs'
import { withSpot, frozen, sayHere } from './helpers.mjs'
import { seedCheckIn, PLACE } from './seed-check-in.mjs'
// Run with TZ=Asia/Kolkata. Signs in as the team member, standing at the studio.
const t = new Tutorial('check-in', { title: 'Mark your attendance', subtitle: 'For your team: check in at the studio in one tap', steps: 4 })
const s = await studio({ name: 'Mehta Studios', owner: 'Asha Mehta', skipSetup: true })
const m = await seedCheckIn(s)
const p = await t.open({ email: m.email, password: m.password })
// The app marks attendance by itself when it opens in view; this video shows
// the tap, so the page starts out of view and the automatic try never runs.
await t.ctx.addInitScript(() => { Object.defineProperty(Document.prototype, 'visibilityState', { configurable: true, get() { return 'hidden' } }) })
await t.ctx.grantPermissions(['geolocation'], { origin: new URL(p.url()).origin })
await t.ctx.setGeolocation(PLACE)
const h = withSpot(t)
await t.goto('/dashboard')
const checkIn = p.getByRole('button', { name: 'Check in' })
await checkIn.waitFor({ timeout: 15000 })
await t.start()
await t.titleCard()

const attCard = () => p.locator('main div.p-4').filter({ hasText: 'Attendance today' }).first()
const card = attCard()
await t.step('Ravi opens the app: Attendance today is on top', card, { hold: 1800 })
await t.step('At the studio? Tap Check in', checkIn, { hold: 700 })
await h.click(checkIn, { after: 300 }); await h.unspot()
const toast = p.locator('[data-sonner-toast]').first()
await toast.waitFor({ timeout: 10000 }); await sleep(500)
await t.layer('hidePointer')
await sayHere(t, 'Marked present, on time', toast, 1800)

await t.step('In, with the time. Check out when he leaves', attCard(), { hold: 1400 })

const att = p.getByRole('link', { name: 'Attendance & leave' }).first()
await t.step('Attendance & leave shows his whole month', att, { hold: 600 })
await h.click(att, { after: 300 }); await h.unspot()
await p.getByText('My attendance').first().waitFor({ timeout: 10000 }); await sleep(1000)
await t.layer('hidePointer')
await sayHere(t, 'P for present: today is counted', p.locator('main tr').filter({ hasText: 'Ravi Kumar' }).first(), 2800)
await t.endCard('Attendance in one tap')
await t.stop()
frozen(t); t.build()
