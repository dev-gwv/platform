import { describe, expect, it } from 'vitest'
import { DEFAULT_FIELDS, askedFields, checkEnquiry, fieldsLine, firstMissing } from './form-fields'

describe('enquiry form fields', () => {
  it('asks email, event, date and anything else by default', () => {
    expect(askedFields(DEFAULT_FIELDS)).toEqual(['email', 'event_type', 'event_date', 'message'])
  })

  it('names the first required field left empty', () => {
    const fields = { ...DEFAULT_FIELDS, email: 'required' as const, budget: 'required' as const }
    expect(firstMissing(fields, { email: 'a@b.in' })).toBe('Budget (₹)')
    expect(firstMissing(fields, { email: ' ' })).toBe('Email')
    expect(firstMissing(fields, { email: 'a@b.in', budget: '50000' })).toBeNull()
  })

  it('checks each answer under its own field', () => {
    const fields = { ...DEFAULT_FIELDS, email: 'required' as const, services: 'required' as const }
    expect(checkEnquiry(fields, 'A', '12345', {})).toEqual({
      name: 'Enter your name',
      phone: 'Enter a valid 10-digit mobile number',
      email: 'Please fill this in',
      services: 'Tick at least one',
    })
    expect(checkEnquiry(fields, 'Asha', '+91 98765 43210', { email: 'nope', services: ['Drone'] })).toEqual({
      email: 'Enter a valid email',
    })
    expect(checkEnquiry(DEFAULT_FIELDS, 'Asha', '098765 43210', {})).toEqual({})
  })

  it('says it in one line', () => {
    expect(fieldsLine(DEFAULT_FIELDS)).toBe('Asks name, phone, email, event, date and a message')
    expect(
      fieldsLine({ ...DEFAULT_FIELDS, email: 'off', event_date: 'required', message: 'off', event_type: 'off' }),
    ).toBe('Asks name, phone and date · 1 more required')
  })
})
