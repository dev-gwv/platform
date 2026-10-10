import { themeFontKey, type ThemeFontKey } from '@ipc/contracts'

/**
 * The typefaces a studio can pick from.
 *
 * Each is a Google font loaded on demand, with a real system fallback behind
 * it: a studio on a bad connection gets the fallback stack, not a blank page.
 * `--font-sans` is the only thing that changes — every surface already reads
 * that token, so a face swap needs no component to know about it.
 */
interface FontOption {
  key: ThemeFontKey
  /** The family name, as Google serves it and as CSS must spell it. */
  family: string
  /** Who it suits — shown on the theme card next to the sample. */
  hint: string
  /** Fallback stack, used before the webfont lands and if it never does. */
  fallback: string
  /** Weights we actually render, kept short so the request stays small. */
  weights: string
}

const SANS = "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"
const SERIF = "ui-serif, Georgia, Cambria, 'Times New Roman', serif"

export const FONT_OPTIONS: Readonly<Record<ThemeFontKey, FontOption>> = {
  inter: {
    key: 'inter',
    family: 'Inter',
    hint: 'Best as a balanced starting point',
    fallback: SANS,
    weights: '400;500;600;700',
  },
  playfair: {
    key: 'playfair',
    family: 'Playfair Display',
    hint: 'Best for premium wedding studios',
    fallback: SERIF,
    weights: '400;500;600;700',
  },
  poppins: {
    key: 'poppins',
    family: 'Poppins',
    hint: 'Best for creative modern brands',
    fallback: SANS,
    weights: '400;500;600;700',
  },
  lato: {
    key: 'lato',
    family: 'Lato',
    hint: 'Best for soft wedding brands',
    fallback: SANS,
    weights: '400;700',
  },
  manrope: {
    key: 'manrope',
    family: 'Manrope',
    hint: 'Best for luxury portfolio brands',
    fallback: SANS,
    weights: '400;500;600;700',
  },
  open_sans: {
    key: 'open_sans',
    family: 'Open Sans',
    hint: 'Best for modern agencies',
    fallback: SANS,
    weights: '400;500;600;700',
  },
  nunito: {
    key: 'nunito',
    family: 'Nunito Sans',
    hint: 'Best for calm professional brands',
    fallback: SANS,
    weights: '400;600;700',
  },
  merriweather: {
    key: 'merriweather',
    family: 'Merriweather',
    hint: 'Best for artisan creative studios',
    fallback: SERIF,
    weights: '400;700',
  },
}

export const FONT_KEYS = Object.keys(FONT_OPTIONS) as ThemeFontKey[]

/** A stored key that no longer exists must not blank the app's typography. */
export const fontOr = (key: string | null | undefined, fallback: ThemeFontKey): FontOption =>
  FONT_OPTIONS[(key ?? '') as ThemeFontKey] ?? FONT_OPTIONS[fallback]

/** The value written to `--font-sans`. */
export const fontStack = (font: FontOption): string => `'${font.family}', ${font.fallback}`

/** Google Fonts CSS2 URL for one family. `swap` so text paints immediately. */
export const fontHref = (font: FontOption): string =>
  `https://fonts.googleapis.com/css2?family=${font.family.replace(/ /g, '+')}:wght@${font.weights}&display=swap`

/**
 * Add the stylesheet for a face, once. Loading is additive on purpose: a studio
 * comparing themes flips through several fonts in a few seconds, and removing
 * the previous link would re-request it on the way back.
 */
export function loadFont(font: FontOption): void {
  const id = `font-${font.key}`
  if (document.getElementById(id)) return
  const link = document.createElement('link')
  link.id = id
  link.rel = 'stylesheet'
  link.href = fontHref(font)
  document.head.append(link)
}

/** Every key the contract allows, so the picker can never drift from it. */
export const FONT_CONTRACT_KEYS = themeFontKey.options
