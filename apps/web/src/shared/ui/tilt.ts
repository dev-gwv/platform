/**
 * Pointer-follow tilt maths.
 *
 * Separated from the component because the signs are the part that goes
 * quietly wrong: get one backwards and the card leans away from the cursor,
 * which still looks like "an effect" and so survives a casual glance.
 *
 * The contract, fixed by the tests: **the edge nearest the pointer lifts
 * toward the viewer.** In CSS a positive `rotateX` pushes the top edge away
 * and a positive `rotateY` pushes the right edge away, so both axes are
 * inverted relative to the raw pointer offset.
 */

interface Tilt {
  /** Degrees about the horizontal axis. */
  rotateX: number
  /** Degrees about the vertical axis. */
  rotateY: number
}

export const NO_TILT: Tilt = { rotateX: 0, rotateY: 0 }

const clamp01 = (n: number) => Math.min(1, Math.max(0, n))

/**
 * Tilt for a pointer at `xPct`/`yPct` across an element, each 0–1 from the
 * top-left. Values outside that range are clamped, so a pointer that has left
 * the element cannot drive the card past `max`.
 */
export function tiltFor(xPct: number, yPct: number, max: number): Tilt {
  if (!Number.isFinite(xPct) || !Number.isFinite(yPct)) return NO_TILT
  const x = clamp01(xPct)
  const y = clamp01(yPct)
  return {
    // Pointer at the top (y = 0) lifts the top edge, which is a NEGATIVE
    // rotateX; at the bottom it is positive.
    rotateX: round((y - 0.5) * 2 * max),
    // Pointer at the right (x = 1) lifts the right edge, which is a NEGATIVE
    // rotateY.
    rotateY: round((0.5 - x) * 2 * max),
  }
}

/** Same, from a pointer position and the element's box. */
export function tiltFromRect(
  clientX: number,
  clientY: number,
  rect: { left: number; top: number; width: number; height: number },
  max: number,
): Tilt {
  // A collapsed or not-yet-laid-out element would divide by zero and send the
  // card spinning off; flat is the honest answer.
  if (rect.width <= 0 || rect.height <= 0) return NO_TILT
  return tiltFor((clientX - rect.left) / rect.width, (clientY - rect.top) / rect.height, max)
}

/**
 * Where the light should come from, as a percentage across the card, so a
 * sheen can track the pointer. Clamped like the tilt.
 */
export function sheenPosition(xPct: number, yPct: number): { x: number; y: number } {
  if (!Number.isFinite(xPct) || !Number.isFinite(yPct)) return { x: 50, y: 50 }
  return { x: round(clamp01(xPct) * 100), y: round(clamp01(yPct) * 100) }
}

const round = (n: number) => Number(n.toFixed(2))
