import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { z } from '@ipc/contracts'
import { callApi } from '@/shared/api/client'
import { useAuth } from '@/shared/auth/AuthProvider'
import { Card, CardContent } from '@/shared/ui/card'
import { Switch } from '@/shared/ui/switch'

const setting = z.object({ on: z.boolean(), applies: z.boolean().default(true) })

/**
 * The studio's own emails to the people who run it, each with its switch:
 * the 8 am email for owners and admins (0198) and the Monday email for the
 * owner (0258). Each shows only to the people it goes to.
 */
export function MorningEmailCard() {
  return (
    <>
      <EmailSwitch
        path="/settings/morning-email"
        label="Morning email"
        description="At 8 am: today's shoots, leads, tasks and overdue invoices. Only on days there is something."
        onWords="You will get the morning email."
        offWords="Morning email stopped."
      />
      <EmailSwitch
        path="/settings/weekly-email"
        label="Monday email"
        description="Every Monday at 8 am: money in last week, what is due, this week's shoots, late edits and new leads."
        onWords="You will get the Monday email."
        offWords="Monday email stopped."
      />
    </>
  )
}

function EmailSwitch({
  path,
  label,
  description,
  onWords,
  offWords,
}: {
  path: string
  label: string
  description: string
  onWords: string
  offWords: string
}) {
  const { session } = useAuth()
  const qc = useQueryClient()
  const key = ['settings', path]
  const q = useQuery({
    queryKey: key,
    queryFn: () => callApi(path, { responseSchema: setting }),
    enabled: !!session,
    staleTime: 60_000,
  })
  const save = useMutation({
    mutationFn: (on: boolean) =>
      callApi(path, { method: 'PUT', body: { on }, responseSchema: setting.pick({ on: true }) }),
    onSuccess: (r) => {
      qc.setQueryData(key, { on: r.on, applies: true })
      toast.success(r.on ? onWords : offWords)
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
          label={label}
          description={description}
        />
      </CardContent>
    </Card>
  )
}
