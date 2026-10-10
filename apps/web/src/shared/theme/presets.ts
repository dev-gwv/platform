import type { ThemeFontKey } from '@ipc/contracts'

/**
 * Theme presets. Each maps to a small set of tenant tokens the ThemeProvider
 * writes onto :root at runtime. Kept as constants (not free-form colour from
 * the client) so a company can only pick from an allow-listed palette — the
 * same list lives in @ipc/contracts, which the server validates writes against.
 *
 * Every preset carries a LIGHT and a DARK value. Runtime tokens land as inline
 * styles on <html>, which outrank the `.dark` class rules — so a single colour
 * per preset would drag its light value into dark mode and wreck the contrast
 * the dark palette was tuned for.
 */
interface Swatch {
  /** oklch lightness 0–1. */
  l: number
  /** oklch chroma. */
  c: number
  /** oklch hue in degrees. */
  h: number
}

export interface ThemePreset {
  key: string
  label: string
  /** One line on the card — who this palette is for. */
  description: string
  /** The face this theme ships with; a studio can override it. */
  font: ThemeFontKey
  light: Record<string, string>
  dark: Record<string, string>
  /** Colour shown in the picker — the light-mode primary. */
  swatch: string
}

/**
 * Lightness at which white text on the colour stops beating dark text. Below
 * it, white reads better; above, near-black does. Amber and Sunset sit on the
 * far side, which is why a fixed near-white foreground was unreadable on them.
 */
export const FOREGROUND_FLIP = 0.68

/** The readable text colour to sit on top of a given swatch. */
export function foregroundFor({ l, h }: Swatch): string {
  return l > FOREGROUND_FLIP ? `oklch(0.2 0.03 ${h})` : 'oklch(0.98 0 0)'
}

const css = ({ l, c, h }: Swatch) => `oklch(${l} ${c} ${h})`

/**
 * One preset's token set for a single scheme: the accent, the focus ring, the
 * readable text on it, the secondary brand colour, and the tinted neutral that
 * hovers and quiet surfaces sit on.
 *
 * The tint is derived rather than hand-picked so it can never drift off the
 * accent's hue — a "neutral" grey a few degrees off the accent is the thing
 * that makes an interface look subtly broken.
 */
function tokens(accent: Swatch, brand: Swatch, scheme: 'light' | 'dark'): Record<string, string> {
  const tint =
    scheme === 'light'
      ? `oklch(0.965 ${Math.min(accent.c, 0.03)} ${accent.h})`
      : `oklch(0.28 ${Math.min(accent.c, 0.04)} ${accent.h})`
  return {
    '--primary': css(accent),
    '--ring': css(accent),
    '--primary-foreground': foregroundFor(accent),
    '--brand': css(brand),
    // The brand colour is a fill in its own right (nav hovers), so it needs the
    // same readable-text treatment the accent gets.
    '--brand-foreground': foregroundFor(brand),
    '--accent': tint,
    '--accent-foreground': scheme === 'light' ? `oklch(0.25 0.02 ${accent.h})` : 'oklch(0.97 0 0)',
  }
}

interface PresetInput {
  key: string
  label: string
  description: string
  font: ThemeFontKey
  light: Swatch
  dark: Swatch
  /** Secondary colour — logo mark, highlights. Same in both schemes' spirit. */
  brandLight: Swatch
  brandDark: Swatch
}

function preset(p: PresetInput): ThemePreset {
  return {
    key: p.key,
    label: p.label,
    description: p.description,
    font: p.font,
    light: tokens(p.light, p.brandLight, 'light'),
    dark: tokens(p.dark, p.brandDark, 'dark'),
    swatch: css(p.light),
  }
}

/**
 * Dark-mode variants sit lighter and slightly less saturated: the same colour
 * that reads as confident on white turns muddy against a near-black surface.
 */
export const THEME_PRESETS: Readonly<Record<string, ThemePreset>> = Object.fromEntries(
  [
    preset({
      key: 'ipc_classic',
      label: 'IPC Classic',
      description: 'Clean default IPC Studio look.',
      font: 'inter',
      light: { l: 0.52, c: 0.22, h: 274 },
      dark: { l: 0.66, c: 0.18, h: 274 },
      brandLight: { l: 0.78, c: 0.16, h: 70 },
      brandDark: { l: 0.82, c: 0.15, h: 70 },
    }),
    preset({
      // Was navy. `light` was { l: 0.28, c: 0.04, h: 265 } — hue 265 is blue,
      // chroma 0.04 is all but grey, and it sat nine degrees from IPC Classic's
      // 274. The gold was only ever in `brand`, which ~11 places in the app
      // paint against ~271 for `primary`. So applying "Luxury Gold" swapped a
      // navy for a duller navy and looked exactly like a button that does
      // nothing — which is how it was reported.
      //
      // Gold is light enough to cross FOREGROUND_FLIP, so the text on it comes
      // out near-black rather than white. That is what makes it read as gold
      // rather than as mustard.
      key: 'luxury_gold',
      label: 'Luxury Gold',
      description: 'Premium and elegant for luxury wedding brands.',
      font: 'playfair',
      light: { l: 0.76, c: 0.14, h: 88 },
      dark: { l: 0.82, c: 0.13, h: 88 },
      // The deep navy it used to be, kept as the secondary — gold on navy is
      // the pairing the theme was reaching for.
      brandLight: { l: 0.3, c: 0.05, h: 265 },
      brandDark: { l: 0.42, c: 0.06, h: 265 },
    }),
    preset({
      key: 'royal_purple',
      label: 'Royal Purple',
      description: 'Modern, premium, and bold.',
      font: 'poppins',
      light: { l: 0.48, c: 0.24, h: 300 },
      dark: { l: 0.66, c: 0.2, h: 300 },
      brandLight: { l: 0.8, c: 0.16, h: 80 },
      brandDark: { l: 0.84, c: 0.15, h: 80 },
    }),
    preset({
      key: 'blush_wedding',
      label: 'Blush Wedding',
      description: 'Soft and elegant for wedding photographers.',
      font: 'lato',
      // Was { l: 0.53, c: 0.2, h: 15 } — a strong coral that sat 0.09 from Warm
      // Terracotta, close enough that swapping one for the other looked like
      // nothing had happened. A blush is pale and pink: lighter, and far
      // enough above FOREGROUND_FLIP to take dark text, which is also what
      // keeps it readable at this lightness.
      light: { l: 0.72, c: 0.15, h: 8 },
      dark: { l: 0.8, c: 0.13, h: 8 },
      brandLight: { l: 0.78, c: 0.12, h: 350 },
      brandDark: { l: 0.82, c: 0.11, h: 350 },
    }),
    preset({
      key: 'editorial_black',
      label: 'Editorial Black',
      description: 'Minimal and high-end portfolio style.',
      font: 'manrope',
      light: { l: 0.2, c: 0.005, h: 0 },
      dark: { l: 0.86, c: 0.005, h: 0 },
      brandLight: { l: 0.55, c: 0.01, h: 0 },
      brandDark: { l: 0.7, c: 0.01, h: 0 },
    }),
    preset({
      key: 'ocean_blue',
      label: 'Ocean Blue',
      description: 'Fresh, trustworthy, and clean.',
      font: 'open_sans',
      light: { l: 0.52, c: 0.14, h: 240 },
      dark: { l: 0.68, c: 0.13, h: 240 },
      brandLight: { l: 0.72, c: 0.15, h: 225 },
      brandDark: { l: 0.78, c: 0.13, h: 225 },
    }),
    preset({
      key: 'emerald_studio',
      label: 'Emerald Studio',
      description: 'Calm, premium, and professional.',
      font: 'nunito',
      light: { l: 0.48, c: 0.13, h: 160 },
      dark: { l: 0.68, c: 0.13, h: 160 },
      brandLight: { l: 0.8, c: 0.11, h: 160 },
      brandDark: { l: 0.84, c: 0.1, h: 160 },
    }),
    preset({
      key: 'warm_terracotta',
      label: 'Warm Terracotta',
      description: 'Earthy and artistic for creative studios.',
      font: 'merriweather',
      // Nudged from hue 40 to 48 to sit clearly in orange rather than on the
      // edge of Blush Wedding's pink.
      light: { l: 0.5, c: 0.16, h: 48 },
      dark: { l: 0.67, c: 0.15, h: 48 },
      brandLight: { l: 0.8, c: 0.11, h: 65 },
      brandDark: { l: 0.84, c: 0.1, h: 65 },
    }),
    preset({
      key: 'minimal_slate',
      label: 'Minimal Slate',
      description: 'Simple, neutral, and highly professional.',
      font: 'inter',
      light: { l: 0.38, c: 0.03, h: 255 },
      dark: { l: 0.72, c: 0.03, h: 255 },
      brandLight: { l: 0.68, c: 0.04, h: 255 },
      brandDark: { l: 0.78, c: 0.03, h: 255 },
    }),
    preset({
      key: 'premium_rose_gold',
      label: 'Premium Rose Gold',
      description: 'Luxury, feminine, and premium for boutique brands.',
      font: 'playfair',
      light: { l: 0.45, c: 0.18, h: 350 },
      dark: { l: 0.68, c: 0.16, h: 350 },
      brandLight: { l: 0.72, c: 0.14, h: 340 },
      brandDark: { l: 0.78, c: 0.12, h: 340 },
    }),
  ].map((p) => [p.key, p]),
)

export const THEME_PRESET_KEYS = Object.keys(THEME_PRESETS)

export const DEFAULT_PRESET_KEY = 'ipc_classic'

/**
 * Keys written before the themes were named. The 0027 migration rewrites stored
 * rows, but a client can still be holding one in localStorage — or reading a row
 * written by an API instance that had not rolled over yet.
 */
export const LEGACY_PRESET_ALIASES: Readonly<Record<string, string>> = {
  brand: 'ipc_classic',
  indigo: 'royal_purple',
  emerald: 'emerald_studio',
  amber: 'luxury_gold',
  rose: 'blush_wedding',
}

/** Resolve any stored key — current, legacy or junk — to a preset. */
export function presetFor(key: string | null | undefined): ThemePreset {
  const resolved = LEGACY_PRESET_ALIASES[key ?? ''] ?? key ?? ''
  return THEME_PRESETS[resolved] ?? THEME_PRESETS[DEFAULT_PRESET_KEY]!
}

/** Every token any preset can set — used to wipe the previous one cleanly. */
export const THEME_TOKENS = [
  '--primary',
  '--ring',
  '--primary-foreground',
  '--brand',
  '--brand-foreground',
  '--accent',
  '--accent-foreground',
] as const

/**
 * A fully custom theme's 8 independently-picked colours — the studio types a
 * hex for each rather than choosing a named preset. Unset fields fall back to
 * the current preset's own value, so turning "Enable custom theme" on with
 * nothing filled in yet doesn't blank the interface.
 */
export interface CustomThemeColors {
  primary: string | null
  secondary: string | null
  accent: string | null
  background: string | null
  surface: string | null
  text: string | null
  muted_text: string | null
  border: string | null
}

export const EMPTY_CUSTOM_COLORS: CustomThemeColors = {
  primary: null,
  secondary: null,
  accent: null,
  background: null,
  surface: null,
  text: null,
  muted_text: null,
  border: null,
}

/** Readable near-black or near-white text for an arbitrary hex fill, by perceived brightness. */
export function foregroundForHex(hex: string): string {
  const m = /^#([0-9a-f]{6})$/i.exec(hex)
  if (!m) return 'oklch(0.98 0 0)'
  const n = parseInt(m[1]!, 16)
  const r = (n >> 16) & 0xff
  const g = (n >> 8) & 0xff
  const b = n & 0xff
  // Perceived brightness (ITU-R BT.601) — matches the industry-standard threshold
  // for picking black-vs-white text on an arbitrary background.
  const brightness = (r * 299 + g * 587 + b * 114) / 1000
  return brightness > 150 ? 'oklch(0.2 0.02 0)' : 'oklch(0.98 0 0)'
}

/**
 * The token set a custom theme writes onto :root — every token a preset can
 * set, plus the neutral surface tokens presets never touch. `base` is the
 * current preset's own tokens for the active scheme, used as the fallback for
 * any of the 8 fields the studio hasn't filled in yet.
 */
export function customThemeTokens(
  colors: CustomThemeColors,
  base: Record<string, string>,
): Record<string, string> {
  const out: Record<string, string> = { ...base }
  if (colors.primary) {
    out['--primary'] = colors.primary
    out['--ring'] = colors.primary
    out['--primary-foreground'] = foregroundForHex(colors.primary)
  }
  if (colors.secondary) {
    out['--brand'] = colors.secondary
    out['--brand-foreground'] = foregroundForHex(colors.secondary)
  }
  if (colors.accent) {
    out['--accent'] = colors.accent
    out['--accent-foreground'] = foregroundForHex(colors.accent)
  }
  if (colors.background) out['--background'] = colors.background
  if (colors.surface) out['--card'] = colors.surface
  if (colors.text) {
    out['--foreground'] = colors.text
    out['--card-foreground'] = colors.text
  }
  if (colors.muted_text) out['--muted-foreground'] = colors.muted_text
  if (colors.border) {
    out['--border'] = colors.border
    out['--input'] = colors.border
  }
  return out
}
