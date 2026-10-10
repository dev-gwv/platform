import { useQuery } from '@tanstack/react-query'
import { deliverableWorkload, type DeliverableType, type DeliverableWorkload, type TeamMember } from '@ipc/contracts'
import { callApi } from '@/shared/api/client'
import { useAuth } from '@/shared/auth/AuthProvider'
import { useAccess } from '@/shared/auth/useAccess'
import { todayInIndia } from '@/shared/ui/days-left'

/**
 * Giving a deliverable to an editor: who already has how much, and the due
 * date to suggest when there is none yet.
 */

/** Anyone whose job role says edit, retouch, design or colour goes first. */
const isEditorRole = (roles: readonly string[]) => roles.some((r) => /edit|retouch|design|colou?r/i.test(r))

/** "Free", "2 in hand", "3 in hand · 1 late", "2 in hand · 1 due this week". */
export function workloadText(w: Pick<DeliverableWorkload, 'open' | 'late' | 'due_week'> | undefined): string {
  if (!w || w.open === 0) return 'Free'
  const parts = [`${w.open} in hand`]
  if (w.late > 0) parts.push(`${w.late} late`)
  else if (w.due_week > 0) parts.push(`${w.due_week} due this week`)
  return parts.join(' · ')
}

/** Editors first, then the least loaded, then by name. */
export function orderPeople(
  people: readonly TeamMember[],
  load: ReadonlyMap<string, DeliverableWorkload>,
): TeamMember[] {
  return [...people].sort(
    (a, b) =>
      Number(isEditorRole(b.role_names)) - Number(isEditorRole(a.role_names)) ||
      (load.get(a.user_id)?.open ?? 0) - (load.get(b.user_id)?.open ?? 0) ||
      a.name.localeCompare(b.name),
  )
}

/**
 * Where "Me" sits in the list: among the editors when the person is one,
 * otherwise straight after them -- the editors always come first.
 */
export function placeMe<T extends Pick<TeamMember, 'role_names'>>(ordered: readonly T[], me: T | null | undefined): T[] {
  if (!me) return [...ordered]
  if (isEditorRole(me.role_names)) return [me, ...ordered]
  const firstOther = ordered.findIndex((p) => !isEditorRole(p.role_names))
  const at = firstOther === -1 ? ordered.length : firstOther
  return [...ordered.slice(0, at), me, ...ordered.slice(at)]
}

/** Days the work needs when the studio has not said: by what it is. */
export function defaultWorkDays(title: string): number {
  const t = title.toLowerCase()
  if (/teaser|reel|short|trailer/.test(t)) return 5
  if (/album|book/.test(t)) return 20
  if (/full film|documentary|feature|traditional/.test(t)) return 20
  if (/film|highlight|video|cinematic/.test(t)) return 12
  return 10
}

/**
 * The due date to suggest: what is set already, else today plus the days the
 * studio gave this kind of work (Settings → deliverable types), else a sensible
 * number for what it is.
 */
export function suggestDue(
  d: { title: string; estimated_date?: string | null | undefined },
  types: readonly Pick<DeliverableType, 'title' | 'work_days'>[],
  today = todayInIndia(),
): string {
  if (d.estimated_date) return d.estimated_date
  const own = types.find((t) => t.title.trim().toLowerCase() === d.title.trim().toLowerCase())?.work_days
  const days = own && own > 0 ? own : defaultWorkDays(d.title)
  const at = new Date(`${today}T00:00:00Z`)
  at.setUTCDate(at.getUTCDate() + days)
  return at.toISOString().slice(0, 10)
}

export function useWorkload() {
  const { session } = useAuth()
  const can = useAccess().hasAction('projects', 'edit')
  return useQuery({
    queryKey: ['projects', 'workload'],
    queryFn: () => callApi('/projects/deliverables/workload', { responseSchema: deliverableWorkload.array() }),
    enabled: !!session && can,
    staleTime: 30_000,
    select: (rows) => new Map(rows.map((r) => [r.user_id, r])),
  })
}
