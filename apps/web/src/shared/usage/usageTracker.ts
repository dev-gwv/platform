// Lovable parity: usageTracker (simplified port of src/lib/usageTracker.ts).
// - One session per tab (sessionStorage).
// - 60s heartbeat while tab is visible.
// - POST /activity/track {route} with a route→module map.
// - Fails silently. Never blocks UI. Separate from activity_log by design.

const SESSION_KEY = 'ipc:usageSession'
const HEARTBEAT_MS = 60_000

let sessionId: string | null = null
let heartbeatTimer: number | null = null

const ROUTE_MODULE_MAP: { prefix: string; module: string }[] = [
  { prefix: '/projects', module: 'projects' },
  { prefix: '/shoots', module: 'shoots' },
  { prefix: '/employees', module: 'team' },
  { prefix: '/team-allocation', module: 'team' },
  { prefix: '/team', module: 'team' },
  { prefix: '/tasks', module: 'tasks' },
  { prefix: '/billing', module: 'billing' },
  { prefix: '/data-management', module: 'data' },
  { prefix: '/attendance', module: 'attendance' },
  { prefix: '/reminders', module: 'reminders' },
  { prefix: '/clients', module: 'clients' },
  { prefix: '/financials', module: 'financials' },
  { prefix: '/enquiries', module: 'enquiries' },
  { prefix: '/company-expenses', module: 'expenses' },
  { prefix: '/notifications', module: 'notifications' },
  { prefix: '/settings', module: 'settings' },
  { prefix: '/dashboard', module: 'dashboard' },
  { prefix: '/platform', module: 'platform' },
]

function getOrCreateSessionId(): string {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as { id?: string }
      if (parsed?.id) return parsed.id
    }
  } catch { /* ignore */ }
  const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
  try {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify({ id, started: new Date().toISOString() }))
  } catch { /* ignore */ }
  return id
}

function moduleFor(route: string): string {
  return ROUTE_MODULE_MAP.find((r) => route.startsWith(r.prefix))?.module ?? 'other'
}

async function post(route: string, heartbeat: boolean) {
  if (!sessionId) return
  try {
    const { callApi } = await import('@/shared/api/client')
    const { z } = await import('@ipc/contracts')
    await callApi('/activity/track', {
      method: 'POST',
      body: {
        route: route.slice(0, 200),
        module: moduleFor(route),
        event_name: heartbeat ? 'heartbeat' : 'route_viewed',
        session_id: sessionId,
        user_agent: navigator.userAgent.slice(0, 400),
        heartbeat,
      },
      responseSchema: z.object({ ok: z.boolean() }),
    }).catch(() => null)
  } catch { /* silent */ }
}

export function trackRouteView(pathname: string) {
  if (!sessionId) return
  void post(pathname, false)
}

export function startUsageTracking(getRoute: () => string) {
  if (typeof window === 'undefined') return () => undefined
  if (sessionId) return () => undefined
  sessionId = getOrCreateSessionId()
  void post(getRoute(), false)
  heartbeatTimer = window.setInterval(() => {
    if (document.visibilityState !== 'visible') return
    void post(getRoute(), true)
  }, HEARTBEAT_MS)
  const onHide = () => { void post(getRoute(), true) }
  document.addEventListener('visibilitychange', onHide)
  return () => {
    if (heartbeatTimer != null) window.clearInterval(heartbeatTimer)
    heartbeatTimer = null
    document.removeEventListener('visibilitychange', onHide)
    sessionId = null
  }
}
