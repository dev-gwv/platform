import qrcode from 'qrcode-generator'
import type { DesignTheme, FriendRewardType } from '@ipc/contracts'
import { designerFontsReady } from '@/features/designer/fonts'

/**
 * The referral card (owner, 10 Nov): one 1080 × 1080 picture a client
 * forwards to friends on WhatsApp -- the studio's look, who is inviting, what
 * the friend gets for booking, the code and a QR to the studio's page. Drawn
 * on a canvas (as the QR print card is), so it needs no library and comes out
 * the same on every phone.
 */
export const CARD = 1080

export interface CardData {
  studio: string
  /** "Priya & Rahul": who is sending it. */
  from: string
  friendType: FriendRewardType
  friendValue: number
  friendTitle: string | null
  code: string
  link: string
  validUntil: string | null
  /** An optional line under the offer, e.g. "for your wedding photography". */
  line?: string | null
}

const inr = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`

/** What the friend gets, in a few big words. The studio's own title wins. */
export function offerHeadline(type: FriendRewardType, value: number, title: string | null): string {
  if (title?.trim()) return title.trim()
  if (type === 'fixed' && value > 0) return `${inr(value)} off your booking`
  if (type === 'percentage' && value > 0) return `${Math.round(value)}% off your booking`
  if (type === 'free_addon') return 'A special gift with your booking'
  return 'A special welcome when you book'
}

/** "31 Mar 2027" from an ISO date, or null. */
export function validWords(iso: string | null): string | null {
  if (!iso) return null
  const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`)
  return Number.isNaN(d.getTime())
    ? null
    : d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
}

/** The code as people read it: upper case, the slug's own dashes kept. */
export const cardCode = (slug: string) => slug.toUpperCase().slice(0, 28)

/** The message that goes with the picture on WhatsApp. */
export function shareText(d: CardData): string {
  const offer = offerHeadline(d.friendType, d.friendValue, d.friendTitle)
  const valid = validWords(d.validUntil)
  return [
    `${d.from} is inviting you to ${d.studio} ✨`,
    `${offer} when you book through this card.`,
    `Use code ${cardCode(d.code)} or tap: ${d.link}`,
    valid ? `Valid till ${valid}.` : '',
  ]
    .filter(Boolean)
    .join('\n')
}

/** Splits text into lines that fit the width, at most `max` (the last one cut with "…"). */
export function wrap(measure: (s: string) => number, text: string, width: number, max = 3): string[] {
  const out: string[] = []
  let line = ''
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const next = line ? `${line} ${word}` : word
    if (measure(next) > width && line) {
      out.push(line)
      line = word
    } else line = next
  }
  if (line) out.push(line)
  if (out.length > max) {
    const kept = out.slice(0, max)
    let last = kept[max - 1]!
    while (last.length > 1 && measure(`${last}…`) > width) last = last.slice(0, -1)
    kept[max - 1] = `${last.trimEnd()}…`
    return kept
  }
  return out
}

const isScript = (font: string) => /vibes|allura|script/i.test(font)
const face = (font: string) => `'${font}', ${isScript(font) ? 'cursive' : 'Georgia, serif'}`

/** Draws the card on a 1080 × 1080 context. The logo is drawn when given and loaded. */
export function drawReferralCard(
  ctx: CanvasRenderingContext2D,
  d: CardData,
  t: DesignTheme,
  logo?: HTMLImageElement | null,
) {
  const W = CARD
  ctx.textAlign = 'center'
  ctx.textBaseline = 'alphabetic'
  ctx.fillStyle = t.background
  ctx.fillRect(0, 0, W, W)
  // A double frame in the look's accent.
  ctx.strokeStyle = t.accent
  ctx.lineWidth = 4
  ctx.strokeRect(36, 36, W - 72, W - 72)
  ctx.lineWidth = 1.5
  ctx.strokeRect(52, 52, W - 104, W - 104)

  let y = 150
  if (logo && logo.naturalWidth > 0) {
    const h = 110
    const w = Math.min(420, (logo.naturalWidth / logo.naturalHeight) * h)
    ctx.drawImage(logo, (W - w) / 2, 88, w, h)
    y = 250
  } else {
    ctx.fillStyle = t.ink
    ctx.font = `600 34px ${face(t.body)}`
    ctx.fillText(d.studio.toUpperCase().slice(0, 40), W / 2, y)
    y = 225
  }

  ctx.fillStyle = t.accent
  ctx.font = `600 26px ${face(t.body)}`
  ctx.fillText('A GIFT FROM', W / 2, y)
  y += 90
  const script = isScript(t.heading)
  ctx.font = `${script ? 400 : 700} ${script ? 92 : 64}px ${face(t.heading)}`
  for (const l of wrap((s) => ctx.measureText(s).width, d.from, 860, 2)) {
    ctx.fillText(l, W / 2, y)
    y += script ? 88 : 72
  }

  y += 30
  ctx.fillStyle = t.ink
  ctx.font = `700 60px ${face(t.body)}`
  for (const l of wrap((s) => ctx.measureText(s).width, offerHeadline(d.friendType, d.friendValue, d.friendTitle), 880, 3)) {
    ctx.fillText(l, W / 2, y)
    y += 70
  }
  ctx.font = `italic 32px ${face(t.body)}`
  ctx.fillStyle = t.ink
  ctx.globalAlpha = 0.8
  ctx.fillText(d.line?.trim() || `when you book ${d.studio}`, W / 2, y + 4)
  ctx.globalAlpha = 1

  // The code on the left, the QR on the right, on the look's panel colour.
  const boxY = 760
  ctx.fillStyle = t.panel
  ctx.fillRect(110, boxY, W - 220, 230)
  ctx.textAlign = 'left'
  ctx.fillStyle = t.accent
  ctx.font = `600 24px ${face(t.body)}`
  ctx.fillText('YOUR CODE', 150, boxY + 62)
  ctx.fillStyle = t.ink
  // A long code gets a smaller type until it fits beside the QR.
  const code = cardCode(d.code)
  let px = 44
  ctx.font = `700 ${px}px ${face(t.body)}`
  while (px > 24 && ctx.measureText(code).width > 520) {
    px -= 2
    ctx.font = `700 ${px}px ${face(t.body)}`
  }
  let shown = code
  while (shown.length > 4 && ctx.measureText(shown).width > 520) shown = shown.slice(0, -1)
  ctx.fillText(shown === code ? code : `${shown.slice(0, -1)}…`, 150, boxY + 118)
  ctx.font = `26px ${face(t.body)}`
  ctx.globalAlpha = 0.8
  ctx.fillText('Scan the code or tap the link', 150, boxY + 166)
  const valid = validWords(d.validUntil)
  if (valid) ctx.fillText(`Valid till ${valid}`, 150, boxY + 202)
  ctx.globalAlpha = 1

  const qr = qrcode(0, 'M')
  qr.addData(d.link)
  qr.make()
  const n = qr.getModuleCount()
  const size = 190
  const qx = W - 110 - size - 20
  const qy = boxY + 20
  ctx.fillStyle = '#FFFFFF'
  ctx.fillRect(qx - 10, qy - 10, size + 20, size + 20)
  ctx.fillStyle = '#111111'
  const cell = size / n
  for (let r = 0; r < n; r++)
    for (let c = 0; c < n; c++) if (qr.isDark(r, c)) ctx.fillRect(qx + c * cell, qy + r * cell, Math.ceil(cell), Math.ceil(cell))
  ctx.textAlign = 'center'
}

function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = () => resolve(null)
    img.src = src
    setTimeout(() => resolve(null), 6000)
  })
}

/** The card as a PNG, fonts and logo waited for (a logo that will not load is left off). */
export async function renderReferralCard(d: CardData, t: DesignTheme, logoUrl?: string | null): Promise<Blob> {
  const canvas = document.createElement('canvas')
  canvas.width = CARD
  canvas.height = CARD
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('This browser cannot draw the card.')
  try {
    await designerFontsReady()
    await Promise.all([
      document.fonts.load(`92px '${t.heading}'`),
      document.fonts.load(`700 60px '${t.body}'`),
      document.fonts.load(`italic 32px '${t.body}'`),
    ])
  } catch {
    /* the fallback font is drawn instead */
  }
  const logo = logoUrl ? await loadImage(logoUrl) : null
  try {
    drawReferralCard(ctx, d, t, logo)
    return await toPng(canvas)
  } catch {
    // A logo from another site taints the canvas: draw it again without.
    drawReferralCard(ctx, d, t, null)
    return await toPng(canvas)
  }
}

const toPng = (canvas: HTMLCanvasElement) =>
  new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('The card could not be made.'))), 'image/png'),
  )

/**
 * Into WhatsApp with the picture on a phone (the share sheet); elsewhere the
 * picture is saved and WhatsApp opens with the message. Answers which.
 */
export async function shareCard(blob: Blob, filename: string, text: string): Promise<'shared' | 'saved'> {
  const file = new File([blob], filename, { type: 'image/png' })
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean }
  if (nav.share && nav.canShare?.({ files: [file] })) {
    try {
      await nav.share({ files: [file], text })
      return 'shared'
    } catch {
      /* cancelled: fall through to saving it */
    }
  }
  saveBlob(blob, filename)
  return 'saved'
}

export function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
