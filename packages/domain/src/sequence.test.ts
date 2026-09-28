import { describe, expect, it } from 'vitest'
import { fillSequenceText, waLink } from './sequence'

describe('fillSequenceText', () => {
  const studio = { name: 'Asha Studio', website: 'https://asha.in' }

  it('fills the lead and studio in', () => {
    expect(fillSequenceText('Hi {{first_name}}, {{studio}} would love to shoot your {{event_type}} on {{event_date}}.', { name: 'Riya Sharma', event_type: 'Wedding', event_date: '2026-12-12' }, studio)).toBe(
      'Hi Riya, Asha Studio would love to shoot your Wedding on 12 Dec 2026.',
    )
  })

  it('reads naturally when the lead left things out', () => {
    expect(fillSequenceText('Hi {{name}}, about your {{event_type}} on {{event_date}}', {}, studio)).toBe('Hi there, about your event on your date')
  })

  it('drops the sentence pointing at a website the studio has not given', () => {
    const body = 'Thank you for reaching out! You can see our work here: {{website}}\n\nWhen can we talk?'
    expect(fillSequenceText(body, {}, { name: 'Asha Studio' })).toBe('Thank you for reaching out!\n\nWhen can we talk?')
    expect(fillSequenceText(body, {}, studio)).toContain('here: https://asha.in')
  })
})

describe('waLink', () => {
  it('adds India to a bare number and carries the message', () => {
    expect(waLink('98765 43210', 'Hi there')).toBe('https://wa.me/919876543210?text=Hi%20there')
    expect(waLink('+44 7700 900123')).toBe('https://wa.me/447700900123')
  })
})
