import { Tutorial, studio, sleep, api } from './lib.mjs'
import { studioLogo } from './seed-studio.mjs'
const t = new Tutorial('studio', { title: 'Your studio: name, logo and packages', subtitle: 'Set it once, use it on every project', steps: 5 })
const logo = await studioLogo()
const s = await studio({ name: 'My Studio', owner: 'Asha Mehta', skipSetup: true })
await api('/settings/company', { token: s.token, method: 'PATCH', body: { display_name: 'Mehta Studios', city: 'Pune', state: 'Maharashtra', country: 'India' } })
const p = await t.open(s)
await t.goto('/settings/company')
await t.start()
await t.titleCard()

const name = p.locator('label:has-text("Company name") + input, label:has-text("Company name") ~ input').first()
await t.step('Settings → Company profile: your studio’s name', name.locator('xpath=..'), { hold: 600 })
await t.point(name); await t.layer('ripple'); await name.click(); await name.press('Control+A')
await name.pressSequentially('Mehta Studios', { delay: 60 }); await sleep(300)
await t.click(p.getByRole('button', { name: 'Save changes' }), { after: 1400 })

const logoField = p.locator('div.flex.flex-col').filter({ has: p.getByText('Studio logo', { exact: true }) }).last()
const up = logoField.getByRole('button', { name: /Upload photo/ })
await t.step('Upload your logo, under 1 MB. It saves itself', logoField, { hold: 500 })
await t.point(up); await t.layer('ripple')
await logoField.locator('input[type=file]').setInputFiles(logo)
await sleep(2600)

const nav = p.getByRole('link', { name: 'Project templates' }).first()
await t.layer('spot', null)
await t.click(nav, { after: 1500 })
const add = p.getByRole('button', { name: 'New template' }).first()
await t.step('Project templates: save your usual package', add, { hold: 700 })
await t.click(add, { after: 1000 })

const dlg = p.getByRole('dialog')
await t.step('Name it, add the price, the days and what you deliver', dlg, { hold: 300, pad: 4 })
await t.type(dlg.getByPlaceholder('e.g. Wedding Photography Package'), 'Gold Wedding', { delay: 45 })
await t.type(dlg.getByPlaceholder('Optional description'), '₹2,50,000 · Haldi, Wedding, Reception', { delay: 30 })
const addIn = async (label, ph, values) => {
  const sec = dlg.locator('label', { hasText: new RegExp('^' + label + '$') }).locator('xpath=../..')
  for (const v of values) {
    await t.click(sec.getByRole('button', { name: 'Add' }), { after: 250 })
    const inp = sec.getByPlaceholder(ph).last()
    await inp.click(); await inp.pressSequentially(v, { delay: 35 })
  }
}
await addIn('Shoots', 'Shoot name', ['Haldi', 'Wedding', 'Reception'])
await addIn('Deliverables', 'Deliverable name', ['Wedding Film', 'Teaser', 'Album, 40 sheets'])
await sleep(400)

const save = dlg.getByRole('button', { name: 'Save', exact: true })
await t.step('Save. Pick it when you make a project', save, { hold: 400 })
await t.click(save, { after: 150 }); await t.layer('spot', null); await sleep(1400)
await t.layer('hidePointer')
const card = p.locator('div.rounded-xl, div[class*="card"]').filter({ has: p.getByText('Gold Wedding', { exact: true }) }).filter({ has: p.getByRole('button', { name: /Use for a new project/ }) }).last()
await t.say('Gold Wedding is ready for your next booking', card, { hold: 2800, pad: 6 })
await t.endCard('Your name and logo on every document')
await t.stop()
t.build()
