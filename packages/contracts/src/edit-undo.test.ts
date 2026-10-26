import { describe, expect, it } from 'vitest'
import { undoDismissalRequest, updateLeadRequest } from './crm'
import { reopenLeaveRequest, setAttendanceRequest, updateHolidayRequest } from './hr'

/** 0286: the shapes that let a thing be changed back. */
describe('edit and undo contracts', () => {
  it("lets a lead's partner be changed or taken off", () => {
    expect(updateLeadRequest.safeParse({ partner_id: '11111111-1111-4111-8111-111111111111' }).success).toBe(true)
    expect(updateLeadRequest.safeParse({ partner_id: null }).success).toBe(true)
    expect(updateLeadRequest.safeParse({ partner_id: 'not-a-partner' }).success).toBe(false)
  })

  it('takes "none" as a way to clear a day, and nothing made up', () => {
    expect(setAttendanceRequest.safeParse({ status: 'none' }).success).toBe(true)
    expect(setAttendanceRequest.safeParse({ status: 'present' }).success).toBe(true)
    expect(setAttendanceRequest.safeParse({ status: 'gone' }).success).toBe(false)
  })

  it('moves or renames a holiday with either field alone', () => {
    expect(updateHolidayRequest.safeParse({ name: 'Diwali' }).success).toBe(true)
    expect(updateHolidayRequest.safeParse({ holiday_date: '2026-11-08' }).success).toBe(true)
    expect(updateHolidayRequest.safeParse({ name: '' }).success).toBe(false)
  })

  it('reopens leave with or without a note, and undoes a "not duplicates" pair by its two leads', () => {
    expect(reopenLeaveRequest.safeParse({}).success).toBe(true)
    expect(reopenLeaveRequest.safeParse({ note: 'x'.repeat(501) }).success).toBe(false)
    expect(
      undoDismissalRequest.safeParse({ lead_a: '11111111-1111-4111-8111-111111111111', lead_b: '22222222-2222-4222-8222-222222222222' })
        .success,
    ).toBe(true)
    expect(undoDismissalRequest.safeParse({ lead_a: '11111111-1111-4111-8111-111111111111' }).success).toBe(false)
  })
})
