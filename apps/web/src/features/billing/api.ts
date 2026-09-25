import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { z } from '@ipc/contracts'
import {
  billingOverview,
  gstState,
  invoiceBankAccount,
  invoiceBankAccountList,
  invoiceDetail,
  invoiceListItem,
  invoiceListResponse,
  invoiceTemplateList,
  invoiceNoteTemplateList,
  paymentReceipt,
  receivedPayment,
  receivedPaymentListResponse,
  type CreateInvoiceBankAccountRequest,
  type CreateInvoiceNoteTemplateRequest,
  type CreateInvoiceRequest,
  type CreateReceivedPaymentRequest,
  type InvoiceListQuery,
  type ReceivedPayment,
  type RecordPaymentRequest,
  type UpdateInvoiceRequest,
  type UpdateReceivedPaymentRequest,
} from '@ipc/contracts'
import { toast } from 'sonner'
import { callApi } from '@/shared/api/client'
import { useAuth } from '@/shared/auth/AuthProvider'
import { useAccess } from '@/shared/auth/useAccess'
import { invalidateMoney } from './invalidate'

const invoicesLegacy = invoiceListItem.array()
const states = gstState.array()
const anySchema = z.any()

export interface InvoiceFilters {
  search?: string | undefined
  status?: string | undefined
  client_id?: string | undefined
  project_id?: string | undefined
  from?: string | undefined
  to?: string | undefined
  page?: number | undefined
  page_size?: number | undefined
}

function toQueryString(f: InvoiceFilters): string {
  const p = new URLSearchParams()
  if (f.search?.trim()) p.set('search', f.search.trim())
  if (f.status && f.status !== 'all') p.set('status', f.status)
  if (f.client_id) p.set('client_id', f.client_id)
  if (f.project_id) p.set('project_id', f.project_id)
  if (f.from) p.set('from', f.from)
  if (f.to) p.set('to', f.to)
  p.set('page', String(f.page ?? 1))
  p.set('page_size', String(f.page_size ?? 25))
  return p.toString()
}

/**
 * Server-filtered invoice list with a summary over the filtered set.
 * Backward compatible: a legacy array response (no params) is normalised to
 * the envelope shape so older servers keep rendering.
 */
export function useInvoices(filters?: InvoiceFilters) {
  const { session } = useAuth()
  const access = useAccess()
  const qs = filters ? toQueryString(filters) : ''
  const hasFilters = !!filters
  return useQuery({
    queryKey: ['invoices', qs || 'all'],
    queryFn: async () => {
      const path = qs ? `/billing/invoices?${qs}` : '/billing/invoices'
      if (!hasFilters) {
        const legacy = await callApi(path, { responseSchema: invoicesLegacy })
        const billed = legacy.reduce((s, i) => s + i.total, 0)
        const pending = legacy.reduce((s, i) => s + i.balance_due, 0)
        return {
          items: legacy,
          summary: {
            total_invoices: legacy.length,
            billed,
            paid: billed - pending,
            pending,
          },
          total: legacy.length,
          page: 1,
          page_size: legacy.length || 25,
        }
      }
      // Envelope when filters are used; tolerate a legacy array mid-deploy.
      const raw = await callApi(path, { responseSchema: anySchema })
      const parsed = invoiceListResponse.safeParse(raw)
      if (parsed.success) return parsed.data
      const items = invoicesLegacy.parse(raw)
      const billed = items.reduce((s, i) => s + i.total, 0)
      const pending = items.reduce((s, i) => s + i.balance_due, 0)
      return {
        items,
        summary: { total_invoices: items.length, billed, paid: billed - pending, pending },
        total: items.length,
        page: filters?.page ?? 1,
        page_size: filters?.page_size ?? 25,
      }
    },
    enabled: !!session && access.hasModule('billing'),
    staleTime: 15_000,
    placeholderData: (prev) => prev,
  })
}

export type { InvoiceListQuery }

export function useStates() {
  const { session } = useAuth()
  return useQuery({
    queryKey: ['billing', 'states'],
    queryFn: () => callApi('/billing/states', { responseSchema: states }),
    enabled: !!session,
    staleTime: 300_000,
  })
}

export function useInvoiceTemplates() {
  const { session } = useAuth()
  const access = useAccess()
  return useQuery({
    queryKey: ['billing', 'templates'],
    queryFn: () => callApi('/billing/templates', { responseSchema: invoiceTemplateList }),
    enabled: !!session && access.hasModule('billing'),
    staleTime: 60_000,
  })
}

export function useInvoiceNoteTemplates() {
  const { session } = useAuth()
  const access = useAccess()
  return useQuery({
    queryKey: ['billing', 'note-templates'],
    queryFn: () => callApi('/billing/note-templates', { responseSchema: invoiceNoteTemplateList }),
    enabled: !!session && access.hasModule('billing'),
    staleTime: 60_000,
  })
}

export function useCreateInvoiceNoteTemplate() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: CreateInvoiceNoteTemplateRequest) =>
      callApi('/billing/note-templates', { method: 'POST', body: input, responseSchema: z.object({ id: z.string() }) }),
    onSuccess: () => {
      toast.success('Note template saved')
      void qc.invalidateQueries({ queryKey: ['billing', 'note-templates'] })
    },
    onError: (e: Error) => toast.error(e.message),
  })
}

export function useUpdateInvoiceNoteTemplate() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: CreateInvoiceNoteTemplateRequest }) =>
      callApi(`/billing/note-templates/${id}`, { method: 'PATCH', body, responseSchema: z.object({ ok: z.boolean() }) }),
    onSuccess: () => {
      toast.success('Template updated')
      void qc.invalidateQueries({ queryKey: ['billing', 'note-templates'] })
    },
    onError: (e: Error) => toast.error(e.message),
  })
}

export function useDeleteInvoiceNoteTemplate() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) =>
      callApi(`/billing/note-templates/${id}`, { method: 'DELETE', responseSchema: anySchema }),
    onSuccess: () => {
      toast.success('Template deleted')
      void qc.invalidateQueries({ queryKey: ['billing', 'note-templates'] })
    },
    onError: (e: Error) => toast.error(e.message),
  })
}

export function useDefaultInvoiceNoteTemplate() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) =>
      callApi(`/billing/note-templates/${id}/default`, { method: 'POST', responseSchema: z.object({ ok: z.boolean() }) }),
    onSuccess: () => {
      toast.success('Default updated')
      void qc.invalidateQueries({ queryKey: ['billing', 'note-templates'] })
    },
    onError: (e: Error) => toast.error(e.message),
  })
}

export function useSeedInvoiceNoteTemplates() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () =>
      callApi('/billing/note-templates/seed-defaults', { method: 'POST', responseSchema: z.object({ inserted: z.number() }) }),
    onSuccess: (r) => {
      toast.success(r.inserted > 0 ? `Added ${r.inserted} recommended templates` : 'Already up to date')
      void qc.invalidateQueries({ queryKey: ['billing', 'note-templates'] })
    },
    onError: (e: Error) => toast.error(e.message),
  })
}

// ── Bank accounts ────────────────────────────────────────────
export function useInvoiceBankAccounts() {
  const { session } = useAuth()
  const access = useAccess()
  return useQuery({
    queryKey: ['billing', 'bank-accounts'],
    queryFn: () => callApi('/billing/bank-accounts', { responseSchema: invoiceBankAccountList }),
    enabled: !!session && access.hasModule('billing'),
    staleTime: 60_000,
  })
}

export function useCreateInvoiceBankAccount() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: CreateInvoiceBankAccountRequest) =>
      callApi('/billing/bank-accounts', { method: 'POST', body: input, responseSchema: invoiceBankAccount }),
    onSuccess: () => {
      toast.success('Bank account saved')
      void qc.invalidateQueries({ queryKey: ['billing', 'bank-accounts'] })
    },
    onError: (e: Error) => toast.error(e.message),
  })
}

export function useUpdateInvoiceBankAccount() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: CreateInvoiceBankAccountRequest }) =>
      callApi(`/billing/bank-accounts/${id}`, { method: 'PATCH', body, responseSchema: z.object({ ok: z.boolean() }) }),
    onSuccess: () => {
      toast.success('Bank account updated')
      void qc.invalidateQueries({ queryKey: ['billing', 'bank-accounts'] })
    },
    onError: (e: Error) => toast.error(e.message),
  })
}

export function useDefaultInvoiceBankAccount() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) =>
      callApi(`/billing/bank-accounts/${id}/default`, { method: 'POST', responseSchema: z.object({ ok: z.boolean() }) }),
    onSuccess: () => {
      toast.success('Default updated')
      void qc.invalidateQueries({ queryKey: ['billing', 'bank-accounts'] })
    },
    onError: (e: Error) => toast.error(e.message),
  })
}

export function useDeleteInvoiceBankAccount() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) =>
      callApi(`/billing/bank-accounts/${id}`, { method: 'DELETE', responseSchema: anySchema }),
    onSuccess: () => {
      toast.success('Bank account deleted')
      void qc.invalidateQueries({ queryKey: ['billing', 'bank-accounts'] })
    },
    onError: (e: Error) => toast.error(e.message),
  })
}

export function useInvoice(id: string) {
  const { session } = useAuth()
  const access = useAccess()
  return useQuery({
    queryKey: ['invoices', id],
    queryFn: () => callApi(`/billing/invoices/${id}`, { responseSchema: invoiceDetail }),
    enabled: !!session && !!id && access.hasModule('billing'),
  })
}

export function useCreateInvoice() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: CreateInvoiceRequest) =>
      callApi('/billing/invoices', {
        method: 'POST',
        body: input,
        responseSchema: z.object({ id: z.string(), invoice_number: z.string() }),
      }),
    onSuccess: () => {
      toast.success('Invoice created')
      invalidateMoney(qc)
    },
  })
}

export function useUpdateInvoice(invoiceId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: UpdateInvoiceRequest) =>
      callApi(`/billing/invoices/${invoiceId}`, { method: 'PATCH', body: input, responseSchema: anySchema }),
    onSuccess: () => {
      toast.success('Invoice updated')
      invalidateMoney(qc)
    },
  })
}

export function useDeleteInvoice() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => callApi(`/billing/invoices/${id}`, { method: 'DELETE', responseSchema: anySchema }),
    onSuccess: () => {
      toast.success('Invoice deleted')
      invalidateMoney(qc)
    },
  })
}

export function useRecordPayment(invoiceId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: RecordPaymentRequest) =>
      callApi(`/billing/invoices/${invoiceId}/payments`, {
        method: 'POST',
        body: input,
        responseSchema: anySchema,
      }),
    onSuccess: () => {
      toast.success('Payment recorded')
      invalidateMoney(qc)
    },
  })
}

// ── Standalone received_payments module (Lovable billing parity) ──
export interface ReceivedPaymentFilters {
  search?: string | undefined
  status?: string | undefined
  client_id?: string | undefined
  project_id?: string | undefined
  date_from?: string | undefined
  date_to?: string | undefined
  is_gst?: boolean | undefined
  mode?: string | undefined
  amount_min?: number | undefined
  amount_max?: number | undefined
  sort_by?: string | undefined
  sort_direction?: 'asc' | 'desc' | undefined
  page?: number | undefined
  page_size?: number | undefined
}

function toPaymentsQueryString(f: ReceivedPaymentFilters): string {
  const p = new URLSearchParams()
  if (f.search?.trim()) p.set('search', f.search.trim())
  if (f.status && f.status !== 'all') p.set('status', f.status)
  if (f.client_id) p.set('client_id', f.client_id)
  if (f.project_id) p.set('project_id', f.project_id)
  if (f.date_from) p.set('date_from', f.date_from)
  if (f.date_to) p.set('date_to', f.date_to)
  if (f.is_gst !== undefined) p.set('is_gst', String(f.is_gst))
  if (f.mode) p.set('mode', f.mode)
  if (f.amount_min !== undefined && Number.isFinite(f.amount_min)) p.set('amount_min', String(f.amount_min))
  if (f.amount_max !== undefined && Number.isFinite(f.amount_max)) p.set('amount_max', String(f.amount_max))
  if (f.sort_by) p.set('sort_by', f.sort_by)
  if (f.sort_direction) p.set('sort_direction', f.sort_direction)
  p.set('page', String(f.page ?? 1))
  p.set('page_size', String(f.page_size ?? 25))
  return p.toString()
}

export function useReceivedPayments(filters: ReceivedPaymentFilters) {
  const { session } = useAuth()
  const access = useAccess()
  const qs = toPaymentsQueryString(filters)
  return useQuery({
    queryKey: ['received-payments', qs],
    queryFn: () => callApi(`/billing/payments?${qs}`, { responseSchema: receivedPaymentListResponse }),
    enabled: !!session && access.hasModule('billing'),
    staleTime: 15_000,
    placeholderData: (prev) => prev,
  })
}

export function useReceivedPayment(id: string | null) {
  const { session } = useAuth()
  const access = useAccess()
  return useQuery({
    queryKey: ['received-payments', id],
    queryFn: () => callApi(`/billing/payments/${id}`, { responseSchema: receivedPayment }),
    enabled: !!session && !!id && access.hasModule('billing'),
  })
}

export function useCreateReceivedPayment() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: CreateReceivedPaymentRequest) =>
      callApi('/billing/payments', {
        method: 'POST',
        body: input,
        responseSchema: z.object({ id: z.string() }),
      }),
    onSuccess: () => {
      toast.success('Payment added')
      invalidateMoney(qc)
    },
    onError: (e: Error) => toast.error(e.message),
  })
}

export function useUpdateReceivedPayment(id: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: UpdateReceivedPaymentRequest) =>
      callApi(`/billing/payments/${id}`, { method: 'PATCH', body: input, responseSchema: z.object({ ok: z.boolean() }) }),
    onSuccess: () => {
      toast.success('Payment updated')
      invalidateMoney(qc)
    },
    onError: (e: Error) => toast.error(e.message),
  })
}

/** A payment drawn as its receipt: letterhead, client, project value. */
export function usePaymentReceipt(id: string | null) {
  const { session } = useAuth()
  const access = useAccess()
  return useQuery({
    queryKey: ['received-payments', id, 'receipt'],
    queryFn: () => callApi(`/billing/payments/${id}/receipt`, { responseSchema: paymentReceipt }),
    enabled: !!session && !!id && access.hasModule('billing'),
  })
}

export function useDeleteReceivedPayment() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => callApi(`/billing/payments/${id}`, { method: 'DELETE', responseSchema: anySchema }),
    onSuccess: () => {
      toast.success('Payment deleted')
      invalidateMoney(qc)
    },
    onError: (e: Error) => toast.error(e.message),
  })
}

export type { ReceivedPayment }

const overviewSchema = billingOverview

/** The Billing overview: owed, late, received, and the lists behind them. */
export function useBillingOverview() {
  const { session } = useAuth()
  const access = useAccess()
  return useQuery({
    queryKey: ['billing', 'overview'],
    queryFn: () => callApi('/billing/overview', { responseSchema: overviewSchema }),
    enabled: !!session && access.hasModule('billing'),
    staleTime: 15_000,
  })
}

/** Make (or replace) the link a client opens without logging in. */
export async function issueInvoiceLink(invoiceId: string): Promise<string | null> {
  try {
    const r = await callApi(`/billing/invoices/${invoiceId}/share`, { method: 'POST', body: {}, responseSchema: z.object({ link: z.string() }) })
    return r.link
  } catch (e) {
    toast.error(e instanceof Error ? e.message : 'Could not make the invoice link.')
    return null
  }
}

export function useRevokeInvoiceLink() {
  return useMutation({
    mutationFn: (invoiceId: string) =>
      callApi(`/billing/invoices/${invoiceId}/share`, { method: 'POST', body: { revoke: true }, responseSchema: anySchema }),
    onSuccess: () => toast.success('The old link no longer works.'),
    onError: (e: Error) => toast.error(e.message),
  })
}

/** Cancel an invoice; its payments stay on the project. */
export function useCancelInvoice() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (invoiceId: string) =>
      callApi(`/billing/invoices/${invoiceId}/cancel`, { method: 'POST', body: {}, responseSchema: anySchema }),
    onSuccess: () => {
      toast.success('Invoice cancelled')
      invalidateMoney(qc)
    },
    onError: (e: Error) => toast.error(e.message),
  })
}
