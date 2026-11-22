import { describe, expect, it } from 'vitest'
import type { DueLineRow } from '@ipc/contracts'
import { DUE_LINES_PAGE, dueLinesFor } from './routes-due'

/**
 * /billing/due sends only the lines a screen opens (speed check, 22 Nov:
 * Home downloaded 925 KB of lines to draw three tiles).
 */
const line = (bucket: DueLineRow['bucket'], i: number): DueLineRow => ({
  project_id: null,
  project_name: `Project ${i}`,
  client_name: null,
  kind: 'invoice',
  label: `INV-${i}`,
  amount: 1000,
  due_on: `2026-11-${String(1 + (i % 28)).padStart(2, '0')}`,
  bucket,
})
const lines = [
  ...Array.from({ length: 70 }, (_, i) => line('overdue', i)),
  ...Array.from({ length: 3 }, (_, i) => line('soon', 100 + i)),
  line('later', 200),
]

describe('dueLinesFor', () => {
  it('sends every line when asked for all, as before', () => {
    expect(dueLinesFor(lines, 'all', DUE_LINES_PAGE)).toEqual({ lines })
  })

  it('sends none for the tiles alone', () => {
    expect(dueLinesFor(lines, 'none', DUE_LINES_PAGE)).toEqual({ lines: [], lines_total: 0 })
  })

  it('sends one bucket, its first page in order, and how many it has', () => {
    const r = dueLinesFor(lines, 'overdue', DUE_LINES_PAGE)
    expect(r.lines_total).toBe(70)
    expect(r.lines).toHaveLength(DUE_LINES_PAGE)
    expect(r.lines).toEqual(lines.slice(0, DUE_LINES_PAGE))
    expect(dueLinesFor(lines, 'overdue', 100).lines).toHaveLength(70)
    expect(dueLinesFor(lines, 'soon', DUE_LINES_PAGE)).toEqual({ lines: lines.slice(70, 73), lines_total: 3 })
  })
})
