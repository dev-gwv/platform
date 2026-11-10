import { PAINT_RE } from '@ipc/contracts'

/**
 * Colours and gradients for the designer (owner, 10 Nov: "a lot of colour
 * options ... including gradient"). A paint is stored as a short string the
 * contract checks (`PAINT_RE`): "#RRGGBB", "lg:<angle>:#A:#B[:#C]" or
 * "rg:#A:#B[:#C]". Nothing else reaches a style attribute.
 */

export interface Gradient {
  kind: 'linear' | 'radial'
  angle: number
  stops: string[]
}

export const isPaint = (p: string) => PAINT_RE.test(p)
export const isGradient = (p: string) => p.startsWith('lg:') || p.startsWith('rg:')

export function parseGradient(p: string): Gradient | null {
  if (!isPaint(p) || !isGradient(p)) return null
  const parts = p.split(':')
  if (parts[0] === 'lg') return { kind: 'linear', angle: Number(parts[1]), stops: parts.slice(2) }
  return { kind: 'radial', angle: 0, stops: parts.slice(1) }
}

export function makeGradient(g: Gradient): string {
  const stops = g.stops.slice(0, 3).map((c) => c.toUpperCase())
  return g.kind === 'linear' ? `lg:${Math.round(((g.angle % 360) + 360) % 360)}:${stops.join(':')}` : `rg:${stops.join(':')}`
}

/** The CSS for a paint; anything that is not one falls back. */
export function cssPaint(p: string | null | undefined, fallback: string): string {
  if (!p || !isPaint(p)) return fallback
  const g = parseGradient(p)
  if (!g) return p
  return g.kind === 'linear'
    ? `linear-gradient(${g.angle}deg, ${g.stops.join(', ')})`
    : `radial-gradient(circle at center, ${g.stops.join(', ')})`
}

/** Solid colours in families, chosen for Indian wedding quotations. */
export const PALETTE: { name: string; colours: string[] }[] = [
  { name: 'Ivory & neutrals', colours: ['#FFFFFF', '#FBF8F3', '#F5EFE6', '#EAE7E0', '#E3D9C9', '#CDBFA8', '#A89A86', '#6E6457'] },
  { name: 'Gold & champagne', colours: ['#FFF4D6', '#F6E3B4', '#EBCB8B', '#D9B26A', '#C9A55C', '#B8893A', '#8A6A2E', '#5E4519'] },
  { name: 'Blush & rose', colours: ['#FFF0F1', '#F7ECEA', '#F4D4D8', '#E8AFB8', '#D98896', '#B5707B', '#93465A', '#6B2737'] },
  { name: 'Maroon & red', colours: ['#F9E1E1', '#E9A3A3', '#D4545B', '#B3242E', '#8E1B2B', '#6E2430', '#5C1A24', '#3C0E16'] },
  { name: 'Orange & haldi', colours: ['#FFF3D6', '#FFE08A', '#FFC93C', '#F9A825', '#F27F1B', '#E25D1B', '#C2410C', '#7C2D12'] },
  { name: 'Green & sage', colours: ['#F0F4EC', '#ECEFE6', '#C9D6BC', '#9DB38A', '#647A57', '#3F6B4A', '#1F5135', '#13321F'] },
  { name: 'Teal & peacock', colours: ['#E3F4F2', '#B2E0DA', '#5FB8AD', '#14918A', '#0F766E', '#0B5D5B', '#134E5E', '#082F35'] },
  { name: 'Blue & navy', colours: ['#EAF1FB', '#C7D9F2', '#8DB3E2', '#3B78C9', '#1E4FA0', '#1B2A4A', '#141722', '#0B1020'] },
  { name: 'Lavender & plum', colours: ['#F4EEFB', '#E3D5F5', '#C3A9E8', '#9B7BD4', '#7148B8', '#5B2C83', '#43205F', '#2A133D'] },
  { name: 'Charcoal & black', colours: ['#F3F3F3', '#D9D9D9', '#A6A6A6', '#737373', '#4A4A4A', '#2E2E2E', '#1A1A1A', '#000000'] },
]

/** Ready-made gradients, each named the way a studio would say it. */
export const GRADIENTS: { name: string; paint: string }[] = [
  { name: 'Champagne', paint: 'lg:135:#FBF3E4:#E9D3A9' },
  { name: 'Gold dust', paint: 'lg:135:#F6E3B4:#C9A55C:#8A6A2E' },
  { name: 'Rose gold', paint: 'lg:135:#F7DCD3:#E3A99A:#B76E79' },
  { name: 'Blush', paint: 'lg:180:#FFF5F5:#F4D4D8' },
  { name: 'Royal maroon', paint: 'lg:160:#8E1B2B:#5C1A24:#2B0A10' },
  { name: 'Midnight gold', paint: 'lg:160:#1F2440:#141722:#0B0E18' },
  { name: 'Navy night', paint: 'rg:#2A3C66:#1B2A4A:#0B1020' },
  { name: 'Haldi', paint: 'lg:135:#FFF3D6:#FFC93C:#F27F1B' },
  { name: 'Sunset', paint: 'lg:135:#FFD3A5:#FD6585' },
  { name: 'Mehendi', paint: 'lg:135:#E8F0D8:#9DB38A:#3F6B4A' },
  { name: 'Sage mist', paint: 'lg:180:#F4F7EF:#C9D6BC' },
  { name: 'Peacock', paint: 'lg:135:#0F766E:#134E5E:#1E4FA0' },
  { name: 'Lavender haze', paint: 'lg:135:#F4EEFB:#C3A9E8' },
  { name: 'Plum wine', paint: 'lg:150:#7148B8:#43205F:#2A133D' },
  { name: 'Ivory glow', paint: 'rg:#FFFFFF:#F5EFE6:#E3D9C9' },
  { name: 'Pearl grey', paint: 'lg:180:#FFFFFF:#E5E5E5' },
  { name: 'Ocean', paint: 'lg:135:#B2E0DA:#3B78C9' },
  { name: 'Candlelight', paint: 'rg:#FFF4D6:#EBCB8B:#5E4519' },
]

/** The directions offered for a gradient made by hand. */
export const DIRECTIONS: { label: string; title: string; g: Pick<Gradient, 'kind' | 'angle'> }[] = [
  { label: '↓', title: 'Top to bottom', g: { kind: 'linear', angle: 180 } },
  { label: '↘', title: 'Corner to corner', g: { kind: 'linear', angle: 135 } },
  { label: '→', title: 'Left to right', g: { kind: 'linear', angle: 90 } },
  { label: '↗', title: 'Up the corner', g: { kind: 'linear', angle: 45 } },
  { label: '◎', title: 'From the centre', g: { kind: 'radial', angle: 0 } },
]

const RECENT_KEY = 'designer-recent-colours'

/** The last colours someone used here, newest first (kept on this device only). */
export function recentPaints(): string[] {
  try {
    const v: unknown = JSON.parse(window.localStorage.getItem(RECENT_KEY) ?? '[]')
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && isPaint(x)).slice(0, 10) : []
  } catch {
    return []
  }
}

export function rememberPaint(p: string) {
  if (!isPaint(p)) return
  try {
    const next = [p, ...recentPaints().filter((x) => x !== p)].slice(0, 10)
    window.localStorage.setItem(RECENT_KEY, JSON.stringify(next))
  } catch {
    /* a private window: nothing kept */
  }
}

/** "#c9a55c" or "C9A55C" typed by hand, as a colour, or null. */
export function hexFrom(typed: string): string | null {
  const t = typed.trim().replace(/^#?/, '#').toUpperCase()
  if (/^#[0-9A-F]{6}$/.test(t)) return t
  if (/^#[0-9A-F]{3}$/.test(t)) return `#${t[1]}${t[1]}${t[2]}${t[2]}${t[3]}${t[3]}`
  return null
}
