import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { z } from '@ipc/contracts'
import { callApi } from '@/shared/api/client'
import { useAuth } from '@/shared/auth/AuthProvider'
import { Card, CardContent } from '@/shared/ui/card'
import { Switch } from '@/shared/ui/switch'

const setting = z.object({ on: z.boolean(), applies: z.boolean().default(true) })
const KEY = ['settings', 'morning-email'] as const

/**
 * The 8 am email for owners and admins (0198): the switch to stop it or bring
 * it back. Shown only to the people it goes to.
 */
export function MorningEmailCard() {
  const { session } = useAuth()
  const qc = useQueryClient()
  const q = useQuery({
    queryKey: KEY,
    queryFn: () => callApi('/settings/morning-email', { responseSchema: setting }),
    enabled: !!session,
    staleTime: 60_000,
  })
  const save = useMutation({
    mutationFn: (on: boolean) =>
      callApi('/settings/morning-email', { method: 'PUT', body: { on }, responseSchema: setting.pick({ on: true }) }),
    onSuccess: (r) => {
      qc.setQueryData(KEY, { on: r.on, applies: true })
      toast.success(r.on ? 'You will get the morning email.' : 'Morning email stopped.')
    },
    onError: () => toast.error('We could not save this.'),
  })

  if (!q.data?.applies) return null
  return (
    <Card>
      <CardContent className="p-4">
        <Switch
          checked={q.data.on}
          disabled={save.isPending}
          onChange={(v) => save.mutate(v)}
          label="Morning email"
          description="At 8 am: today's shoots, leads, tasks and overdue invoices. Only on days there is something."
        />
      </CardContent>
    </Card>
  )
}
