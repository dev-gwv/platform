/**
 * Where a photo sits in its frame (step 4): drawn to cover the frame, then
 * zoomed, with its focus point (x, y as 0-100) deciding what shows -- the
 * same as CSS object-fit: cover with object-position, but worked out so the
 * crop view can draw the whole photo around the frame, faded, like Canva.
 */
export interface Placement {
  left: number
  top: number
  width: number
  height: number
}

export function placePhoto(
  fw: number,
  fh: number,
  iw: number,
  ih: number,
  x: number,
  y: number,
  zoom: number,
): Placement {
  const s = Math.max(fw / iw, fh / ih) * zoom
  const width = iw * s
  const height = ih * s
  // "|| 0" keeps a frame that fits exactly at 0, not -0.
  return { left: ((fw - width) * x) / 100 || 0, top: ((fh - height) * y) / 100 || 0, width, height }
}

/** The focus point after the photo is dragged by (dx, dy) frame pixels: it follows the hand. */
export function panPhoto(
  p: Placement,
  fw: number,
  fh: number,
  x0: number,
  y0: number,
  dx: number,
  dy: number,
) {
  const clamp = (v: number) => Math.max(0, Math.min(100, Math.round(v * 10) / 10))
  const spareX = p.width - fw
  const spareY = p.height - fh
  return {
    x: spareX > 0.5 ? clamp(x0 - (dx * 100) / spareX) : x0,
    y: spareY > 0.5 ? clamp(y0 - (dy * 100) / spareY) : y0,
  }
}
