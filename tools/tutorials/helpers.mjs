import { settledBox } from './lib.mjs'
// Small per-script helpers: keep the spotlight on whatever is being touched.
export function withSpot(t) {
  const L = (x) => (typeof x === 'string' ? t.page.locator(x).first() : x)
  const spot = async (loc, pad = 6) => {
    const l = L(loc)
    await l.scrollIntoViewIfNeeded({ timeout: 3000 }).catch(() => {})
    const r = await settledBox(l)
    await t.layer('spot', r, pad)
    return l
  }
  return {
    spot,
    unspot: () => t.layer('spot', null),
    click: async (loc, opts) => { await spot(loc); await t.click(L(loc), opts) },
    type: async (loc, text, opts) => { await spot(loc); await t.type(L(loc), text, opts) },
    retype: async (loc, text, delay = 60) => {
      const l = await spot(loc); await t.point(l); await t.layer('ripple'); await l.fill(''); await l.pressSequentially(text, { delay })
    },
  }
}
/** The end card is static, so the screencast sends one frame; hold it for its real length. */
export function padEnd() {
  // stop() now holds the last frame until the voice ends.
}
/** Print stretches where the screen did not change for longer than `min` seconds. */
export function frozen(t, min = 2.5) {
  const f = t.frames
  for (let i = 0; i + 1 < f.length; i++) { const d = f[i + 1].t - f[i].t; if (d > min) console.log(`still ${d.toFixed(1)} s at ${(f[i].t - f[0].t).toFixed(1)} s`) }
}
/** An uncounted caption with the spotlight on `loc` exactly where it is now (no scrolling). */
export async function sayHere(t, text, loc, hold = 1800, pad = 6) {
  // Measure once the last line is said: the page can move while she speaks.
  await t.waitVoice()
  const r = loc ? await settledBox(loc) : null
  await t.layer('spot', r, pad)
  await t.layer('caption', text)
  await new Promise((res) => setTimeout(res, hold))
}
