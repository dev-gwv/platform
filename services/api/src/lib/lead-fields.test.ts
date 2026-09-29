import { describe, expect, it } from 'vitest'
import { cleanLead, normalizeEmail, normalizePhone } from './lead-fields'
import { mapGraphLead } from './meta'

describe('normalizePhone', () => {
  it('reads an Indian mobile however it was typed', () => {
    for (const raw of ['9876543210', '09876543210', '919876543210', '+919876543210', '+91 98765-43210', '+91 (98765) 43210', '0091 98765 43210', ' 98765.43210 ']) {
      expect(normalizePhone(raw), raw).toBe('+919876543210')
    }
  })

  it('keeps a real international number, with its plus', () => {
    expect(normalizePhone('+1 (212) 555-0147')).toBe('+12125550147')
    expect(normalizePhone('+44 20 7946 0958')).toBe('+442079460958')
  })

  it('gives up on placeholders, junk and impossible lengths', () => {
    expect(normalizePhone('<test lead: dummy data for phone_number>')).toBeNull()
    expect(normalizePhone('call me')).toBeNull()
    expect(normalizePhone('12345')).toBeNull()
    expect(normalizePhone('1234567890123456789')).toBeNull()
    expect(normalizePhone('')).toBeNull()
    expect(normalizePhone(null)).toBeNull()
  })

  it('never returns more than the contacts table allows', () => {
    for (const raw of ['+91 98765-43210', '+442079460958', '123456789012345']) {
      expect((normalizePhone(raw) ?? '').length).toBeLessThanOrEqual(30)
    }
  })
})

describe('cleanLead', () => {
  it('keeps an unusable phone in meta and says why', () => {
    const l = cleanLead({ name: '<test lead: dummy data for full_name>', phone: '<test lead: dummy data for phone_number>', email: 'test@fb.com', meta: { leadgen_id: '1' } })
    expect(l.phone).toBeNull()
    expect(l.phoneIssue).toBe('rejected')
    expect(l.meta.raw_phone).toBe('<test lead: dummy data for phone_number>')
    expect(l.meta.leadgen_id).toBe('1')
    expect(l.email).toBe('test@fb.com')
  })

  it('saves an email-only lead with no phone', () => {
    const l = cleanLead({ email: 'asha@example.com' })
    expect(l).toMatchObject({ phone: null, email: 'asha@example.com', phoneIssue: 'missing' })
    expect(l.meta.raw_phone).toBeUndefined()
  })

  it('fits the name and email the contacts table can hold', () => {
    const l = cleanLead({ name: 'x'.repeat(400), phone: '9876543210', email: 'not an email' })
    expect(l.name!.length).toBe(160)
    expect(l.email).toBeNull()
    expect(l.meta.raw_email).toBe('not an email')
    expect(l.phoneIssue).toBeNull()
    expect(normalizeEmail(`${'a'.repeat(250)}@x.com`)).toBeNull()
  })
})

describe('a Meta lead, from its form fields', () => {
  it('reads the standard questions and keeps custom ones', () => {
    const lead = mapGraphLead({
      field_data: [
        { name: 'FULL_NAME', values: ['Asha Rao'] },
        { name: 'Phone_Number', values: ['+91 98765-43210'] },
        { name: 'EMAIL', values: ['asha@example.com'] },
        { name: 'wedding_date', values: ['12 Dec'] },
      ],
    })
    expect(lead).toMatchObject({ name: 'Asha Rao', phone: '+91 98765-43210', email: 'asha@example.com' })
    expect(lead.fields.wedding_date).toBe('12 Dec')
  })

  it('joins first and last name when there is no full name', () => {
    expect(mapGraphLead({ field_data: [{ name: 'first_name', values: ['Asha'] }, { name: 'last_name', values: ['Rao'] }] }).name).toBe('Asha Rao')
    expect(mapGraphLead({ field_data: [{ name: 'last_name', values: ['Rao'] }] }).name).toBe('Rao')
    expect(mapGraphLead({ field_data: [] }).name).toBeNull()
  })
})
