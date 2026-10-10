/**
 * The browser smoke test (CI job `browser`): a real Chromium against the
 * built app and a real API on a real Postgres. It catches what unit tests
 * and the API checks cannot -- a page that crashes on load, a lazy chunk
 * that fails to import, a screen that throws on the data a new studio has.
 *
 * It signs a fresh studio up, signs in through the login page, opens every
 * page in the menu and fails on a page error, a route error boundary, or a
 * page with no heading. Then it adds a client through the form, and checks
 * the plan page's Talk to us button.
 *
 *   WEB=http://localhost:4173 API=http://localhost:8787 PLAYWRIGHT=<path to playwright/index.mjs> node e2e/smoke.mjs
 */
const WEB = process.env.WEB ?? 'http://localhost:4173'
const API = process.env.API ?? 'http://localhost:8787'
const { chromium } = await import(process.env.PLAYWRIGHT ?? 'playwright')

const PAGES = [
  ['/dashboard', 'Home'],
  ['/follow-ups', 'Leads'],
  ['/clients', 'Clients'],
  ['/projects', 'Projects'],
  ['/team-allocation', 'Shoots'],
  ['/production-board', 'Post-Production'],
  ['/tasks', 'Tasks'],
  ['/data-management', 'Data & Backup'],
  ['/billing/payments', 'Money'],
  ['/employees', 'Team'],
  ['/reports', 'Reports'],
  ['/settings/subscription', 'Plan & billing'],
  ['/settings/company', 'Settings'],
  ['/profile', 'My profile'],
]

let failed = 0
const ok = (name) => console.log(`PASS  ${name}`)
const bad = (name, why) => {
  failed += 1
  console.log(`FAIL  ${name}: ${why}`)
}

async function api(path, body, token) {
  const r = await fetch(`${API}${path}`, {
    method: body ? 'POST' : 'GET',
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  })
  return { status: r.status, json: await r.json().catch(() => null) }
}

const n = Math.random().toString(36).slice(2, 8)
const email = `smoke-${n}@example.com`
const password = 'Smoke-pass-1234'
const reg = await api('/auth/register', { company_name: `Smoke Studio ${n}`, admin_name: 'Smoke Owner', email, phone: `98${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`, password })
const token = reg.json?.session?.access_token
if (!token) {
  console.log('FAIL  sign-up', reg.status, JSON.stringify(reg.json))
  process.exit(1)
}
await fetch(`${API}/settings/company/setup`, { method: 'PATCH', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify({ action: 'skip' }) })

const browser = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {})
const page = await (await browser.newContext({ viewport: { width: 1280, height: 860 } })).newPage()
const errors = []
page.on('pageerror', (e) => errors.push(e.message))

try {
  await page.goto(`${WEB}/login`)
  await page.locator('input[type=email]').fill(email)
  await page.locator('input[type=password]').fill(password)
  await page.getByRole('button', { name: /sign in/i }).click()
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 30_000 })
  ok('signs in through the login page')

  for (const [path, name] of PAGES) {
    const before = errors.length
    await page.goto(`${WEB}${path}`)
    try {
      await page.locator('main h1').first().waitFor({ timeout: 20_000 })
      await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => undefined)
      const broken = await page.getByText(/Couldn.t show/).count()
      if (broken > 0) bad(`${name} (${path})`, 'the page showed its error box')
      else if (errors.length > before) bad(`${name} (${path})`, errors.slice(before).join(' | '))
      else ok(`${name} opens (${path})`)
    } catch (e) {
      bad(`${name} (${path})`, `no heading: ${e.message.split('\n')[0]}`)
    }
  }

  // A new client through the form, the way a studio adds its first one.
  await page.goto(`${WEB}/clients`)
  await page.getByRole('button', { name: /new client|add client/i }).first().click()
  const dialog = page.getByRole('dialog')
  await dialog.getByPlaceholder('e.g. Priya Sharma').fill('Priya Mehta')
  await dialog.getByPlaceholder('98765 43210').fill('9876501234')
  await dialog.getByRole('button', { name: /save client|save/i }).first().click()
  await page.getByText('Priya Mehta').first().waitFor({ timeout: 15_000 })
  ok('adds a client through the form')

  await page.goto(`${WEB}/settings/subscription`)
  await page.getByRole('button', { name: /Talk to us on WhatsApp|Email us/ }).first().waitFor({ timeout: 20_000 }).catch(() => undefined)
  const talk = await page.getByRole('button', { name: /Talk to us on WhatsApp|Email us/ }).count()
  if (talk >= 3) ok('the plan page offers Talk to us on every plan')
  else bad('plan page', `expected 3 plan buttons, saw ${talk}`)
} catch (e) {
  bad('smoke', e.message.split('\n')[0])
} finally {
  await browser.close()
}

console.log(`\n${failed ? 'FAILED' : 'OK'}: ${failed} failed`)
process.exit(failed ? 1 : 0)
