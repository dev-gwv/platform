import { Tutorial, studio, sleep } from './lib.mjs'
import { withSpot, padEnd, frozen, sayHere } from './helpers.mjs'
import { seedBoard } from './seed-board.mjs'
// Run with TZ=Asia/Kolkata.
const t = new Tutorial('board', { title: 'Run the production board', subtitle: 'Every edit by stage, late work first', steps: 5 })
const s = await studio({ name: 'Sharma Films', owner: 'Rakesh Sharma', skipSetup: true })
await seedBoard(s)
const p = await t.open(s)
const h = withSpot(t)
await t.goto('/production-board')
await p.getByText('Haldi Reels').first().waitFor({ timeout: 20000 })
await t.start()
await t.titleCard()

// 1 — the four numbers
const tiles = p.locator('main button[aria-pressed]').first().locator('xpath=..')
await t.step('Late, due today, no editor: counted for you', tiles, { hold: 2400 })

// 2 — drag a card to the next stage
const reels = p.getByRole('button', { name: 'Open Haldi Reels' })
await t.step('Reels edited? Drag the card to the next stage', reels, { hold: 1600 })
const lane = p.locator('section[aria-label^="With manager"]')
// Bring Editing → With manager to the middle, away from the edge where dragging auto-scrolls.
await lane.locator('xpath=ancestor::div[contains(@class,"overflow-x-auto")][1]').evaluate((e) => e.scrollTo({ left: 200, behavior: 'smooth' }))
await sleep(700)
{
  const a = await reels.boundingBox(), b = await lane.boundingBox()
  const sx = a.x + a.width * 0.75, sy = a.y + 18
  const ex = b.x + b.width * 0.5, ey = b.y + 70
  await t.layer('spot', null)
  await t.layer('pointer', sx, sy); await sleep(700); await t.layer('ripple')
  await p.mouse.move(sx, sy); await p.mouse.down(); await sleep(150)
  const N = 28
  for (let i = 1; i <= N; i++) {
    const k = i / N, e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2
    const x = sx + (ex - sx) * e, y = sy + (ey - sy) * e - Math.sin(Math.PI * k) * 30
    await p.mouse.move(x, y); await t.layer('pointer', x, y, 40); await sleep(35)
  }
  await sleep(400); await p.mouse.up(); await sleep(1100)
}
const dlg = p.getByRole('dialog', { name: 'Move to With manager' })
await dlg.waitFor(); await sleep(300)
await sayHere(t, 'Paste the reels’ link, then move it', dlg, 1400)
await h.type(dlg.getByPlaceholder('https://drive.google.com/…'), 'https://drive.google.com/haldi-reels', { delay: 30 })
await h.click(dlg.getByRole('button', { name: /^Move to/ }), { after: 300 }); await h.unspot(); await sleep(1200)
await sayHere(t, 'Now waiting for your review', p.locator('section[aria-label^="With manager"]'), 1900)

// 3 — List view
const listTab = p.getByRole('tab', { name: 'List', exact: true }).or(p.getByRole('button', { name: 'List', exact: true })).first()
await t.step('Switch to List: late work is always on top', listTab, { hold: 1300 })
await h.click(listTab, { after: 300 }); await h.unspot(); await sleep(1300)
await sayHere(t, 'The late teaser leads the list', p.locator('main li').first(), 1700)

// 4 — tick two
const hl = p.getByRole('checkbox', { name: 'Select Highlight Film' })
const al = p.getByRole('checkbox', { name: 'Select Wedding Album' })
await t.step('Tick the work that has nobody on it', p.locator('main li').filter({ has: hl }), { hold: 1100 })
await h.click(hl, { after: 300 })
await h.click(al, { after: 500 }); await h.unspot(); await sleep(600)

// 5 — bulk give
const bar = p.getByRole('region', { name: 'Change the selected deliverables' })
const give = bar.getByRole('combobox', { name: 'Give the selected to' })
await t.step('“2 selected”: Give to… Kavya, both at once', bar, { hold: 1500 })
await h.click(give, { after: 500 })
await h.click(p.getByRole('option', { name: 'Kavya Iyer' }), { after: 200 }); await h.unspot()
await t.layer('caption', null); await sleep(1700)
await t.layer('hidePointer')
const rows = p.locator('main ul').filter({ has: p.getByText('Highlight Film') }).first()
await t.say('Both are Kavya’s now, ready for her to start', rows, { hold: 2800 })
await t.endCard('All your editing work, on one board')
await t.stop()
padEnd(t); frozen(t); t.build()
