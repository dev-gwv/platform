import { z } from 'zod'
import { uuid, isoDate, isoDateTime, money, gstRate } from './shared/primitives'

export const gstTreatment = z.enum(['non_gst', 'gst_applicable', 'exempt', 'reverse_charge'])

export const expense = z.object({
  id: uuid,
  project_id: uuid.nullable(),
  party_id: uuid.nullable(),
  party_name: z.string().nullable(),
  category: z.string().nullable(),
  description: z.string().nullable(),
  amount: money,
  expense_date: isoDate,
  gst_treatment: gstTreatment,
  gst_rate: gstRate.nullable(),
  is_fixed_overhead: z.boolean(),
  // Lovable parity (optional so old rows still parse).
  invoice_number: z.string().nullable().nullish(),
  amount_is: z.enum(['including_tax', 'excluding_tax']).nullish(),
  tax_name: z.string().nullable().nullish(),
  tax_amount: money.nullish(),
  reverse_charge: z.boolean().nullish(),
  itemize_json: z.array(z.record(z.string(), z.unknown())).nullish(),
  /** Who paid, when it was not the studio's account: money to give back. */
  paid_by_user_id: uuid.nullable().default(null),
  paid_by_name: z.string().nullable().default(null),
  reimbursement_status: z.enum(['none', 'pending', 'reimbursed']).default('none'),
  reimbursed_at: isoDateTime.nullable().default(null),
  attachment_count: z.number().int().nonnegative().default(0),
})
export type Expense = z.infer<typeof expense>

export const expenseAttachment = z.object({
  id: uuid,
  file_id: uuid.nullable().default(null),
  file_name: z.string().nullable(),
  file_url: z.string().nullable(),
  mime_type: z.string().nullable().default(null),
  file_size: z.number().int().nullable().default(null),
  created_at: isoDateTime,
})
export type ExpenseAttachment = z.infer<typeof expenseAttachment>

export const addExpenseAttachmentRequest = z.object({ file_id: uuid })
export type AddExpenseAttachmentRequest = z.infer<typeof addExpenseAttachmentRequest>

/** The three tiles over the Expenses page, whatever the list is filtered to. */
export const expenseSummary = z.object({
  count: z.number().int(),
  total: money,
  tax_total: money,
  rcm_total: money,
  linked_count: z.number().int(),
  category_count: z.number().int(),
  this_month: money.default(0),
  this_fy: money.default(0),
  to_reimburse: money.default(0),
})
export type ExpenseSummary = z.infer<typeof expenseSummary>

/** GST collected on invoices and paid on expenses, month by month, for the accountant. */
export const gstSummary = z.object({
  from: isoDate,
  to: isoDate,
  months: z.array(
    z.object({
      month: z.string(),
      taxable_sales: money,
      cgst: money,
      sgst: money,
      igst: money,
      gst_collected: money,
      purchases: money,
      gst_paid: money,
      rcm: money,
    }),
  ),
})
export type GstSummary = z.infer<typeof gstSummary>

export const expenseItemLine = z.object({
  title: z.string().trim().max(200),
  amount: money,
  qty: z.number().min(0).nullish(),
})
export type ExpenseItemLine = z.infer<typeof expenseItemLine>

export const createExpenseRequest = z.object({
  project_id: uuid.nullable().default(null),
  party_id: uuid.nullable().optional(),
  category: z.string().max(80).optional(),
  description: z.string().max(400).optional(),
  amount: money,
  expense_date: isoDate.optional(),
  gst_treatment: gstTreatment.default('non_gst'),
  gst_rate: gstRate.optional(),
  is_fixed_overhead: z.boolean().default(false),
  invoice_number: z.string().trim().max(80).nullish(),
  amount_is: z.enum(['including_tax', 'excluding_tax']).nullish(),
  tax_name: z.string().trim().max(80).nullish(),
  tax_amount: money.nullish(),
  reverse_charge: z.boolean().nullish(),
  itemize_json: z.array(z.record(z.string(), z.unknown())).nullish(),
  paid_by_user_id: uuid.nullable().optional(),
  reimbursement_status: z.enum(['none', 'pending', 'reimbursed']).optional(),
})
export type CreateExpenseRequest = z.infer<typeof createExpenseRequest>

export const updateExpenseRequest = z.object({
  project_id: uuid.nullable().optional(),
  party_id: uuid.nullable().optional(),
  category: z.string().max(80).nullable().optional(),
  description: z.string().max(400).nullable().optional(),
  amount: money.optional(),
  expense_date: isoDate.optional(),
  gst_treatment: gstTreatment.optional(),
  gst_rate: gstRate.nullable().optional(),
  is_fixed_overhead: z.boolean().optional(),
  invoice_number: z.string().trim().max(80).nullable().optional(),
  amount_is: z.enum(['including_tax', 'excluding_tax']).nullable().optional(),
  tax_name: z.string().trim().max(80).nullable().optional(),
  tax_amount: money.nullable().optional(),
  reverse_charge: z.boolean().optional(),
  itemize_json: z.array(z.record(z.string(), z.unknown())).nullable().optional(),
  paid_by_user_id: uuid.nullable().optional(),
  reimbursement_status: z.enum(['none', 'pending', 'reimbursed']).optional(),
})
export type UpdateExpenseRequest = z.infer<typeof updateExpenseRequest>

/** One row of the project_financials view + derived gross/balance. */
export const projectFinancials = z.object({
  project_id: uuid,
  name: z.string(),
  revenue: money,
  received: money,
  direct_team_cost: money,
  project_expenses: money,
  gross_profit: z.number(),
  balance_pending: money,
})
export type ProjectFinancials = z.infer<typeof projectFinancials>

// ── Lovable parity: monthly profit + fixed overheads + overview ──
export const fixedOverheadCategory = z.enum([
  'rent', 'salaries', 'utilities', 'internet', 'software', 'insurance', 'maintenance', 'marketing', 'other',
])
export type FixedOverheadCategory = z.infer<typeof fixedOverheadCategory>

export const fixedOverheadAlloc = z.enum(['equal', 'revenue', 'shoot_days', 'headcount'])
export type FixedOverheadAlloc = z.infer<typeof fixedOverheadAlloc>

export const fixedOverhead = z.object({
  id: uuid,
  category: z.string(),
  label: z.string().nullable(),
  amount: money,
  alloc_basis: z.string(),
  month: isoDate,
  is_active: z.boolean(),
  created_at: z.string().nullable().nullish(),
})
export type FixedOverhead = z.infer<typeof fixedOverhead>

export const createFixedOverheadRequest = z.object({
  category: fixedOverheadCategory,
  label: z.string().trim().max(160).nullish(),
  amount: money,
  alloc_basis: fixedOverheadAlloc.default('equal'),
  month: isoDate,
})
export type CreateFixedOverheadRequest = z.infer<typeof createFixedOverheadRequest>

export const monthlyProfitSummary = z.object({
  month: z.string(),
  basis: z.string(),
  alloc: z.string(),
  cash_received: z.number(),
  booked_revenue: z.number(),
  salary_cost: z.number(),
  office_fixed: z.number(),
  variable_cost: z.number(),
  fixed_total: z.number(),
  total_cost: z.number(),
  net_cash: z.number(),
  net_booked: z.number(),
  margin_cash: z.number().nullish(),
  margin_booked: z.number().nullish(),
  warnings: z.array(z.string()).nullish(),
  projects: z.array(z.record(z.string(), z.unknown())).nullish(),
  salary_buckets: z.array(z.record(z.string(), z.unknown())).nullish(),
})
export type MonthlyProfitSummary = z.infer<typeof monthlyProfitSummary>

export const financialOverview = z.object({
  start_date: z.string().nullable().nullish(),
  end_date: z.string().nullable().nullish(),
  revenue: z.number(),
  received: z.number(),
  receivables: z.number(),
  collection_rate: z.number(),
  margin: z.number().nullish(),
  salaries: z.number(),
  company_expenses: z.number(),
  personal_expenses: z.number(),
  gst_collected: z.number().nullish(),
  gst_paid: z.number().nullish(),
  rcm_liability: z.number().nullish(),
  attention_count: z.number().int().nullish(),
  attention: z.array(z.record(z.string(), z.unknown())).nullish(),
  recent: z.array(z.record(z.string(), z.unknown())).nullish(),
  // Lovable parity (additive optional): net/expected profit, totals, data-quality counts, salary toggle echo.
  net_profit: z.number().nullish(),
  expected_profit: z.number().nullish(),
  total_expenses: z.number().nullish(),
  uncategorized_count: z.number().int().nullish(),
  missing_invoice_count: z.number().int().nullish(),
  include_salaries: z.boolean().nullish(),
  salaries_warning: z.string().nullable().nullish(),
})
export type FinancialOverview = z.infer<typeof financialOverview>

// ── reconciliation ────────────────────────────────────────────────
/**
 * The screen where two derivations of the same rupee have to agree.
 *
 * Every figure is a difference between two independently-computed numbers:
 * invoiced vs received, received vs banked, project value vs invoiced, owed vs
 * settled. A split like the two payment ledgers shows up here as a column
 * rather than as two screens nobody compares.
 */


/**
 * The Profit & Loss statement (0167). `cash`: what came in and went out in
 * the period. `booked`: the work done in the period -- each project's value
 * spread over its shoots, with the crew those shoots cost. Every cost is in
 * exactly one line.
 */
export const pnlBasis = z.enum(['cash', 'booked'])
export type PnlBasis = z.infer<typeof pnlBasis>

export const pnlQuery = z.object({
  from: isoDate,
  to: isoDate,
  basis: pnlBasis.default('cash'),
  project_id: uuid.optional(),
})
export type PnlQuery = z.infer<typeof pnlQuery>

export const pnlLines = z.object({
  income: z.number(),
  gst_collected: z.number(),
  team_crew: z.number(),
  team_payouts: z.number(),
  project_expenses: z.number(),
  gross_profit: z.number(),
  salaries: z.number(),
  overheads: z.number(),
  studio_expenses: z.number(),
  net_profit: z.number(),
})
export type PnlLines = z.infer<typeof pnlLines>

export const profitAndLoss = z.object({
  from: isoDate,
  to: isoDate,
  basis: pnlBasis,
  lines: pnlLines,
  monthly: z.array(pnlLines.extend({ month: z.string() })),
  categories: z.array(z.object({ category: z.string(), amount: z.number() })),
  projects: z.array(
    z.object({
      project_id: uuid,
      name: z.string(),
      client_name: z.string().nullish(),
      status: z.string(),
      income: z.number(),
      team: z.number(),
      expenses: z.number(),
      profit: z.number(),
      margin: z.number().nullish(),
      to_collect: z.number(),
    }),
  ),
  rail: z.object({ still_to_collect: z.number(), owed_to_team: z.number() }),
})
export type ProfitAndLoss = z.infer<typeof profitAndLoss>
