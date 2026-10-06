import { useSyncExternalStore } from 'react'
import type { HelpLang } from './tutorials'

/**
 * English or Hindi for the tutorials and the guide. Remembered on this
 * device, so the next video plays in the language picked last; `?lang=hi` on
 * a link (sent on WhatsApp) opens in Hindi. A choice the browser cannot store
 * still holds for the visit.
 */
const STORE = 'help-lang'
let current: HelpLang | null = null
const listeners = new Set<() => void>()

function read(): HelpLang {
  if (current) return current
  try {
    const q = new URLSearchParams(window.location.search).get('lang')
    if (q === 'hi' || q === 'en') return (current = q)
    current = window.localStorage.getItem(STORE) === 'hi' ? 'hi' : 'en'
  } catch {
    current = 'en'
  }
  return current
}

export function setHelpLang(lang: HelpLang) {
  current = lang
  try {
    window.localStorage.setItem(STORE, lang)
  } catch {
    // Private window: it still holds for this visit.
  }
  for (const l of listeners) l()
}

function subscribe(l: () => void) {
  listeners.add(l)
  return () => listeners.delete(l)
}

export function useHelpLang(): [HelpLang, (lang: HelpLang) => void] {
  const lang = useSyncExternalStore(subscribe, read, () => 'en' as HelpLang)
  return [lang, setHelpLang]
}

export const LANG_LABEL: Record<HelpLang, string> = { en: 'English', hi: 'हिन्दी' }
