import { useEffect, useRef } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { toast } from 'sonner'
import { crmActivity, myFollowUp } from '@ipc/contracts'
import { callApi } from '@/shared/api/client'
import { useAuth } from '@/shared/auth/AuthProvider'
import { useAccess } from '@/shared/auth/useAccess'
import { shouldRemind } from './follow-ups'

type Due = { id: string; lead_id: string | null; lead_name: string | null; lead_phone: string | null; subject: string | null; body?: string | null; due_at: string | null }

/**
 * "Call in 10 min · Aanya": a nudge on whatever page you are on, for your own
 * follow-ups, in the ten minutes before each is due -- the one it was given
 * to, else the lead's owner, else whoever wrote it, so a lead given to a team
 * member reminds only them (owner, 25 Oct). People with the CRM read their
 * follow-ups from it; everyone else from /me/follow-ups, so a team member
 * given a lead is reminded too. It stays on screen until they act on it or
 * close it, with Call and Open right there, and never repeats itself.
 */
export function FollowUpReminders() {
  const { session } = useAuth()
  const access = useAccess()
  const navigate = useNavigate()
  const told = useRef(new Set<string>())
  const crm = access.hasModule('crm')

  const q = useQuery({
    queryKey: ['crm', 'reminders', crm],
    queryFn: async (): Promise<Due[]> =>
      crm
        ? callApi(
            `/crm/activities?open_tasks=1&mine=1&due_before=${encodeURIComponent(new Date(Date.now() + 3600_000).toISOString())}&limit=50`,
            { responseSchema: crmActivity.array() },
          )
        : callApi('/me/follow-ups', { responseSchema: myFollowUp.array() }),
    enabled: !!session,
    refetchInterval: 60_000,
    refetchIntervalInBackground: true,
    staleTime: 30_000,
  })

  useEffect(() => {
    if (!session) return
    const check = () => {
      const now = new Date()
      for (const t of q.data ?? []) {
        if (!t.due_at || told.current.has(t.id) || !shouldRemind(t.due_at, now)) continue
        told.current.add(t.id)
        const mins = Math.max(0, Math.round((new Date(t.due_at).getTime() - now.getTime()) / 60_000))
        const phone = t.lead_phone
        toast(`${t.subject ?? 'Follow-up'} ${mins === 0 ? 'now' : `in ${mins} min`} · ${t.lead_name ?? 'a lead'}`, {
          id: `follow-up:${t.id}`,
          description: [phone, t.body].filter(Boolean).join(' · ') || undefined,
          duration: Number.POSITIVE_INFINITY,
          closeButton: true,
          action: t.lead_id
            ? { label: 'Open', onClick: () => void navigate({ to: '/follow-ups', search: { lead: t.lead_id } as never }) }
            : undefined,
          cancel: phone
            ? {
                label: 'Call',
                onClick: () => {
                  window.location.href = `tel:${phone.replace(/[^\d+]/g, '')}`
                },
              }
            : undefined,
        })
      }
    }
    check()
    const id = setInterval(check, 30_000)
    return () => clearInterval(id)
  }, [session, q.data, navigate])

  return null
}
