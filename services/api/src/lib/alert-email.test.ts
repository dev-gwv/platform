import { describe, expect, it } from 'vitest'
import type { Env } from '../context'
import { alertEmail, alertLink, type AlertRow } from './alert-email'

const env = { APP_URL: 'https://studioautopilot.in/' } as unknown as Env

const row = (over: Partial<AlertRow> = {}): AlertRow => ({
  notification_id: 'n1',
  company_id: 'c1',
  studio_name: 'Asha Studio',
  recipient_uid: 'u1',
  email: 'ravi@gmail.com',
  name: 'Ravi Kumar',
  type: 'shoot_assigned',
  title: "You're booked: Wedding",
  body: 'Sat 12 Nov · 4 PM · Candid Photographer',
  deep_link: '/shoots/my',
  ...over,
})

describe('alert emails', () => {
  it('links only inside the app', () => {
    expect(alertLink(env, '/tasks?open=abc')).toBe('https://studioautopilot.in/tasks?open=abc')
    expect(alertLink(env, 'https://evil.example/x')).toBe('https://studioautopilot.in/')
    expect(alertLink(env, '//evil.example')).toBe('https://studioautopilot.in/')
    expect(alertLink(env, null)).toBe('https://studioautopilot.in/')
  })

  it('one alert is its own subject; several are counted', () => {
    expect(alertEmail(env, [row()]).subject).toBe("You're booked: Wedding")
    const many = alertEmail(env, [row(), row({ notification_id: 'n2', title: 'Task overdue', deep_link: '/tasks' })])
    expect(many.subject).toBe('2 things waiting for you at Asha Studio')
    expect(many.html).toContain('Hi Ravi, from Asha Studio')
    expect(many.html).toContain('Task overdue')
    expect(many.text).toContain('https://studioautopilot.in/tasks')
  })

  it('escapes what people typed', () => {
    const m = alertEmail(env, [row({ title: '<b>Haldi</b>', body: 'a & b' })])
    expect(m.html).toContain('&lt;b&gt;Haldi&lt;/b&gt;')
    expect(m.html).toContain('a &amp; b')
  })
})
