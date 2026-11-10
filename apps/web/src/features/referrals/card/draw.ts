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

/**
 * The gift code as people read it: the six characters every slug ends with
 * (0067: name + "-" + 6 random), upper case, so it can be said on a call. An
 * older slug without that ending shows whole, cut to fit.
 */
export function cardCode(slug: string): string {
  const tail = slug.split('-').pop() ?? ''
  return (/^[a-z0-9]{6}$/i.test(tail) ? tail : slug).toUpperCase().slice(0, 16)
}

/** The message that goes with the picture on WhatsApp. */
export function shareText(d: CardData): string {
  const offer = offerHeadline(d.friendType, d.friendValue, d.friendTitle)
  const valid = validWords(d.validUntil)
  return [
    `${d.from} is inviting you to ${d.studio} ✨`,
    `${offer} when you book through this card.`,
    `Tap to claim it: ${d.link}`,
    `Gift code: ${cardCode(d.code)}`,
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

/** A hex colour lightened or darkened toward white/black by `amount` (−1…1). */
function shade(hex: string, amount: number): string {
  const n = parseInt(hex.slice(1), 16)
  const mix = (c: number) => Math.round(amount >= 0 ? c + (255 - c) * amount : c * (1 + amount))
  const r = mix((n >> 16) & 255)
  const g = mix((n >> 8) & 255)
  const b = mix(n & 255)
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

/** A thin line with a small diamond in the middle, in the accent. */
function ornament(ctx: CanvasRenderingContext2D, cx: number, y: number, half: number, colour: string) {
  ctx.strokeStyle = colour
  ctx.fillStyle = colour
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.moveTo(cx - half, y)
  ctx.lineTo(cx - 18, y)
  ctx.moveTo(cx + 18, y)
  ctx.lineTo(cx + half, y)
  ctx.stroke()
  ctx.beginPath()
  ctx.moveTo(cx, y - 9)
  ctx.lineTo(cx + 9, y)
  ctx.lineTo(cx, y + 9)
  ctx.lineTo(cx - 9, y)
  ctx.closePath()
  ctx.fill()
}

/**
 * Draws the card on a 1080 × 1080 context (owner audit, 10 Nov: the first
 * card was plain and half empty). Top to bottom: the studio's logo or name;
 * "A GIFT FROM" and who sends it, in the look's script; the offer in a band
 * of the accent colour so it is the first thing read; "when you book …";
 * then a panel with the three steps to claim it, the valid-till date and the
 * gift code beside a large QR. The logo is drawn when given and loaded.
 */
export function drawReferralCard(
  ctx: CanvasRenderingContext2D,
  d: CardData,
  t: DesignTheme,
  logo?: HTMLImageElement | null,
) {
  const W = CARD
  const measure = (s: string) => ctx.measureText(s).width
  ctx.textAlign = 'center'
  ctx.textBaseline = 'alphabetic'

  // Ground: the look's colour with a soft glow of its panel at the top.
  ctx.fillStyle = t.background
  ctx.fillRect(0, 0, W, W)
  const glow = ctx.createRadialGradient(W / 2, 120, 40, W / 2, 120, 760)
  glow.addColorStop(0, `${t.panel}cc`)
  glow.addColorStop(1, `${t.panel}00`)
  ctx.fillStyle = glow
  ctx.fillRect(0, 0, W, W)
  ctx.strokeStyle = t.accent
  ctx.lineWidth = 3
  roundRect(ctx, 32, 32, W - 64, W - 64, 28)
  ctx.stroke()

  // The studio.
  let y: number
  if (logo && logo.naturalWidth > 0) {
    const h = 96
    const w = Math.min(380, (logo.naturalWidth / logo.naturalHeight) * h)
    ctx.drawImage(logo, (W - w) / 2, 76, w, h)
    y = 228
  } else {
    ctx.fillStyle = t.ink
    ctx.font = `600 34px ${face(t.body)}`
    ctx.fillText(d.studio.toUpperCase().slice(0, 40).split('').join('\u200A'), W / 2, 136)
    y = 200
  }

  // Who it is from.
  ctx.fillStyle = t.accent
  ctx.font = `700 24px ${face(t.body)}`
  ctx.fillText('A  GIFT  FROM', W / 2, y)
  const script = isScript(t.heading)
  ctx.font = `${script ? 400 : 700} ${script ? 96 : 66}px ${face(t.heading)}`
  y += script ? 92 : 78
  for (const l of wrap(measure, d.from, 860, 2)) {
    ctx.fillText(l, W / 2, y)
    y += script ? 86 : 70
  }
  ornament(ctx, W / 2, y - 18, 150, t.accent)

  // The offer, on a band of the accent.
  const offer = offerHeadline(d.friendType, d.friendValue, d.friendTitle)
  let px = 66
  ctx.font = `700 ${px}px ${face(t.body)}`
  let lines = wrap(measure, offer, 800, 2)
  while (px > 46 && (lines.length > 2 || lines.some((l) => measure(l) > 800))) {
    px -= 4
    ctx.font = `700 ${px}px ${face(t.body)}`
    lines = wrap(measure, offer, 800, 2)
  }
  const lh = Math.round(px * 1.15)
  const bandTop = y + 22
  const bandH = lines.length * lh + 64
  ctx.fillStyle = t.accent
  roundRect(ctx, 92, bandTop, W - 184, bandH, 26)
  ctx.fill()
  ctx.fillStyle = t.background
  let ly = bandTop + 32 + lh * 0.8
  for (const l of lines) {
    ctx.fillText(l, W / 2, ly)
    ly += lh
  }
  ctx.fillStyle = t.ink
  ctx.globalAlpha = 0.85
  ctx.font = `italic 34px ${face(t.body)}`
  ctx.fillText(d.line?.trim() || `when you book ${d.studio}`, W / 2, bandTop + bandH + 56)
  ctx.globalAlpha = 1

  // How to claim it, beside the QR, on the look's panel.
  const boxY = 724
  const boxH = 290
  ctx.fillStyle = t.panel
  roundRect(ctx, 92, boxY, W - 184, boxH, 24)
  ctx.fill()
  ctx.strokeStyle = shade(t.panel, -0.12)
  ctx.lineWidth = 1.5
  ctx.stroke()

  ctx.textAlign = 'left'
  const steps = ['Scan the code', 'Share your details', 'Book, and the gift is yours']
  let sy = boxY + 66
  for (const [i, step] of steps.entries()) {
    ctx.fillStyle = t.accent
    ctx.beginPath()
    ctx.arc(152, sy - 10, 24, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = t.panel
    ctx.font = `700 30px Georgia, serif`
    ctx.textAlign = 'center'
    ctx.fillText(String(i + 1), 152, sy)
    ctx.textAlign = 'left'
    ctx.fillStyle = t.ink
    ctx.font = `600 30px ${face(t.body)}`
    ctx.fillText(step, 190, sy)
    sy += 62
  }
  ctx.font = `24px ${face(t.body)}`
  ctx.globalAlpha = 0.8
  const valid = validWords(d.validUntil)
  ctx.fillText([`Gift code ${cardCode(d.code)}`, valid && `valid till ${valid}`].filter(Boolean).join(' · '), 130, boxY + boxH - 34)
  ctx.globalAlpha = 1

  const qr = qrcode(0, 'M')
  qr.addData(d.link)
  qr.make()
  const n = qr.getModuleCount()
  const size = 226
  const qx = W - 92 - size - 32
  const qy = boxY + (boxH - size) / 2
  ctx.fillStyle = '#FFFFFF'
  roundRect(ctx, qx - 14, qy - 14, size + 28, size + 28, 16)
  ctx.fill()
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
