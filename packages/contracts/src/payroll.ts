import { z } from 'zod'
import { isoDate, isoDateTime, money, uuid } from './shared/primitives'

/** Monthly payroll run (0185): draft -> approved (locked) -> paid. */
export const payrollRunStatus = z.enum(['draft', 'approved', 'paid'])
export type PayrollRunStatus = z.infer<typeof payrollRunStatus>

const month = z.number().int().min(1).max(12)
const year = z.number().int().min(2000).max(2100)

export const payrollRun = z.object({
  id: uuid,
  pay_year: year,
  pay_month: month,
  status: payrollRunStatus,
  total_base: money,
  total_deductions: money,
  total_additions: money,
  total_net: money,
  total_paid: money,
  people: z.number().int(),
  generated_at: isoDateTime,
  approved_at: isoDateTime.nullable(),
  approved_by_name: z.string().nullable(),
  paid_at: isoDateTime.nullable(),
})
export type PayrollRun = z.infer<typeof payrollRun>

export const payrollLine = z.object({
  id: uuid,
  user_id: uuid,
  name: z.string(),
  /** The full monthly salary. */
  base_amount: money,
  working_days: z.number().int(),
  /** The days paid for: joining (or the 1st) to leaving (or the last day), 0188. */
  period_start: isoDate,
  period_end: isoDate,
  /** Working days inside that period. */
  payable_days: z.number().int(),
  /** base × payable days ÷ working days; the base for a full month. */
  prorated_base: money,
  days_present: z.number().int(),
  unpaid_leave_days: z.number(),
  absent_days: z.number().int(),
  late_marks: z.number().int(),
  deduction: money,
  additions: money,
  additions_note: z.string().nullable(),
  other_deductions: money,
  other_deductions_note: z.string().nullable(),
  net_pay: money,
  paid_amount: z.number(),
  paid_at: isoDateTime.nullable(),
  payment_mode: z.string().nullable(),
  payment_reference: z.string().nullable(),
})
export type PayrollLine = z.infer<typeof payrollLine>

/** Shoot payouts still owed for the month, one row per person. */
export const payrollFreelancerDue = z.object({
  user_id: uuid,
  name: z.string(),
  shoots: z.number().int(),
  owed: money,
  paid: z.number(),
  due: money,
})
export type PayrollFreelancerDue = z.infer<typeof payrollFreelancerDue>

export const payrollMonth = z.object({
  run: payrollRun.nullable(),
  lines: z.array(payrollLine),
  /** Null when the caller does not see team payouts. */
  freelancers: z.array(payrollFreelancerDue).nullable(),
  can_edit: z.boolean(),
})
export type PayrollMonth = z.infer<typeof payrollMonth>

export const generatePayrollRequest = z.object({ year, month })
export type GeneratePayrollRequest = z.infer<typeof generatePayrollRequest>

const note = z.string().trim().max(200).nullable().optional()

export const updatePayrollLineRequest = z.object({
  additions: money.max(10_000_000),
  additions_note: note,
  other_deductions: money.max(10_000_000),
  other_deductions_note: note,
})
export type UpdatePayrollLineRequest = z.infer<typeof updatePayrollLineRequest>

export const markPayrollPaidRequest = z.object({
  /** One line; leave out to mark everyone still to pay. */
  line_id: uuid.optional(),
  payment_mode: z.string().trim().max(40).nullable().optional(),
  reference: z.string().trim().max(120).nullable().optional(),
})
export type MarkPayrollPaidRequest = z.infer<typeof markPayrollPaidRequest>

export const markPayrollPaidResponse = z.object({ paid_count: z.number().int(), paid_total: z.number() })

/** A bank-transfer sheet row; full account details, for whoever pays. */
export const payrollExportRow = z.object({
  name: z.string(),
  upi_id: z.string().nullable(),
  bank_account_name: z.string().nullable(),
  bank_account_number: z.string().nullable(),
  bank_ifsc: z.string().nullable(),
  net_pay: money,
  payable_days: z.number().int(),
})
export type PayrollExportRow = z.infer<typeof payrollExportRow>

export const payslipSummary = z.object({
  id: uuid,
  pay_year: year,
  pay_month: month,
  net_pay: money,
  paid_at: isoDateTime.nullable(),
  run_status: payrollRunStatus,
})
export type PayslipSummary = z.infer<typeof payslipSummary>

export const payslip = payrollLine.extend({
  pay_year: year,
  pay_month: month,
  run_status: payrollRunStatus,
  email: z.string().nullable(),
  phone: z.string().nullable(),
  job_title: z.string().nullable(),
  company_name: z.string(),
  company_legal_name: z.string().nullable(),
  company_address: z.string().nullable(),
  company_phone: z.string().nullable(),
  company_email: z.string().nullable(),
  logo_url: z.string().nullable(),
})
export type Payslip = z.infer<typeof payslip>
