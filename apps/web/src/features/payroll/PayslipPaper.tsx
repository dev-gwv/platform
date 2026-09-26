import type { ReactNode } from 'react'
import { amountInWords, monthLabel, proRataNote, shortDay } from '@ipc/domain'
import type { Payslip } from '@ipc/contracts'
import { formatINR } from '@/shared/ui/format'

/**
 * A member's payslip for one month, drawn like the receipt: letterhead, the
 * facts, earnings beside deductions, and net pay in words. It is paper, so it
 * keeps light colours in dark mode; `.paper` gives it the whole sheet when
 * printed.
 */
export function PayslipPaper({ slip }: { slip: Payslip }) {
  const month = monthLabel(slip.pay_year, slip.pay_month)
  const contact = [slip.company_phone, slip.company_email].filter(Boolean).join('  ·  ')
  // Joined or left during the month: paid for the working days in between.
  const partial = proRataNote(slip)
  const period = `${shortDay(slip.period_start)} – ${shortDay(slip.period_end)} ${slip.pay_year}`
  const earnings: [string, number, string | null][] = [
    partial
      ? [
          `Salary for ${slip.payable_days} of ${slip.working_days} working days`,
          slip.prorated_base,
          `Monthly salary ${formatINR(slip.base_amount)} × ${slip.payable_days} ÷ ${slip.working_days}`,
        ]
      : ['Monthly salary', slip.base_amount, null],
    ...(slip.additions > 0 ? [['Additions', slip.additions, slip.additions_note] as [string, number, string | null]] : []),
  ]
  const deductions: [string, number, string | null][] = [
    ...(slip.deduction > 0
      ? [['Unpaid leave and absent days', slip.deduction, `${fmtDays(slip.unpaid_leave_days + slip.absent_days)} of ${slip.working_days} working days`] as [string, number, string | null]]
      : []),
    ...(slip.other_deductions > 0 ? [['Other deductions', slip.other_deductions, slip.other_deductions_note] as [string, number, string | null]] : []),
  ]
  const gross = slip.prorated_base + slip.additions
  const totalDeductions = slip.deduction + slip.other_deductions
  const paid = !!slip.paid_at

  return (
    <article className="paper relative overflow-hidden rounded-2xl border border-slate-200 bg-white text-slate-900 shadow-sm">
      {paid && (
        <div className="absolute right-[-44px] top-5 rotate-45 bg-emerald-600 px-12 py-1 text-xs font-bold uppercase tracking-[0.2em] text-white shadow-md">
          Paid
        </div>
      )}

      <header className="flex items-start gap-4 border-b border-slate-200 px-5 pb-6 pt-7 sm:px-8">
        {slip.logo_url && (
          <img src={slip.logo_url} alt={slip.company_name} className="size-14 shrink-0 rounded-lg border border-slate-200 bg-white object-contain" />
        )}
        <div className="min-w-0 pr-10">
          <h2 className="text-xl font-semibold leading-tight">{slip.company_name}</h2>
          {slip.company_legal_name && slip.company_legal_name !== slip.company_name && (
            <p className="mt-0.5 text-xs text-slate-500">{slip.company_legal_name}</p>
          )}
          {slip.company_address && <p className="mt-1 max-w-[44ch] whitespace-pre-line text-xs text-slate-600">{slip.company_address}</p>}
          {contact && <p className="mt-1 text-xs text-slate-600">{contact}</p>}
        </div>
      </header>

      <section className="px-5 pt-6 sm:px-8">
        <h1 className="text-2xl font-bold uppercase tracking-tight">Payslip</h1>
        <p className="mt-1 text-xs text-slate-500">Salary for {month}.</p>
        {partial && <p className="mt-1 text-xs font-medium text-slate-700">{partial}</p>}
        <dl className="mt-5 grid grid-cols-2 gap-x-8 gap-y-3 text-sm sm:grid-cols-4">
          <Meta label="Name" value={slip.name} />
          {slip.job_title && <Meta label="Role" value={slip.job_title} />}
          <Meta label="Month" value={month} />
          <Meta label="Period" value={period} />
          <Meta label="Working days" value={String(slip.working_days)} />
          {partial && <Meta label="Days paid for" value={String(slip.payable_days)} />}
          <Meta label="Days present" value={String(slip.days_present)} />
          {slip.unpaid_leave_days > 0 && <Meta label="Unpaid leave" value={fmtDays(slip.unpaid_leave_days)} />}
          {slip.absent_days > 0 && <Meta label="Absent" value={String(slip.absent_days)} />}
          {slip.late_marks > 0 && <Meta label="Late marks" value={String(slip.late_marks)} />}
          {paid && <Meta label="Paid on" value={new Date(slip.paid_at!).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' })} />}
          {slip.payment_mode && <Meta label="Paid by" value={slip.payment_mode} />}
          {slip.payment_reference && <Meta label="Reference" value={slip.payment_reference} />}
        </dl>
      </section>

      <section className="mt-6 grid gap-4 px-5 sm:grid-cols-2 sm:gap-6 sm:px-8">
        <Table title="Earnings" rows={earnings} total={gross} totalLabel="Total earnings" />
        <Table title="Deductions" rows={deductions} total={totalDeductions} totalLabel="Total deductions" empty="No deductions" />
      </section>

      <section className="mt-6 px-5 sm:px-8">
        <div className="paper-block rounded-xl border border-emerald-200 bg-emerald-50 px-5 py-5 sm:px-6">
          <p className="text-xs font-semibold uppercase tracking-wider text-emerald-700">Net pay</p>
          <p className="mt-1 text-3xl font-bold tabular-nums text-emerald-700 sm:text-4xl">{formatINR(slip.net_pay)}</p>
          <p className="mt-2 text-xs text-slate-700">
            <span className="text-slate-500">In words:</span>{' '}
            <span className="font-medium text-slate-800">{amountInWords(slip.net_pay)} only</span>
          </p>
        </div>
      </section>

      <footer className="mt-8 px-5 pb-8 sm:px-8">
        <div className="flex flex-wrap items-end justify-between gap-6 border-t border-slate-200 pt-6">
          <p className="max-w-md text-xs text-slate-500">This is a computer-generated payslip and does not require a signature.</p>
          <div className="min-w-[180px] border-t border-slate-300 pt-2 text-right">
            <p className="text-xs text-slate-500">Authorised Signatory</p>
            <p className="mt-0.5 text-xs font-medium text-slate-700">{slip.company_name}</p>
          </div>
        </div>
      </footer>
    </article>
  )
}

const fmtDays = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1))

function Table({
  title,
  rows,
  total,
  totalLabel,
  empty,
}: {
  title: string
  rows: [string, number, string | null][]
  total: number
  totalLabel: string
  empty?: string
}) {
  return (
    <div className="paper-block overflow-hidden rounded-xl border border-slate-200">
      <h3 className="bg-slate-50 px-4 py-2 text-[11px] font-semibold uppercase tracking-wider text-slate-600">{title}</h3>
      <table className="w-full text-sm">
        <tbody>
          {rows.length === 0 && (
            <tr className="border-t border-slate-200">
              <td className="px-4 py-2.5 text-slate-500">{empty}</td>
            </tr>
          )}
          {rows.map(([label, amount, note]) => (
            <tr key={label} className="border-t border-slate-200">
              <td className="px-4 py-2.5 align-top">
                <p>{label}</p>
                {note && <p className="text-xs text-slate-500">{note}</p>}
              </td>
              <td className="px-4 py-2.5 text-right align-top tabular-nums">{formatINR(amount)}</td>
            </tr>
          ))}
          <tr className="border-t border-slate-200 bg-slate-50">
            <td className="px-4 py-2 text-xs font-semibold uppercase tracking-wider text-slate-600">{totalLabel}</td>
            <td className="px-4 py-2 text-right font-semibold tabular-nums">{formatINR(total)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  )
}

function Meta({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">{label}</dt>
      <dd className="mt-0.5 break-words text-sm font-medium text-slate-900">{value}</dd>
    </div>
  )
}
