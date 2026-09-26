import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  markPayrollPaidResponse,
  payrollExportRow,
  payrollMonth,
  payslip,
  payslipSummary,
  z,
  type MarkPayrollPaidRequest,
  type UpdatePayrollLineRequest,
} from '@ipc/contracts'
import { callApi } from '@/shared/api/client'
import { useAuth } from '@/shared/auth/AuthProvider'
import { useAccess } from '@/shared/auth/useAccess'

const none = z.unknown()
const idOnly = z.object({ id: z.string() })
const netOnly = z.object({ net_pay: z.number() })

/** Who sees the payroll screen, and who may change it (the server checks both). */
export function usePayrollPowers() {
  const { session } = useAuth()
  const access = useAccess()
  const owner = !!session?.is_owner
  return {
    canView: owner || access.hasModule('team_salaries'),
    canEdit: owner || access.hasAction('team_salaries', 'edit'),
  }
}

export function usePayrollMonth(year: number, month: number) {
  const { canView } = usePayrollPowers()
  return useQuery({
    queryKey: ['payroll', 'month', year, month],
    queryFn: () => callApi(`/payroll/runs?year=${year}&month=${month}`, { responseSchema: payrollMonth }),
    enabled: canView,
  })
}

function usePayrollMutation<T, R>(fn: (v: T) => Promise<R>, done: string | null) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      if (done) toast.success(done)
      void qc.invalidateQueries({ queryKey: ['payroll'] })
      // The salaries ledger and the member page follow a payment.
      void qc.invalidateQueries({ queryKey: ['team'] })
    },
    onError: (e: Error) => toast.error(e.message),
  })
}

export const useGeneratePayroll = () =>
  usePayrollMutation(
    (body: { year: number; month: number }) => callApi('/payroll/runs/generate', { method: 'POST', body, responseSchema: idOnly }),
    'Payroll worked out from attendance and leave',
  )

export const useUpdatePayrollLine = () =>
  usePayrollMutation(
    ({ id, body }: { id: string; body: UpdatePayrollLineRequest }) =>
      callApi(`/payroll/lines/${id}`, { method: 'PATCH', body, responseSchema: netOnly }),
    'Saved',
  )

export const useApprovePayroll = () =>
  usePayrollMutation(
    (runId: string) => callApi(`/payroll/runs/${runId}/approve`, { method: 'POST', responseSchema: none }),
    'Approved. The month is now locked.',
  )

export const useMarkPayrollPaid = () =>
  usePayrollMutation(
    ({ runId, body }: { runId: string; body: MarkPayrollPaidRequest }) =>
      callApi(`/payroll/runs/${runId}/pay`, { method: 'POST', body, responseSchema: markPayrollPaidResponse }),
    null,
  )

/** Full account details: fetched only when the sheet is downloaded. */
export const fetchPayrollExport = (runId: string) =>
  callApi(`/payroll/runs/${runId}/export`, { responseSchema: payrollExportRow.array() })

export function usePayslips(userId: string | null, enabled = true) {
  return useQuery({
    queryKey: ['payroll', 'payslips', userId],
    queryFn: () => callApi(`/payroll/payslips?user_id=${userId}`, { responseSchema: payslipSummary.array() }),
    enabled: !!userId && enabled,
  })
}

export function usePayslip(id: string) {
  return useQuery({
    queryKey: ['payroll', 'payslip', id],
    queryFn: () => callApi(`/payroll/payslips/${id}`, { responseSchema: payslip }),
  })
}
