import { Tutorial, studio, sleep, WEB } from './lib.mjs'
import { seedEnquiryStudio, sendEnquiry } from './seed-enquiry-form.mjs'
const t = new Tutorial('enquiry-form', { title: 'Your enquiry form and QR code', subtitle: 'Every enquiry lands in Leads by itself', steps: 6 })
const s = await studio({ name: 'Mehta Studios', owner: 'Asha Mehta', skipSetup: true })
await seedEnquiryStudio(s)
const p = await t.open(s)
await t.ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: WEB })
await t.goto('/leads')
await p.waitForLoadState('networkidle').catch(() => {}); await sleep(800)
await t.start()
await t.titleCard()

// 1. Leads → Enquiry form & QR
const hubLink = p.locator('main a:visible', { hasText: 'Enquiry form & QR' }).first()
await t.step('Leads → “Enquiry form & QR”', hubLink, { hold: 1400 })
await t.layer('spot', null)
await t.click(hubLink, { after: 300 })
await p.getByRole('button', { name: 'Download for print (HD)' }).waitFor()
await p.waitForLoadState('networkidle').catch(() => {}); await sleep(900)

// 2. Your QR code: print it, share the link
const qrCard = p.getByRole('button', { name: 'Download for print (HD)' }).locator('xpath=ancestor::div[contains(@class,"rounded")][last()]')
await t.step('Your QR code: print it, or share the link', qrCard, { hold: 1800, pad: 4 })
await t.say('“Copy code” puts the form on your website', p.getByRole('button', { name: 'Copy code' }), { hold: 1300 })
await t.click(p.getByRole('button', { name: 'Copy code' }), { after: 700 })

// 3. Questions: switch on what to ask
await t.layer('spot', null)
const qTab = p.getByRole('tab', { name: 'Questions' })
await t.click(qTab, { after: 900 })
const switches = p.locator('main').getByRole('switch')
const city = switches.nth(4)
const budget = switches.nth(7)
await t.step('Questions: switch on what to ask', budget.locator('xpath=ancestor::div[contains(@class,"border-b") or contains(@class,"py")][1]'), { hold: 600, pad: 6 })
await t.click(city, { after: 500 })
await t.click(budget, { after: 1000 })

// 4. After they send: WhatsApp chat
await t.layer('spot', null)
await t.click(p.getByRole('tab', { name: 'After they send' }), { after: 900 })
const wa = p.getByText('Chat with you on WhatsApp').locator('xpath=ancestor::*[self::label or self::button][1]')
await t.step('After they send: they land in your WhatsApp', wa, { hold: 1200, pad: 4 })
const preview = p.getByText('What they’ll send you').or(p.getByText("What they'll send you")).first().locator('xpath=..')
await t.say('Their enquiry comes typed in', preview, { hold: 1500, pad: 4 })

// 5. A QR for a partner
await t.layer('spot', null)
const add = p.getByRole('button', { name: 'Add partner' }).first()
await t.step('“Add partner”: a QR for a shop or vendor', add, { hold: 600 })
await t.click(add, { after: 900 })
await t.layer('spot', null)
const dlg = p.getByRole('dialog')
await t.type(dlg.getByPlaceholder('Riya Boutique'), 'Royal Jewellers', { delay: 45 })
await t.click(dlg.getByRole('button', { name: 'Jeweller', exact: true }), { after: 500 })
await t.click(dlg.getByRole('button', { name: 'Add partner and make QR' }), { after: 2200 })
await p.waitForLoadState('networkidle').catch(() => {}); await sleep(600)
await t.say('Their own QR: every lead from it reads “via Royal Jewellers”', p.getByRole('main'), { hold: 2000, pad: 0 })

// 6. Wedding QR codes
await t.layer('spot', null)
await t.goto('/follow-ups/form?tab=wedding')
await p.waitForLoadState('networkidle').catch(() => {}); await sleep(900)
const wq = p.getByRole('button', { name: 'Add wedding QR' })
await t.step('Wedding QR codes: guests at your weddings enquire too', wq, { hold: 1400 })

// The enquiry arrives
await sendEnquiry(s)
await t.layer('spot', null); await t.layer('caption', null); await t.layer('hidePointer')
await t.click(p.getByRole('link', { name: 'Leads', exact: true }).first(), { after: 100 })
await t.layer('hidePointer')
await p.waitForLoadState('networkidle').catch(() => {}); await sleep(1800)
const lead = p.getByText('Priya Sharma').first()
await t.say('Priya’s enquiry is already in Leads', lead.locator('xpath=ancestor::*[self::li or self::article or self::a or contains(@class,"rounded")][1]'), { hold: 3000, pad: 6 })
await t.endCard('Every enquiry lands in Leads by itself')
await t.stop()
t.build()
