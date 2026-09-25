import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  expense,
  expenseAttachment,
  expenseSummary,
  gstSummary,
  fixedOverhead,
  profitAndLoss,
  z,
  type CreateExpenseRequest,
  type CreateFixedOverheadRequest,
  type PnlQuery,
  type UpdateExpenseRequest,
} from '@ipc/contracts'

const noContent = z.unknown()
import { toast } from 'sonner'
import { callApi } from '@/shared/api/client'
import { useAuth } from '@/shared/auth/AuthProvider'
import { useAccess } from '@/shared/auth/useAccess'

const expenses = expense.array()

export interface ExpenseFilters {
  search?: string | undefined
  category?: string | undefined
  project_id?: string | undefined
  date_from?: string | undefined
  date_to?: string | undefined
  min_amount?: string | undefined
  max_amount?: string | undefined
  /** 'with' | 'without' | 'rcm' — GST treatment, or reverse charge only. */
  gst?: string | undefined
  /** Who paid from their own pocket. */
  paid_by?: string | undefined
  reimbursement?: 'none' | 'pending' | 'reimbursed' | undefined
  sort?: 'date' | 'amount' | undefined
  dir?: 'asc' | 'desc' | undefined
  page?: number | undefined
  page_size?: number | undefined
}

/** Every filter goes on the query string the same way for the list and the tiles. */
function expenseParams(f: ExpenseFilters): URLSearchParams {
  const p = new URLSearchParams()
  if (f.search?.trim()) p.set('search', f.search.trim())
  if (f.category) p.set('category', f.category)
  if (f.project_id) p.set('project_id', f.project_id)
  if (f.date_from) p.set('date_from', f.date_from)
  if (f.date_to) p.set('date_to', f.date_to)
  if (f.min_amount) p.set('min_amount', f.min_amount)
  if (f.max_amount) p.set('max_amount', f.max_amount)
  if (f.gst) p.set('gst', f.gst)
  if (f.paid_by) p.set('paid_by', f.paid_by)
  if (f.reimbursement) p.set('reimbursement', f.reimbursement)
  return p
}

const expensePage = z.object({
  items: expenses,
  total: z.number().int(),
  page: z.number().int(),
  page_size: z.number().int(),
})
export type ExpensePage = z.infer<typeof expensePage>

/**
 * A page of expenses, with the real total behind it.
 *
 * This used to fetch 200 rows and paginate them in the browser, so a studio
 * past its two-hundredth expense simply could not reach the rest — and the
 * pager, counting the 200 it had, gave no sign of it.
 */
export function useExpensePage(filters: ExpenseFilters & { page: number; page_size: number }) {
  const { session } = useAuth()
  const access = useAccess()
  const params = expenseParams(filters)
  if (filters.sort) params.set('sort', filters.sort)
  if (filters.dir) params.set('dir', filters.dir)
  params.set('page', String(filters.page))
  params.set('page_size', String(filters.page_size))
  const qs = params.toString()
  return useQuery({
    queryKey: ['expenses', 'page', qs],
    queryFn: () => callApi(`/financials/expenses?${qs}`, { responseSchema: expensePage }),
    enabled: !!session && access.hasModule('company_expenses'),
    staleTime: 15_000,
  })
}

export function useExpenses(filters: ExpenseFilters = {}) {
  const { session } = useAuth()
  const access = useAccess()
  const params = new URLSearchParams()
  if (filters.search?.trim()) params.set('search', filters.search.trim())
  if (filters.category) params.set('category', filters.category)
  if (filters.project_id) params.set('project_id', filters.project_id)
  if (filters.date_from) params.set('date_from', filters.date_from)
  if (filters.date_to) params.set('date_to', filters.date_to)
  if (filters.min_amount) params.set('min_amount', filters.min_amount)
  if (filters.max_amount) params.set('max_amount', filters.max_amount)
  if (filters.sort) params.set('sort', filters.sort)
  if (filters.dir) params.set('dir', filters.dir)
  if (filters.page) params.set('page', String(filters.page))
  if (filters.page_size) params.set('page_size', String(filters.page_size))
  const qs = params.toString()
  return useQuery({
    queryKey: ['expenses', qs],
    queryFn: () => callApi(`/financials/expenses${qs ? `?${qs}` : ''}`, { responseSchema: expenses }),
    enabled: !!session && access.hasModule('company_expenses'),
    staleTime: 15_000,
  })
}

/** One project's own expenses — its detail page's Expenses tab. */
export function useProjectExpenses(projectId: string) {
  const { session } = useAuth()
  const access = useAccess()
  return useQuery({
    queryKey: ['expenses', 'project', projectId],
    queryFn: () => callApi(`/financials/expenses?project_id=${projectId}`, { responseSchema: expenses }),
    enabled: !!session && access.hasModule('company_expenses') && !!projectId,
    staleTime: 15_000,
  })
}

export function useCreateExpense() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: CreateExpenseRequest) =>
      callApi('/financials/expenses', { method: 'POST', body: input, responseSchema: expense }),
    onSuccess: () => {
      toast.success('Expense added')
      void qc.invalidateQueries({ queryKey: ['expenses'] })
      // An expense changes a project's profit.
      void qc.invalidateQueries({ queryKey: ['financials'] })
    },
  })
}

export function useUpdateExpense() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: UpdateExpenseRequest }) =>
      callApi(`/financials/expenses/${id}`, { method: 'PATCH', body: patch, responseSchema: expense }),
    onSuccess: () => {
      toast.success('Expense updated')
      void qc.invalidateQueries({ queryKey: ['expenses'] })
      // An expense changes a project's profit.
      void qc.invalidateQueries({ queryKey: ['financials'] })
    },
  })
}

export function useDeleteExpense() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => callApi(`/financials/expenses/${id}`, { method: 'DELETE', responseSchema: noContent }),
    onSuccess: () => {
      toast.success('Expense deleted')
      void qc.invalidateQueries({ queryKey: ['expenses'] })
      // An expense changes a project's profit.
      void qc.invalidateQueries({ queryKey: ['financials'] })
    },
  })
}





const overheads = fixedOverhead.array()

export function useFixedOverheads(month?: string) {
  const { session } = useAuth()
  const access = useAccess()
  return useQuery({
    queryKey: ['financials', 'fixed-overheads', month ?? 'all'],
    queryFn: () => callApi(`/financials/fixed-overheads${month ? `?month=${month}` : ''}`, { responseSchema: overheads }),
    enabled: !!session && access.hasModule('financials'),
    staleTime: 15_000,
  })
}

export function useCreateFixedOverhead() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: CreateFixedOverheadRequest) =>
      callApi('/financials/fixed-overheads', { method: 'POST', body: input, responseSchema: fixedOverhead }),
    onSuccess: () => {
      toast.success('Overhead added')
      void qc.invalidateQueries({ queryKey: ['financials'] })
    },
  })
}

export function useUpdateFixedOverhead() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Partial<CreateFixedOverheadRequest> }) =>
      callApi(`/financials/fixed-overheads/${id}`, { method: 'PATCH', body: patch, responseSchema: fixedOverhead }),
    onSuccess: () => {
      toast.success('Overhead updated')
      void qc.invalidateQueries({ queryKey: ['financials'] })
    },
  })
}

export function useDeleteFixedOverhead() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => callApi(`/financials/fixed-overheads/${id}`, { method: 'DELETE', responseSchema: noContent }),
    onSuccess: () => {
      toast.success('Overhead deleted')
      void qc.invalidateQueries({ queryKey: ['financials'] })
    },
  })
}


/**
 * Totals over the whole date range, not the page on screen.
 *
 * The cards used to sum whatever rows the current page happened to hold, so
 * "Total" meant "total of these twenty" — a number that changed as you paged
 * and was wrong every time.
 */
/**
 * The tiles, over the same rows the list is showing.
 *
 * This took a date range only, so "Total" described every expense in the
 * month while the rows under it were narrowed by category, project, amount
 * and a search — two numbers on one screen answering different questions.
 */
export function useExpenseSummary(filters: ExpenseFilters = {}) {
  const { session } = useAuth()
  const access = useAccess()
  const qs = expenseParams(filters).toString()
  return useQuery({
    queryKey: ['expenses', 'summary', qs],
    queryFn: () =>
      callApi(`/financials/expenses/summary${qs ? `?${qs}` : ''}`, { responseSchema: expenseSummary }),
    enabled: !!session && access.hasModule('company_expenses'),
    staleTime: 15_000,
  })
}

/** The Profit & Loss for a period (cash or booked), or one project's whole life. */
export function useProfitAndLoss(q: PnlQuery, enabled = true) {
  const { session } = useAuth()
  const access = useAccess()
  const params = new URLSearchParams({ from: q.from, to: q.to, basis: q.basis, ...(q.project_id ? { project_id: q.project_id } : {}) })
  return useQuery({
    queryKey: ['financials', 'pnl', q.from, q.to, q.basis, q.project_id ?? null],
    queryFn: () => callApi(`/financials/pnl?${params.toString()}`, { responseSchema: profitAndLoss }),
    enabled: enabled && !!session && access.hasModule('financials'),
    staleTime: 30_000,
    placeholderData: (prev) => prev,
  })
}

/** The bills behind one expense. */
export function useExpenseAttachments(expenseId: string | null) {
  const { session } = useAuth()
  return useQuery({
    queryKey: ['expenses', 'attachments', expenseId],
    queryFn: () => callApi(`/financials/expenses/${expenseId}/attachments`, { responseSchema: expenseAttachment.array() }),
    enabled: !!session && !!expenseId,
    staleTime: 15_000,
  })
}

export function useAddExpenseAttachment() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ expenseId, file_id }: { expenseId: string; file_id: string }) =>
      callApi(`/financials/expenses/${expenseId}/attachments`, { method: 'POST', body: { file_id }, responseSchema: expenseAttachment }),
    onSuccess: (_a, v) => {
      void qc.invalidateQueries({ queryKey: ['expenses', 'attachments', v.expenseId] })
      void qc.invalidateQueries({ queryKey: ['expenses', 'page'] })
      void qc.invalidateQueries({ queryKey: ['expenses', 'project'] })
    },
    onError: (e: Error) => toast.error(e.message),
  })
}

export function useDeleteExpenseAttachment() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ attachmentId }: { attachmentId: string; expenseId: string }) =>
      callApi(`/financials/expenses/attachments/${attachmentId}`, { method: 'DELETE', responseSchema: z.unknown() }),
    onSuccess: (_r, v) => {
      void qc.invalidateQueries({ queryKey: ['expenses', 'attachments', v.expenseId] })
      void qc.invalidateQueries({ queryKey: ['expenses', 'page'] })
    },
    onError: (e: Error) => toast.error(e.message),
  })
}

/** The money is back with the person who paid. */
export function useMarkReimbursed() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => callApi(`/financials/expenses/${id}/reimbursed`, { method: 'POST', body: {}, responseSchema: z.object({ ok: z.boolean() }) }),
    onSuccess: () => {
      toast.success('Marked as paid back')
      void qc.invalidateQueries({ queryKey: ['expenses'] })
    },
    onError: (e: Error) => toast.error(e.message),
  })
}

/** GST collected and paid, month by month, for the accountant. */
export function useGstSummary(from: string, to: string, enabled = true) {
  const { session } = useAuth()
  const access = useAccess()
  return useQuery({
    queryKey: ['financials', 'gst-summary', from, to],
    queryFn: () => callApi(`/financials/gst-summary?from=${from}&to=${to}`, { responseSchema: gstSummary }),
    enabled: !!session && enabled && !!from && !!to && access.hasModule('financials'),
    staleTime: 60_000,
  })
}
