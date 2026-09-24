import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  expense,
  reconciliationSummary,
  projectFinancials,
  profitabilityReport,
  financialOverview,
  monthlyProfitSummary,
  fixedOverhead,
  z,
  type CreateExpenseRequest,
  type CreateFixedOverheadRequest,
  type ProfitabilityReportQuery,
  type UpdateExpenseRequest,
} from '@ipc/contracts'

const noContent = z.unknown()
import { toast } from 'sonner'
import { callApi } from '@/shared/api/client'
import { useAuth } from '@/shared/auth/AuthProvider'
import { useAccess } from '@/shared/auth/useAccess'

const expenses = expense.array()
const financials = projectFinancials.array()

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

export function useProjectFinancials() {
  const { session } = useAuth()
  const access = useAccess()
  return useQuery({
    queryKey: ['financials', 'projects'],
    queryFn: () => callApi('/financials/projects', { responseSchema: financials }),
    enabled: !!session && access.hasModule('financials'),
    staleTime: 30_000,
  })
}

export function useProfitabilityReport(query: ProfitabilityReportQuery) {
  const { session } = useAuth()
  const access = useAccess()
  const params = new URLSearchParams()
  if (query.date_from) params.set('date_from', query.date_from)
  if (query.date_to) params.set('date_to', query.date_to)
  if (query.project_id) params.set('project_id', query.project_id)
  if (query.client_id) params.set('client_id', query.client_id)
  if (query.status) params.set('status', query.status)
  if (query.search) params.set('search', query.search)
  params.set('sort_by', query.sort_by)
  params.set('sort_direction', query.sort_direction)
  params.set('page', String(query.page))
  params.set('page_size', String(query.page_size))
  return useQuery({
    queryKey: ['financials', 'profitability', params.toString()],
    queryFn: () => callApi(`/financials/profitability?${params.toString()}`, { responseSchema: profitabilityReport }),
    enabled: !!session && access.hasModule('financials'),
    staleTime: 15_000,
  })
}

/** Lovable parity: date-filtered financial overview cards + salaries toggle. */
export function useFinancialOverview(startDate?: string, endDate?: string, includeSalaries = true) {
  const { session } = useAuth()
  const access = useAccess()
  const params = new URLSearchParams()
  if (startDate) params.set('start_date', startDate)
  if (endDate) params.set('end_date', endDate)
  params.set('include_salaries', includeSalaries ? 'true' : 'false')
  return useQuery({
    queryKey: ['financials', 'overview', params.toString()],
    queryFn: () => callApi(`/financials/overview?${params.toString()}`, { responseSchema: financialOverview }),
    enabled: !!session && access.hasModule('financials'),
    staleTime: 30_000,
  })
}

/** Lovable parity: monthly profit (cash/booked + alloc). */
export function useMonthlyProfitSummary(month: string, basis: 'cash' | 'booked', alloc: string) {
  const { session } = useAuth()
  const access = useAccess()
  const params = new URLSearchParams({ month, basis, alloc })
  return useQuery({
    queryKey: ['financials', 'monthly-profit', params.toString()],
    queryFn: () => callApi(`/financials/monthly-profit-summary?${params.toString()}`, { responseSchema: monthlyProfitSummary }),
    enabled: !!session && access.hasModule('financials'),
    staleTime: 15_000,
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

export const expenseSummary = z.object({
  count: z.number().int(),
  total: z.number(),
  tax_total: z.number(),
  rcm_total: z.number(),
  // Counted in SQL over the whole filtered set. Computing these from the rows
  // on screen made "Project-linked" and "Categories used" describe one page.
  linked_count: z.coerce.number().int().default(0),
  category_count: z.coerce.number().int().default(0),
})
export type ExpenseSummary = z.infer<typeof expenseSummary>

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

/**
 * The reconciliation report: every figure a difference between two
 * independently-computed numbers. Short staleTime because the whole value of
 * the page is that a divergence is noticed the day it appears.
 */
export function useReconciliation() {
  const { session } = useAuth()
  const access = useAccess()
  return useQuery({
    queryKey: ['financials', 'reconciliation'],
    queryFn: () => callApi('/financials/reconciliation', { responseSchema: reconciliationSummary }),
    enabled: !!session && access.hasModule('financials'),
    staleTime: 30_000,
  })
}
