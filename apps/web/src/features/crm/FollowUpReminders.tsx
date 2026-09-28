import { useEffect, useRef } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { toast } from 'sonner'
import { crmActivity } from '@ipc/contracts'
import { callApi } from '@/shared/api/client'
import { useAuth } from '@/shared/auth/AuthProvider'
import { useAccess } from '@/shared/auth/useAccess'
import { shouldRemind } from './follow-ups'

/**
 * "Follow-up in 10 min · Aanya": a nudge on whatever page you are on, for
 * your own follow-ups, in the ten minutes before each is due. Asks once a
 * minute for the next hour's tasks and never repeats itself. The Control
 * Center's follow-up board does the same; a promise nobody is reminded of is
 * a promise kept by luck.
 */
export function FollowUpReminders() {
  const { session } = useAuth()
  const access = useAccess()
  const navigate = useNavigate()
  const told = useRef(new Set<string>())
  const on = !!session && access.hasModule('crm')

  const q = useQuery({
    queryKey: ['crm', 'reminders'],
    queryFn: () =>
      callApi(
        `/crm/activities?open_tasks=1&mine=1&due_before=${encodeURIComponent(new Date(Date.now() + 3600_000).toISOString())}&limit=50`,
        { responseSchema: crmActivity.array() },
      ),
    enabled: on,
    refetchInterval: 60_000,
    refetchIntervalInBackground: true,
    staleTime: 30_000,
  })

  useEffect(() => {
    if (!on) return
    const check = () => {
      const now = new Date()
      for (const t of q.data ?? []) {
        if (!t.due_at || told.current.has(t.id) || !shouldRemind(t.due_at, now)) continue
        told.current.add(t.id)
        const mins = Math.max(0, Math.round((new Date(t.due_at).getTime() - now.getTime()) / 60_000))
        toast(`${t.subject ?? 'Follow-up'} ${mins === 0 ? 'now' : `in ${mins} min`} · ${t.lead_name ?? 'a lead'}`, {
          description: t.body ?? undefined,
          duration: 15_000,
          action: t.lead_id
            ? { label: 'Open', onClick: () => void navigate({ to: '/follow-ups', search: { lead: t.lead_id } as never }) }
            : undefined,
        })
      }
    }
    check()
    const id = setInterval(check, 30_000)
    return () => clearInterval(id)
  }, [on, q.data, navigate])

  return null
}
