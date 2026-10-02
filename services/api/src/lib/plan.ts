import type { PlanInstalment } from '@ipc/contracts'

/** The terms' payment rows, read defensively: they were typed in by people, over several versions. */
export function planInstalmentsFrom(raw: unknown): PlanInstalment[] {
  if (!Array.isArray(raw)) return []
  const out: PlanInstalment[] = []
  for (const r of raw as Record<string, unknown>[]) {
    const value = Number(r?.value)
    if (!Number.isFinite(value) || value <= 0) continue
    out.push({
      label: typeof r.label === 'string' && r.label.trim() ? r.label.trim() : `Instalment ${out.length + 1}`,
      mode: r.mode === 'amount' ? 'amount' : 'percent',
      value,
      due_trigger: typeof r.due_trigger === 'string' && r.due_trigger.trim() ? r.due_trigger.trim() : null,
    })
  }
  return out
}

