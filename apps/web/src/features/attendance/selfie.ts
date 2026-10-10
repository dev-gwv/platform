/**
 * Selfies are small on purpose: 480 px on the long side, JPEG at 0.7 --
 * enough to recognise a face, about 30–60 KB, quick to send on a shoot-day
 * connection, and far under the 1 MB every upload is held to.
 */
const SELFIE_MAX = 480

/** The size that fits inside `max` on its long side, never larger than the original. */
export function fitWithin(width: number, height: number, max = SELFIE_MAX): { width: number; height: number } {
  if (width <= 0 || height <= 0) return { width: 0, height: 0 }
  const scale = Math.min(1, max / Math.max(width, height))
  return { width: Math.round(width * scale), height: Math.round(height * scale) }
}

/** Shrink a camera photo to a small JPEG in the browser. */
export async function compressSelfie(file: File): Promise<File> {
  const bitmap = await createImageBitmap(file)
  const size = fitWithin(bitmap.width, bitmap.height)
  const canvas = document.createElement('canvas')
  canvas.width = size.width
  canvas.height = size.height
  canvas.getContext('2d')?.drawImage(bitmap, 0, 0, size.width, size.height)
  bitmap.close()
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.7))
  if (!blob) throw new Error('We could not read that photo. Take it again.')
  return new File([blob], 'selfie.jpg', { type: 'image/jpeg' })
}
