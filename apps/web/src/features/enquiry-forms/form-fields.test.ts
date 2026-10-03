import { describe, expect, it } from 'vitest'
import { DEFAULT_FIELDS, askedFields, fieldsLine, firstMissing } from './form-fields'

describe('enquiry form fields', () => {
  it('lists what is asked in order', () => {
    expect(askedFields(DEFAULT_FIELDS)).toEqual(['event_type', 'event_date', 'city', 'message'])
  })

  it('names the first required field left empty', () => {
    const fields = { ...DEFAULT_FIELDS, email: 'required' as const, budget: 'required' as const }
    expect(firstMissing(fields, { email: 'a@b.in' })).toBe('Budget')
    expect(firstMissing(fields, { email: ' ' })).toBe('Email')
    expect(firstMissing(fields, { email: 'a@b.in', budget: '50000' })).toBeNull()
  })

  it('says it in one line', () => {
    expect(fieldsLine(DEFAULT_FIELDS)).toBe('Asks name, phone, event, date, city and a message')
    expect(fieldsLine({ ...DEFAULT_FIELDS, event_date: 'required', city: 'off', message: 'off', event_type: 'off' })).toBe(
      'Asks name, phone and date · 1 more required',
    )
  })
})
