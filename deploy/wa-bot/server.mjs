// The support group bot (0280): a spare WhatsApp number, linked like WhatsApp
// Web, that posts support call alerts into ONE group the platform admin picks.
//
// Why it is built the way it is (the developer, 24 Oct: "Meta bans APIs very
// quickly"; this bot is not Meta's official API, so it must look and behave
// like a careful person, not a broadcaster):
//   * it only ever posts to groups (@g.us) it is a member of -- never to a
//     person, never to a list;
//   * one post per key (the API's dedupe key), kept across restarts;
//   * at least MIN_GAP_MS between posts plus a random pause, a "typing…" moment
//     before each, and hard hourly and daily ceilings that hold even if the
//     API asked for more;
//   * it never reads, answers or marks anything: incoming messages are not
//     even subscribed to, and it does not show itself online;
//   * it listens only on the compose network (no published port) and every
//     call but /health needs WA_BOT_SECRET.
//
// Endpoints: GET /health, GET /status, GET /groups, POST /send {jid,text,key},
// POST /logout. Data (the link and the send log) lives in WA_BOT_DATA.

import http from 'node:http'
import fs from 'node:fs/promises'
import path from 'node:path'
import { timingSafeEqual } from 'node:crypto'
import makeWASocket, { Browsers, DisconnectReason, fetchLatestBaileysVersion, useMultiFileAuthState } from '@whiskeysockets/baileys'
import pino from 'pino'

const PORT = Number(process.env.PORT || 3001)
const SECRET = process.env.WA_BOT_SECRET || ''
const DATA = process.env.WA_BOT_DATA || '/data'
const AUTH_DIR = path.join(DATA, 'auth')
const LOG_FILE = path.join(DATA, 'sent.json')
// Ceilings that hold whatever the API asks. The Platform page's own caps sit under these.
const HOURLY_CEILING = Number(process.env.WA_BOT_HOURLY_CAP || 30)
const DAILY_CEILING = Number(process.env.WA_BOT_DAILY_CAP || 150)
const MIN_GAP_MS = 5_000

const logger = pino({ level: process.env.WA_BOT_LOG_LEVEL || 'warn' })

let sock = null
let status = { state: 'connecting', qr: null, me: null }
let restartTimer = null
let backoffMs = 2_000

// ── the send log: caps and "already sent" survive a restart ──────────────
/** @type {{ at: number, key: string, id: string }[]} */
let sent = []
async function loadLog() {
  try {
    sent = JSON.parse(await fs.readFile(LOG_FILE, 'utf8'))
  } catch {
    sent = []
  }
}
async function saveLog() {
  const dayAgo = Date.now() - 48 * 3600_000
  sent = sent.filter((s) => s.at > dayAgo).slice(-2000)
  await fs.mkdir(DATA, { recursive: true })
  await fs.writeFile(LOG_FILE, JSON.stringify(sent))
}
const sentSince = (ms) => sent.filter((s) => s.at > Date.now() - ms).length

// ── the WhatsApp link ─────────────────────────────────────────────────────
async function start() {
  clearTimeout(restartTimer)
  await fs.mkdir(AUTH_DIR, { recursive: true })
  const { state: auth, saveCreds } = await useMultiFileAuthState(AUTH_DIR)
  const latest = await fetchLatestBaileysVersion().catch(() => null)
  sock = makeWASocket({
    auth,
    ...(latest?.version ? { version: latest.version } : {}),
    logger,
    browser: Browsers.ubuntu('Studio AutoPilot'),
    markOnlineOnConnect: false,
    // No full history; the small initial sync stays on, because Baileys needs
    // it for its number mappings and warns that sessions break without it.
    syncFullHistory: false,
    generateHighQualityLinkPreview: false,
  })
  sock.ev.on('creds.update', saveCreds)
  sock.ev.on('connection.update', async (u) => {
    if (u.qr) status = { state: 'qr', qr: u.qr, me: null }
    if (u.connection === 'open') {
      backoffMs = 2_000
      const me = String(sock.user?.id ?? '').split(':')[0].split('@')[0] || null
      status = { state: 'open', qr: null, me }
      logger.warn({ me }, 'linked')
    }
    if (u.connection === 'close') {
      const code = u.lastDisconnect?.error?.output?.statusCode
      if (code === DisconnectReason.loggedOut) {
        // Unlinked from the phone (or by /logout): forget the link and show a fresh QR.
        status = { state: 'logged_out', qr: null, me: null }
        await fs.rm(AUTH_DIR, { recursive: true, force: true })
        restartTimer = setTimeout(() => void start(), 2_000)
      } else if (code === DisconnectReason.restartRequired || !auth.creds.me) {
        // Just after a scan WhatsApp asks for one restart; and while no phone is
        // linked, an unscanned QR simply expires. Either way come straight back,
        // so the Platform page always has a fresh QR instead of "Connecting…".
        status = { state: 'connecting', qr: null, me: null }
        restartTimer = setTimeout(() => void start(), 3_000)
      } else {
        // A linked session dropped: back off, so a WhatsApp outage is not hammered.
        status = { ...status, state: 'connecting', qr: null }
        restartTimer = setTimeout(() => void start(), backoffMs)
        backoffMs = Math.min(backoffMs * 2, 5 * 60_000)
      }
    }
  })
}

// ── posting ───────────────────────────────────────────────────────────────
let lastPostAt = 0
let queue = Promise.resolve()
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** One post, one at a time, never faster than the gap. */
function post(jid, text, key) {
  const run = async () => {
    const already = sent.find((s) => s.key === key)
    if (already) return { status: 200, body: { id: already.id, duplicate: true } }
    if (status.state !== 'open' || !sock) return { status: 503, body: { error: 'The bot is not linked.', retry: false } }
    if (sentSince(3600_000) >= HOURLY_CEILING || sentSince(24 * 3600_000) >= DAILY_CEILING) {
      return { status: 429, body: { error: 'The bot has reached its ceiling for now.', retry: true } }
    }
    let meta
    try {
      meta = await sock.groupMetadata(jid)
    } catch {
      return { status: 403, body: { error: 'The bot is not in that group.', retry: false } }
    }
    const meDigits = status.me
    if (meDigits && !meta.participants.some((p) => String(p.id).startsWith(meDigits) || String(p.phoneNumber ?? '').startsWith(meDigits))) {
      return { status: 403, body: { error: 'The bot is not in that group.', retry: false } }
    }
    const wait = lastPostAt + MIN_GAP_MS + Math.floor(Math.random() * 4_000) - Date.now()
    if (wait > 0) await sleep(wait)
    try {
      await sock.sendPresenceUpdate('composing', jid).catch(() => {})
      await sleep(1_000 + Math.floor(Math.random() * 2_000))
      await sock.sendPresenceUpdate('paused', jid).catch(() => {})
      const res = await sock.sendMessage(jid, { text })
      lastPostAt = Date.now()
      const id = res?.key?.id ?? ''
      sent.push({ at: lastPostAt, key, id })
      await saveLog()
      return { status: 200, body: { id } }
    } catch (err) {
      logger.warn({ err: String(err?.message ?? err) }, 'post failed')
      return { status: 502, body: { error: `WhatsApp did not take it: ${String(err?.message ?? err).slice(0, 200)}`, retry: true } }
    }
  }
  const p = queue.then(run, run)
  queue = p.catch(() => {})
  return p
}

// ── HTTP, on the compose network only ─────────────────────────────────────
function authorised(req) {
  if (!SECRET) return false
  const given = Buffer.from(String(req.headers['x-bot-secret'] ?? ''))
  const want = Buffer.from(SECRET)
  return given.length === want.length && timingSafeEqual(given, want)
}

async function readJson(req) {
  let raw = ''
  for await (const chunk of req) {
    raw += chunk
    if (raw.length > 16_000) throw new Error('too large')
  }
  return JSON.parse(raw || '{}')
}

function reply(res, code, body) {
  res.writeHead(code, { 'content-type': 'application/json' })
  res.end(JSON.stringify(body))
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', 'http://bot')
    if (url.pathname === '/health') return reply(res, 200, { ok: true, state: status.state })
    if (!authorised(req)) return reply(res, 401, { error: 'unauthorised' })

    if (req.method === 'GET' && url.pathname === '/status') {
      return reply(res, 200, { ...status, sent_last_hour: sentSince(3600_000), sent_today: sentSince(24 * 3600_000) })
    }
    if (req.method === 'GET' && url.pathname === '/groups') {
      if (status.state !== 'open' || !sock) return reply(res, 503, { error: 'The bot is not linked.' })
      const groups = await sock.groupFetchAllParticipating()
      return reply(
        res,
        200,
        Object.values(groups)
          .map((g) => ({ jid: g.id, name: g.subject ?? '', size: g.participants?.length ?? 0 }))
          .sort((a, b) => a.name.localeCompare(b.name)),
      )
    }
    if (req.method === 'POST' && url.pathname === '/send') {
      const { jid, text, key } = await readJson(req)
      if (typeof jid !== 'string' || !/^[\d-]+@g\.us$/.test(jid)) return reply(res, 400, { error: 'Only groups.', retry: false })
      if (typeof text !== 'string' || !text.trim() || text.length > 1500) return reply(res, 400, { error: 'Empty or too long.', retry: false })
      if (typeof key !== 'string' || !key) return reply(res, 400, { error: 'A key is needed.', retry: false })
      const r = await post(jid, text, key)
      return reply(res, r.status, r.body)
    }
    if (req.method === 'POST' && url.pathname === '/logout') {
      await sock?.logout().catch(() => {})
      await fs.rm(AUTH_DIR, { recursive: true, force: true })
      status = { state: 'logged_out', qr: null, me: null }
      restartTimer = setTimeout(() => void start(), 1_000)
      return reply(res, 200, { ok: true })
    }
    return reply(res, 404, { error: 'not found' })
  } catch (err) {
    logger.error({ err: String(err?.message ?? err) }, 'request failed')
    return reply(res, 500, { error: 'Something went wrong.', retry: true })
  }
})

await loadLog()
server.listen(PORT, '0.0.0.0', () => logger.warn({ port: PORT }, 'wa-bot listening'))
if (!SECRET) logger.error('WA_BOT_SECRET is not set: every call will be refused.')
void start()
