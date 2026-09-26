import { z } from 'zod'
import { isoDate, money, uuid } from './shared/primitives'

/**
 * Reports (0189): how the studio is doing for a period, one read per tab.
 * Every figure is the one another screen already shows -- see the migration
 * for which table each comes from.
 */
export const reportQuery = z
  .object({ from: isoDate, to: isoDate })
  .refine((q) => q.from <= q.to, { message: 'The end date is before the start date.' })
export type ReportQuery = z.infer<typeof reportQuery>

export const reportTab = z.enum(['sales', 'money', 'delivery', 'team'])
export type ReportTab = z.infer<typeof reportTab>

const count = z.number().int().nonnegative()
const pct = z.number().min(0).max(100).nullable()

export const salesReport = z.object({
  from: isoDate,
  to: isoDate,
  /** Leads that came in during the period. */
  enquiries: count,
  /** Of those, how many are now booked (converted). */
  booked: count,
  conversion_pct: pct,
  /** Projects created in the period, not cancelled, and their value. */
  bookings: count,
  booking_value: money,
  sources: z.array(z.object({ source: z.string(), enquiries: count, booked: count })),
  lost: count,
  lost_reasons: z.array(z.object({ reason: z.string(), count })),
})
export type SalesReport = z.infer<typeof salesReport>

export const moneyReport = z.object({
  from: isoDate,
  to: isoDate,
  /** Invoices issued in the period (not draft, not cancelled). */
  billed: money,
  invoices: count,
  /** Payments received in the period. */
  received: money,
  /** Project value not yet received, right now. */
  to_collect: money,
  /** The part of it on invoices past their due date. */
  overdue: money,
  overdue_invoices: count,
  expenses: money,
  /** The four clients who owe the most. */
  owes: z.array(
    z.object({
      client_id: uuid,
      client_name: z.string(),
      outstanding: money,
      overdue: money,
      overdue_days: z.number().int().nullable(),
      /** The oldest overdue invoice, if any. */
      invoice_id: uuid.nullable(),
      /** The project with the most still to collect. */
      project_id: uuid.nullable(),
    }),
  ),
})
export type MoneyReport = z.infer<typeof moneyReport>

export const deliveryReport = z.object({
  from: isoDate,
  to: isoDate,
  delivered: count,
  with_due_date: count,
  on_time: count,
  on_time_pct: pct,
  avg_days_to_deliver: z.number().nullable(),
  late_now: count,
  /** The five most overdue, longest late first. */
  late: z.array(
    z.object({
      id: uuid,
      title: z.string(),
      project_id: uuid,
      project_name: z.string(),
      client_name: z.string().nullable(),
      due_date: isoDate,
      days_late: z.number().int(),
      assignee_name: z.string().nullable(),
    }),
  ),
})
export type DeliveryReport = z.infer<typeof deliveryReport>

export const teamReport = z.object({
  from: isoDate,
  to: isoDate,
  members: z.array(
    z.object({
      user_id: uuid,
      name: z.string(),
      shoots: count,
      delivered: count,
      late_now: count,
      days_present: count,
      leave_days: z.number().nonnegative(),
    }),
  ),
})
export type TeamReport = z.infer<typeof teamReport>
