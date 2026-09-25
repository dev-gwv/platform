import { describe, expect, it } from 'vitest'
import type { DataRecord, TeamSlot } from '@ipc/contracts'
import { dataRecord } from '@ipc/contracts'
import { dataCounts, defaultDataType, defaultLabel, deriveStage, recordForSlot, slotStage, whenLabel } from './stage'

const SHOOT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'

const slot = (over: Partial<TeamSlot> = {}): TeamSlot => ({
  released_at: null,
  shoot_name: null,
  shoot_date: null,
  shoot_status: null,
  location: null,
  map_link: null,
  project_id: null,
  project_name: null,
  client_name: null,
  id: 'bbbbbbbb-bbbb-4bbb-8bbb-000000000001',
  user_id: 'cccccccc-cccc-4ccc-8ccc-000000000001',
  user_name: 'Rahul Verma',
  shoot_id: SHOOT,
  service_name: 'Candid Photographer',
  start_at: '2026-09-25T19:25:00.000Z', // Sat 26 Sep, 12:55 am IST
  end_at: '2026-09-25T23:25:00.000Z',
  status: 'booked',
  estimated_cost: null,
  final_cost: null,
  cost_status: 'tentative',
  cost_notes: null,
  data_required: false,
  data_not_required_reason: null,
  ...over,
})

const record = (over: Partial<DataRecord> = {}): DataRecord =>
  dataRecord.parse({
    id: 'dddddddd-dddd-4ddd-8ddd-000000000001',
    data_label: 'Haldi',
    data_type: 'photos',
    project_id: null,
    project_name: null,
    shoot_id: SHOOT,
    primary_status: 'pending',
    backup_status: 'pending',
    primary_location_id: null,
    primary_location_name: null,
    backup_location_id: null,
    backup_location_name: null,
    card_count: 0,
    size_gb: 0,
    verified_at: null,
    created_at: '2026-09-26T10:00:00.000Z',
    ...over,
  })

describe('deriveStage (mirrors data_record_stage in 0160)', () => {
  const base = { primary_status: 'pending', backup_status: 'pending', date_received: null, issue_found: false, is_not_required: false } as const
  it.each([
    [{}, 'with_shooter'],
    [{ date_received: '2026-09-26' }, 'received'],
    [{ primary_status: 'copied' }, 'copied'],
    [{ primary_status: 'copied', backup_status: 'copied' }, 'backed_up'],
    [{ primary_status: 'copied', backup_status: 'not_required' }, 'backed_up'],
    [{ primary_status: 'verified', backup_status: 'verified' }, 'verified'],
    [{ primary_status: 'verified', backup_status: 'not_required' }, 'verified'],
    [{ primary_status: 'verified', backup_status: 'issue' }, 'issue'],
    [{ issue_found: true, primary_status: 'verified', backup_status: 'verified' }, 'issue'],
    [{ backup_status: 'not_required' }, 'not_required'],
    [{ is_not_required: true, primary_status: 'copied' }, 'not_required'],
  ] as const)('%o → %s', (over, want) => {
    expect(deriveStage({ ...base, ...over })).toBe(want)
  })
})

describe('recordForSlot / slotStage / dataCounts', () => {
  it('prefers the linked record, and finds an older unlinked one by person and role on the same shoot', () => {
    const s = slot()
    const linked = record({ id: 'dddddddd-dddd-4ddd-8ddd-000000000002', slot_id: s.id })
    const byName = record({ team_member_name: 'rahul verma', requirement_name: 'CANDID PHOTOGRAPHER' })
    expect(recordForSlot(s, [byName, linked])?.id).toBe(linked.id)
    expect(recordForSlot(s, [byName])?.id).toBe(byName.id)
    expect(recordForSlot(s, [record({ ...byName, shoot_id: null, team_member_name: 'Rahul Verma' })])).toBeUndefined()
  })

  it('says "missing" without a record, unless the booking opted out with a reason', () => {
    expect(slotStage(slot(), undefined)).toBe('missing')
    // The column defaults to false (0008): false alone is not an opt-out.
    expect(slotStage(slot({ data_required: false, data_not_required_reason: null }), undefined)).toBe('missing')
    expect(slotStage(slot({ data_not_required_reason: 'Assistant, no camera' }), undefined)).toBe('opted_out')
  })

  it('counts bookings whose data is safe, of those that owe it', () => {
    const a = slot()
    const b = slot({ id: 'bbbbbbbb-bbbb-4bbb-8bbb-000000000002', user_name: 'Anita' })
    const c = slot({ id: 'bbbbbbbb-bbbb-4bbb-8bbb-000000000003', data_not_required_reason: 'No camera' })
    const released = slot({ id: 'bbbbbbbb-bbbb-4bbb-8bbb-000000000004', status: 'released' })
    const recs = [
      record({ slot_id: a.id, primary_status: 'copied', backup_status: 'copied', data_status: 'backed_up' }),
      record({ id: 'dddddddd-dddd-4ddd-8ddd-000000000009', slot_id: b.id, primary_status: 'copied', data_status: 'copied' }),
    ]
    expect(dataCounts([a, b, c, released], recs)).toEqual({ needed: 2, done: 1 })
  })
})

describe('labels', () => {
  it('puts the day first', () => {
    expect(whenLabel(slot(), 'Asia/Kolkata')).toBe('Sat, 26 Sept · 12:55 am–04:55 am')
  })

  it('picks a data type from the role, and names the record after shoot, role and person', () => {
    expect(defaultDataType('Drone Operator')).toBe('drone')
    expect(defaultDataType('Cinematographer')).toBe('videos')
    expect(defaultDataType('Traditional Videographer')).toBe('videos')
    expect(defaultDataType('Candid Photographer')).toBe('photos')
    expect(defaultLabel({ name: 'Haldi' }, slot())).toBe('Haldi · Candid Photographer · Rahul Verma')
  })
})
