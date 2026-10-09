import { AuthedPage } from '@/shared/layout/AuthedPage'
import { PageHeader } from '@/shared/layout/page-header'
import { SalariesTab } from '@/features/team/SalariesTab'

/**
 * The monthly salary ledger, under Pay beside Payroll and Team payouts. It
 * used to be a second tab row inside the Team directory, which stacked two
 * rows of tabs on one page once People got its own.
 */
export function TeamSalariesPage() {
  return (
    <AuthedPage module="team_salaries">
      <PageHeader title="Monthly salaries" />
      <SalariesTab />
    </AuthedPage>
  )
}
