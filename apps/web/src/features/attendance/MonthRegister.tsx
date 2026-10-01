import { useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight, Download } from 'lucide-react'
import { dayCode, registerTotals, type DayCode } from '@ipc/domain'
import type { MonthRegister as Register } from '@ipc/contracts'
import { Button } from '@/shared/ui/button'
import { Card, CardContent } from '@/shared/ui/card'
import { cn } from '@/shared/ui/cn'
import { downloadCsv, toCsv } from '@/shared/ui/csv'
import { EmptyState, ErrorState } from '@/shared/ui/states'
import { SkeletonList } from '@/shared/ui/skeleton'
import { useMonthRegister } from './api'

const CODE_TONE: Record<DayCode, string> = {
  P: 'bg-success/15 text-success',
  L: 'bg-warning/15 text-warning',
  H: 'bg-tone-amber/15 text-tone-amber',
  A: 'bg-destructive/15 text-destructive',
  S: 'bg-tone-violet/15 text-tone-violet',
  Lv: 'bg-tone-blue/15 text-tone-blue',
  '½Lv': 'bg-tone-blue/10 text-tone-blue',
  Off: 'bg-muted text-muted-foreground',
  Hol: 'bg-tone-teal/15 text-tone-teal',
  '': '',
}

const shiftMonth = (month: string, by: number) => {
  const [y, m] = month.split('-').map(Number) as [number, number]
  const d = new Date(y, m - 1 + by, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}
const thisMonth = () => shiftMonth(new Date().toISOString().slice(0, 7), 0)
const monthTitle = (month: string) =>
  new Date(`${month}-01T12:00:00`).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })
const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1))

/**
 * The month as a muster roll: people down the side, days across, one letter
 * a day, and a sentence of totals worked out exactly as payroll does. The
 * CSV is the same table, for the accountant.
 */
export function MonthRegister({ mine = false }: { mine?: boolean }) {
  const [month, setMonth] = useState(thisMonth)
  const reg = useMonthRegister(month, mine)
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" size="sm" onClick={() => setMonth((m) => shiftMonth(m, -1))} aria-label="Previous month">
          <ChevronLeft />
        </Button>
        <p className="min-w-36 text-center text-sm font-semibold">{monthTitle(month)}</p>
        <Button variant="outline" size="sm" onClick={() => setMonth((m) => shiftMonth(m, 1))} aria-label="Next month">
          <ChevronRight />
        </Button>
        {reg.data && reg.data.people.length > 0 && !mine && (
          <Button variant="outline" size="sm" className="ml-auto" onClick={() => exportCsv(reg.data!)}>
            <Download /> Download muster (CSV)
          </Button>
        )}
      </div>
      {reg.isLoading ? (
        <SkeletonList rows={5} columns={6} />
      ) : reg.isError || !reg.data ? (
        <ErrorState onRetry={() => void reg.refetch()} />
      ) : reg.data.people.length === 0 ? (
        <EmptyState title="Nobody to show" description="Nobody on the team is tracked this month." />
      ) : (
        <RegisterTable reg={reg.data} />
      )}
      <p className="text-xs text-muted-foreground">
        P present · L late · H half day · A absent · S shoot · Lv leave · Off weekly off · Hol holiday
      </p>
    </div>
  )
}

function RegisterTable({ reg }: { reg: Register }) {
  const ctx = { today: reg.today, trackedFrom: reg.tracked_from, lateMarksPerHalfDay: reg.late_marks_per_half_day }
  const days = reg.people[0]?.cells.map((c) => c.day) ?? []
  const rows = useMemo(
    () =>
      reg.people.map((p) => ({
        ...p,
        codes: p.cells.map((c) => dayCode(c, ctx)),
        totals: registerTotals(p.cells, ctx),
      })),
    // ctx is derived from reg.
    [reg],
  )
  return (
    <Card>
      <CardContent className="overflow-x-auto p-0">
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr className="border-b border-border">
              <th className="sticky left-0 z-10 bg-card px-3 py-2 text-left font-medium">Person</th>
              {days.map((d) => (
                <th key={d} className="min-w-7 px-0.5 py-2 text-center font-medium text-muted-foreground">
                  {Number(d.slice(8))}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => (
              <tr key={p.user_id} className="border-b border-border align-top last:border-0">
                <td className="sticky left-0 z-10 min-w-48 bg-card px-3 py-2">
                  <p className="text-sm font-medium">{p.name}</p>
                  <p className="text-[11px] text-muted-foreground">
                    Present {p.totals.present} · Late {p.totals.late} · Half {p.totals.half} · Absent {p.totals.absent} · Leave{' '}
                    {fmt(p.totals.leave)} ·{' '}
                    <span className="font-medium text-foreground">
                      Payable {fmt(p.totals.payable)} of {p.totals.workingDays}
                    </span>
                  </p>
                </td>
                {p.codes.map((c, i) => (
                  <td key={days[i]} className="px-0.5 py-2 text-center">
                    {c && <span className={cn('inline-block min-w-6 rounded px-0.5 py-0.5 font-semibold', CODE_TONE[c])}>{c}</span>}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent>
    </Card>
  )
}

function exportCsv(reg: Register) {
  const ctx = { today: reg.today, trackedFrom: reg.tracked_from, lateMarksPerHalfDay: reg.late_marks_per_half_day }
  const days = reg.people[0]?.cells.map((c) => c.day) ?? []
  const header = ['Name', ...days.map((d) => String(Number(d.slice(8)))), 'Present', 'Late', 'Half', 'Absent', 'Leave', 'Working days', 'Payable']
  const body = reg.people.map((p) => {
    const t = registerTotals(p.cells, ctx)
    return [p.name, ...p.cells.map((c) => dayCode(c, ctx)), t.present, t.late, t.half, t.absent, fmt(t.leave), t.workingDays, fmt(t.payable)]
  })
  downloadCsv(`attendance-${reg.month}.csv`, toCsv(header, body))
}
