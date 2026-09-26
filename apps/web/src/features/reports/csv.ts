import type { DeliveryReport, MoneyReport, SalesReport, TeamReport } from '@ipc/contracts'
import { toCsv } from '@/shared/ui/csv'

/** Where a lead came from, in the words a studio uses. */
const SOURCE_LABEL: Record<string, string> = {
  facebook: 'Facebook',
  instagram: 'Instagram',
  whatsapp: 'WhatsApp',
  webform: 'Website form',
  google_form: 'Google Form',
  referral: 'Referral',
  manual: 'Added by hand',
  enquiry: 'Enquiry form',
  csv_import: 'Imported',
  other: 'Other',
}

export const sourceLabel = (s: string) => SOURCE_LABEL[s] ?? s.charAt(0).toUpperCase() + s.slice(1).replace(/_/g, ' ')

/** 37.5 -> "37.5%", null -> "—". */
export const pctText = (n: number | null) => (n == null ? '—' : `${Number.isInteger(n) ? n : n.toFixed(1)}%`)

/**
 * One file per tab: a heading line naming the period, then small tables with
 * a blank line between them, so it reads the same in Excel as on screen.
 */
const section = (title: string, headers: string[], rows: (string | number | null)[][]) =>
  `${title}\n${toCsv(headers, rows)}`

export function salesCsv(r: SalesReport, label: string): string {
  return [
    `Sales ${label} (${r.from} to ${r.to})`,
    section('Summary', ['Measure', 'Value'], [
      ['Enquiries received', r.enquiries],
      ['Turned into bookings', r.booked],
      ['Conversion %', r.conversion_pct],
      ['New projects', r.bookings],
      ['Booking value (₹)', r.booking_value],
      ['Leads lost', r.lost],
    ]),
    section('Top lead sources', ['Source', 'Enquiries', 'Booked'], r.sources.map((s) => [sourceLabel(s.source), s.enquiries, s.booked])),
    section('Why leads were lost', ['Reason', 'Leads'], r.lost_reasons.map((l) => [l.reason, l.count])),
  ].join('\n\n')
}

export function moneyCsv(r: MoneyReport, label: string): string {
  return [
    `Money ${label} (${r.from} to ${r.to})`,
    section('Summary', ['Measure', 'Amount (₹)'], [
      ['Billed', r.billed],
      ['Invoices issued', r.invoices],
      ['Received', r.received],
      ['Still to collect (today)', r.to_collect],
      ['Overdue (today)', r.overdue],
      ['Expenses', r.expenses],
    ]),
    section('Who owes you', ['Client', 'Still to collect (₹)', 'Overdue (₹)', 'Days overdue'],
      r.owes.map((o) => [o.client_name, o.outstanding, o.overdue, o.overdue_days])),
  ].join('\n\n')
}

export function deliveryCsv(r: DeliveryReport, label: string): string {
  return [
    `Delivery ${label} (${r.from} to ${r.to})`,
    section('Summary', ['Measure', 'Value'], [
      ['Delivered', r.delivered],
      ['Delivered on time', r.on_time],
      ['Had a due date', r.with_due_date],
      ['On time %', r.on_time_pct],
      ['Average days from shoot to delivery', r.avg_days_to_deliver],
      ['Late right now', r.late_now],
    ]),
    section('Late right now', ['Deliverable', 'Project', 'Client', 'Due date', 'Days late', 'With'],
      r.late.map((l) => [l.title, l.project_name, l.client_name, l.due_date, l.days_late, l.assignee_name])),
  ].join('\n\n')
}

export function teamCsv(r: TeamReport, label: string): string {
  return [
    `Team ${label} (${r.from} to ${r.to})`,
    toCsv(['Name', 'Shoots done', 'Work delivered', 'Late now', 'Days present', 'Leave days'],
      r.members.map((m) => [m.name, m.shoots, m.delivered, m.late_now, m.days_present, m.leave_days])),
  ].join('\n\n')
}
