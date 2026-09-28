import { useSyncExternalStore } from 'react'

/**
 * "Install app": Chrome and Edge (Android and desktop) offer to put the app on
 * the home screen, but only through an event we must catch and keep. iPhone
 * has no such event; there it is Share → Add to Home Screen.
 */
interface InstallPrompt extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

let deferred: InstallPrompt | null = null
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((l) => l())

export function registerPwa() {
  if (typeof window === 'undefined') return
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault()
    deferred = e as InstallPrompt
    emit()
  })
  window.addEventListener('appinstalled', () => {
    deferred = null
    emit()
  })
  if ('serviceWorker' in navigator && import.meta.env.PROD) {
    window.addEventListener('load', () => void navigator.serviceWorker.register('/sw.js').catch(() => {}))
  }
}

export const isStandalone = () =>
  typeof window !== 'undefined' &&
  (window.matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true)

const isIos = () => typeof navigator !== 'undefined' && /iphone|ipad|ipod/i.test(navigator.userAgent)

/** 'prompt' when the browser can install in one tap, 'ios' for the Share-menu hint, null when installed or unsupported. */
export function useInstall(): { kind: 'prompt' | 'ios' | null; install: () => Promise<void> } {
  const available = useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => deferred !== null,
    () => false,
  )
  const kind = isStandalone() ? null : available ? 'prompt' : isIos() ? 'ios' : null
  return {
    kind,
    install: async () => {
      if (!deferred) return
      await deferred.prompt()
      await deferred.userChoice
      deferred = null
      emit()
    },
  }
}
