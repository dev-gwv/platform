import { Pencil } from 'lucide-react'
import { Button } from '@/shared/ui/button'
import { cn } from '@/shared/ui/cn'
import { useINR } from '@/shared/money/MoneyMask'
import { useClients } from '@/features/clients/api'
import {
  WIZARD_STEPS,
  type draftTotals,
  type ProjectDraft,
  type stepErrors,
  type WizardStep,
} from '@/features/projects/wizard'
import { countLabel } from './wizard-state'

/**
 * The last look before the project exists.
 *
 * Six tiles rather than a table of twenty rows: what a studio checks here is
 * "is this the right client, the right days, the right money", and each tile
 * carries the Edit that takes them back to fix it. A tile whose step still has
 * a problem says what the problem is, in place — so nobody has to open a step
 * to find out why the button won't fire.
 */
export function ReviewStep({
  draft,
  totals,
  errors,
  onJump,
}: {
  draft: ProjectDraft
  totals: ReturnType<typeof draftTotals>
  errors: ReturnType<typeof stepErrors>
  onJump: (s: WizardStep) => void
}) {
  const inr = useINR()
  const { data: clients } = useClients()
  const client = Array.isArray(clients) ? clients.find((c) => c.id === draft.client_id) : undefined
  const clientName = client?.name ?? draft.new_client_name.trim()
  const problems = WIZARD_STEPS.filter((s) => errors[s])
  const promised = draft.deliverables.filter((d) => d.visibility_scope === 'client')
  const team = draft.deliverables.length - promised.length

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <ReviewTile
          label="Project"
          value={draft.name.trim() || '—'}
          problem={errors.client && !draft.name.trim() ? errors.client : undefined}
          onEdit={() => onJump('client')}
        />
        <ReviewTile
          label="Client"
          value={clientName || 'Not set'}
          problem={errors.client && !clientName ? errors.client : undefined}
          onEdit={() => onJump('client')}
        />
        <ReviewTile
          label="Shoots"
          value={
            draft.shoots.length ? `${countLabel(draft.shoots.length, 'shoot')} added` : 'None added'
          }
          hint={summarise(draft.shoots.map((s) => s.name.trim() || 'Untitled'))}
          problem={errors.shoots}
          onEdit={() => onJump('shoots')}
        />
        <ReviewTile
          label="Deliverables"
          value={promised.length ? `${countLabel(promised.length, 'deliverable')} added` : 'None added'}
          hint={summarise(promised.map((d) => d.title.trim() || 'Untitled'))}
          problem={errors.deliverables}
          onEdit={() => onJump('deliverables')}
        />
        <ReviewTile
          label="Package / add-ons / total"
          value={`${inr(totals.packageCost)} + ${inr(totals.addOns)} = ${inr(totals.total)}`}
          accent
          onEdit={() => onJump('billing')}
        />
        <ReviewTile
          label="Advance"
          value={`Received ${inr(totals.received)}${totals.promised ? ` · Promised ${inr(totals.promised)}` : ''} · Still to collect ${inr(totals.balance)}`}
          problem={errors.billing}
          onEdit={() => onJump('billing')}
        />
      </div>

      {team > 0 && (
        <p className="text-xs text-muted-foreground">
          Team work: {countLabel(team, 'item')} from your presets — edit them on the project page.
        </p>
      )}

      {problems.length > 0 ? (
        <p className="text-sm font-medium text-warning">
          Some required fields are missing. Use Edit to fix them before creating the project.
        </p>
      ) : (
        <p className="text-sm text-muted-foreground">
          Creating this makes {countLabel(1, 'project')}
          {draft.shoots.length ? `, ${countLabel(draft.shoots.length, 'shoot')}` : ''}
          {draft.deliverables.length ? `, ${countLabel(draft.deliverables.length, 'deliverable')}` : ''}
          {draft.payments.length ? ` and ${countLabel(draft.payments.length, 'payment')}` : ''}
          {draft.client_id ? '' : ' and a new client record'}.
        </p>
      )}
    </div>
  )
}

/** One fact about the project, and the way back to change it. */
function ReviewTile({
  label,
  value,
  hint,
  problem,
  accent,
  onEdit,
}: {
  label: string
  value: string
  hint?: string
  problem?: string | undefined
  accent?: boolean
  onEdit: () => void
}) {
  return (
    <div
      className={cn(
        'flex items-start gap-3 rounded-lg border p-4',
        problem
          ? 'border-destructive/30 bg-destructive/5'
          : accent
            ? 'border-primary/30 bg-primary/5'
            : 'border-border bg-muted/30',
      )}
    >
      <div className="min-w-0 flex-1">
        <p className="text-[0.7rem] font-semibold uppercase tracking-wider text-muted-foreground">
          {label}
        </p>
        <p className={cn('break-words font-semibold', accent && 'text-primary')}>
          {value}
        </p>
        {problem ? (
          <p className="mt-1 text-xs text-destructive">{problem}</p>
        ) : (
          hint && <p className="truncate text-xs text-muted-foreground">{hint}</p>
        )}
      </div>
      <Button variant="ghost" size="sm" onClick={onEdit}>
        <Pencil /> Edit
      </Button>
    </div>
  )
}

const summarise = (names: string[]) => (names.length === 0 ? 'None' : names.join(', '))
