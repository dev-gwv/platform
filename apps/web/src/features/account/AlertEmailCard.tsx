import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { z } from '@ipc/contracts'
import { callApi } from '@/shared/api/client'
import { useAuth } from '@/shared/auth/AuthProvider'
import { Card, CardContent } from '@/shared/ui/card'
import { Switch } from '@/shared/ui/switch'

const setting = z.object({ on: z.boolean(), email: z.string().nullable().optional() })
const KEY = ['me', 'alert-emails'] as const

/**
 * Email copies of my alerts (0227): a booking, a task or an edit given to me
 * that I have not opened in the app within 15 minutes also comes by email.
 */
export function AlertEmailCard() {
  const { session } = useAuth()
  const qc = useQueryClient()
  const q = useQuery({
    queryKey: KEY,
    queryFn: () => callApi('/me/alert-emails', { responseSchema: setting }),
    enabled: !!session,
    staleTime: 60_000,
  })
  const save = useMutation({
    mutationFn: (on: boolean) => callApi('/me/alert-emails', { method: 'PUT', body: { on }, responseSchema: setting.pick({ on: true }) }),
    onSuccess: (r) => {
      qc.setQueryData(KEY, { ...q.data, on: r.on })
      toast.success(r.on ? 'Alerts you miss in the app will come by email too.' : 'Alert emails stopped.')
    },
    onError: () => toast.error('We could not save this.'),
  })

  if (!q.data) return null
  return (
    <Card>
      <CardContent className="p-4">
        <Switch
          checked={q.data.on}
          disabled={save.isPending}
          onChange={(v) => save.mutate(v)}
          label="Email me my alerts"
          description={`A shoot, task or edit given to you that you have not seen in the app within 15 minutes${q.data.email ? ` also goes to ${q.data.email}` : ' also comes by email'}.`}
        />
      </CardContent>
    </Card>
  )
}
