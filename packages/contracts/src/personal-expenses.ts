import { z } from 'zod'
import { uuid, isoDate, isoDateTime, money, gstRate } from './shared/primitives'

export const personalExpenseCategory = z.enum([
  'travel',
  'food',
  'accommodation',
  'supplies',
  'communication',
  'equipment',
  'other',
])
export type PersonalExpenseCategory = z.infer<typeof personalExpenseCategory>

export const PERSONAL_EXPENSE_CATEGORIES: readonly PersonalExpenseCategory[] = personalExpenseCategory.options

/** A vendor, freelancer, or other party an expense was paid to or received from. */
export const party = z.object({
  id: uuid,
  name: z.string(),
  kind: z.enum(['vendor', 'freelancer', 'other']),
  // Lovable parity: parties manager fields. All optional.
  phone: z.string().nullable().nullish(),
  email: z.string().nullable().nullish(),
  gstin: z.string().nullable().nullish(),
  address: z.string().nullable().nullish(),
  state: z.string().nullable().nullish(),
  is_active: z.boolean().nullish(),
})
export type Party = z.infer<typeof party>

export const createPartyRequest = z.object({
  name: z.string().trim().min(1).max(120),
  kind: z.enum(['vendor', 'freelancer', 'other']).default('vendor'),
  phone: z.string().trim().max(40).nullish(),
  email: z.string().trim().max(200).nullish(),
  gstin: z.string().trim().max(20).nullish(),
  address: z.string().trim().max(400).nullish(),
  state: z.string().trim().max(80).nullish(),
  is_active: z.boolean().nullish(),
})
export type CreatePartyRequest = z.infer<typeof createPartyRequest>

export const updatePartyRequest = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  kind: z.enum(['vendor', 'freelancer', 'other']).optional(),
  phone: z.string().trim().max(40).nullable().optional(),
  email: z.string().trim().max(200).nullable().optional(),
  gstin: z.string().trim().max(20).nullable().optional(),
  address: z.string().trim().max(400).nullable().optional(),
  state: z.string().trim().max(80).nullable().optional(),
  is_active: z.boolean().optional(),
})
export type UpdatePartyRequest = z.infer<typeof updatePartyRequest>

export const personalExpense = z.object({
  id: uuid,
  company_id: uuid,
  user_id: uuid,
  party_id: uuid.nullable(),
  party_name: z.string().nullable(),
  amount: money,
  expense_date: isoDate,
  category: z.string().nullable(),
  gst_treatment: z.string(),
  gst_rate: gstRate.nullable(),
  description: z.string().nullable(),
  created_at: isoDateTime,
  // Lovable parity (optional).
  invoice_number: z.string().nullable().nullish(),
  amount_is: z.string().nullable().nullish(),
  tax_name: z.string().nullable().nullish(),
  tax_amount: money.nullish(),
  reverse_charge: z.boolean().nullish(),
  itemize_json: z.array(z.record(z.string(), z.unknown())).nullish(),
})
export type PersonalExpense = z.infer<typeof personalExpense>

export const personalExpenseSummary = z.object({
  total_count: z.number().int(),
  total_amount: money,
  this_month_amount: money,
  this_month_count: z.number().int(),
})
export type PersonalExpenseSummary = z.infer<typeof personalExpenseSummary>

export const personalExpenseList = z.object({
  items: z.array(personalExpense),
  summary: personalExpenseSummary,
  next_cursor: isoDateTime.nullable().default(null),
})
export type PersonalExpenseList = z.infer<typeof personalExpenseList>

export const createPersonalExpenseRequest = z.object({
  party_id: uuid.nullish(),
  amount: money.refine((v) => v > 0, 'amount must be positive'),
  expense_date: isoDate.optional(),
  // The built-in categories are defaults, not the whole list: a studio adds
  // its own from the form (Settings → Lookups, personal_expense_category).
  category: z.string().trim().min(1).max(80).nullish(),
  gst_treatment: z.enum(['non_gst', 'gst_applicable', 'exempt', 'reverse_charge']).default('non_gst'),
  gst_rate: gstRate.nullish(),
  description: z.string().trim().max(2000).nullish(),
  // Lovable parity: invoice/amount_is/tax_name/amount/reverse/itemized.
  invoice_number: z.string().trim().max(80).nullish(),
  amount_is: z.enum(['including_tax', 'excluding_tax']).nullish(),
  tax_name: z.string().trim().max(80).nullish(),
  tax_amount: money.nullish(),
  reverse_charge: z.boolean().nullish(),
  itemize_json: z.array(z.record(z.string(), z.unknown())).nullish(),
})
export type CreatePersonalExpenseRequest = z.infer<typeof createPersonalExpenseRequest>

export const updatePersonalExpenseRequest = createPersonalExpenseRequest
export type UpdatePersonalExpenseRequest = z.infer<typeof updatePersonalExpenseRequest>

export const personalExpenseReport = z.object({
  period_start: isoDate,
  period_end: isoDate,
  total_amount: money,
  by_category: z.array(
    z.object({
      category: z.string().nullable(),
      amount: money,
      count: z.number().int(),
    }),
  ),
  daily_breakdown: z.array(
    z.object({
      date: isoDate,
      amount: money,
      count: z.number().int(),
    }),
  ),
})
export type PersonalExpenseReport = z.infer<typeof personalExpenseReport>

export const personalExpenseReportRequest = z.object({
  start_date: isoDate,
  end_date: isoDate,
})
export type PersonalExpenseReportRequest = z.infer<typeof personalExpenseReportRequest>
