import { useState } from 'react'
import type { ClientOccasion } from '@ipc/contracts'
import { Button } from '@/shared/ui/button'
import { Input, Label } from '@/shared/ui/input'
import { Select } from '@/shared/ui/select'

export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const

export interface OccasionDraft {
  kind: 'birthday' | 'anniversary'
  person_name: string
  month: number
  day: number
  year: number | null
}

/** "14 Mar", "14 Mar 1995". */
export function dayMonth(o: Pick<OccasionDraft, 'month' | 'day' | 'year'>, withYear = false): string {
  return `${o.day} ${MONTHS[o.month - 1]}${withYear && o.year ? ` ${o.year}` : ''}`
}

/**
 * One date: whose (a birthday), the day and month, the year if they know it.
 * Used on the project's Wishes tab and in Add / Edit client.
 */
export function OccasionForm({
  initial,
  kind,
  busy,
  onSave,
  onCancel,
}: {
  initial?: Partial<ClientOccasion>
  kind: OccasionDraft['kind']
  busy?: boolean
  onSave: (d: OccasionDraft) => void
  onCancel: () => void
}) {
  const [person, setPerson] = useState(initial?.person_name ?? '')
  const [day, setDay] = useState(initial?.day ? String(initial.day) : '')
  const [month, setMonth] = useState(initial?.month ? String(initial.month) : '')
  const [year, setYear] = useState(initial?.year ? String(initial.year) : '')
  const ready = Number(day) >= 1 && Number(day) <= 31 && Number(month) >= 1 && (kind === 'anniversary' || person.trim().length > 0)
  return (
    // A div, not a form: it also sits inside the Add / Edit client form.
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-muted/30 p-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {kind === 'birthday' && (
          <div className="col-span-2 flex flex-col gap-1 sm:col-span-1">
            <Label htmlFor="occ-person">Whose</Label>
            <Input id="occ-person" value={person} onChange={(e) => setPerson(e.target.value)} placeholder="e.g. Priya" autoFocus />
          </div>
        )}
        <div className="flex flex-col gap-1">
          <Label htmlFor="occ-day">Day</Label>
          <Input id="occ-day" inputMode="numeric" value={day} onChange={(e) => setDay(e.target.value.replace(/\D/g, '').slice(0, 2))} placeholder="14" />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="occ-month">Month</Label>
          <Select id="occ-month" value={month} onChange={(e) => setMonth(e.target.value)}>
            <option value="">Month</option>
            {MONTHS.map((m, i) => (
              <option key={m} value={String(i + 1)}>
                {m}
              </option>
            ))}
          </Select>
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="occ-year">Year (if known)</Label>
          <Input id="occ-year" inputMode="numeric" value={year} onChange={(e) => setYear(e.target.value.replace(/\D/g, '').slice(0, 4))} placeholder="1995" />
        </div>
      </div>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          type="button"
          size="sm"
          disabled={!ready || busy}
          onClick={() =>
            onSave({
              kind,
              person_name: kind === 'birthday' ? person.trim() : '',
              day: Number(day),
              month: Number(month),
              year: year.trim() ? Number(year) : null,
            })
          }
        >
          Save
        </Button>
      </div>
    </div>
  )
}
