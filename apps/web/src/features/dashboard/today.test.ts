import { describe, expect, it } from 'vitest'
import type { MyDeliverable, MyFollowUp, TaskListItem, TeamSlot } from '@ipc/contracts'
import { myDay, openWorkLine } from './today'

let n = 0
const id = () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`
/** A local clock time on a local day, as the API sends it. */
const at = (day: string, h: number, m = 0) => {
  const [y, mo, d] = day.split('-').map(Number)
  return new Date(y!, mo! - 1, d!, h, m).toISOString()
}

const slot = (over: Partial<TeamSlot>): TeamSlot => ({
  response: 'confirmed',
  decline_reason: null,
  arrived_at: null,
  released_at: null,
  shoot_name: 'Engagement',
  shoot_date: null,
  shoot_status: null,
  location: null,
  map_link: null,
  project_id: null,
  project_name: 'Sharma Wedding',
  client_name: null,
  id: id(),
  user_id: 'me',
  user_name: null,
  shoot_id: id(),
  service_name: 'Candid Photographer',
  start_at: at('2026-10-23', 15),
  end_at: at('2026-10-23', 18),
  status: 'booked',
  estimated_cost: null,
  final_cost: null,
  cost_status: 'tentative',
  cost_notes: null,
  data_required: false,
  data_not_required_reason: null,
  ...over,
})

const task = (title: string, due: string | null, over: Partial<TaskListItem> = {}) =>
  ({ id: id(), title, status: 'to_do', due_date: due, project_id: null, project_name: null, ...over }) as unknown as TaskListItem

const edit = (title: string, over: Partial<MyDeliverable> = {}) =>
  ({
    id: id(), project_id: id(), project_name: 'Sharma Wedding', title, status: 'pending', visibility_scope: 'internal',
    notes_count: 0, voice_count: 0, changes_requested: false, review_note: null, last_version: null,
    estimated_date: null, start_by: null, started_at: null, ...over,
  }) as unknown as MyDeliverable

const call = (lead: string, due: string, over: Partial<MyFollowUp> = {}): MyFollowUp => ({
  id: id(), lead_id: id(), lead_name: lead, lead_phone: null, subject: null, due_at: due, priority: null, ...over,
})

const base = { me: 'me', slots: [], tasks: [], edits: [], calls: [], owedCards: new Set<string>() }
const NOW = new Date(2026, 9, 23, 11, 0)

describe("a team member's day", () => {
  it('puts what is late first, then the day by the clock, then what is due today', () => {
    const shoot = slot({})
    const { today } = myDay({
      ...base,
      now: NOW,
      slots: [shoot],
      tasks: [task('Cull photos', '2026-10-21'), task('Select album', '2026-10-23')],
      calls: [call('Mehta', at('2026-10-23', 16))],
    })
    expect(today.map((i) => [i.kind, i.note])).toEqual([
      ['task', '2 days late'],
      ['shoot', 'Candid Photographer'],
      ['call', expect.stringMatching(/^At 4/)],
      ['task', 'Due today'],
    ])
    expect(today[1]!.title).toMatch(/^3–6\sPM · Engagement \(Sharma Wedding\)$/)
    expect(today[0]!.late).toBe(true)
  })

  it('keeps a shoot until it ends, and drops other people\'s and released ones', () => {
    const later = new Date(2026, 9, 23, 19, 0)
    const { today } = myDay({
      ...base,
      now: later,
      slots: [slot({}), slot({ user_id: 'someone' }), slot({ status: 'released' as TeamSlot['status'] })],
    })
    expect(today).toEqual([])
  })

  it('lists the week ahead with its day, and nothing past it', () => {
    const { next } = myDay({
      ...base,
      now: NOW,
      slots: [slot({ start_at: at('2026-10-25', 10), end_at: at('2026-10-25', 14) }), slot({ start_at: at('2026-11-05', 10), end_at: at('2026-11-05', 12) })],
      tasks: [task('Deliver teaser', '2026-10-27')],
    })
    expect(next).toHaveLength(2)
    expect(next[0]!.title).toMatch(/^Sun, 25 Oct · 10\sAM–2\sPM · Engagement/)
    expect(next[1]!.note).toBe('4 days left · Tue, 27 Oct')
  })

  it('says when to start an edit, and puts one sent back near the top', () => {
    const { today, next } = myDay({
      ...base,
      now: NOW,
      edits: [
        edit('Highlight film', { start_by: '2026-10-23' }),
        edit('Album', { start_by: '2026-10-20' }),
        edit('Teaser', { changes_requested: true }),
        edit('Reels', { start_by: '2026-10-26' }),
        edit('Started one', { start_by: '2026-10-20', started_at: '2026-10-20T05:00:00Z', estimated_date: '2026-10-29' }),
      ],
    })
    expect(today.map((i) => i.note)).toEqual(['Start · 3 days late', 'Sent back for changes', 'Start today'])
    expect(next.map((i) => i.note)).toEqual(['Start Mon, 26 Oct', '6 days left · Thu, 29 Oct'])
  })

  it('marks a call late once its hour has gone, and asks for cards still owed', () => {
    const shot = slot({ start_at: at('2026-10-20', 10), end_at: at('2026-10-20', 14) })
    const { today } = myDay({
      ...base,
      now: NOW,
      slots: [shot],
      owedCards: new Set([shot.id]),
      calls: [call('Kapoor', at('2026-10-23', 9, 30), { subject: 'Send quote' })],
    })
    expect(today.map((i) => [i.kind, i.late])).toEqual([
      ['call', true],
      ['handover', false],
    ])
    expect(today[0]!.title).toBe('Send quote · Kapoor')
    expect(today[0]!.note).toMatch(/^Was due 9:30/)
    expect(today[1]!.title).toBe('Hand over your cards · Engagement (Sharma Wedding)')
  })

  it('ignores done and cancelled tasks', () => {
    const { today } = myDay({
      ...base,
      now: NOW,
      tasks: [task('Done', '2026-10-20', { status: 'completed' }), task('Gone', '2026-10-20', { status: 'cancelled' })],
    })
    expect(today).toEqual([])
  })
})

describe('the open-work line', () => {
  it('counts only what there is', () => {
    expect(openWorkLine({ tasks: 3, edits: 2, handovers: 1 })).toBe('3 tasks · 2 edits · 1 hand-over')
    expect(openWorkLine({ tasks: 1, edits: 0, handovers: 0 })).toBe('1 task')
    expect(openWorkLine({ tasks: 0, edits: 0, handovers: 0 })).toBeNull()
  })
})
