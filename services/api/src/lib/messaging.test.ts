import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Env } from '../context'
import { deliver } from './messaging'

const row = {
  id: 'm1',
  company_id: 'c1',
  channel: 'whatsapp' as 'whatsapp' | 'email',
  to_address: '919876543210',
  template_key: 'leave_decided',
  meta_template_name: 'ipc_leave_decision',
  language: 'en',
  template_body: 'Hi {{1}}, {{2}}: {{3}}. Dates: {{4}}.',
  vars: ['Priya', 'Sharma Studio', 'Leave approved', ''],
  subject: 'Sharma Studio: Leave approved',
  body: '05 Oct',
  link: '/leave',
  studio_name: 'Sharma Studio',
}
const env = (over: Partial<Env> = {}) => ({ WHATSAPP_PHONE_NUMBER_ID: '', WHATSAPP_ACCESS_TOKEN: '', RESEND_API_KEY: '', EMAIL_FROM: 'x@y.in', APP_URL: 'https://app.test', ...over }) as Env

describe('deliver', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('fails cleanly, without calling anyone, when WhatsApp is not configured', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    expect(await deliver(env(), row)).toEqual({ ok: false, error: 'WhatsApp not configured' })
    expect(await deliver(env(), { ...row, channel: 'email', to_address: 'p@s.in' })).toEqual({ ok: false, error: 'Email not configured' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('sends the template with exactly its parameters, a blank one as a dash', async () => {
    const fetchMock = vi.fn(async (_u: string, init: RequestInit) => {
      const b = JSON.parse(String(init.body)) as { template: { components: Array<{ parameters: Array<{ text: string }> }> } }
      expect(b.template.components[0]!.parameters.map((p) => p.text)).toEqual(['Priya', 'Sharma Studio', 'Leave approved', '-'])
      return new Response(JSON.stringify({ messages: [{ id: 'wamid.9' }] }), { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)
    expect(await deliver(env({ WHATSAPP_PHONE_NUMBER_ID: '1', WHATSAPP_ACCESS_TOKEN: 't' }), row)).toEqual({ ok: true, providerId: 'wamid.9' })
  })

  it("turns a provider refusal into a reason instead of throwing", async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"error":{"message":"Invalid parameter"}}', { status: 400 })))
    const r = await deliver(env({ WHATSAPP_PHONE_NUMBER_ID: '1', WHATSAPP_ACCESS_TOKEN: 't' }), row)
    expect(r).toEqual({ ok: false, error: 'WhatsApp refused it (400): Invalid parameter' })
  })

  it('emails with the app link', async () => {
    const fetchMock = vi.fn(async (_u: string, init: RequestInit) => {
      const b = JSON.parse(String(init.body)) as { to: string; subject: string; html: string }
      expect(b.to).toBe('p@s.in')
      expect(b.subject).toBe('Sharma Studio: Leave approved')
      expect(b.html).toContain('https://app.test/leave')
      return new Response(JSON.stringify({ id: 'em_1' }), { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)
    expect(await deliver(env({ RESEND_API_KEY: 'k' }), { ...row, channel: 'email', to_address: 'p@s.in' })).toEqual({ ok: true, providerId: 'em_1' })
  })
})
