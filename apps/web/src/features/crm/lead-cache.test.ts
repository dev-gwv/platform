import { describe, expect, it } from 'vitest'
import { QueryClient } from '@tanstack/react-query'
import type { CrmLead, CrmTag } from '@ipc/contracts'
import {
  applyLeadPatch,
  bulkRowPatch,
  changesMembership,
  listsNeedRefresh,
  patchLead,
  patchLeadRows,
  rollbackLeadPatch,
  refreshCrm,
  rowPatchFrom,
  settleLeads,
  tagsFor,
} from './lead-cache'

const A = '00000000-0000-4000-8000-00000000000a'
const B = '00000000-0000-4000-8000-00000000000b'
const S1 = '00000000-0000-4000-8000-000000000001'
const S2 = '00000000-0000-4000-8000-000000000002'

function lead(id: string, over: Partial<CrmLead> = {}): CrmLead {
  return { id, name: id === A ? 'Asha' : 'Bina', status: 'new', stage_id: S1, is_archived: false, is_hot: false, quality: null, tags: [], ...over } as CrmLead
}

describe('rowPatchFrom', () => {
  it('copies the fields a card shows and leaves the rest to the server', () => {
    expect(rowPatchFrom({ quality: 'hot', functions: [] })).toEqual({ quality: 'hot', is_hot: true })
    expect(rowPatchFrom({ quality: 'cold' })).toEqual({ quality: 'cold', is_hot: false })
    expect(rowPatchFrom({ assigned_to: null })).toEqual({ assigned_to: null, assignee_name: null })
    expect(rowPatchFrom({ follow_up_at: '2026-11-22T05:30:00.000Z' })).toEqual({ follow_up_at: '2026-11-22T05:30:00.000Z' })
  })

  it('takes a stage from the bulk bar too', () => {
    expect(bulkRowPatch({ stage_id: S2, note: 'x' })).toEqual({ stage_id: S2 })
  })
})

describe('patchLeadRows', () => {
  it('changes only the named leads and keeps the same array when none is there', () => {
    const rows = [lead(A), lead(B)]
    const next = patchLeadRows(rows, new Set([A]), { stage_id: S2 })!
    expect(next[0]!.stage_id).toBe(S2)
    expect(next[1]).toBe(rows[1])
    expect(patchLeadRows(rows, new Set(['other']), { stage_id: S2 })).toBe(rows)
    expect(patchLeadRows(undefined, new Set([A]), {})).toBeUndefined()
    expect(patchLead(undefined, { stage_id: S2 })).toBeUndefined()
    expect(patchLead(lead(A), { stage_id: S2 })!.stage_id).toBe(S2)
  })
})

describe('tagsFor', () => {
  const all = [
    { id: 'x', name: 'Destination', color: 'teal', is_active: true, lead_count: 3 },
    { id: 'y', name: 'NRI', color: 'violet', is_active: true, lead_count: 1 },
  ] as CrmTag[]
  it('turns ids into label chips in the order picked, dropping unknown ones', () => {
    expect(tagsFor(['y', 'gone', 'x'], all)).toEqual([
      { id: 'y', name: 'NRI', color: 'violet' },
      { id: 'x', name: 'Destination', color: 'teal' },
    ])
    expect(tagsFor(['x'], undefined)).toBeUndefined()
  })
})

describe('which changes move a lead between lists', () => {
  it('a stage move inside open, or a label, does not', () => {
    expect(changesMembership({ stage_id: S2 }, lead(A))).toBe(false)
    expect(changesMembership({ status: 'contacted' }, lead(A))).toBe(false)
  })
  it('booking, losing and archiving do', () => {
    expect(changesMembership({ status: 'converted' }, lead(A))).toBe(true)
    expect(changesMembership({ status: 'lost' }, lead(A))).toBe(true)
    expect(changesMembership({ is_archived: true }, lead(A))).toBe(true)
    expect(changesMembership({ status: 'new' }, lead(A, { status: 'lost' }))).toBe(true)
  })
  it('a PATCH whose card text the browser cannot write itself asks for the lists again', () => {
    expect(listsNeedRefresh({ quality: 'hot' }, lead(A))).toBe(false)
    expect(listsNeedRefresh({ follow_up_at: null, contacted_status: 'contacted' }, lead(A))).toBe(false)
    expect(listsNeedRefresh({ assigned_to: B }, lead(A))).toBe(true)
    expect(listsNeedRefresh({ notes: 'called' }, lead(A))).toBe(true)
    expect(listsNeedRefresh({ is_archived: true, archive_reason: 'spam' }, lead(A))).toBe(true)
  })
})

describe('applyLeadPatch / rollbackLeadPatch', () => {
  it('moves the card in every cached list and the drawer, and puts it back on error', async () => {
    const qc = new QueryClient()
    const open = [lead(A), lead(B)]
    qc.setQueryData(['crm', 'leads', 'card', 'open', 'active', 0], open)
    qc.setQueryData(['crm', 'lead-search', 'ash'], [lead(A)])
    qc.setQueryData(['crm', 'leads', 'one', A], lead(A))
    qc.setQueryData(['crm', 'leads', 'summary', 'default'], { total: 2 })

    const snap = await applyLeadPatch(qc, [A], { stage_id: S2, stage_name: 'Quoted' })
    expect(snap.before?.id).toBe(A)
    expect(qc.getQueryData<CrmLead[]>(['crm', 'leads', 'card', 'open', 'active', 0])![0]!.stage_id).toBe(S2)
    expect(qc.getQueryData<CrmLead[]>(['crm', 'lead-search', 'ash'])![0]!.stage_name).toBe('Quoted')
    expect(qc.getQueryData<CrmLead>(['crm', 'leads', 'one', A])!.stage_id).toBe(S2)
    // The summary is not a list of leads and is left alone.
    expect(qc.getQueryData(['crm', 'leads', 'summary', 'default'])).toEqual({ total: 2 })

    rollbackLeadPatch(qc, snap)
    expect(qc.getQueryData(['crm', 'leads', 'card', 'open', 'active', 0])).toEqual(open)
    expect(qc.getQueryData<CrmLead>(['crm', 'leads', 'one', A])!.stage_id).toBe(S1)
  })
})

describe('a refresh asks for the list from its first page', () => {
  const pagesKey = ['crm', 'leads', 'card', 'pages', 'view=today']
  const threePages = () => ({
    pages: [{ items: [lead(A)], next_cursor: 'c1' }, { items: [lead(B)], next_cursor: 'c2' }, { items: [], next_cursor: null }],
    pageParams: [null, 'c1', 'c2'],
  })
  type Pages = ReturnType<typeof threePages>

  it('a patch still lands on every loaded page; settling a list change cuts it to the first', async () => {
    const qc = new QueryClient()
    qc.setQueryData(pagesKey, threePages())
    await applyLeadPatch(qc, [B], { stage_id: S2 })
    expect(qc.getQueryData<Pages>(pagesKey)!.pages[1]!.items[0]!.stage_id).toBe(S2)

    // A change that cannot move a lead between lists leaves the pages alone.
    settleLeads(qc, [B], { lists: false })
    expect(qc.getQueryData<Pages>(pagesKey)!.pages).toHaveLength(3)

    settleLeads(qc, [B], { lists: true })
    const trimmed = qc.getQueryData<Pages>(pagesKey)!
    expect(trimmed.pages).toHaveLength(1)
    expect(trimmed.pageParams).toEqual([null])
  })

  it('refreshCrm cuts the list to its first page and leaves the board whole', () => {
    const qc = new QueryClient()
    qc.setQueryData(pagesKey, threePages())
    const cols = { columns: [{ stage_id: S1, total: 40, items: [lead(A), lead(B)], next_cursor: null }] }
    qc.setQueryData(['crm', 'leads', 'card', 'columns', 'p', ''], cols)
    void refreshCrm(qc)
    expect(qc.getQueryData<Pages>(pagesKey)!.pages).toHaveLength(1)
    expect(qc.getQueryData(['crm', 'leads', 'card', 'columns', 'p', ''])).toEqual(cols)
  })
})
