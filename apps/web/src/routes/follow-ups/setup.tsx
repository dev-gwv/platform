import { useState } from 'react'
import { Link, useLocation, useNavigate } from '@tanstack/react-router'
import { ArrowLeft } from 'lucide-react'
import { AuthedPage } from '@/shared/layout/AuthedPage'
import { PageHeader } from '@/shared/layout/page-header'
import { Button } from '@/shared/ui/button'
import { SkeletonList } from '@/shared/ui/skeleton'
import { ErrorState } from '@/shared/ui/states'
import { cn } from '@/shared/ui/cn'
import { useLeads } from '@/features/crm/api'
import { DistributionTab } from '@/features/crm/tabs/DistributionTab'
import { TemplatesTab } from '@/features/crm/tabs/TemplatesTab'
import { ImportsTab } from '@/features/crm/tabs/ImportsTab'
import { DuplicatesTab } from '@/features/crm/tabs/DuplicatesTab'
import { CrmSettingsTab } from '@/features/crm/tabs/SettingsTab'

/**
 * Everything a studio sets once.
 *
 * These five sat as tabs beside the day's work, which is how the CRM came to
 * have fourteen of them. Distribution rules, message templates, a CSV import,
 * a duplicate merge and the pipeline editor are all things someone configures
 * on a Tuesday afternoon and then never opens again -- so they are one click
 * away from the leads page rather than permanently in front of it.
 */
const SECTIONS = [
  { key: 'distribution', label: 'Who gets new leads', hint: 'The rota that assigns an arriving lead' },
  { key: 'templates', label: 'Message templates', hint: 'What you send on WhatsApp and email' },
  { key: 'imports', label: 'Imports & automations', hint: 'Bring in a CSV; run a sequence' },
  { key: 'duplicates', label: 'Duplicates', hint: 'The same person, twice' },
  { key: 'pipeline', label: 'Stages & scoring', hint: 'Your pipeline, lost reasons, scoring, SLA' },
] as const

type SectionKey = (typeof SECTIONS)[number]['key']
const isSection = (v: unknown): v is SectionKey => SECTIONS.some((s) => s.key === v)

export function CrmSetupPage() {
  return (
    <AuthedPage module="crm">
      <CrmSetup />
    </AuthedPage>
  )
}

function CrmSetup() {
  const { search } = useLocation()
  const navigate = useNavigate()
  const raw = (search as { section?: unknown }).section
  const [fallback, setFallback] = useState<SectionKey>('distribution')
  const section: SectionKey = isSection(raw) ? raw : fallback

  function open(next: SectionKey) {
    setFallback(next)
    void navigate({ to: '/follow-ups/setup', search: { section: next } as never, replace: true })
  }

  // Duplicates and the pipeline editor both need the archived rows, so the
  // full list is only fetched for the two sections that read it.
  const needsAll = section === 'duplicates' || section === 'pipeline'
  const everything = useLeads(needsAll)
  const allLeads = everything.data ?? []
  const archived = allLeads.filter((l) => l.is_archived)

  return (
    <>
      <PageHeader
        title="Lead setup"
        description="Set these once. The day's work is on the Leads page."
        actions={
          <Button variant="outline" asChild>
            <Link to="/follow-ups">
              <ArrowLeft /> Back to leads
            </Link>
          </Button>
        }
      />

      <div role="tablist" aria-label="Lead setup sections" className="mt-4 flex flex-wrap gap-1 rounded-lg border border-border bg-card p-1.5">
        {SECTIONS.map((s) => (
          <button
            key={s.key}
            id={`crm-setup-${s.key}`}
            type="button"
            role="tab"
            aria-selected={section === s.key}
            aria-controls="crm-setup-panel"
            title={s.hint}
            onClick={() => open(s.key)}
            className={cn(
              'whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium transition-colors',
              section === s.key
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:bg-accent hover:text-foreground',
            )}
          >
            {s.label}
          </button>
        ))}
      </div>

      <p className="mt-2 text-sm text-muted-foreground">
        {SECTIONS.find((s) => s.key === section)?.hint}
      </p>

      <div id="crm-setup-panel" role="tabpanel" aria-labelledby={`crm-setup-${section}`} className="mt-4">
        {section === 'distribution' ? (
          <DistributionTab />
        ) : section === 'templates' ? (
          <TemplatesTab />
        ) : section === 'imports' ? (
          <ImportsTab />
        ) : needsAll && everything.isLoading ? (
          <SkeletonList rows={5} columns={4} />
        ) : needsAll && everything.isError ? (
          <ErrorState error={everything.error} onRetry={() => void everything.refetch()} />
        ) : section === 'duplicates' ? (
          <DuplicatesTab archivedLeads={archived} allLeads={allLeads} />
        ) : (
          <CrmSettingsTab leads={allLeads.filter((l) => !l.is_archived)} archived={archived} />
        )}
      </div>
    </>
  )
}
