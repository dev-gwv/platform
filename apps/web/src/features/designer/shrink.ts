/**
 * Photos are made small before they upload (owner, 9 Nov: photographers'
 * files are 20-30 MB). A quotation page needs about 2400 px on its long side;
 * anything bigger, or heavier than 1.5 MB, is redrawn as a JPEG, stepping the
 * size and quality down until it is under 1.5 MB. A small file goes up as it
 * is. The server takes up to 10 MB, so a 30 MB camera file now always fits.
 */
const TARGET_BYTES = 1.5 * 1024 * 1024
const STEPS: readonly (readonly [number, number])[] = [
  [2400, 0.86],
  [2400, 0.78],
  [2000, 0.78],
  [1800, 0.72],
  [1600, 0.68],
]

export interface Shrunk {
  file: File
  width: number | null
  height: number | null
  before: number
  after: number
}

/** "28.4 MB" / "860 KB". */
export const sizeWords = (bytes: number) =>
  bytes >= 1024 * 1024
    ? `${(bytes / 1024 / 1024).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`

/** The side lengths a picture is drawn at, its long side at most `max`. */
export function fitWithin(w: number, h: number, max: number): [number, number] {
  const s = Math.min(1, max / Math.max(w, h))
  return [Math.max(1, Math.round(w * s)), Math.max(1, Math.round(h * s))]
}

async function decode(
  file: File,
): Promise<{ img: CanvasImageSource; w: number; h: number; close: () => void }> {
  if (typeof createImageBitmap === 'function') {
    try {
      const bmp = await createImageBitmap(file)
      return { img: bmp, w: bmp.width, h: bmp.height, close: () => bmp.close() }
    } catch {
      // Fall through to <img>: Safari reads HEIC there.
    }
  }
  const url = URL.createObjectURL(file)
  const el = new Image()
  el.decoding = 'async'
  el.src = url
  await el.decode()
  return { img: el, w: el.naturalWidth, h: el.naturalHeight, close: () => URL.revokeObjectURL(url) }
}

export async function shrinkPhoto(file: File): Promise<Shrunk> {
  const before = file.size
  if (file.type === 'image/gif' || file.type === 'image/svg+xml')
    return { file, width: null, height: null, before, after: before }
  let pic
  try {
    pic = await decode(file)
  } catch {
    throw new Error('This photo could not be opened here. Please save it as a JPG and try again.')
  }
  try {
    const small =
      before <= TARGET_BYTES &&
      Math.max(pic.w, pic.h) <= 2400 &&
      /^image\/(jpeg|png|webp)$/.test(file.type)
    if (small) return { file, width: pic.w, height: pic.h, before, after: before }
    const canvas = document.createElement('canvas')
    let best: Blob | null = null
    let size: [number, number] = [pic.w, pic.h]
    for (const [max, q] of STEPS) {
      size = fitWithin(pic.w, pic.h, max)
      canvas.width = size[0]
      canvas.height = size[1]
      const g = canvas.getContext('2d')
      if (!g) break
      g.fillStyle = '#fff'
      g.fillRect(0, 0, size[0], size[1])
      g.drawImage(pic.img, 0, 0, size[0], size[1])
      best = await new Promise<Blob | null>((ok) => canvas.toBlob(ok, 'image/jpeg', q))
      if (best && best.size <= TARGET_BYTES) break
    }
    if (!best) return { file, width: pic.w, height: pic.h, before, after: before }
    const out = new File([best], `${file.name.replace(/\.\w+$/, '') || 'photo'}.jpg`, {
      type: 'image/jpeg',
    })
    return { file: out, width: size[0], height: size[1], before, after: out.size }
  } finally {
    pic.close()
  }
}
