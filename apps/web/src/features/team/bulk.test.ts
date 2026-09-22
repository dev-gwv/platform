import { describe, expect, it } from 'vitest'
import { addMemberRequest } from '@ipc/contracts'
import {
  isBlankRow,
  libraryKey,
  newRow,
  parsePastedTeam,
  pendingRows,
  pickableRoles,
  toRequest,
  validateRows,
  type BulkRow,
  type PickableRole,
} from './bulk'

const row = (over: Partial<BulkRow> = {}): BulkRow => ({ ...newRow(), ...over })

const ROLE_ID = '11111111-1111-4111-8111-111111111111'
const PICKABLE: PickableRole[] = [
  { key: ROLE_ID, type_name: 'Candid Photographer', role_code: 'candid_photographer', stage: 'production', owned: true },
  { key: libraryKey('video_editor'), type_name: 'Video Editor', role_code: 'video_editor', stage: 'post', owned: false },
]

describe('rows', () => {
  it('treats an untouched row as blank, and skips it', () => {
    const blank = row()
    const typed = row({ name: 'Asha' })
    expect(isBlankRow(blank)).toBe(true)
    expect(pendingRows([blank, typed])).toEqual([typed])
  })

  it('still treats a row as blank when only a shared password or job role was applied to it', () => {
    const filled = row({ password: 'Welcome@1', roleKeys: [ROLE_ID] })
    expect(isBlankRow(filled)).toBe(true)
    expect(validateRows([filled]).size).toBe(0)
  })

  it('does not send a row that was already added', () => {
    const done = row({ name: 'Asha', status: 'added' })
    expect(pendingRows([done])).toEqual([])
  })
})

describe('toRequest', () => {
  it('makes a login when there is an email', () => {
    const req = toRequest(row({ name: 'Asha', phone: '9876543210', email: 'a@x.in', password: 'secret1' }), () => null)
    expect(req.create_login).toBe(true)
    expect(req.email).toBe('a@x.in')
    expect(req.password).toBe('secret1')
    expect(addMemberRequest.safeParse(req).success).toBe(true)
  })

  it('adds someone directory-only when the email is blank, and ignores a stray password', () => {
    const req = toRequest(row({ name: 'Ravi', phone: '9876543210', password: 'ignored' }), () => null)
    expect(req.create_login).toBe(false)
    expect(req).not.toHaveProperty('email')
    expect(req).not.toHaveProperty('password')
    expect(addMemberRequest.safeParse(req).success).toBe(true)
  })

  it('resolves role keys and drops the ones it cannot place', () => {
    const req = toRequest(
      row({ name: 'Asha', phone: '9876543210', roleKeys: [ROLE_ID, 'lib:unknown'] }),
      (k) => (k === ROLE_ID ? ROLE_ID : null),
    )
    expect(req.role_ids).toEqual([ROLE_ID])
  })
})

describe('validateRows', () => {
  it('passes a complete row', () => {
    const r = row({ name: 'Asha', phone: '9876543210', email: 'a@x.in', password: 'secret1' })
    expect(validateRows([r]).size).toBe(0)
  })

  it('names each missing field', () => {
    const r = row({ name: 'A', email: 'nope' })
    const e = validateRows([r]).get(r.key)
    expect(e?.name).toBe('At least 2 letters')
    expect(e?.phone).toBe('Phone is required')
    expect(e?.email).toBe("Doesn't look like an email")
  })

  it('needs a password only when there is an email to sign in with', () => {
    const withEmail = row({ name: 'Asha', phone: '9876543210', email: 'a@x.in' })
    const without = row({ name: 'Ravi', phone: '9876543211' })
    const errors = validateRows([withEmail, without])
    expect(errors.get(withEmail.key)?.password).toBe('Needed to sign in')
    expect(errors.has(without.key)).toBe(false)
  })

  it('catches the same email or phone typed on two rows', () => {
    const a = row({ name: 'Asha', phone: '98765 43210', email: 'A@x.in', password: 'secret1' })
    const b = row({ name: 'Ravi', phone: '9876543210', email: 'a@x.in', password: 'secret1' })
    const e = validateRows([a, b])
    expect(e.has(a.key)).toBe(false)
    expect(e.get(b.key)?.email).toBe('Same as row 1')
    expect(e.get(b.key)?.phone).toBe('Same as row 1')
  })

  it('ignores blank rows rather than flagging them', () => {
    expect(validateRows([row(), row()]).size).toBe(0)
  })
})

describe('parsePastedTeam', () => {
  it('reads a tab-separated block from a spreadsheet without a header, in the default order', () => {
    const text = 'Asha Rao\t9876543210\tasha@x.in\tsecret1\tCandid Photographer\nRavi\t9876543211\t\t\t'
    const { rows, unknownRoles } = parsePastedTeam(text, PICKABLE)
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({ name: 'Asha Rao', phone: '9876543210', email: 'asha@x.in', password: 'secret1', roleKeys: [ROLE_ID] })
    expect(rows[1]).toMatchObject({ name: 'Ravi', email: '', roleKeys: [] })
    expect(unknownRoles).toEqual([])
  })

  it('follows a header row in any column order', () => {
    const text = 'Email,Name,Mobile,Access,Type\nasha@x.in,Asha,9876543210,Manager,Freelancer'
    const { rows } = parsePastedTeam(text, PICKABLE)
    expect(rows[0]).toMatchObject({ name: 'Asha', email: 'asha@x.in', phone: '9876543210', role: 'manager', engagement: 'freelancer' })
  })

  it('matches several job roles in one cell, including library ones, ignoring case', () => {
    const text = 'Name\tPhone\tRole\nAsha\t9876543210\tcandid photographer, VIDEO EDITOR'
    const { rows } = parsePastedTeam(text, PICKABLE)
    expect(rows[0]!.roleKeys).toEqual([ROLE_ID, libraryKey('video_editor')])
  })

  it('reports role names it could not place instead of dropping them silently', () => {
    const text = 'Asha\t9876543210\t\t\tDrone Pilot'
    expect(parsePastedTeam(text, PICKABLE).unknownRoles).toEqual(['Drone Pilot'])
  })

  it('handles quoted CSV cells that contain commas', () => {
    const text = 'Name,Phone,Roles\n"Rao, Asha",9876543210,"Candid Photographer, Video Editor"'
    const { rows } = parsePastedTeam(text, PICKABLE)
    expect(rows[0]!.name).toBe('Rao, Asha')
    expect(rows[0]!.roleKeys).toHaveLength(2)
  })

  it('returns nothing for an empty paste', () => {
    expect(parsePastedTeam('  \n \n', PICKABLE).rows).toEqual([])
  })
})

describe('pickableRoles', () => {
  it('lists owned roles first and only the library roles not yet taken', () => {
    const list = pickableRoles(
      [{ id: ROLE_ID, type_name: 'Candid Photographer', role_code: 'candid_photographer', stage: 'production', member_count: 0 }],
      [
        { id: '22222222-2222-4222-8222-222222222222', type_name: 'Candid Photographer', role_code: 'candid_photographer', stage: 'production' },
        { id: '33333333-3333-4333-8333-333333333333', type_name: 'Video Editor', role_code: 'video_editor', stage: 'post' },
      ],
    )
    expect(list.map((r) => r.key)).toEqual([ROLE_ID, libraryKey('video_editor')])
  })
})
