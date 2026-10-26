import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Env } from '../context'

// Who is a studio owner: the one address the fake database knows.
const OWNER = 'asha@mehtastudios.in'
const logged: string[] = []
vi.mock('./db', () => ({
  withService: async (_env: Env, fn: (sql: unknown) => unknown) =>
    fn((strings: TemplateStringsArray, ...values: unknown[]) => {
      const text = strings.join('?')
      if (text.includes('insert into email_log')) {
        logged.push(String(values[4]))
        return Promise.resolve([])
      }
      return Promise.resolve([{ ok: values[0] === OWNER }])
    }),
}))

const { deliver, AUTOMATIC_OFF_NOTE } = await import('./email')

const env = { RESEND_API_KEY: 'k', EMAIL_FROM: 'Studio AutoPilot <noreply@studioautopilot.in>', DATABASE_URL: 'postgres://x' } as unknown as Env
const mail = (to: string) => ({ to, subject: 'Hello', html: '<p>Hi</p>' })

afterEach(() => {
  vi.restoreAllMocks()
  logged.length = 0
})

describe('no email goes out by itself (26 Oct)', () => {
  it('sends what a person pressed Send on, to whoever it is for', async () => {
    const f = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ id: 're_1' }), { status: 200 }))
    for (const [to, kind] of [
      ['priya@example.com', 'client_doc'],
      ['nitin@example.com', 'team_terms'],
      ['nitin@example.com', 'invitation'],
      [OWNER, 'password_reset'],
      [OWNER, 'verification'],
      ['anyone@example.com', 'test'],
    ]) {
      expect((await deliver(env, mail(to!), { kind: kind! })).status).toBe('sent')
    }
    expect(f).toHaveBeenCalledTimes(6)
  })

  it('holds everything the app would send on its own, even to the owner, and logs it as skipped', async () => {
    const f = vi.spyOn(globalThis, 'fetch')
    for (const kind of ['morning', 'access', 'weekly', 'staff_alert', 'onboarding', 'terms_agreed', 'sequence', 'message', 'notice']) {
      expect(await deliver(env, mail(OWNER), { kind })).toEqual({ status: 'failed', error: AUTOMATIC_OFF_NOTE })
    }
    expect(f).not.toHaveBeenCalled()
    expect(logged.every((s) => s === 'skipped')).toBe(true)
  })
})
