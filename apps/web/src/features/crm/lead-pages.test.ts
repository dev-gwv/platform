import { describe, expect, it } from 'vitest'
import type { LeadColumns } from '@ipc/contracts'
import { NO_EXTRAS, NO_FACETS } from './board-filters'
import { EMPTY_QUERY } from './leads'
import { appendToColumn, leadColumnsPath, leadFilterParams, leadPagePath, localDayStart, pageRows, showingLine } from './lead-pages'
import { patchColumns, patchLeadData } from './lead-cache'

const now = new Date(2026, 10, 21, 15, 30)
const base = { view: 'all' as const, saved: null, facets: NO_FACETS, extras: NO_EXTRAS, showArchived: false, now }

describe('leadFilterParams', () => {
  it('sends only what narrows, plus the viewer’s midnight', () => {
    const p = leadFilterParams(base)
    expect([...p.keys()]).toEqual(['day_start'])
    expect(p.get('day_start')).toBe(localDayStart(now))
    expect(localDayStart(now)).toMatch(/^2026-11-21T00:00:00[+-]\d{2}:\d{2}$/)
  })

  it('carries the view, facets and extras', () => {
    const p = leadFilterParams({
      ...base,
      view: 'hot',
      facets: { ...NO_FACETS, owner: ['b', 'a'], tag: ['__none'] },
      extras: { ...NO_EXTRAS, due: 'week', budgetMin: 50000, hotOnly: true, addedDays: 7, contacted: 'never' },
      showArchived: true,
    })
    expect(p.get('view')).toBe('hot')
    expect(p.get('f_owner')).toBe('a,b')
    expect(p.get('f_tag')).toBe('__none')
    expect(p.get('due')).toBe('week')
    expect(p.get('budget_min')).toBe('50000')
    expect(p.get('hot')).toBe('1')
    expect(p.get('contacted')).toBe('never')
    expect(p.get('include_archived')).toBe('1')
    expect(new Date(p.get('created_from')!).getDate()).toBe(15)
  })

  it('turns a saved view into its outcome and fields', () => {
    const won = leadFilterParams({ ...base, view: null, saved: { ...EMPTY_QUERY, status: 'converted' } })
    expect(won.get('outcome')).toBe('won')
    const every = leadFilterParams({ ...base, view: null, saved: { ...EMPTY_QUERY } })
    expect(every.get('outcome')).toBe('all')
    const mine = leadFilterParams({
      ...base,
      view: null,
      saved: { ...EMPTY_QUERY, filters: ['overdue', 'hot'], assignee: 'none', status: 'qualified', search: ' priya ' },
    })
    expect(mine.get('outcome')).toBeNull()
    expect(mine.get('quick')).toBe('hot,overdue')
    expect(mine.get('assignee')).toBe('none')
    expect(mine.get('status')).toBe('qualified')
    expect(mine.get('q')).toBe('priya')
  })

  it('builds the page and column addresses', () => {
    const f = leadFilterParams(base).toString()
    expect(leadPagePath(f, { order: 'urgency', cursor: 'abc', limit: 100 })).toMatch(/^\/crm\/leads\/page\?.*order=urgency&cursor=abc&limit=100$/)
    expect(leadPagePath(f, { order: 'newest', stageId: null, pipelineId: 'p' })).toContain('stage_id=none')
    expect(leadColumnsPath(f, 'p1')).toContain('pipeline_id=p1')
  })
})

const card = (id: string, stage: string, value = 0) => ({ id, stage_id: stage, deal_value: value }) as never

describe('the paged board in the cache', () => {
  const cols = (): LeadColumns => ({
    columns: [
      { stage_id: 's1', total: 40, value: 300, items: [card('a', 's1', 100), card('b', 's1', 200)], next_cursor: 'c1' },
      { stage_id: 's2', total: 1, value: 0, items: [card('c', 's2')], next_cursor: null },
    ],
    total: 41,
    value: 300,
  })

  it('moves a dropped card to the top of its new column at once, counts following', () => {
    const next = patchColumns(cols(), new Set(['b']), { stage_id: 's2' })
    expect(next.columns[0]!.items.map((r) => r.id)).toEqual(['a'])
    expect(next.columns[0]!.total).toBe(39)
    expect(next.columns[0]!.value).toBe(100)
    expect(next.columns[1]!.items.map((r) => r.id)).toEqual(['b', 'c'])
    expect(next.columns[1]!.total).toBe(2)
    expect(next.columns[1]!.value).toBe(200)
  })

  it('a change that is not a move stays in place; a lead not on the board leaves it alone', () => {
    const data = cols()
    const next = patchColumns(data, new Set(['a']), { quality: 'hot' })
    expect((next.columns[0]!.items[0] as unknown as { quality: string }).quality).toBe('hot')
    expect(patchColumns(data, new Set(['zz']), { stage_id: 's2' })).toBe(data)
  })

  it('patches the list’s pages too', () => {
    const data = { pages: [{ items: [card('a', 's1')], next_cursor: 'x', total: 2 }, { items: [card('b', 's1')], next_cursor: null, total: null }], pageParams: [null, 'x'] }
    const next = patchLeadData(data, new Set(['b']), { stage_id: 's2' }) as typeof data
    expect(next.pages[0]).toBe(data.pages[0])
    expect((next.pages[1]!.items[0] as unknown as { stage_id: string }).stage_id).toBe('s2')
  })

  it('Show more adds the next page under the cards, each once', () => {
    const next = appendToColumn(cols(), 's1', { items: [card('b', 's1'), card('d', 's1')], next_cursor: null, total: null })
    expect(next.columns[0]!.items.map((r) => r.id)).toEqual(['a', 'b', 'd'])
    expect(next.columns[0]!.next_cursor).toBeNull()
  })

  it('reads the list’s pages in order, each lead once', () => {
    expect(pageRows([{ items: [card('a', 's')], next_cursor: 'x', total: 2 }, { items: [card('a', 's'), card('b', 's')], next_cursor: null, total: null }]).map((r) => r.id)).toEqual(['a', 'b'])
    expect(showingLine(100, 1372)).toBe('Showing 100 of 1,372')
  })
})
