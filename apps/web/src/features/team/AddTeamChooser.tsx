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
      <h2 className="text-xl font-semibold tracking-tight">How do you want to add your team?</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        You can always add more people, or change anyone's details, later.
      </p>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <Choice
          icon={UserPlus}
          title="One person"
          description="Add a single team member, one step at a time — including their pay, if you want to set it now."
          onClick={() => onPick('single')}
          nudge
        />
        <Choice
          icon={Users}
          title="Several people at once"
          description="Type or paste your whole team into one table — names, phones, emails, passwords and roles — and add everyone in one go."
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
  nudge,
}: {
  icon: LucideIcon
  title: string
  description: string
  onClick: () => void
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
      <span className="flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
        <Icon className="size-5" />
      </span>
      <span>
        <span className="flex items-center gap-1.5 font-semibold">
          {title}
          <ArrowRight className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
        </span>
        <span className="mt-1 block text-sm text-muted-foreground">{description}</span>
      </span>
    </button>
  )
}
