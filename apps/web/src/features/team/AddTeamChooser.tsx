import { ArrowRight, UserPlus, Users } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { Button } from '@/shared/ui/button'

export type AddMode = 'choose' | 'single' | 'bulk'

/**
 * The one question asked before anything else when a studio adds its team.
 *
 * "Set up your team" used to land on the full directory — search, four
 * filters, a salary range, export, roles — for a studio with nobody in it
 * yet. The owner came to add people and was handed a tool for managing
 * people they did not have. This screen is deliberately the only thing on
 * the page: two ways in, and a way out.
 */
export function AddTeamChooser({
  onPick,
  onCancel,
}: {
  onPick: (mode: Exclude<AddMode, 'choose'>) => void
  onCancel: () => void
}) {
  return (
    <div className="mx-auto w-full max-w-2xl">
      <h2 className="text-2xl font-bold tracking-tight">Add your team</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        The people who shoot and edit with you. Add them one by one, or all at once.
      </p>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <Choice
          icon={UserPlus}
          title="One by one"
          description="Name, phone and role for each person. About a minute each."
          onClick={() => onPick('single')}
          badge="Start here"
          nudge
        />
        <Choice
          icon={Users}
          title="All at once"
          description="Paste your team from a sheet, one person per row."
          onClick={() => onPick('bulk')}
        />
      </div>

      <div className="mt-4 flex justify-end">
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  )
}

function Choice({
  icon: Icon,
  title,
  description,
  onClick,
  badge,
  nudge,
}: {
  icon: LucideIcon
  title: string
  description: string
  onClick: () => void
  /** A small amber tag: the one to press first. */
  badge?: string
  /** The choice to pulse when this screen is opened from setup. */
  nudge?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-setup-nudge={nudge ? '' : undefined}
      className="group flex flex-col items-start gap-3 rounded-lg border border-border bg-card p-4 text-left shadow-sm transition-colors hover:border-primary/50 hover:bg-primary/[0.03] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <span className="flex w-full items-start justify-between gap-2">
        <span className="flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Icon className="size-5" />
        </span>
        {badge && (
          <span className="rounded-full bg-warning/15 px-2 py-0.5 text-xs font-semibold text-warning">
            {badge}
          </span>
        )}
      </span>
      <span>
        <span className="flex items-center gap-1.5 font-semibold">
          <span className="text-base">{title}</span>
          <ArrowRight className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
        </span>
        <span className="mt-1 block text-sm text-muted-foreground">{description}</span>
      </span>
    </button>
  )
}
