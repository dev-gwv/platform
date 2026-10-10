import { Hono } from 'hono'
import {
  bulkLeadPatch,
  bulkPatchResponse,
  bulkUndoRequest,
  bulkUndoResponse,
  eraseLeadsRequest,
  eraseLeadsResponse,
  duplicateGroup,
  mergeLeadsRequest,
  mergeLeadsResponse,
  resolveDuplicateRequest,
  resolveDuplicateResponse,
  unmergeLeadsRequest,
  unmergeLeadsResponse,
} from '@ipc/contracts'
import type { AppEnv } from '../../context'
import { fail } from '../../middleware/errors'
import { withUser } from '../../lib/db'
import { attempt } from '../../lib/attempt'
import { audit } from '../../lib/audit'
import { edit, remove } from './shared'

export const crmBulkRoutes = new Hono<AppEnv>()
  // ── Bulk edits, with undo ───────────────────────────────────
  .post('/leads/bulk', edit, async (c) => {
    const parsed = bulkLeadPatch.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Invalid bulk patch.')
    const { ids, patch } = parsed.data
    if (patch.status === 'lost' && !patch.lost_reason) fail(422, 'Moving to Lost needs a reason.')
    const previous = await attempt(
      c,
      'crm.bulk',
      () =>
        withUser(
          c.env,
          c.get('auth').userId,
          (sql) => sql`select * from crm_bulk_patch(${sql.array(ids)}::uuid[], ${sql.json(patch)})`,
        ),
      { onCode: (code) => (code === '22023' ? ('rule' as const) : undefined) },
    )
    if (previous === 'rule') fail(422, 'Moving to Lost needs a reason.')
    if (!previous) fail(400, 'Bulk update failed.')
    await audit(c, { action: 'lead.bulk_update', entityType: 'crm_lead', after: { ids: ids.length, patch } })
    return c.json(bulkPatchResponse.parse({ updated: previous.length, previous }))
  })

  .post('/leads/bulk/undo', edit, async (c) => {
    const parsed = bulkUndoRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Nothing to undo.')
    const rows = await attempt(c, 'crm.bulk_undo', () =>
      withUser(
        c.env,
        c.get('auth').userId,
        (sql) => sql<{ n: number }[]>`select crm_restore_leads(${sql.json(parsed.data.previous)}) as n`,
      ),
    )
    if (!rows) fail(400, 'We could not undo that change.')
    await audit(c, { action: 'lead.bulk_undo', entityType: 'crm_lead', after: { restored: rows[0]?.n ?? 0 } })
    return c.json(bulkUndoResponse.parse({ restored: rows[0]?.n ?? 0 }))
  })

  // Permanent erasure of archived leads and every copy of the person's details
  // (0213). Not undoable, so the audit entry records how many, never who.
  .post('/leads/erase', remove, async (c) => {
    const parsed = eraseLeadsRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Pick the leads to delete.')
    const ids = parsed.data.ids
    const rows = await attempt(c, 'crm.erase', () =>
      withUser(
        c.env,
        c.get('auth').userId,
        (sql) => sql<{ n: number }[]>`select crm_erase_leads(${sql.array(ids)}::uuid[]) as n`,
      ),
    )
    if (!rows) fail(400, 'We could not delete these leads.')
    const erased = rows[0]?.n ?? 0
    if (erased === 0) fail(409, 'Only archived leads can be deleted permanently. Archive them first.')
    await audit(c, { action: 'lead.erase', entityType: 'crm_lead', after: { requested: ids.length, erased } })
    return c.json(eraseLeadsResponse.parse({ erased }))
  })

  // ── Duplicates ──────────────────────────────────────────────
  .get('/duplicates', async (c) => {
    const rows = await attempt(c, 'crm.duplicates', () =>
      withUser(c.env, c.get('auth').userId, (sql) => sql`select * from crm_duplicate_groups()`),
    )
    if (!rows) fail(400, 'We could not load duplicates.')
    return c.json(duplicateGroup.array().parse(rows))
  })

  .post('/leads/merge', edit, async (c) => {
    const parsed = mergeLeadsRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Pick a survivor and at least one duplicate.')
    const { survivor_id, duplicate_ids } = parsed.data
    const rows = await attempt(c, 'crm.merge', () =>
      withUser(
        c.env,
        c.get('auth').userId,
        (sql) => sql<{ merged: number }[]>`
          select merge_leads(${survivor_id}, ${sql.array(duplicate_ids)}::uuid[]) as merged`,
      ),
    )
    if (!rows) fail(400, 'Merge failed.')
    await audit(c, { action: 'lead.merge', entityType: 'crm_lead', entityId: survivor_id, after: { duplicate_ids } })
    return c.json(mergeLeadsResponse.parse({ merged: rows[0]?.merged ?? 0 }))
  })

  .post('/leads/unmerge', edit, async (c) => {
    const parsed = unmergeLeadsRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Pick the lead to unmerge.')
    const rows = await attempt(c, 'crm.unmerge', () =>
      withUser(
        c.env,
        c.get('auth').userId,
        (sql) => sql<{ restored: number }[]>`select unmerge_leads(${parsed.data.survivor_id}) as restored`,
      ),
    )
    if (!rows) fail(400, 'Unmerge failed.')
    await audit(c, { action: 'lead.unmerge', entityType: 'crm_lead', entityId: parsed.data.survivor_id })
    return c.json(unmergeLeadsResponse.parse({ restored: rows[0]?.restored ?? 0 }))
  })

  // Lovable parity: keep_separate / archive without merging notes.
  .post('/duplicates/resolve', edit, async (c) => {
    const parsed = resolveDuplicateRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Pick a lead and at least one duplicate.')
    const { survivor_id, duplicate_ids, action } = parsed.data
    const rows = await attempt(c, 'crm.duplicates_resolve', () =>
      withUser(
        c.env,
        c.get('auth').userId,
        (sql) => sql<{ resolved: number }[]>`
          select resolve_crm_duplicates(${survivor_id}, ${sql.array(duplicate_ids)}::uuid[], ${action}) as resolved`,
      ),
    )
    if (!rows) fail(400, 'We could not resolve those duplicates.')
    await audit(c, { action: 'lead.duplicates_resolve', entityType: 'crm_lead', entityId: survivor_id, after: { duplicate_ids, action } })
    return c.json(resolveDuplicateResponse.parse({ resolved: rows[0]?.resolved ?? 0 }))
  })
