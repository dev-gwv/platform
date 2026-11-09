/**
 * A phone photo is 5-12 MB; a quotation page needs about 2000 px. Anything
 * bigger than that is redrawn as a JPEG before upload, so a design of thirty
 * photos does not eat the studio's storage. Small files go up untouched.
 */
const MAX_SIDE = 2000
const LEAVE_UNDER = 1.5 * 1024 * 1024

export async function shrinkPhoto(file: File): Promise<File> {
  if (file.size <= LEAVE_UNDER || file.type === 'image/gif' || typeof createImageBitmap !== 'function') return file
  try {
    const bmp = await createImageBitmap(file)
    const scale = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(bmp.width * scale)
    canvas.height = Math.round(bmp.height * scale)
    canvas.getContext('2d')?.drawImage(bmp, 0, 0, canvas.width, canvas.height)
    bmp.close()
    const blob = await new Promise<Blob | null>((ok) => canvas.toBlob(ok, 'image/jpeg', 0.86))
    if (!blob || blob.size >= file.size) return file
    return new File([blob], file.name.replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' })
  } catch {
    return file
  }
}
