import { describe, expect, it } from 'vitest'
import { googleAddUrl } from './CalendarLinkButton'

describe('Add to Google Calendar', () => {
  it('hands Google the link as webcal://, encoded', () => {
    const url = googleAddUrl('https://api.studioautopilot.in/public/calendar/abc_DEF-123.ics')
    expect(url).toBe('https://calendar.google.com/calendar/r?cid=webcal%3A%2F%2Fapi.studioautopilot.in%2Fpublic%2Fcalendar%2Fabc_DEF-123.ics')
  })
})
