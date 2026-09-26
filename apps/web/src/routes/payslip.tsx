import { useParams, useRouter } from '@tanstack/react-router'
import { ArrowLeft, Printer } from 'lucide-react'
import { monthLabel } from '@ipc/domain'
import { AuthedPage } from '@/shared/layout/AuthedPage'
import { Button } from '@/shared/ui/button'
import { DownloadDocumentButton } from '@/shared/ui/download-document'
import { Skeleton } from '@/shared/ui/skeleton'
import { ErrorState } from '@/shared/ui/states'
import { usePayslip } from '@/features/payroll/api'
import { PayslipPaper } from '@/features/payroll/PayslipPaper'

/**
 * One payslip, ready to print or save as PDF. Open to whoever runs payroll,
 * and to the member themself once the month is approved (the server decides;
 * anyone else gets "not found").
 */
export function PayslipPage() {
  return (
    <AuthedPage module="dashboard">
      <Slip />
    </AuthedPage>
  )
}

function Slip() {
  const { lineId } = useParams({ from: '/authed/payroll/payslip/$lineId' })
  const router = useRouter()
  const q = usePayslip(lineId)

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
      <div className="paper-toolbar no-print flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border bg-card p-3">
        <Button size="sm" variant="ghost" onClick={() => router.history.back()}>
          <ArrowLeft /> Back
        </Button>
        {q.data && (
          <div className="flex flex-wrap gap-2">
            <DownloadDocumentButton
              name={`Payslip ${monthLabel(q.data.pay_year, q.data.pay_month)} ${q.data.name}`}
              label="Download PDF"
              size="sm"
            />
            <Button size="sm" onClick={() => window.print()}>
              <Printer /> Print
            </Button>
          </div>
        )}
      </div>
      {q.isLoading ? (
        <div className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-6">
          <Skeleton className="h-10 w-1/2" />
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-40 w-full" />
        </div>
      ) : q.isError || !q.data ? (
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      ) : (
        <PayslipPaper slip={q.data} />
      )}
    </div>
  )
}
