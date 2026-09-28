import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { Bell, Mail, MessageCircle, Pencil, Plus, Sparkles, Trash2 } from 'lucide-react'
import type { Sequence, SequenceChannel } from '@ipc/contracts'
import { Button } from '@/shared/ui/button'
import { Card, CardContent } from '@/shared/ui/card'
import { SkeletonCards } from '@/shared/ui/skeleton'
import { EmptyState, ErrorState } from '@/shared/ui/states'
import { Switch } from '@/shared/ui/switch'
import { useConfirm } from '@/shared/ui/confirm'
import { useAccess } from '@/shared/auth/useAccess'
import { cn } from '@/shared/ui/cn'
import { useAddStarters, useDeleteSequence, useHasFeature, usePatchSequence, useSequences } from './api'
import { SequenceEditor } from './SequenceEditor'

export const CHANNEL: Record<SequenceChannel, { label: string; icon: typeof Bell; tone: string }> = {
  whatsapp: { label: 'WhatsApp', icon: MessageCircle, tone: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300' },
  email: { label: 'Email', icon: Mail, tone: 'bg-sky-500/10 text-sky-700 dark:text-sky-300' },
  reminder: { label: 'Reminder', icon: Bell, tone: 'bg-amber-500/10 text-amber-700 dark:text-amber-300' },
}

/** When it starts, in words. */
export function startsWhen(s: Pick<Sequence, 'auto_start' | 'stage_filter' | 'source_filter'>): string {
  if (!s.auto_start) return 'Started by hand'
  const from = s.source_filter ? ` from ${s.source_filter.replace(/_/g, ' ')}` : ''
  return s.stage_filter ? `Starts when a lead${from} reaches ${s.stage_filter.replace(/_/g, ' ')}` : `Starts for every new lead${from}`
}

/**
 * Follow-up sequences: the messages a lead gets on its day -- a WhatsApp
 * hello, the packages by email, a nudge, a reminder to call. The studio
 * writes them once; each lead gets them filled in with its own name.
 */
export function SequencesSection() {
  const q = useSequences()
  const starters = useAddStarters()
  const access = useAccess()
  const canEdit = access.hasAction('crm', 'edit')
  const auto = useHasFeature('sequences_auto')
  const [editing, setEditing] = useState<Sequence | 'new' | null>(null)
  const list = q.data ?? []
  const hasStarters = list.some((s) => s.starter_key)

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="font-semibold tracking-tight">Follow-up sequences</h3>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Messages a lead gets on its day. {auto ? 'Emails go out by themselves; ' : ''}WhatsApp messages wait in{' '}
            <Link to="/follow-ups/send" className="font-medium text-primary hover:underline">
              Send now
            </Link>{' '}
            for one tap from your phone. A reply stops it.
          </p>
        </div>
        {canEdit && (
          <div className="flex gap-2">
            {!hasStarters && (
              <Button variant="outline" disabled={starters.isPending} onClick={() => starters.mutate()}>
                <Sparkles /> Add ready-made
              </Button>
            )}
            <Button onClick={() => setEditing('new')}>
              <Plus /> New sequence
            </Button>
          </div>
        )}
      </div>

      {q.isPending ? (
        <SkeletonCards count={2} />
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      ) : list.length === 0 ? (
        <Card>
          <CardContent className="py-4">
            <EmptyState
              title="No sequences yet"
              description="Start with the ready-made ones for a photography studio: a new enquiry, a quotation sent, and after the shoot."
              action={
                canEdit ? (
                  <Button disabled={starters.isPending} onClick={() => starters.mutate()}>
                    <Sparkles /> Add ready-made sequences
                  </Button>
                ) : undefined
              }
            />
          </CardContent>
        </Card>
      ) : (
        <ul className="flex flex-col gap-2">
          {list.map((s) => (
            <SequenceRow key={s.id} s={s} canEdit={canEdit} onEdit={() => setEditing(s)} />
          ))}
        </ul>
      )}

      {!auto && list.some((s) => s.steps.some((st) => st.channel === 'email')) && (
        <p className="text-xs text-muted-foreground">
          Emails wait in Send now too. Sending them by themselves, from your studio’s name, comes with the higher plan.
        </p>
      )}

      {editing && <SequenceEditor sequence={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </div>
  )
}

function SequenceRow({ s, canEdit, onEdit }: { s: Sequence; canEdit: boolean; onEdit: () => void }) {
  const patch = usePatchSequence()
  const del = useDeleteSequence()
  const confirm = useConfirm()
  const stats = [
    s.active_leads ? `${s.active_leads} on it` : null,
    s.sent ? `${s.sent} sent` : null,
    s.replied ? `${s.replied} replied` : null,
  ].filter(Boolean)

  async function onDelete() {
    const yes = await confirm({
      title: `Delete “${s.name}”?`,
      ...(s.active_leads ? { description: `${s.active_leads} lead${s.active_leads === 1 ? ' is' : 's are'} on it now; they come off it.` } : {}),
      confirmLabel: 'Delete',
      destructive: true,
    })
    if (yes) del.mutate(s.id)
  }

  return (
    <li className={cn('rounded-lg border border-border bg-card p-3', !s.is_active && 'opacity-60')}>
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="font-medium">{s.name}</p>
          <p className="text-xs text-muted-foreground">
            {startsWhen(s)}
            {stats.length > 0 && ` · ${stats.join(' · ')}`}
          </p>
          <ol className="mt-2 flex flex-wrap gap-1.5">
            {s.steps.map((st) => {
              const ch = CHANNEL[st.channel]
              const Icon = ch.icon
              return (
                <li key={st.step_no} className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium', ch.tone)}>
                  <Icon className="size-3" /> Day {st.day_offset} · {ch.label}
                </li>
              )
            })}
          </ol>
        </div>
        {canEdit && (
          <div className="flex items-center gap-1">
            <Switch
              checked={s.is_active}
              onChange={(v) => patch.mutate({ id: s.id, patch: { is_active: v } })}
              label={s.is_active ? 'On' : 'Off'}
              disabled={patch.isPending}
            />
            <Button size="icon" variant="ghost" onClick={onEdit} aria-label={`Edit ${s.name}`}>
              <Pencil />
            </Button>
            <Button size="icon" variant="ghost" onClick={() => void onDelete()} aria-label={`Delete ${s.name}`}>
              <Trash2 />
            </Button>
          </div>
        )}
      </div>
    </li>
  )
}
