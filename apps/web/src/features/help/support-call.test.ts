import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { BOOKING_APP_ORIGINS, embedUrlFor } from './support-call'

const ctx = { name: 'Asha Rao', email: 'asha@mehta.in', studio: 'Mehta Studio', page: '/projects/1', origin: 'https://studioautopilot.in' }
const APP = 'https://calendly-common-meeting-web-bjvr.vercel.app'

describe('embedUrlFor', () => {
  it('opens the event as its embed page, with who is asking and where from', () => {
    const url = new URL(embedUrlFor(`${APP}/harsh-solanki/support-call`, ctx)!)
    expect(url.origin + url.pathname).toBe(`${APP}/embed/harsh-solanki/support-call`)
    expect(Object.fromEntries(url.searchParams)).toEqual({
      utm_source: 'studioautopilot',
      utm_medium: 'app',
      utm_campaign: 'support-call',
      utm_content: 'Mehta Studio',
      utm_term: '/projects/1',
      parent: 'https://studioautopilot.in/projects/1',
      name: 'Asha Rao',
      email: 'asha@mehta.in',
    })
  })

  it('takes an embed link as it is, and the whole booking page', () => {
    expect(embedUrlFor(`${APP}/embed/harsh-solanki/support-call`, ctx)).toContain('/embed/harsh-solanki/support-call?')
    expect(embedUrlFor(`${APP}/harsh-solanki`, ctx)).toContain('/embed/harsh-solanki?')
  })

  it('leaves out what it does not know', () => {
    const url = new URL(embedUrlFor(`${APP}/harsh-solanki/support-call`, { page: '/', origin: 'https://studioautopilot.in' })!)
    expect(url.searchParams.has('name')).toBe(false)
    expect(url.searchParams.has('email')).toBe(false)
    expect(url.searchParams.has('utm_content')).toBe(false)
  })

  it('keeps any other link in a new tab', () => {
    expect(embedUrlFor('https://cal.com/someone/30min', ctx)).toBeNull()
    expect(embedUrlFor(`${APP}/a/b/c`, ctx)).toBeNull()
    expect(embedUrlFor('not a link', ctx)).toBeNull()
    expect(embedUrlFor(null, ctx)).toBeNull()
  })

  it('may only frame a booking app the live headers allow', () => {
    const headers = readFileSync(join(__dirname, '..', '..', '..', 'public', '_headers'), 'utf8')
    const appCsp = headers.split('\n').find((l) => l.trim().startsWith('Content-Security-Policy:')) ?? ''
    const frameSrc = /frame-src ([^;]*)/.exec(appCsp)?.[1] ?? ''
    for (const origin of BOOKING_APP_ORIGINS) expect(frameSrc.split(' ')).toContain(origin)
  })
})
