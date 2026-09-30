import { Calculator, Camera, CheckSquare, Database, FileCheck, FileSignature, FileText, Gift, LayoutGrid, Package, Receipt, Wallet } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { useAccess } from '@/shared/auth/useAccess'
import { cn } from '@/shared/ui/cn'

/**
 * The tabs across a project. Each one is a view of the same project; the
 * Quotation is its own page (it prints), but it sits in the same row so a
 * studio finds it where it finds everything else about the project.
 */
export const PROJECT_TABS = [
  { value: 'overview', label: 'Overview', icon: LayoutGrid },
  { value: 'quotation', label: 'Quotation', icon: FileText },
  { value: 'shoots', label: 'Shoots', icon: Camera },
  { value: 'deliverables', label: 'Post-production work', icon: Package },
  { value: 'completed_work', label: 'Work to review', icon: FileCheck },
  { value: 'terms', label: 'Terms', icon: FileSignature },
  { value: 'billing', label: 'Billing', icon: Wallet },
  { value: 'expenses', label: 'Expenses', icon: Receipt },
  // Every cost of the project -- team payouts and expenses -- against its value.
  { value: 'costs', label: 'Cost sheet', icon: Calculator },
  { value: 'tasks', label: 'Tasks', icon: CheckSquare },
  // As in the old app: this project's data and its referrals, each also a
  // page of its own in the sidebar (Data & Backup, Referrals).
  { value: 'data', label: 'Data', icon: Database },
  { value: 'referrals', label: 'Referrals', icon: Gift },
] as const
export type ProjectTab = (typeof PROJECT_TABS)[number]['value']

/** Tabs for things this person cannot use are not shown at all. */
export function useVisibleProjectTabs() {
  const access = useAccess()
  return PROJECT_TABS.filter(
    (t) =>
      (t.value !== 'tasks' || access.hasModule('tasks')) &&
      (t.value !== 'expenses' || access.hasModule('company_expenses')) &&
      (t.value !== 'completed_work' || access.hasModule('team_work_preview')) &&
      (t.value !== 'data' || access.hasAction('projects', 'edit')) &&
      (t.value !== 'costs' || access.hasAction('projects', 'edit')) &&
      (t.value !== 'referrals' || access.hasModule('referrals')),
  )
}

export function ProjectTabStrip({
  active,
  onSelect,
  className,
}: {
  active: ProjectTab
  onSelect: (tab: ProjectTab) => void
  className?: string
}) {
  const tabs = useVisibleProjectTabs()
  const strip = useRef<HTMLDivElement>(null)
  // On a phone the row scrolls sideways: keep the open tab in sight.
  useEffect(() => {
    const row = strip.current
    const on = row?.querySelector<HTMLElement>('[aria-current="page"]')
    if (row && on && row.scrollWidth > row.clientWidth) {
      row.scrollLeft = on.offsetLeft - (row.clientWidth - on.offsetWidth) / 2
    }
  }, [active])
  return (
    <div ref={strip} className={cn('flex items-center gap-1 overflow-x-auto rounded-lg border border-border bg-card p-1.5 sm:flex-wrap', className)}>
      {tabs.map((t) => (
        <button
          key={t.value}
          type="button"
          onClick={() => onSelect(t.value)}
          aria-current={active === t.value ? 'page' : undefined}
          className={cn(
            'flex shrink-0 items-center gap-2 rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors',
            active === t.value
              ? 'bg-primary text-primary-foreground'
              : 'text-muted-foreground hover:bg-accent hover:text-foreground',
          )}
        >
          <t.icon className="size-4" aria-hidden />
          {t.label}
        </button>
      ))}
    </div>
  )
}
