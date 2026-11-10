import { Tutorial, sleep } from './lib.mjs'
import { withSpot, padEnd, frozen } from './helpers.mjs'
// Run with TZ=Asia/Kolkata. A real sign-up on the local stack (a fresh email each run).
const t = new Tutorial('signup', { title: 'Create your account', subtitle: 'Sign up, sign in, and where you land', steps: 6 })
const p = await t.open({}, { signIn: false })
const h = withSpot(t)
await t.start()
await t.titleCard()
const start = p.getByRole('link', { name: /Start your .*free trial/ }).first()
await t.step('Tap “Start your free trial”', start, { hold: 900 })
await h.click(start, { after: 300 }); await h.unspot()
await p.getByLabel('Company name').waitFor({ timeout: 15000 }); await sleep(900)

await t.step('Your studio’s name and your name', p.getByLabel('Company name'), { hold: 300 })
await h.type(p.getByLabel('Company name'), 'Mehta Studios')
await h.type(p.getByLabel('Your name'), 'Asha Mehta')
await sleep(300)

const email = `asha${Math.floor(Math.random() * 90000 + 10000)}@mehtastudios.in`
await t.step('Email and mobile: the email is your username', p.getByLabel('Email'), { hold: 300 })
await h.type(p.getByLabel('Email'), email, { delay: 40 })
await h.type(p.getByLabel('Phone'), '9876543210')
await sleep(300)

await t.step('A password, twice, then “Create account”', p.getByLabel('Password', { exact: true }), { hold: 300 })
await h.type(p.getByLabel('Password', { exact: true }), 'mehta2026')
await h.type(p.getByLabel('Confirm password'), 'mehta2026')
const create = p.getByRole('button', { name: 'Create account' })
await h.click(create, { after: 300 }); await h.unspot()
await p.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 30000 })
await sleep(3000)

const team = p.getByRole('heading', { name: 'Add your team' }).first().locator('xpath=..')
await t.step('You are in: step 1 is “Add your team”', team, { hold: 2200 })
await h.unspot()

// Sign out the way a person would come back another day.
await p.context().clearCookies()
await p.evaluate(() => { try { localStorage.clear(); sessionStorage.clear() } catch { /* fine */ } })
await t.goto('/login')
await sleep(800)
const forgot = p.getByRole('button', { name: 'Forgot password?' })
await t.step('Next time: Sign in. Forgot? “Forgot password?”', p.locator('form').first(), { hold: 600 })
await h.type(p.locator('input[type=email]'), email, { delay: 35 })
await h.spot(forgot); await sleep(1600)
await h.unspot()
await t.endCard('Two minutes, and your studio is ready')
await t.stop()
padEnd(t); frozen(t); t.build()
