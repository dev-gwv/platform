import { Tutorial, studio, sleep } from './lib.mjs'
import { withSpot, padEnd, frozen, sayHere } from './helpers.mjs'
import { seedDay, PLACE } from './seed-day.mjs'
// Run with TZ=Asia/Kolkata. Signs in as the team member, at the studio's place.
const t = new Tutorial('team-day', { title: 'Your team’s day', subtitle: 'What a team member sees when they sign in', steps: 5 })
const s = await studio({ name: 'Verma Studios', owner: 'Sunil Verma', skipSetup: true })
const m = await seedDay(s)
const p = await t.open({ email: m.email, password: m.password })
await t.ctx.grantPermissions(['geolocation'], { origin: new URL(p.url()).origin })
await t.ctx.setGeolocation(PLACE)
const h = withSpot(t)
await t.goto('/dashboard')
await p.getByRole('button', { name: 'I’ve reached' }).or(p.getByRole('button', { name: "I've reached" })).first().waitFor({ timeout: 20000 })
await t.start()
await t.titleCard()

const today = p.locator('main ul').first().locator('xpath=../..')
const att = p.locator('main div').filter({ has: p.getByText('Attendance today', { exact: true }) }).filter({ hasText: 'On a shoot today' }).last()
await t.step('Ravi signs in: his day, in time order', today, { hold: 2200 })
await sayHere(t, 'A shoot day: his attendance is the venue', att, 2000)

const reached = p.getByRole('button', { name: /I.ve reached/ }).first()
await t.step('At the Haldi venue, he taps “I’ve reached”', reached, { hold: 1300 })
await h.click(reached, { after: 300 }); await h.unspot(); await sleep(1500)
await sayHere(t, 'Reached, on time: that is today’s attendance', p.getByText(/^Reached \d/).first(), 2000)

const confirm = p.getByRole('button', { name: 'Confirm' })
const sangeet = p.locator('main li').filter({ hasText: 'Sangeet' })
await t.step('Tonight’s Sangeet: Confirm, so the studio knows', sangeet, { hold: 1400 })
await h.click(confirm, { after: 300 }); await h.unspot(); await sleep(1400)

const started = p.getByRole('button', { name: /I.ve started/ })
const teaser = p.locator('main li').filter({ hasText: 'Wedding Teaser' })
await t.step('Starting the teaser? Tap “I’ve started”', teaser, { hold: 1400 })
await h.click(started, { after: 60 }); await h.unspot(); await sleep(1800)

const work = p.getByRole('link', { name: /My work/ }).last()
await t.step('My work: every edit, its stage and days left', work, { hold: 1200 })
await h.click(work, { after: 300 }); await h.unspot()
await p.getByText('Your edits').first().waitFor({ timeout: 10000 }); await sleep(900)
const edits = p.locator('main div').filter({ has: p.getByText('Your edits', { exact: true }) }).filter({ hasText: 'Highlight Film' }).last()
await sayHere(t, 'The teaser is in Editing, 6 days left', edits, 2400)

await t.layer('caption', null)
await h.click(p.getByRole('link', { name: 'Home', exact: true }), { after: 300 }); await h.unspot()
await p.getByText(/Reached the shoot at/).first().waitFor({ timeout: 8000 }).catch(() => console.log('attendance card did not refresh'))
await sleep(900)
await t.layer('hidePointer')
const day = p.locator('main').locator('div.flex.flex-col.gap-4').first()
await t.say('Reached, confirmed, editing: Ravi’s day is on track', day, { hold: 2800, pad: 4 })
await t.endCard('Your team’s day, on their own login')
await t.stop()
padEnd(t); frozen(t); t.build()
