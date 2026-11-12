import { useState } from 'react'
import { Input } from '@/shared/ui/input'
import { Select } from '@/shared/ui/select'
import { useTask, useTaskSearch } from './api'

/**
 * Pick a task: the newest twenty, narrowed by a search on the title (the
 * server's, never the studio's whole task list). A task already linked stays
 * in the list even when the search would not find it.
 */
export function TaskPicker({
  value,
  onChange,
  ariaLabel = 'Linked task',
}: {
  value: string
  onChange: (id: string | null) => void
  ariaLabel?: string
}) {
  const [q, setQ] = useState('')
  const found = useTaskSearch(q)
  const linked = useTask(value || null)
  const rows = found.data ?? []
  const options = linked.data && !rows.some((t) => t.id === linked.data.id) ? [linked.data, ...rows] : rows

  return (
    <div className="flex flex-col gap-2">
      <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search tasks" aria-label="Search tasks" />
      <Select value={value} onChange={(e) => onChange(e.target.value || null)} aria-label={ariaLabel}>
        <option value="">{found.data && !options.length ? 'No task by that name' : 'Select…'}</option>
        {options.map((t) => (
          <option key={t.id} value={t.id}>
            {t.project_name ? `${t.title} · ${t.project_name}` : t.title}
          </option>
        ))}
      </Select>
    </div>
  )
}
