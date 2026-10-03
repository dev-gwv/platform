import { useState } from 'react'
import { Cake, Heart, Plus, X } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/shared/ui/button'
import { Label } from '@/shared/ui/input'
import { useAddOccasion, useClientOccasions, useDeleteOccasion } from './api'
import { OccasionForm, dayMonth, type OccasionDraft } from './OccasionForm'

const label = (o: Pick<OccasionDraft, 'kind' | 'person_name'>) => (o.kind === 'birthday' ? o.person_name || 'Birthday' : 'Anniversary')

/**
 * "Birthdays & anniversary" in Add / Edit client (0243): optional chips. For a
 * client already saved each date saves at once; for a new client they wait in
 * `pending` and are saved with the client.
 */
export function ClientDates({
  clientId,
  pending,
  onPending,
}: {
  clientId?: string | undefined
  pending?: OccasionDraft[]
  onPending?: (next: OccasionDraft[]) => void
}) {
  const saved = useClientOccasions(clientId)
  const add = useAddOccasion()
  const remove = useDeleteOccasion()
  const [adding, setAdding] = useState<OccasionDraft['kind'] | null>(null)
  const live = !!clientId
  const items: Array<OccasionDraft & { id?: string }> = live ? (saved.data ?? []) : (pending ?? [])
  const hasAnniversary = items.some((o) => o.kind === 'anniversary')

  const save = (d: OccasionDraft) => {
    if (!live) {
      onPending?.([...(pending ?? []), d])
      setAdding(null)
      return
    }
    add.mutate({ client_id: clientId, ...d }, { onSuccess: () => setAdding(null), onError: (e) => toast.error(e.message) })
  }
  const drop = (i: number, id?: string) => {
    if (!live) onPending?.((pending ?? []).filter((_, j) => j !== i))
    else if (id) remove.mutate(id, { onError: (e) => toast.error(e.message) })
  }

  return (
    <div className="flex flex-col gap-2">
      <Label>Birthdays & anniversary (optional)</Label>
      <div className="flex flex-wrap gap-2">
        {items.map((o, i) => (
          <span key={o.id ?? i} className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card py-1 pl-2 pr-1 text-sm">
            {o.kind === 'birthday' ? <Cake className="size-3.5 text-tone-amber" /> : <Heart className="size-3.5 text-tone-rose" />}
            {label(o)} · {dayMonth(o)}
            <button type="button" aria-label={`Remove ${label(o)}`} className="rounded-full p-0.5 hover:text-destructive" onClick={() => drop(i, o.id)}>
              <X className="size-3.5" />
            </button>
          </span>
        ))}
        {!adding && (
          <>
            <Button type="button" size="sm" variant="outline" onClick={() => setAdding('birthday')}>
              <Plus className="size-4" /> Birthday
            </Button>
            {!hasAnniversary && (
              <Button type="button" size="sm" variant="outline" onClick={() => setAdding('anniversary')}>
                <Plus className="size-4" /> Wedding anniversary
              </Button>
            )}
          </>
        )}
      </div>
      {adding && <OccasionForm kind={adding} busy={add.isPending} onSave={save} onCancel={() => setAdding(null)} />}
    </div>
  )
}
