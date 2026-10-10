/**
 * Chart geometry — the arithmetic behind the pictures, with no pixels in it.
 *
 * Kept apart from the components so the part that can be silently wrong (a
 * scale that clips a bar, a path that inverts when every value is equal) is
 * the part under test.
 */

export interface Point {
  label: string
  value: number
}

interface Scale {
  /** The top of the axis. Never zero, so a flat series still has a chart. */
  max: number
  /** Fraction of `max`, clamped to 0–1. */
  ratio: (value: number) => number
  /** Percent, for a CSS height or width. */
  percent: (value: number) => number
}

/**
 * A scale from zero to the largest value, with a little headroom so the tallest
 * bar does not touch the ceiling.
 *
 * Negative values are clamped to zero rather than inverting the axis: a loss is
 * a real thing to show, but a bar chart that grows downward from an invisible
 * baseline misleads more than it informs.
 */
export function scaleFor(values: readonly number[], headroom = 1.05): Scale {
  const highest = values.reduce((max, v) => (v > max ? v : max), 0)
  // An all-zero series would divide by zero; 1 keeps every bar at 0% instead.
  const max = highest > 0 ? highest * headroom : 1
  const ratio = (value: number) => Math.min(1, Math.max(0, value / max))
  return { max, ratio, percent: (value) => ratio(value) * 100 }
}

/**
 * An SVG polyline through the points, in a 0–100 by 0–100 viewBox.
 *
 * y is flipped because SVG counts downward and a chart counts upward — the
 * single most common way a sparkline ends up upside down.
 */
export function linePath(values: readonly number[], scale: Scale): string {
  if (values.length === 0) return ''
  if (values.length === 1) return `M 0 ${100 - scale.percent(values[0]!)} L 100 ${100 - scale.percent(values[0]!)}`
  const step = 100 / (values.length - 1)
  return values
    .map((v, i) => `${i === 0 ? 'M' : 'L'} ${(i * step).toFixed(2)} ${(100 - scale.percent(v)).toFixed(2)}`)
    .join(' ')
}

/** The same line closed down to the baseline, for a tinted area beneath it. */
export function areaPath(values: readonly number[], scale: Scale): string {
  const line = linePath(values, scale)
  if (!line) return ''
  return `${line} L 100 100 L 0 100 Z`
}

/**
 * Change between the first and last point, as a percentage.
 *
 * Null when there is nothing honest to say: fewer than two points, or a
 * starting value of zero — "up ∞%" from nothing is not a fact worth printing.
 */
export function trendPercent(values: readonly number[]): number | null {
  if (values.length < 2) return null
  const first = values[0]!
  const last = values[values.length - 1]!
  if (first === 0) return null
  return Math.round(((last - first) / Math.abs(first)) * 100)
}

/** Slices as percentages of the whole, largest first, tiny ones grouped. */
interface Slice extends Point {
  percent: number
}

export function shareOf(points: readonly Point[], minPercent = 4): Slice[] {
  const total = points.reduce((sum, p) => sum + Math.max(0, p.value), 0)
  if (total <= 0) return []

  const scaled = points
    .filter((p) => p.value > 0)
    .map((p) => ({ ...p, percent: (p.value / total) * 100 }))
    .sort((a, b) => b.percent - a.percent)

  const big = scaled.filter((s) => s.percent >= minPercent)
  const small = scaled.filter((s) => s.percent < minPercent)
  if (small.length === 0) return big

  // A dozen 1% slivers are unreadable and unlabellable; one honest "Other" is
  // better than a legend nobody can match to the chart.
  return [
    ...big,
    {
      label: `Other (${small.length})`,
      value: small.reduce((sum, s) => sum + s.value, 0),
      percent: small.reduce((sum, s) => sum + s.percent, 0),
    },
  ]
}

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/**
 * Sum values into the last N calendar months, oldest first.
 *
 * ISO dates are sliced rather than parsed: `new Date('2026-09-01')` is
 * midnight UTC, which in a negative-offset timezone is still August, and a
 * chart that moves a month's takings into the previous month is worse than no
 * chart. Months with nothing in them are kept — a gap is information.
 */
export function monthlySeries<T>(
  items: readonly T[],
  dateOf: (item: T) => string | null,
  valueOf: (item: T) => number,
  months = 6,
  today: Date = new Date(),
): Point[] {
  const buckets = new Map<string, number>()
  const order: Array<{ key: string; label: string }> = []

  for (let back = months - 1; back >= 0; back--) {
    const at = new Date(today.getFullYear(), today.getMonth() - back, 1)
    const key = `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, '0')}`
    buckets.set(key, 0)
    order.push({ key, label: MONTH_NAMES[at.getMonth()]! })
  }

  for (const item of items) {
    const date = dateOf(item)
    if (!date) continue
    const key = date.slice(0, 7)
    if (buckets.has(key)) buckets.set(key, buckets.get(key)! + valueOf(item))
  }

  return order.map(({ key, label }) => ({ label, value: buckets.get(key) ?? 0 }))
}

/** Sum by a text key — expense categories, lead sources, anything grouped. */
export function groupBy<T>(
  items: readonly T[],
  keyOf: (item: T) => string | null,
  valueOf: (item: T) => number,
  fallback = 'Uncategorised',
): Point[] {
  const totals = new Map<string, number>()
  for (const item of items) {
    const key = keyOf(item)?.trim() || fallback
    totals.set(key, (totals.get(key) ?? 0) + valueOf(item))
  }
  return [...totals.entries()].map(([label, value]) => ({ label, value }))
}
