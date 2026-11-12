import { useState } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { shootListItem } from '@ipc/contracts'
import { callApi } from '@/shared/api/client'
import { useAuth } from '@/shared/auth/AuthProvider'
import { Input } from '@/shared/ui/input'
import { Select } from '@/shared/ui/select'
import { todayInIndia } from '@/shared/ui/days-left'
import { shootsWindowPath, useShoot } from './api'

const list = shootListItem.array()

const addDays = (iso: string, days: number) => {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

/** How far ahead the picker looks: the shoots a reminder is usually about. */
export const PICKER_DAYS = 60

const label = (s: { name: string; project_name: string | null; shoot_date: string | null }) =>
  [s.name, s.project_name, s.shoot_date].filter(Boolean).join(' · ')

/**
 * Pick a shoot: the next 60 days, narrowed by a search on the project, client
 * or shoot name (at most 20 from the server). A shoot already linked stays in
 * the list even when it is outside the window.
 */
export function ShootPicker({
  value,
  onChange,
  ariaLabel = 'Linked shoot',
}: {
  value: string
  onChange: (id: string | null) => void
  ariaLabel?: string
}) {
  const { session } = useAuth()
  const [q, setQ] = useState('')
  const today = todayInIndia()
  const to = addDays(today, PICKER_DAYS)
  const shoots = useQuery({
    queryKey: ['shoots', 'picker', today, to, q.trim()],
    queryFn: () => callApi(shootsWindowPath(today, to, q), { responseSchema: list }),
    enabled: !!session,
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  })
  const linked = useShoot(value)
  const rows = (shoots.data ?? []).filter((s) => s.status !== 'cancelled')
  const options = linked.data && !rows.some((s) => s.id === linked.data.id) ? [linked.data, ...rows] : rows

  return (
    <div className="flex flex-col gap-2">
      <Input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search by project or client"
        aria-label="Search shoots"
      />
      <Select value={value} onChange={(e) => onChange(e.target.value || null)} aria-label={ariaLabel}>
        <option value="">{shoots.data && !options.length ? 'No shoots in the next 60 days' : 'Select…'}</option>
        {options.map((s) => (
          <option key={s.id} value={s.id}>
            {label(s)}
          </option>
        ))}
      </Select>
    </div>
  )
}
