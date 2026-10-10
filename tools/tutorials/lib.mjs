// Tutorial recorder: drives the real app in Chromium and captures sharp
// frames through the DevTools screencast, with an in-page layer for the
// teaching: a branded title card, a spotlight that dims everything but the
// thing being explained, a smooth pointer with a click ripple, a caption pill
// with a step counter, and a closing card. build() turns the frames into an
// H.264 MP4 (and a VP9 WebM) with the music bed under it, plus a poster.
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? '/opt/node22/lib/node_modules/playwright/index.mjs')
import { mkdirSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { HI as HI_BASE } from './hi.mjs'
import { VO as VO_BASE } from './vo.mjs'
import { readdirSync } from 'node:fs'
// A tutorial may also carry its script in lines/<key>.mjs: export const VO = { <key>: {...} }, HI = { 'caption': 'हिन्दी' }.
const HI = { ...HI_BASE }
const VO = { ...VO_BASE }
{
  const dir = new URL('./lines/', import.meta.url)
  let files = []
  try { files = readdirSync(dir).filter((f) => f.endsWith('.mjs')) } catch { /* no extra lines */ }
  for (const f of files) {
    const m = await import(new URL(f, dir))
    Object.assign(HI, m.HI ?? {})
    Object.assign(VO, m.VO ?? {})
  }
}
import { say } from './tts/say.mjs'

/** TUT_LANG=hi records the same tutorial with Hindi captions into final/hi/. */
export const LANG = process.env.TUT_LANG === 'hi' ? 'hi' : 'en'
export function tr(text) {
  if (LANG === 'en' || text == null || text === '') return text
  const t = HI[text]
  if (!t) throw new Error('No Hindi caption for: ' + text)
  return t
}

export const API = process.env.API ?? 'http://localhost:8791'
export const WEB = process.env.WEB ?? 'http://localhost:5199'
const FF = process.env.FFMPEG ?? 'ffmpeg'
const HERE = new URL('.', import.meta.url).pathname
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

export async function api(path, { token, method = 'GET', body } = {}) {
  const r = await fetch(API + path, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  })
  return { status: r.status, json: await r.json().catch(() => ({})) }
}
export const phone = () => `98${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`

/** A fresh studio with its owner signed in by API; setup closed unless asked. */
export async function studio({ name = 'Mehta Studios', owner = 'Asha Mehta', skipSetup = true } = {}) {
  const n = Math.random().toString(36).slice(2, 7)
  const email = `tut-${n}@example.com`
  const password = 'Tutorial-pass-1'
  const reg = await api('/auth/register', { method: 'POST', body: { company_name: name, admin_name: owner, email, phone: phone(), password } })
  const token = reg.json.session?.access_token
  if (!token) throw new Error('register failed ' + JSON.stringify(reg.json))
  if (skipSetup) await api('/settings/company/setup', { token, method: 'PATCH', body: { action: 'skip' } })
  // The how-to cards would show inside the recording itself: close them.
  const keys = ['team', 'team-bulk', 'client', 'project', 'project-client', 'project-shoots', 'project-deliverables', 'project-billing']
  await api('/auth/hints/learn', { token, method: 'PUT', body: { value: { watched: [], closed: keys } } })
  await api('/auth/hints/guide', { token, method: 'PUT', body: { value: { shown: 1, closed: true } } })
  return { email, password, token }
}

// ── the in-page teaching layer ─────────────────────────────────────────
function layerInit() {
  if (window.__tut) return
  const NAVY = '#1b2a4a', GOLD = '#f2a618'
  const font = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, 'Noto Sans Devanagari', sans-serif"
  const css = document.createElement('style')
  css.textContent = `
    #tut-root{position:fixed;inset:0;pointer-events:none;z-index:2147483646;font-family:${font}}
    #tut-spot{position:fixed;border-radius:14px;box-shadow:0 0 0 9999px rgba(15,23,42,.42);outline:3px solid ${GOLD};outline-offset:3px;
      transition:all .55s cubic-bezier(.4,0,.2,1);opacity:0}
    #tut-cap{position:fixed;left:50%;bottom:34px;transform:translate(-50%,24px);opacity:0;transition:all .45s cubic-bezier(.2,.8,.2,1);
      background:${NAVY};color:#fff;border-radius:999px;padding:14px 26px 14px 14px;display:flex;align-items:center;gap:14px;
      box-shadow:0 12px 32px rgba(15,23,42,.35);font-size:22px;font-weight:600;letter-spacing:-.01em;white-space:nowrap;max-width:92vw}
    #tut-cap.on{opacity:1;transform:translate(-50%,0)}
    #tut-cap b{background:${GOLD};color:${NAVY};border-radius:999px;font-size:15px;font-weight:800;padding:5px 11px;font-variant-numeric:tabular-nums}
    #tut-ptr{position:fixed;left:0;top:0;width:30px;height:30px;transition:transform .7s cubic-bezier(.45,0,.25,1);opacity:0;filter:drop-shadow(0 3px 5px rgba(0,0,0,.35))}
    .tut-ripple{position:fixed;width:16px;height:16px;margin:-8px 0 0 -8px;border-radius:50%;border:3px solid ${GOLD};animation:tut-r .6s ease-out forwards}
    @keyframes tut-r{to{transform:scale(4.2);opacity:0}}
    #tut-card{position:fixed;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:18px;text-align:center;
      background:radial-gradient(1200px 600px at 50% 40%,#24375f 0%,${NAVY} 60%,#111c33 100%);color:#fff;opacity:0;transition:opacity .6s ease}
    #tut-card.on{opacity:1}
    #tut-card .wm{font-size:30px;font-weight:800;letter-spacing:-.02em}
    #tut-card .wm span{color:${GOLD}}
    #tut-card h1{margin:0;font-size:54px;font-weight:800;letter-spacing:-.03em;max-width:80vw;line-height:1.1}
    #tut-card p{margin:0;font-size:24px;color:#c9d3e8;max-width:70vw}
    #tut-card .pill{margin-top:8px;border:1.5px solid rgba(242,166,24,.6);color:${GOLD};border-radius:999px;padding:8px 18px;font-size:18px;font-weight:700}
  `
  const mount = () => {
    if (document.getElementById('tut-root')) return
    (document.head || document.documentElement).appendChild(css)
    const root = document.createElement('div')
    root.id = 'tut-root'
    root.innerHTML = '<div id="tut-spot"></div><div id="tut-cap"><b></b><span></span></div>' +
      '<svg id="tut-ptr" viewBox="0 0 24 24"><path d="M4 2l15 11-6.5 1.2 3.8 7.3-2.6 1.3-3.8-7.4L4 20z" fill="#fff" stroke="#1b2a4a" stroke-width="1.6" stroke-linejoin="round"/></svg>' +
      '<div id="tut-card"></div>';
    (document.body || document.documentElement).appendChild(root)
  }
  // A tutorial never shows the owner's confirm-email strip: it is not what is being taught.
  const hideStrip = () => {
    for (const el of document.querySelectorAll('div,section,aside')) {
      if (el.childElementCount < 8 && /^\s*Confirm your email/.test(el.textContent || '') && el.offsetHeight < 90) el.style.display = 'none'
    }
  }
  const watch = () => { try { new MutationObserver(hideStrip).observe(document.body, { childList: true, subtree: true }); hideStrip() } catch { /* the page is still loading */ } }
  if (document.body) watch(); else document.addEventListener('DOMContentLoaded', watch)
  const $ = (id) => { mount(); return document.getElementById(id) }
  let px = 0, py = 0
  window.__tut = {
    caption(text, step, total) {
      const c = $('tut-cap')
      if (!text) { c.classList.remove('on'); return }
      const b = c.querySelector('b')
      b.textContent = step ? step + ' / ' + total : ''
      b.style.display = step ? '' : 'none'
      c.querySelector('span').textContent = text
      c.classList.add('on')
    },
    spot(r, pad = 8) {
      const s = $('tut-spot')
      if (!r) { s.style.opacity = 0; return }
      s.style.left = (r.x - pad) + 'px'; s.style.top = (r.y - pad) + 'px'
      s.style.width = (r.width + pad * 2) + 'px'; s.style.height = (r.height + pad * 2) + 'px'
      s.style.opacity = 1
    },
    pointer(x, y, ms = 700) {
      const p = $('tut-ptr')
      if (p.style.opacity !== '1') { p.style.transitionDuration = '0ms'; p.style.transform = 'translate(' + (window.innerWidth * 0.62) + 'px,' + (window.innerHeight * 0.6) + 'px)'; p.getBoundingClientRect() }
      p.style.opacity = 1
      p.style.transitionDuration = ms + 'ms'
      p.style.transform = 'translate(' + (x - 4) + 'px,' + (y - 2) + 'px)'
      px = x; py = y
    },
    hidePointer() { $('tut-ptr').style.opacity = 0 },
    ripple() {
      const d = document.createElement('div'); d.className = 'tut-ripple'
      d.style.left = px + 'px'; d.style.top = py + 'px'
      $('tut-root').appendChild(d); setTimeout(() => d.remove(), 700)
    },
    card(html) {
      const c = $('tut-card')
      if (!html) { c.classList.remove('on'); return }
      c.innerHTML = html; c.classList.add('on')
    },
  }
}

/** A locator's box once it has stopped moving (smooth scrolls, dialogs sliding in), or null. */
export async function settledBox(loc, { tries = 8, gap = 150 } = {}) {
  let prev = await loc.boundingBox({ timeout: 3000 }).catch(() => null)
  for (let i = 0; prev && i < tries; i++) {
    await sleep(gap)
    const r = await loc.boundingBox({ timeout: 1000 }).catch(() => null)
    if (!r) return prev
    if (Math.abs(r.x - prev.x) < 1 && Math.abs(r.y - prev.y) < 1 && Math.abs(r.width - prev.width) < 1 && Math.abs(r.height - prev.height) < 1) return r
    prev = r
  }
  return prev
}

export class Tutorial {
  constructor(slug, { title, subtitle, steps }) {
    this.slug = slug
    this.title = tr(title)
    this.subtitle = tr(subtitle)
    this.total = steps
    this.n = 0
    this.dir = join(HERE, 'out', LANG === 'hi' ? slug + '-hi' : slug)
    rmSync(this.dir, { recursive: true, force: true })
    mkdirSync(join(this.dir, 'frames'), { recursive: true })
    this.frames = []
    // The voice-over: one clip per title, step and end card (vo.mjs). Each
    // clip finishes before the next caption appears, so voice and screen
    // never drift apart.
    this.vo = VO[slug] ?? null
    this.cues = []
    this.busyUntil = 0
  }

  async waitVoice() {
    const ms = (this.busyUntil - Date.now() / 1000) * 1000
    if (ms > 0) await sleep(ms)
  }

  /** Speak one line now; returns its length in seconds. */
  async speak(line) {
    if (!line) return 0
    await this.waitVoice()
    const c = await say(line[LANG], LANG)
    this.cues.push({ t: Date.now() / 1000, file: c.file, secs: c.secs })
    this.busyUntil = Date.now() / 1000 + c.secs + 0.35
    return c.secs
  }

  async open({ email, password }) {
    // Make every clip before the screen starts, so no line waits on the network.
    if (this.vo) for (const l of [this.vo.title, ...this.vo.steps, this.vo.end]) if (l) await say(l[LANG], LANG)
    this.browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })
    this.ctx = await this.browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1.5 })
    await this.ctx.addInitScript(layerInit)
    // A tutorial never shows a cookie or confirm-email strip it does not teach.
    this.page = await this.ctx.newPage()
    this.page.on('pageerror', (e) => console.log('pageerror', e.message))
    await this.page.goto(WEB + '/login')
    await this.page.locator('input[type=email]').fill(email)
    await this.page.locator('input[type=password]').fill(password)
    await this.page.getByRole('button', { name: /sign in/i }).click()
    await this.page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 20000 })
    await sleep(1500)
    return this.page
  }

  /** Start capturing. Frames arrive on change; each keeps its own time. */
  async start() {
    this.cdp = await this.ctx.newCDPSession(this.page)
    this.cdp.on('Page.screencastFrame', async (f) => {
      const i = this.frames.length
      const file = join(this.dir, 'frames', `${String(i).padStart(6, '0')}.jpg`)
      writeFileSync(file, Buffer.from(f.data, 'base64'))
      this.frames.push({ file, t: f.metadata.timestamp })
      try { await this.cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }) } catch { /* the screencast already stopped */ }
    })
    await this.cdp.send('Page.startScreencast', { format: 'jpeg', quality: 92, maxWidth: 1920, maxHeight: 1080, everyNthFrame: 1 })
    this.t0 = Date.now() / 1000
  }

  async stop() {
    await this.waitVoice()
    await sleep(300)
    // A still screen sends no frames: hold the last one until now, so the
    // video lasts as long as the voice does.
    const last = this.frames[this.frames.length - 1]
    if (last) this.frames.push({ file: last.file, t: Date.now() / 1000 })
    await this.cdp.send('Page.stopScreencast')
    this.tEnd = Date.now() / 1000
    await this.browser.close()
  }

  async layer(fn, ...args) {
    // A caption never changes, or goes, while she is still saying it.
    if (fn === 'caption') await this.waitVoice()
    if (fn === 'caption' && typeof args[0] === 'string') args = [tr(args[0]), ...args.slice(1)]
    return this.page.evaluate(([fn, args]) => window.__tut && window.__tut[fn](...args), [fn, args])
  }

  async goto(path) {
    await this.page.goto(WEB + path)
    await this.page.waitForLoadState('networkidle').catch(() => {})
    await sleep(900)
  }

  async titleCard(ms = 2600) {
    await this.layer('card', `<div class="wm">Studio<span>AutoPilot</span></div><h1>${this.title}</h1>${this.subtitle ? `<p>${this.subtitle}</p>` : ''}<div class="pill">${LANG === 'hi' ? `${this.total} आसान स्टेप · एक मिनट से कम` : `${this.total} quick steps · under a minute`}</div>`)
    const secs = await this.speak(this.vo?.title)
    await sleep(Math.max(ms, secs * 1000 + 400))
    await this.layer('card', null)
    await sleep(700)
  }

  async endCard(line, ms = 2800) {
    await this.waitVoice()
    await this.layer('caption', null)
    await this.layer('spot', null)
    await this.layer('hidePointer')
    await this.layer('card', `<div class="wm">Studio<span>AutoPilot</span></div><h1>${tr(line)}</h1><div class="pill">studioautopilot.in</div>`)
    const secs = await this.speak(this.vo?.end)
    await sleep(Math.max(ms, secs * 1000 + 900))
  }

  /** Next step: caption with its counter, spotlight on the target. */
  async step(text, target, { pad = 8, hold = 1600 } = {}) {
    // The spotlight moves on only once the last line has been said.
    await this.waitVoice()
    this.n += 1
    const loc = typeof target === 'string' ? this.page.locator(target).first() : target
    if (loc) {
      await loc.scrollIntoViewIfNeeded({ timeout: 3000 }).catch(() => {})
      await sleep(100)
      const r = await settledBox(loc)
      if (!r) console.log(`WARN step ${this.n} "${text}": nothing to spotlight`)
      await this.layer('spot', r, pad)
      if (r) await this.layer('pointer', r.x + Math.min(r.width * 0.5, 120), r.y + r.height * 0.5)
    } else {
      await this.layer('spot', null)
    }
    await this.layer('caption', text, this.n, this.total)
    await this.warnToasts(`step ${this.n}`)
    await this.speak(this.vo?.steps[this.n - 1])
    await sleep(hold)
    return loc
  }

  /** Log any error toast on screen: a tutorial never shows one. */
  async warnToasts(where) {
    const bad = await this.page.evaluate(() => [...document.querySelectorAll('[data-sonner-toast][data-type="error"]')].map((e) => e.textContent)).catch(() => [])
    for (const b of bad) console.log(`WARN ${where}: error toast "${b}"`)
  }

  /** Say something without counting a step (an aside, a result). */
  async say(text, target, { pad = 8, hold = 1500 } = {}) {
    await this.waitVoice()
    const loc = typeof target === 'string' ? this.page.locator(target).first() : target
    if (loc) {
      await loc.scrollIntoViewIfNeeded({ timeout: 3000 }).catch(() => {})
      const r = await settledBox(loc)
      if (!r) console.log(`WARN say "${text}": nothing to spotlight`)
      await this.layer('spot', r, pad)
    } else await this.layer('spot', null)
    await this.layer('caption', text)
    await this.warnToasts(`say "${text}"`)
    await sleep(hold)
  }

  async point(loc) {
    const l = typeof loc === 'string' ? this.page.locator(loc).first() : loc
    await l.scrollIntoViewIfNeeded({ timeout: 3000 }).catch(() => {})
    const r = await l.boundingBox({ timeout: 3000 }).catch(() => null)
    if (r) await this.layer('pointer', r.x + Math.min(r.width / 2, 60), r.y + r.height / 2)
    await sleep(750)
    return l
  }

  async click(loc, { after = 900 } = {}) {
    const l = await this.point(loc)
    await this.layer('ripple')
    await sleep(180)
    await l.click()
    await sleep(after)
  }

  async type(loc, text, { delay = 55 } = {}) {
    const l = await this.point(loc)
    await this.layer('ripple')
    await l.click()
    await l.pressSequentially(text, { delay })
    await sleep(350)
  }

  /** Frames to MP4 + WebM with the music bed, and a poster. */
  build({ poster = 0.35 } = {}) {
    // CDP can deliver frames out of order; a backward gap would stretch the video past the music.
    this.frames.sort((a, b) => a.t - b.t)
    const list = []
    const fr = this.frames
    for (let i = 0; i < fr.length; i++) {
      const d = i + 1 < fr.length ? fr[i + 1].t - fr[i].t : 1.2
      list.push(`file '${fr[i].file}'`, `duration ${Math.max(0.001, d).toFixed(4)}`)
    }
    list.push(`file '${fr[fr.length - 1].file}'`)
    const listFile = join(this.dir, 'frames.txt')
    writeFileSync(listFile, list.join('\n'))
    const dur = fr[fr.length - 1].t - fr[0].t + 1.2
    const silent = join(this.dir, 'silent.mp4')
    execFileSync(FF, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', listFile,
      '-vf', 'scale=1920:1080:flags=lanczos,fps=30,format=yuv420p', '-c:v', 'libx264', '-preset', 'slow', '-crf', '23', '-tune', 'stillimage', '-movflags', '+faststart', silent])
    const bed = join(HERE, 'bed.ogg')
    const outDir = join(HERE, 'final', ...(LANG === 'hi' ? ['hi'] : []))
    mkdirSync(outDir, { recursive: true })
    const mp4 = join(outDir, `${this.slug}.mp4`)
    // Music under the voice: soft when she speaks, the voice laid at each cue.
    const fmt = 'aformat=sample_rates=44100:channel_layouts=stereo'
    const cues = this.cues.map((c) => ({ ...c, at: Math.max(0, c.t - fr[0].t) }))
    const music = cues.length ? 0.1 : 0.32
    let audio = `[1:a]atrim=0:${dur.toFixed(2)},${fmt},volume=${music},afade=t=in:d=1.5,afade=t=out:st=${Math.max(0, dur - 2.5).toFixed(2)}:d=2.5[m]`
    cues.forEach((c, i) => { const ms = Math.round(c.at * 1000); audio += `;[${i + 2}:a]${fmt},volume=1.6,adelay=${ms}|${ms}[v${i}]` })
    audio += cues.length ? `;[m]${cues.map((_, i) => `[v${i}]`).join('')}amix=inputs=${cues.length + 1}:normalize=0:duration=first[a]` : ';[m]anull[a]'
    execFileSync(FF, ['-hide_banner', '-loglevel', 'error', '-y', '-i', silent, '-i', bed, ...cues.flatMap((c) => ['-i', c.file]), '-filter_complex', audio,
      '-map', '0:v', '-map', '[a]', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '128k', '-shortest', '-movflags', '+faststart', mp4])
    const webm = null
    execFileSync(FF, ['-hide_banner', '-loglevel', 'error', '-y', '-ss', (dur * poster).toFixed(2), '-i', silent, '-frames:v', '1',
      '-vf', 'scale=1280:720', '-q:v', '3', join(outDir, `${this.slug}.jpg`)])
    if (!existsSync(mp4)) throw new Error('no mp4')
    console.log(`built ${this.slug}: ${dur.toFixed(1)} s, ${fr.length} frames`)
    return { mp4, webm, dur }
  }
}
