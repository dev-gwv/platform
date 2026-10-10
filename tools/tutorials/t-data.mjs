import { Tutorial, studio, sleep } from './lib.mjs'
import { seedData } from './seed-data.mjs'
const t = new Tutorial('data', { title: 'Record the cards after a shoot', subtitle: 'Who copied them, the main disk and the backup', steps: 5 })
const s = await studio({ name: 'Mehta Studios', owner: 'Asha Mehta', skipSetup: true })
const d = await seedData(s)
const p = await t.open(s)
await t.goto(`/projects/${d.projectId}?tab=shoots`)
await p.mouse.wheel(0, 300); await sleep(700)
await t.start()
await t.titleCard()

const chip = p.getByRole('button', { name: /Data: 0 of 2 handed in/ }).first()
await t.step('The wedding is done. No cards are in yet', chip, { hold: 500, pad: 6 })

const ravi = p.locator('li').filter({ hasText: 'Ravi Kumar' }).first()
const add = ravi.getByRole('button', { name: 'Add data' })
await t.step('Ravi hands over his cards. Tap Add data', add, { hold: 300 })
await t.click(add, { after: 200 }); await t.layer('spot', null); await sleep(1300)

const dlg = p.getByRole('dialog')

async function pick(name, option) {
  await t.click(dlg.getByRole('combobox', { name }), { after: 300 })
  await t.click(p.getByRole('option', { name: option, exact: true }), { after: 250 })
}
const copies = dlg.locator('#dr-copied').locator('xpath=ancestor::div[contains(@class,"flex-col") and contains(@class,"gap-3")][1]')
await t.step('Who copied them, the main disk and the backup', copies, { hold: 200, pad: 6 })
await pick('Main copy location', 'WD-001')
await pick('Main copy status', 'Copied')
await pick('Backup copy location', 'SEA-002')
await pick('Backup copy status', 'Copied')
await sleep(300)

const save = dlg.getByRole('button', { name: 'Save', exact: true })
await t.step('Tap Save', save, { hold: 200 })
await t.click(save, { after: 200 }); await t.layer('spot', null); await sleep(1500)

const neha = p.locator('li').filter({ hasText: 'Neha Singh' }).first()
const add2 = neha.getByRole('button', { name: 'Add data' })
await t.step('Neha’s opens on the same disks. Mark them Copied', add2, { hold: 200 })
await t.click(add2, { after: 200 }); await t.layer('spot', null); await sleep(1300)
await pick('Main copy status', 'Copied')
await pick('Backup copy status', 'Copied')
await t.click(dlg.getByRole('button', { name: 'Save', exact: true }), { after: 200 })
await t.layer('caption', null); await sleep(1100)
await t.layer('hidePointer')

const head = p.getByText(/Data: 2 of 2 handed in/).first()
await head.evaluate((e) => e.scrollIntoView({ block: 'center' })); await sleep(600)
const line = head.locator('xpath=ancestor::div[2]')
await t.say('Both in, and every card backed up', line, { hold: 2200, pad: 6 })
await t.endCard('Every card copied twice, and you know it')
await t.stop()
t.build()
