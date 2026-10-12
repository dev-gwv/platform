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

const { deliver, OWNER_ONLY_NOTE } = await import('./email')

const env = { RESEND_API_KEY: 'k', EMAIL_FROM: 'Studio AutoPilot <noreply@studioautopilot.in>', DATABASE_URL: 'postgres://x' } as unknown as Env
const mail = (to: string) => ({ to, subject: 'Hello', html: '<p>Hi</p>' })

afterEach(() => {
  vi.restoreAllMocks()
  logged.length = 0
})

describe('email goes to studio owners only, for now', () => {
  it('sends to the owner', async () => {
    const f = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ id: 're_1' }), { status: 200 }))
    const r = await deliver(env, mail(' Asha@MehtaStudios.in '), { kind: 'onboarding' })
    expect(r).toEqual({ status: 'sent', id: 're_1' })
    expect(f).toHaveBeenCalledOnce()
    expect(logged).toEqual(['sent'])
  })

  it('holds mail to the team, a client or a lead, and logs it as skipped', async () => {
    const f = vi.spyOn(globalThis, 'fetch')
    for (const [to, kind] of [['nitin@example.com', 'staff_alert'], ['priya@example.com', 'client_doc'], ['lead@example.com', 'sequence']]) {
      const r = await deliver(env, mail(to!), { kind: kind! })
      expect(r).toEqual({ status: 'failed', error: OWNER_ONLY_NOTE })
    }
    expect(f).not.toHaveBeenCalled()
    expect(logged).toEqual(['skipped', 'skipped', 'skipped'])
  })

  it("never holds the platform's own test send", async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ id: 're_2' }), { status: 200 }))
    expect((await deliver(env, mail('anyone@example.com'), { kind: 'test' })).status).toBe('sent')
  })
})
