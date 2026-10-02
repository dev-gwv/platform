import { useMemo } from 'react'
import { Copy, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { useQuery } from '@tanstack/react-query'
import { shootListItem, type LeaveRequest, type ShootListItem, type TeamMember, type TeamSlot } from '@ipc/contracts'
import { callApi } from '@/shared/api/client'
import { useAuth } from '@/shared/auth/AuthProvider'
import { Button } from '@/shared/ui/button'
import { todayInIndia } from '@/shared/ui/days-left'
import { useBookSlots } from '@/features/allocation/api'
import { copyResultLine, isLive, localDay, sameCrewPlan, shootHours, suggestedPayout } from './assign'

const list = shootListItem.array()

/** "Mehendi and Wedding", "Haldi, Mehendi and Wedding". */
function names(xs: readonly string[]): string {
  if (xs.length <= 1) return xs[0] ?? ''
  return `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`
}

/**
 * "Book the same people for Mehendi and Wedding?" -- once a day has its crew,
 * one tap books them on the project's other coming days in the same roles,
 * at each day's own hours and usual rates. Busy, on-leave and unneeded seats
 * are skipped and the toast names who and why. Hidden when there is nothing
 * to copy.
 */
export function CopyTeamBar({
  shoot,
  slots,
  members,
  leaves,
}: {
  shoot: ShootListItem
  slots: readonly TeamSlot[]
  members: readonly TeamMember[]
  leaves: readonly Pick<LeaveRequest, 'user_id' | 'start_date' | 'end_date' | 'half_day' | 'status'>[]
}) {
  const { session } = useAuth()
  const book = useBookSlots()
  const shoots = useQuery({
    queryKey: ['shoots', 'project', shoot.project_id],
    queryFn: () => callApi(`/shoots?project_id=${shoot.project_id}`, { responseSchema: list }),
    enabled: !!session && !!shoot.project_id,
    staleTime: 15_000,
  })
  const today = todayInIndia()
  const byId = useMemo(() => new Map(members.map((m) => [m.user_id, m])), [members])

  const plan = useMemo(() => {
    const crew = slots
      .filter((s) => s.shoot_id === shoot.id && isLive(s) && s.service_name)
      .map((s) => ({ user_id: s.user_id, name: byId.get(s.user_id)?.name ?? s.user_name ?? 'Someone', role: s.service_name! }))
    const targets = (shoots.data ?? []).filter(
      (t) => t.id !== shoot.id && t.status !== 'cancelled' && t.requirements.length > 0 && (!t.start_at || localDay(t.start_at) >= today),
    )
    return { crew, targets, ...sameCrewPlan({ crew, targets, slots, leaves }) }
  }, [slots, shoot.id, shoots.data, byId, leaves, today])

  if (plan.crew.length === 0 || plan.book.length === 0) return null
  const days = [...new Set(plan.book.map((b) => b.shoot_name))]

  async function copy() {
    const items = plan.book.map((b) => {
      const m = byId.get(b.user_id)
      const t = plan.targets.find((x) => x.id === b.shoot_id)
      const rate = m ? suggestedPayout(m, { shootName: b.shoot_name, hours: t ? shootHours(t) : null }) : null
      return {
        user_id: b.user_id,
        shoot_id: b.shoot_id,
        service_name: b.service_name,
        start_at: b.start_at,
        end_at: b.end_at,
        ...(rate != null ? { estimated_cost: rate } : {}),
        cost_status: 'tentative' as const,
      }
    })
    try {
      const { results } = await book.mutateAsync(items)
      const ok = results.filter((r) => r.id).length
      const refused = results
        .filter((r) => !r.id)
        .map((r) => ({ ...plan.book[r.index]!, name: byId.get(plan.book[r.index]!.user_id)?.name ?? 'Someone', why: 'busy' as const }))
      toast.success(copyResultLine(ok, [...plan.skipped, ...refused]))
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'We could not book them.')
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2 text-sm">
      <Copy className="size-4 shrink-0 text-primary" aria-hidden />
      <span className="min-w-0 flex-1">
        Book the same people for <span className="font-medium">{names(days)}</span>? Busy people are skipped.
      </span>
      <Button size="sm" variant="outline" onClick={() => void copy()} disabled={book.isPending}>
        {book.isPending && <Loader2 className="animate-spin" />} Book {plan.book.length} on {days.length === 1 ? 'that day' : 'those days'}
      </Button>
    </div>
  )
}
