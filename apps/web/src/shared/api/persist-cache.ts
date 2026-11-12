import { dehydrate, hydrate, type DehydratedState, type Query, type QueryClient } from '@tanstack/react-query'

/**
 * Pages open from memory, every time (owner, 12 Nov: "once I open any tab ...
 * on the second click it should load up very fast ... make it a permanent
 * thing").
 *
 * What the app has read is kept on this device, in IndexedDB, for the person
 * and studio it belongs to. On the next start -- a refresh, a new tab, the
 * desktop or phone app opened tomorrow -- it is put back before the first
 * page draws, so a page opened before shows at once and refreshes itself
 * quietly behind (each restored answer keeps its old time, so it counts as
 * stale and is asked for again).
 *
 * Kept safe:
 * - per person and studio: a different login, or Switch studio, never sees
 *   another's rows (`setCacheScope`); signing out deletes it (`forgetCache`);
 * - the shape guard: it is thrown away when the contracts the app reads
 *   change (`__CONTRACTS_HASH__`, set at build time), so an old shape never
 *   reaches new code;
 * - a week at most, only answers that succeeded, never sign-in, tokens or
 *   the assistant's thread, and nothing over ~10 MB.
 */

declare const __CONTRACTS_HASH__: string

const DB = 'sa-cache'
const STORE = 'queries'
const SCOPE_KEY = 'sa-cache-scope'
const MAX_AGE = 7 * 24 * 3600_000
const MAX_BYTES = 10 * 1024 * 1024
const WRITE_EVERY = 2000

/** Query keys never kept: sessions, tokens, links that carry secrets, the assistant. */
const NEVER = new Set(['auth', 'session', 'assistant', 'calendar', 'token', 'tokens', 'refresh'])

type Stored = { buster: string; savedAt: number; state: DehydratedState }

const buster = () => (typeof __CONTRACTS_HASH__ === 'string' ? __CONTRACTS_HASH__ : 'dev')

/** May this query be kept on the device? Pure, tested. */
export function keepQuery(q: Pick<Query, 'queryKey' | 'state'>): boolean {
  if (q.state.status !== 'success' || q.state.data === undefined) return false
  const first = q.queryKey[0]
  if (typeof first === 'string' && NEVER.has(first)) return false
  return !q.queryKey.some((k) => typeof k === 'string' && /token|password|secret/i.test(k))
}

/** Is a saved copy still good to restore? Pure, tested. */
export function usable(stored: Stored | undefined | null, now: number, want: string): stored is Stored {
  return !!stored && stored.buster === want && now - stored.savedAt < MAX_AGE && !!stored.state
}

function openDb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      if (typeof indexedDB === 'undefined') return resolve(null)
      const req = indexedDB.open(DB, 1)
      req.onupgradeneeded = () => req.result.createObjectStore(STORE)
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => resolve(null)
      req.onblocked = () => resolve(null)
    } catch {
      resolve(null)
    }
  })
}

async function idb<T>(mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest | void): Promise<T | null> {
  const db = await openDb()
  if (!db) return null
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, mode)
      const req = run(tx.objectStore(STORE))
      tx.oncomplete = () => resolve(req ? (req.result as T) : null)
      tx.onerror = () => resolve(null)
      tx.onabort = () => resolve(null)
    } catch {
      resolve(null)
    }
  })
}

function readScope(): string | null {
  try {
    return localStorage.getItem(SCOPE_KEY)
  } catch {
    return null
  }
}

function writeScope(scope: string | null) {
  try {
    if (scope) localStorage.setItem(SCOPE_KEY, scope)
    else localStorage.removeItem(SCOPE_KEY)
  } catch {
    /* storage blocked: nothing is kept */
  }
}

let scope: string | null = null
let timer: ReturnType<typeof setTimeout> | null = null

/**
 * Put back what the last person on this device had, before the first render.
 * Waits at most `budgetMs` so a slow disk never holds the app back.
 */
export async function restoreCache(qc: QueryClient, budgetMs = 400): Promise<void> {
  scope = readScope()
  if (!scope) return
  const key = scope
  const read = idb<Stored>('readonly', (s) => s.get(key))
  const stored = await Promise.race([read, new Promise<null>((r) => setTimeout(() => r(null), budgetMs))])
  if (usable(stored, Date.now(), buster())) {
    try {
      hydrate(qc, stored.state)
    } catch {
      /* a bad copy is simply not used */
    }
  }
}

/**
 * Who the cache belongs to, once the session is known. A different person or
 * studio than the one restored drops what was put back.
 */
export function setCacheScope(qc: QueryClient, userId: string, companyId: string) {
  const next = `${userId}:${companyId}`
  if (scope && scope !== next) {
    qc.clear()
    void idb('readwrite', (s) => s.delete(scope as string))
  }
  scope = next
  writeScope(next)
}

/** Sign-out and studio switch: forget this device's copy. */
export function forgetCache() {
  const old = scope ?? readScope()
  scope = null
  writeScope(null)
  if (timer) clearTimeout(timer)
  timer = null
  if (old) void idb('readwrite', (s) => s.delete(old))
}

/** Save the cache a moment after it changes, at most every two seconds. */
export function persistCache(qc: QueryClient): () => void {
  const save = () => {
    timer = null
    if (!scope) return
    const key = scope
    const state = dehydrate(qc, { shouldDehydrateQuery: keepQuery, shouldDehydrateMutation: () => false })
    let size = 0
    try {
      size = JSON.stringify(state).length
    } catch {
      return
    }
    if (size > MAX_BYTES) return
    const stored: Stored = { buster: buster(), savedAt: Date.now(), state }
    void idb('readwrite', (s) => s.put(stored, key))
  }
  const unsub = qc.getQueryCache().subscribe((e) => {
    if (e.type !== 'updated' || e.action.type !== 'success') return
    if (!timer) timer = setTimeout(save, WRITE_EVERY)
  })
  const onHide = () => {
    if (document.visibilityState === 'hidden' && timer) {
      clearTimeout(timer)
      save()
    }
  }
  document.addEventListener('visibilitychange', onHide)
  return () => {
    unsub()
    document.removeEventListener('visibilitychange', onHide)
  }
}
