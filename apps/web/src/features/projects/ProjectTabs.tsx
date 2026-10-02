import {
  Banknote,
  Calculator,
  Camera,
  CheckSquare,
  Database,
  FileCheck,
  FileSignature,
  FileText,
  Gift,
  LayoutGrid,
  Package,
  Receipt,
  Wallet,
  type LucideIcon,
} from 'lucide-react'
import { useEffect, useRef } from 'react'
import type { ModuleAction, ModuleKey } from '@ipc/permissions'
import { useAccess } from '@/shared/auth/useAccess'
import { SectionTabs } from '@/shared/layout/section-tabs'
import { cn } from '@/shared/ui/cn'

/**
 * The views of a project. Each id is an address (`?tab=`) that links, stored
 * notifications and the tracking page use, so an id never changes; what
 * changes is how they are grouped across the top. The Quotation is its own
 * page (it prints), but it sits in the same row so a studio finds it where it
 * finds everything else about the project.
 */
export const PROJECT_TABS = [
  { value: 'overview', label: 'Overview', icon: LayoutGrid },
  { value: 'quotation', label: 'Quotation', icon: FileText },
  { value: 'shoots', label: 'Shoots', icon: Camera },
  { value: 'deliverables', label: 'Work', icon: Package },
  { value: 'completed_work', label: 'Work to review', icon: FileCheck },
  { value: 'tasks', label: 'Tasks', icon: CheckSquare },
  { value: 'terms', label: 'Terms', icon: FileSignature },
  { value: 'billing', label: 'Billing', icon: Wallet },
  { value: 'expenses', label: 'Expenses', icon: Receipt },
  // Every cost of the project -- team payouts and expenses -- against its value.
  { value: 'costs', label: 'Cost sheet', icon: Calculator },
  // What each person booked on it is owed, what has gone out, and Pay.
  { value: 'payouts', label: 'Payouts', icon: Banknote },
  // As in the old app: this project's data and its referrals, each also a
  // page of its own in the sidebar (Data & Backup, Referrals).
  { value: 'data', label: 'Data', icon: Database },
  { value: 'referrals', label: 'Referrals', icon: Gift },
] as const
export type ProjectTab = (typeof PROJECT_TABS)[number]['value']

/**
 * The row across the top: eight entries, not twelve. Post-production holds
 * the work, what is handed in to review and the tasks; Finance holds
 * billing, expenses and the cost sheet. The owner: twelve tabs were "a lot
 * of chaos... my mind is not able to focus on anything".
 */
export const PROJECT_GROUPS = [
  { value: 'overview', label: 'Overview', icon: LayoutGrid, views: ['overview'] },
  { value: 'quotation', label: 'Quotation', icon: FileText, views: ['quotation'] },
  { value: 'shoots', label: 'Shoots', icon: Camera, views: ['shoots'] },
  { value: 'production', label: 'Post-production', icon: Package, views: ['deliverables', 'completed_work', 'tasks'] },
  { value: 'terms', label: 'Terms', icon: FileSignature, views: ['terms'] },
  { value: 'finance', label: 'Finance', icon: Wallet, views: ['billing', 'expenses', 'costs', 'payouts'] },
  { value: 'data', label: 'Data', icon: Database, views: ['data'] },
  { value: 'referrals', label: 'Referrals', icon: Gift, views: ['referrals'] },
] as const satisfies ReadonlyArray<{ value: string; label: string; icon: LucideIcon; views: readonly ProjectTab[] }>
export type ProjectGroup = (typeof PROJECT_GROUPS)[number]['value']

/** The group a view sits under. */
export function groupOf(view: ProjectTab): ProjectGroup {
  return PROJECT_GROUPS.find((g) => (g.views as readonly ProjectTab[]).includes(view))?.value ?? 'overview'
}

/** The views of a group, in order. */
export function viewsOf(group: ProjectGroup): readonly ProjectTab[] {
  return PROJECT_GROUPS.find((g) => g.value === group)?.views ?? []
}

/** Which views this person can use. Pure, so the gates are tested. */
export function visibleViews(
  can: { module: (m: ModuleKey) => boolean; action: (m: ModuleKey, a: ModuleAction) => boolean },
): ProjectTab[] {
  return PROJECT_TABS.map((t) => t.value).filter(
    (v) =>
      (v !== 'tasks' || can.module('tasks')) &&
      (v !== 'expenses' || can.module('company_expenses')) &&
      (v !== 'completed_work' || can.module('team_work_preview')) &&
      (v !== 'data' || can.action('projects', 'edit')) &&
      (v !== 'costs' || can.action('projects', 'edit')) &&
      (v !== 'payouts' || can.module('team_payouts')) &&
      (v !== 'referrals' || can.module('referrals')),
  )
}

/** Tabs for things this person cannot use are not shown at all. */
export function useVisibleProjectTabs(): ProjectTab[] {
  const access = useAccess()
  return visibleViews({ module: (m) => access.hasModule(m), action: (m, a) => access.hasAction(m, a) })
}

export function ProjectTabStrip({
  active,
  onSelect,
  className,
}: {
  active: ProjectTab
  /** Called with the first view of the chosen group this person can see. */
  onSelect: (tab: ProjectTab) => void
  className?: string
}) {
  const visible = useVisibleProjectTabs()
  const groups = PROJECT_GROUPS.map((g) => ({ ...g, first: g.views.find((v) => visible.includes(v)) })).filter(
    (g) => g.first !== undefined,
  )
  const current = groupOf(active)
  const strip = useRef<HTMLDivElement>(null)
  // On a phone the row scrolls sideways: keep the open tab in sight.
  useEffect(() => {
    const row = strip.current
    const on = row?.querySelector<HTMLElement>('[aria-current="page"]')
    if (row && on && row.scrollWidth > row.clientWidth) {
      row.scrollLeft = on.offsetLeft - (row.clientWidth - on.offsetWidth) / 2
    }
  }, [current])
  return (
    <div ref={strip} className={cn('flex items-center gap-1 overflow-x-auto rounded-lg border border-border bg-card p-1.5 sm:flex-wrap', className)}>
      {groups.map((g) => (
        <button
          key={g.value}
          type="button"
          onClick={() => onSelect(g.value === current ? active : g.first!)}
          aria-current={current === g.value ? 'page' : undefined}
          className={cn(
            'flex shrink-0 items-center gap-2 rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors',
            current === g.value
              ? 'bg-primary text-primary-foreground'
              : 'text-muted-foreground hover:bg-accent hover:text-foreground',
          )}
        >
          <g.icon className="size-4" aria-hidden />
          {g.label}
        </button>
      ))}
    </div>
  )
}

/**
 * The quiet second row inside Post-production and Finance: Work · Work to
 * review · Tasks, or Billing · Expenses · Cost sheet. Nothing is drawn for a
 * group with a single view this person can see.
 */
export function ProjectSubTabs({
  active,
  onSelect,
  className,
}: {
  active: ProjectTab
  onSelect: (tab: ProjectTab) => void
  className?: string
}) {
  const visible = useVisibleProjectTabs()
  const views = viewsOf(groupOf(active)).filter((v) => visible.includes(v))
  if (views.length < 2) return null
  const tabs = views.map((v) => ({ value: v, label: PROJECT_TABS.find((t) => t.value === v)!.label }))
  return <SectionTabs variant="underline" tabs={tabs} value={active} onChange={onSelect} label="Sections" {...(className ? { className } : {})} />
}
