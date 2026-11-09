import { PAGE_H, PAGE_W } from './page-context'

/**
 * Canva's guides (step 4): while an item is dragged, its centre and edges
 * snap to the page's centre and to a margin, and a pink line shows where.
 * Pure, so the tests can move a box and read where it lands.
 */
export const SNAP = 8
export const MARGIN = 48

export interface Box {
  x: number
  y: number
  w: number
  h: number
}

export interface Guide {
  axis: 'x' | 'y'
  at: number
}

const targets = (size: number) => [MARGIN, size / 2, size - MARGIN]

/** Where a box dragged to (x, y) settles, and the guides it lines up with. */
export function snapBox(b: Box): { x: number; y: number; guides: Guide[] } {
  const guides: Guide[] = []
  let { x, y } = b
  const fit = (pos: number, size: number, page: number, axis: 'x' | 'y') => {
    // Try the item's start, centre and end against the margins and the middle.
    let best: { d: number; to: number; at: number } | null = null
    for (const t of targets(page)) {
      for (const [edge, off] of [
        [pos, 0],
        [pos + size / 2, size / 2],
        [pos + size, size],
      ] as const) {
        const d = Math.abs(edge - t)
        if (d <= SNAP && (!best || d < best.d)) best = { d, to: t - off, at: t }
      }
    }
    if (best) guides.push({ axis, at: best.at })
    return best ? best.to : pos
  }
  x = fit(x, b.w, PAGE_W, 'x')
  y = fit(y, b.h, PAGE_H, 'y')
  return { x, y, guides }
}
