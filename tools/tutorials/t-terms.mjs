import { Tutorial, studio, sleep } from './lib.mjs'
import { seedTerms } from './seed-terms.mjs'
const t = new Tutorial('terms', { title: 'Send your terms, and get them signed', subtitle: 'The client signs with a finger, right on your phone', steps: 6 })
const s = await studio({ name: 'Mehta Studios', owner: 'Asha Mehta', skipSetup: true })
const d = await seedTerms(s)
const p = await t.open(s)
await t.goto(`/projects/${d.projectId}`)
await t.start()
await t.titleCard()

const tab = p.getByRole('button', { name: 'Terms', exact: true }).or(p.getByRole('tab', { name: 'Terms' })).first()
await t.step('Open the project’s Terms tab', tab, { hold: 900 })
await t.click(tab, { after: 1400 })

const wedding = p.getByRole('button', { name: /^Wedding/ }).first()
const choices = wedding.locator('xpath=..')
await t.step('Pick your usual terms. The payment plan fills in', choices, { hold: 600 })
await t.click(wedding, { after: 1400 })

const send = p.getByRole('button', { name: /Create link & send/ })
await t.layer('spot', null); await t.layer('hidePointer'); await send.evaluate((e) => e.scrollIntoView({ block: 'center' })); await sleep(900)
await t.step('Read them, then tap Create link & send', send, { hold: 900 })
await t.click(send, { after: 200 }); await t.layer('spot', null); await sleep(1600)

const dlg = p.getByRole('dialog')
await t.step('Send it on WhatsApp, or let Priya sign here', dlg, { hold: 700, pad: 4 })
await t.layer('spot', null); await t.click(dlg.getByRole('button', { name: 'Let them sign here' }), { after: 200 }); await sleep(1800)

const pad = p.getByRole('dialog').locator('canvas').first()
await pad.scrollIntoViewIfNeeded()
await sleep(400)
const box = p.getByRole('dialog').locator('canvas').first().locator('xpath=ancestor::div[2]')
await t.step('Priya checks her name and signs with a finger', box, { hold: 300, pad: 6 })
// A signature: a looped P, then a running wave.
const r = await pad.boundingBox()
const ox = r.x + r.width * 0.22, oy = r.y + r.height * 0.62
const strokes = [
  // P: up the stem, round the bowl
  [...Array.from({ length: 14 }, (_, i) => [0, -i * 6]), ...Array.from({ length: 22 }, (_, i) => { const a = -Math.PI / 2 + (i / 21) * Math.PI * 1.15; return [18 + Math.cos(a) * 20, -60 + 22 + Math.sin(a) * 22] })],
  // riya: a running wave with small loops
  Array.from({ length: 70 }, (_, i) => { const x = 42 + i * 4.2; const y = -12 + Math.sin(i / 3.2) * 12 - Math.max(0, Math.sin(i / 6.5)) * 6; return [x, y] }),
  // underline flourish
  Array.from({ length: 30 }, (_, i) => [10 + i * 10, 22 - Math.sin((i / 29) * Math.PI) * 8]),
]
for (const st of strokes) {
  const [x0, y0] = st[0]
  await t.layer('pointer', ox + x0, oy + y0, 250); await sleep(260)
  await p.mouse.move(ox + x0, oy + y0)
  await p.mouse.down()
  for (let i = 1; i < st.length; i++) {
    const [x, y] = st[i]
    await p.mouse.move(ox + x, oy + y, { steps: 2 })
    if (i % 2 === 0) await t.layer('pointer', ox + x, oy + y, 30)
    await sleep(14)
  }
  await p.mouse.up()
  await sleep(150)
}
await sleep(600)

const agree = p.getByRole('dialog').getByRole('button', { name: 'I agree' })
await t.step('Priya taps I agree', agree, { hold: 600 })
await t.click(agree, { after: 200 }); await t.layer('spot', null); await t.layer('caption', null); await sleep(1800)
await t.layer('hidePointer')
const card = p.getByText(/^Agreed by Priya Sharma/).locator('xpath=ancestor::div[contains(@class,"border-tone-green")][1]')
await p.evaluate(() => window.scrollTo({ top: 0 }))
await t.say('Agreed, signed in person, and kept on record', card, { hold: 2600, pad: 6 })
await t.endCard('Terms agreed, with her signature on file')
await t.stop()
t.build()
