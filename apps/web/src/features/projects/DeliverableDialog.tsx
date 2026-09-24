import { useState } from 'react'
import type { Deliverable, DeliverableStatus } from '@ipc/contracts'
import { Button } from '@/shared/ui/button'
import { Dialog, DialogContent, DialogFooter } from '@/shared/ui/dialog'
import { Input, Label, Select, Textarea } from '@/shared/ui/input'
import { Switch } from '@/shared/ui/switch'
import { cn } from '@/shared/ui/cn'
import { useMembers } from '@/features/allocation/api'
import { LookupSelect } from '@/features/settings/LookupSelect'
import { QUICK_DELIVERABLES } from '@/features/projects/wizard'
import { useAddDeliverable, useUpdateDeliverable } from '@/features/projects/api'
import { STAGE_LABEL, STAGE_ORDER, type ShootRef } from './deliverable-stage'

const TITLE_DEFAULTS = QUICK_DELIVERABLES.map((t) => ({ value: t, label: t }))

const SEG_ON: Record<DeliverableStatus, string> = {
  pending: 'border-border bg-muted text-foreground',
  in_progress: 'border-tone-blue/40 bg-tone-blue-soft text-tone-blue',
  review: 'border-tone-amber/40 bg-tone-amber-soft text-tone-amber',
  completed: 'border-tone-green/40 bg-tone-green-soft text-tone-green',
  cancelled: 'border-border bg-muted text-muted-foreground',
}

/**
 * Add or change one deliverable: what it is, which shoot it comes from, who
 * sees it, who is editing it, when it is due, where it stands and where it
 * was sent.
 *
 * That is the whole of it. The old dialogs also asked for a work type, a
 * start rule, days-after-start, internal notes and two quotation switches
 * that could contradict each other; none of it changed what anyone did next.
 * "Client" or "Team only" now decides whether it appears on the quotation.
 */
export function DeliverableDialog({
  projectId,
  shoots,
  deliverable,
  defaultShootId,
  onClose,
}: {
  projectId: string
  shoots: readonly ShootRef[]
  deliverable?: Deliverable | undefined
  /** Pre-picks the shoot when adding from a shoot's group. */
  defaultShootId?: string | null | undefined
  onClose: () => void
}) {
  const editing = !!deliverable
  const add = useAddDeliverable(projectId)
  const update = useUpdateDeliverable(projectId)
  const { data: members } = useMembers()

  const [title, setTitle] = useState(deliverable?.title ?? '')
  const [shootId, setShootId] = useState(deliverable?.shoot_id ?? defaultShootId ?? '')
  const [scope, setScope] = useState<'client' | 'internal'>(deliverable?.visibility_scope ?? 'client')
  const [assigneeId, setAssigneeId] = useState(deliverable?.assignee_id ?? '')
  const [due, setDue] = useState(deliverable?.estimated_date ?? '')
  const [status, setStatus] = useState<DeliverableStatus>(
    (deliverable?.status as DeliverableStatus | undefined) ?? 'pending',
  )
  const [link, setLink] = useState(deliverable?.delivery_link ?? '')
  const [charged, setCharged] = useState(deliverable?.is_additional_charge ?? false)
  const [amount, setAmount] = useState(deliverable?.additional_charge_amount ? String(deliverable.additional_charge_amount) : '')
  const [brief, setBrief] = useState(deliverable?.description ?? '')

  const busy = add.isPending || update.isPending
  const client = scope === 'client'
  const extra = client && charged

  function save() {
    const body = {
      title: title.trim(),
      shoot_id: shootId || null,
      visibility_scope: scope,
      show_on_quotation: client,
      assignee_id: assigneeId || null,
      estimated_date: due || null,
      status,
      delivery_link: link.trim() || null,
      is_additional_charge: extra,
      additional_charge_amount: extra ? Number(amount) || 0 : 0,
      description: brief.trim() || null,
    }
    if (editing) {
      update.mutate({ deliverableId: deliverable.id, patch: body }, { onSuccess: onClose })
    } else {
      add.mutate(
        {
          ...body,
          list_key: 'primary',
          start_rule: 'whole_project',
          estimated_date: due || undefined,
          description: brief.trim() || undefined,
        },
        { onSuccess: onClose },
      )
    }
  }

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent title={editing ? 'Edit deliverable' : 'Add deliverable'} className="max-w-lg">
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="dl-title">What</Label>
            <LookupSelect
              id="dl-title"
              aria-label="Deliverable"
              category="deliverable"
              defaults={TITLE_DEFAULTS}
              value={title}
              onChange={setTitle}
              placeholder="Pick or add one"
              addLabel="Add another…"
              inputPlaceholder="e.g. Pre-wedding reel"
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="dl-shoot">From</Label>
              <Select id="dl-shoot" aria-label="From shoot" value={shootId} onChange={(e) => setShootId(e.target.value)}>
                <option value="">Whole project</option>
                {shoots.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Who sees it</Label>
              <div role="radiogroup" aria-label="Who sees it" className="flex h-9 gap-1 rounded-md border border-input p-0.5">
                {(['client', 'internal'] as const).map((v) => (
                  <button
                    key={v}
                    type="button"
                    role="radio"
                    aria-checked={scope === v}
                    onClick={() => setScope(v)}
                    className={cn(
                      'flex-1 rounded px-2 text-sm font-medium transition-colors',
                      scope === v ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted',
                    )}
                  >
                    {v === 'client' ? 'Client' : 'Team only'}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="dl-editor">Editor</Label>
              <Select id="dl-editor" aria-label="Editor" value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)}>
                <option value="">No one yet</option>
                {(members ?? []).map((m) => (
                  <option key={m.user_id} value={m.user_id}>
                    {m.name}
                  </option>
                ))}
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="dl-due">Due</Label>
              <Input id="dl-due" type="date" value={due} onChange={(e) => setDue(e.target.value)} />
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>Stage</Label>
            <div role="radiogroup" aria-label="Stage" className="flex flex-wrap gap-1">
              {STAGE_ORDER.map((s) => (
                <button
                  key={s}
                  type="button"
                  role="radio"
                  aria-checked={status === s}
                  onClick={() => setStatus(s)}
                  className={cn(
                    'rounded-full border px-3 py-1 text-xs font-medium transition-colors',
                    status === s ? SEG_ON[s] : 'border-transparent text-muted-foreground hover:bg-muted',
                  )}
                >
                  {STAGE_LABEL[s]}
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="dl-link">Link sent to client</Label>
            <Input
              id="dl-link"
              type="url"
              value={link}
              onChange={(e) => setLink(e.target.value)}
              placeholder="Drive, YouTube, WeTransfer…"
            />
          </div>

          {client && (
            <div className="rounded-lg border border-border p-3">
              <Switch checked={charged} onChange={setCharged} label="Charged on top of the package" />
              {charged && (
                <Input
                  className="mt-2"
                  aria-label="Extra charge"
                  inputMode="decimal"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="Amount in ₹"
                />
              )}
            </div>
          )}

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="dl-brief">Brief</Label>
            <Textarea
              id="dl-brief"
              rows={2}
              value={brief}
              onChange={(e) => setBrief(e.target.value)}
              placeholder="Songs, colour, anything the editor should know"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!title.trim() || busy} onClick={save}>
            {busy ? 'Saving…' : editing ? 'Save' : 'Add'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
