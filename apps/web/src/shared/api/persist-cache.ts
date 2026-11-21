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
 * - kept across releases (speed audit, 21 Nov: it used to be thrown away
 *   whenever packages/contracts changed, which was most deploys, so the
 *   first open after each release was slow again). Every restored answer is
 *   stale and asked for again at once, so an older shape is on screen only
 *   until the page's own request lands. Bump `CACHE_FORMAT` by hand when a
 *   change would make an old copy crash a page before that;
 * - the safety net: a screen that breaks in the first seconds after a
 *   restore forgets the copy and reloads the tab, once
 *   (`forgetCacheAfterCrash`, called by the error screens);
 * - a week at most, only answers that succeeded, never sign-in, tokens or
 *   the assistant's thread, and nothing over ~10 MB.
 */

/** Bump to throw away every device's copy, e.g. after a shape change old copies would crash on. */
export const CACHE_FORMAT = 'v2'

const DB = 'sa-cache'
const STORE = 'queries'
const SCOPE_KEY = 'sa-cache-scope'
const MAX_AGE = 7 * 24 * 3600_000
const MAX_BYTES = 10 * 1024 * 1024
const WRITE_EVERY = 2000

/** Query keys never kept: sessions, tokens, links that carry secrets, the assistant. */
const NEVER = new Set(['auth', 'session', 'assistant', 'calendar', 'token', 'tokens', 'refresh'])

type Stored = { buster: string; savedAt: number; state: DehydratedState }

const CRASH_KEY = 'sa-cache-crash-reload'
/** How long after a restore a crash is blamed on the restored copy. */
const CRASH_WINDOW = 15_000

const buster = () => CACHE_FORMAT

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
let restoredAt = 0

/** Put a saved copy into the cache, every restored answer marked stale. */
function putBack(qc: QueryClient, stored: Stored) {
  try {
    const keys = new Set(stored.state.queries.map((q) => q.queryHash))
    hydrate(qc, stored.state)
    restoredAt = Date.now()
    // A restored answer is shown, never trusted: mark each one stale so the
    // page that draws it also asks again. One saved under 30 s ago would
    // otherwise count as fresh, and a refresh pressed to see someone else's
    // change showed the old copy. Only the restored ones: an answer fetched
    // while a late copy was still being read stays fresh (hydrate never
    // overwrites a newer answer with an older one).
    void qc.invalidateQueries({
      predicate: (q) => keys.has(q.queryHash) && q.state.dataUpdatedAt <= stored.savedAt,
      refetchType: 'none',
    })
  } catch {
    /* a bad copy is simply not used */
  }
}

/**
 * Put back what the last person on this device had, before the first render.
 * Waits at most `budgetMs` so a slow disk never holds the app back; a copy
 * that arrives later is still put back, for the queries that have not been
 * answered by then, unless the session has moved to someone else meanwhile.
 */
export async function restoreCache(qc: QueryClient, budgetMs = 400): Promise<void> {
  scope = readScope()
  if (!scope) return
  const key = scope
  let late = false
  const read = idb<Stored>('readonly', (s) => s.get(key)).then((stored) => {
    if (late && scope === key && usable(stored, Date.now(), buster())) putBack(qc, stored)
    return stored
  })
  const stored = await Promise.race([read, new Promise<undefined>((r) => setTimeout(() => r(undefined), budgetMs))])
  if (stored === undefined) {
    late = true
    return
  }
  if (usable(stored, Date.now(), buster())) putBack(qc, stored)
}

/** Did a crash at `now` come soon enough after a restore at `at` to blame the copy? Pure, tested. */
export function crashAfterRestore(now: number, at: number): boolean {
  return at > 0 && now - at >= 0 && now - at < CRASH_WINDOW
}

/**
 * Called by the error screens. If a screen broke within seconds of a restore,
 * the restored copy may be the cause (an older shape): forget it and reload
 * the tab, at most once per tab. Answers whether a reload is on its way.
 */
export function forgetCacheAfterCrash(): boolean {
  if (!crashAfterRestore(Date.now(), restoredAt)) return false
  restoredAt = 0
  const old = scope ?? readScope()
  let reload = false
  try {
    if (!sessionStorage.getItem(CRASH_KEY)) {
      sessionStorage.setItem(CRASH_KEY, String(Date.now()))
      reload = true
    }
  } catch {
    /* storage blocked: forget the copy, but never risk a reload loop */
  }
  if (timer) clearTimeout(timer)
  timer = null
  const gone = old ? idb('readwrite', (s) => s.delete(old)) : Promise.resolve(null)
  if (reload) void gone.finally(() => window.location.reload())
  return reload
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

/** Is this query refreshed on a timer by any screen showing it? */
function isPoll(q: Query): boolean {
  try {
    return q.observers.some((o) => !!o.options.refetchInterval)
  } catch {
    return false
  }
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
    // A poll (the bell's count, reminders, the due chip: every minute) does
    // not by itself rewrite the whole copy; it rides along with the next save
    // something else causes, or the one when the tab is hidden.
    if (isPoll(e.query)) return
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
