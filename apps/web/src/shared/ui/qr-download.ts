import qrcode from 'qrcode-generator'

/**
 * QR codes to print. The studio hands these to vendors, so the download is a
 * print-ready PNG (2400 px wide, 8 inches at 300 dpi) with the studio's name
 * and a line under the code saying what it is for, plus a vector SVG for a
 * designer or printer.
 */

const INK = '#111827'

function make(text: string) {
  const qr = qrcode(0, 'M')
  qr.addData(text)
  qr.make()
  return qr
}

/** The code as an SVG string: sharp at any size, nothing to fetch. */
export function qrSvg(text: string, margin = 2): string {
  return make(text).createSvgTag({ cellSize: 4, margin, scalable: true })
}

function save(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

const safeFileName = (s: string) =>
  s.replace(/[^\w-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').toLowerCase() || 'qr-code'

/** Splits text into lines that fit the width. */
function wrap(ctx: CanvasRenderingContext2D, text: string, width: number): string[] {
  const out: string[] = []
  let line = ''
  for (const word of text.split(' ')) {
    const next = line ? `${line} ${word}` : word
    if (ctx.measureText(next).width > width && line) {
      out.push(line)
      line = word
    } else line = next
  }
  if (line) out.push(line)
  return out
}

export async function downloadQrPng(text: string, filename: string, title?: string, subtitle?: string) {
  const W = 2400
  const pad = 200
  const size = W - pad * 2
  const qr = make(text)
  const n = qr.getModuleCount()
  const cell = size / n

  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('No canvas')
  const font = (px: number, weight: number) => `${weight} ${px}px "Inter", "Segoe UI", Arial, sans-serif`
  ctx.font = font(120, 800)
  const titleLines = title ? wrap(ctx, title, size) : []
  ctx.font = font(76, 500)
  const subLines = subtitle ? wrap(ctx, subtitle, size) : []
  const textH = (titleLines.length ? titleLines.length * 150 + 40 : 0) + subLines.length * 100
  canvas.width = W
  canvas.height = pad + size + (textH ? pad * 0.6 + textH : 0) + pad

  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.fillStyle = INK
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      // Rounded out to whole pixels with a hair of overlap, so no seams show.
      if (qr.isDark(r, c)) ctx.fillRect(Math.floor(pad + c * cell), Math.floor(pad + r * cell), Math.ceil(cell) + 1, Math.ceil(cell) + 1)
    }
  }

  ctx.textAlign = 'center'
  ctx.textBaseline = 'top'
  let y = pad + size + pad * 0.6
  ctx.font = font(120, 800)
  for (const l of titleLines) {
    ctx.fillText(l, W / 2, y)
    y += 150
  }
  if (titleLines.length) y += 40
  ctx.font = font(76, 500)
  ctx.fillStyle = '#4b5563'
  for (const l of subLines) {
    ctx.fillText(l, W / 2, y)
    y += 100
  }

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
  if (!blob) throw new Error('Could not make the image')
  save(blob, `${safeFileName(filename)}.png`)
}

export function downloadQrSvg(text: string, filename: string) {
  const svg = make(text).createSvgTag({ cellSize: 8, margin: 4 })
  save(new Blob([svg], { type: 'image/svg+xml' }), `${safeFileName(filename)}.svg`)
}
