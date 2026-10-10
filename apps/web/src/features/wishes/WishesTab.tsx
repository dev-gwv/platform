import { useState } from 'react'
import { Cake, ClipboardList, Copy, Heart, MessageCircle, Pencil, Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { buildWhatsAppUrl, type ClientOccasion } from '@ipc/contracts'
import { daysUntil, nextOccurrence, sortBySoonest, whenWords, wishWords, yearsOn, ordinal } from '@ipc/domain'
import { Button } from '@/shared/ui/button'
import { Card, CardContent } from '@/shared/ui/card'
import { IconTile } from '@/shared/ui/icon-tile'
import { Switch } from '@/shared/ui/switch'
import { SkeletonList } from '@/shared/ui/skeleton'
import { ErrorState } from '@/shared/ui/states'
import { useConfirm } from '@/shared/ui/confirm'
import { cn } from '@/shared/ui/cn'
import { todayInIndia } from '@/shared/ui/days-left'
import { useAddOccasion, useDeleteOccasion, useProjectWishes, useUpdateOccasion } from './api'
import { OccasionForm, dayMonth, type OccasionDraft } from './OccasionForm'
import { DetailsLinkDialog } from './DetailsLinkDialog'

const first = (name: string) => name.trim().split(/\s+/)[0] ?? name

/** "Priya's birthday", "Anniversary". */
function occasionTitle(o: Pick<ClientOccasion, 'kind' | 'person_name'>): string {
  return o.kind === 'birthday' ? `${first(o.person_name) || 'Birthday'}'s birthday` : 'Wedding anniversary'
}

/**
 * The project's Wishes tab (0243): the client's birthdays and anniversary,
 * each with a switch, and the next wish written out with Send on WhatsApp --
 * the studio's own WhatsApp, free on every plan.
 */
export function WishesTab({ projectId, projectName, canEdit }: { projectId: string; projectName: string; canEdit: boolean }) {
  const q = useProjectWishes(projectId)
  const add = useAddOccasion()
  const update = useUpdateOccasion()
  const remove = useDeleteOccasion()
  const confirm = useConfirm()
  const [adding, setAdding] = useState<OccasionDraft['kind'] | null>(null)
  const [editing, setEditing] = useState<string | null>(null)
  const [asking, setAsking] = useState(false)
  const today = todayInIndia()

  if (q.isLoading) return <SkeletonList className="mt-4" />
  if (q.isError || !q.data) return <ErrorState onRetry={() => void q.refetch()} />
  const { client, studio_name: studio, occasions } = q.data
  const list = sortBySoonest(occasions, today)
  const next = list.find((o) => o.wish)
  const hasAnniversary = occasions.some((o) => o.kind === 'anniversary')
  const nextOn = next ? nextOccurrence(next, today) : null
  const words = next && nextOn ? wishWords({ occasion: next, clientName: client.name, studioName: studio, on: nextOn, others: occasions }) : ''

  const save = (d: OccasionDraft, id?: string) => {
    const done = { onSuccess: () => (setAdding(null), setEditing(null)), onError: (e: Error) => toast.error(e.message) }
    if (id) update.mutate({ id, ...d }, done)
    else add.mutate({ client_id: client.id, project_id: projectId, ...d }, done)
  }

  return (
    <div className="mt-4 flex flex-col gap-4">
      {next && nextOn && (
        <Card>
          <CardContent className="flex flex-col gap-3 p-4">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Next wish · {occasionTitle(next)} · {whenWords(daysUntil(nextOn, today))}
            </p>
            <p className="rounded-lg border-l-4 border-l-tone-rose bg-tone-rose-soft/40 px-3 py-2 text-sm leading-relaxed">{words}</p>
            <div className="flex flex-wrap gap-2">
              <Button asChild size="sm" className="bg-[#25D366] text-white hover:bg-[#1ebe5a]">
                <a href={buildWhatsAppUrl(client.phone, words)} target="_blank" rel="noreferrer">
                  <MessageCircle className="size-4" /> Send on WhatsApp
                </a>
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => void navigator.clipboard.writeText(words).then(() => toast.success('Wish copied'), () => toast.error('Could not copy'))}
              >
                <Copy className="size-4" /> Copy
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="flex flex-col gap-3 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="font-semibold">{first(client.name)}'s dates</p>
            {canEdit && (
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" onClick={() => (setAdding('birthday'), setEditing(null))}>
                  <Plus className="size-4" /> Birthday
                </Button>
                {!hasAnniversary && (
                  <Button size="sm" variant="outline" onClick={() => (setAdding('anniversary'), setEditing(null))}>
                    <Plus className="size-4" /> Wedding anniversary
                  </Button>
                )}
              </div>
            )}
          </div>

          {adding && (
            <OccasionForm kind={adding} busy={add.isPending} onSave={(d) => save(d)} onCancel={() => setAdding(null)} />
          )}

          {list.length === 0 && !adding && (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-dashed border-tone-amber/60 bg-tone-amber-soft/40 px-3 py-3">
              <p className="text-sm text-tone-amber">Add {first(client.name)}'s birthday and wedding date, and wish them every year.</p>
              {canEdit && (
                <Button size="sm" onClick={() => setAsking(true)}>
                  <ClipboardList className="size-4" /> Ask {first(client.name)} to fill them
                </Button>
              )}
            </div>
          )}
          {asking && (
            <DetailsLinkDialog
              projectId={projectId}
              projectName={projectName}
              clientName={client.name}
              clientPhone={client.phone}
              studioName={studio}
              onClose={() => setAsking(false)}
            />
          )}

          <ul className="flex flex-col divide-y divide-border">
            {list.map((o) => {
              const on = nextOccurrence(o, today)
              const years = yearsOn(o, on)
              if (editing === o.id) {
                return (
                  <li key={o.id} className="py-2">
                    <OccasionForm initial={o} kind={o.kind} busy={update.isPending} onSave={(d) => save(d, o.id)} onCancel={() => setEditing(null)} />
                  </li>
                )
              }
              return (
                <li key={o.id} className={cn('flex flex-wrap items-center gap-3 py-2.5', !o.wish && 'opacity-60')}>
                  <IconTile icon={o.kind === 'birthday' ? Cake : Heart} tone={o.kind === 'birthday' ? 'amber' : 'rose'} size="sm" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">
                      {occasionTitle(o)}
                      {o.kind === 'anniversary' && years ? ` · ${ordinal(years)}` : ''}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {dayMonth(o, true)} · {whenWords(daysUntil(on, today))}
                      {o.source === 'wedding_day' ? ' · from the wedding day' : o.source === 'client_form' ? ' · filled in by the client' : ''}
                    </p>
                  </div>
                  {canEdit && (
                    <div className="flex items-center gap-1">
                      <Switch
                        checked={o.wish}
                        label="Wish"
                        onChange={(wish) => update.mutate({ id: o.id, wish }, { onError: (e) => toast.error(e.message) })}
                      />
                      <Button size="icon" variant="ghost" aria-label="Edit date" onClick={() => (setEditing(o.id), setAdding(null))}>
                        <Pencil className="size-4" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        aria-label="Remove date"
                        className="hover:text-destructive"
                        onClick={async () => {
                          if (await confirm({ title: `Remove ${occasionTitle(o).toLowerCase()}?`, confirmLabel: 'Remove', destructive: true }))
                            remove.mutate(o.id, { onError: (e) => toast.error(e.message) })
                        }}
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        </CardContent>
      </Card>
    </div>
  )
}
