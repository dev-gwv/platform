import { useCallback, useEffect, useRef, useState } from 'react'
import { History, X } from 'lucide-react'
import { useAuth } from '@/shared/auth/AuthProvider'

/** Drafts older than this are stale: the job they were for has moved on. */
const MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000
const PREFIX = 'ipc.draft.'

interface Stored<T> {
  v: T
  at: number
}

function storageKey(userId: string, key: string) {
  return `${PREFIX}${userId}.${key}`
}

function read<T>(k: string): Stored<T> | null {
  try {
    const raw = localStorage.getItem(k)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Stored<T>
    if (!parsed || typeof parsed.at !== 'number' || Date.now() - parsed.at > MAX_AGE_MS) {
      localStorage.removeItem(k)
      return null
    }
    return parsed
  } catch {
    return null
  }
}

/**
 * Keeps what someone is typing in a form safe on this device: every change is
 * saved as they go, and if the page is refreshed, the tab closed or a stray
 * click navigates away, opening the same form again brings it all back. The
 * draft is dropped once the form is saved (`clear`) or the person chooses to
 * start fresh (`discard`).
 *
 * `key` names the form ("invoice:new", "invoice:edit:<id>"); null switches
 * the draft off (e.g. while a dialog is closed). Drafts are per signed-in
 * person, so a shared computer does not hand one person's work to another.
 * `isBlank` says when there is nothing worth keeping, so an untouched form
 * never offers to "restore" emptiness. Without it, the form as it first
 * opened counts as blank: only real changes are kept.
 */
export function useFormDraft<T>(
  key: string | null,
  value: T,
  restore: (v: T) => void,
  { isBlank, warnOnLeave = true }: { isBlank?: (v: T) => boolean; warnOnLeave?: boolean } = {},
) {
  const { session } = useAuth()
  const k = key && session ? storageKey(session.user_id, key) : null
  const [restoredAt, setRestoredAt] = useState<number | null>(null)
  const [savedAt, setSavedAt] = useState<number | null>(null)
  const loadedFor = useRef<string | null>(null)
  const baseline = useRef<string | null>(null)
  const skipNext = useRef(false)
  const dirty = useRef(false)
  const restoreRef = useRef(restore)
  restoreRef.current = restore

  // A closed form (key gone) is ready to load afresh when it opens again.
  useEffect(() => {
    if (!k) loadedFor.current = null
  }, [k])

  // Bring back what was there, once per form opening.
  useEffect(() => {
    if (!k || loadedFor.current === k) return
    loadedFor.current = k
    baseline.current = JSON.stringify(value)
    const found = read<T>(k)
    if (found && !(isBlank ? isBlank(found.v) : JSON.stringify(found.v) === baseline.current)) {
      skipNext.current = true
      restoreRef.current(found.v)
      setRestoredAt(found.at)
      setSavedAt(found.at)
    }
  }, [k])

  // Save as they type, a moment after they stop.
  const serialized = JSON.stringify(value)
  useEffect(() => {
    if (!k || loadedFor.current !== k) return
    if (skipNext.current) {
      skipNext.current = false
      return
    }
    const t = setTimeout(() => {
      try {
        if (isBlank ? isBlank(value) : serialized === baseline.current) {
          localStorage.removeItem(k)
          dirty.current = false
          return
        }
        localStorage.setItem(k, JSON.stringify({ v: value, at: Date.now() } satisfies Stored<T>))
        dirty.current = true
        setSavedAt(Date.now())
      } catch {
        // Storage full or blocked: the form still works, it just is not kept.
      }
    }, 400)
    return () => clearTimeout(t)
    // `value` is represented by `serialized`.
  }, [k, serialized])

  // A refresh or a closed tab with unsaved work asks first.
  useEffect(() => {
    if (!k || !warnOnLeave) return
    const onLeave = (e: BeforeUnloadEvent) => {
      if (!dirty.current) return
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', onLeave)
    return () => window.removeEventListener('beforeunload', onLeave)
  }, [k, warnOnLeave])

  /** The form was saved for real: nothing left to keep. */
  const clear = useCallback(() => {
    if (!k) return
    try {
      localStorage.removeItem(k)
    } catch {
      /* ignore */
    }
    dirty.current = false
    setRestoredAt(null)
    setSavedAt(null)
  }, [k])

  return { restoredAt, savedAt, clear, dismissRestored: () => setRestoredAt(null) }
}

/** "5 min ago", for the restored banner and the "saved" hint. */
export function agoText(at: number): string {
  const s = Math.max(0, Math.round((Date.now() - at) / 1000))
  if (s < 45) return 'just now'
  const m = Math.round(s / 60)
  if (m < 60) return `${m} min ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h} hr ago`
  return `${Math.round(h / 24)} days ago`
}

/**
 * The line that tells someone their unsaved work came back, with a way to
 * throw it away and start fresh instead.
 */
export function DraftRestoredBanner({ at, onDiscard, onDismiss }: { at: number | null; onDiscard: () => void; onDismiss: () => void }) {
  if (!at) return null
  return (
    <div role="status" className="flex flex-wrap items-center gap-2 rounded-lg border border-tone-blue/30 bg-tone-blue-soft px-3 py-2 text-sm text-tone-blue">
      <History className="size-4 shrink-0" aria-hidden />
      <span className="flex-1">We brought back what you were typing ({agoText(at)}). It was not saved yet.</span>
      <button type="button" onClick={onDiscard} className="font-medium underline underline-offset-2 hover:no-underline">
        Start fresh
      </button>
      <button type="button" onClick={onDismiss} aria-label="Close" className="rounded p-0.5 hover:bg-black/5">
        <X className="size-4" />
      </button>
    </div>
  )
}
