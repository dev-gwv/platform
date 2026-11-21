import { useEffect } from 'react'
import { useRouter } from '@tanstack/react-router'
import type { NavEntry } from './nav'

/**
 * Every menu page's file, fetched in the background after sign-in (owner,
 * 12 Nov: "it should be just click, and it should come up, like when you open
 * up a folder on a laptop"). A page's file used to download on its first
 * click -- and again after every release, because each release names its
 * files anew -- so the first open of Data & Backup or Shoots waited on it.
 *
 * Waits until the browser is idle, then preloads one page every 300 ms so
 * the person's own clicks always come first. Nothing is shown and nothing is
 * fetched for a page the person cannot open (the list is the filtered menu).
 */
export function menuTargets(entries: readonly NavEntry[]): string[] {
  const out: string[] = []
  for (const e of entries) {
    const leaves = 'children' in e ? e.children : [e]
    for (const l of leaves) {
      out.push(l.to)
      // A menu line that is a hub (Money, Team's people, Projects…) opens its tabs too.
      for (const t of l.hub ?? []) out.push(t.to)
    }
  }
  return [...new Set(out.filter((t) => t.startsWith('/')))]
}

/**
 * Pages opened from a list rather than the menu, with an id in the address,
 * which `preloadRoute` cannot warm without one. The project page is the most
 * opened page there is, and its tabs are in its own file; its quotation and
 * editor are the next two clicks from it. The same imports as app/router.tsx,
 * so they are the very files the router asks for.
 */
const WARM_MODULES: readonly (() => Promise<unknown>)[] = [
  () => import('@/routes/projects/detail'),
  () => import('@/routes/projects/$id.quotation'),
  () => import('@/routes/projects/$id.edit'),
]

export function useWarmPages(entries: readonly NavEntry[], enabled: boolean) {
  const router = useRouter()
  const key = menuTargets(entries).join('|')
  useEffect(() => {
    if (!enabled || !key) return
    // A phone on a metered or very slow link is left alone.
    const conn = (navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } }).connection
    if (conn?.saveData || conn?.effectiveType === '2g' || conn?.effectiveType === 'slow-2g') return
    const targets = key.split('|')
    const projectsOpen = targets.includes('/projects')
    const jobs: (() => void)[] = [
      // First, the project page: the next click from Home or Projects more often
      // than any menu line. Only for whoever has Projects in their menu; staff
      // have their own project page.
      ...(projectsOpen ? WARM_MODULES.map((load) => () => void load().catch(() => undefined)) : []),
      ...targets.map((to) => () => void router.preloadRoute({ to } as never).catch(() => undefined)),
    ]
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | null = null
    const step = (i: number) => {
      if (cancelled || i >= jobs.length) return
      jobs[i]!()
      timer = setTimeout(() => step(i + 1), 300)
    }
    const ric = (globalThis as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }).requestIdleCallback
    const idle = (cb: () => void) => (ric ? ric(cb, { timeout: 4000 }) : setTimeout(cb, 1500))
    const start = setTimeout(() => idle(() => step(0)), 1200)
    return () => {
      cancelled = true
      clearTimeout(start)
      if (timer) clearTimeout(timer)
    }
  }, [router, key, enabled])
}
