import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Env } from '../context'
import { sendClientDocEmail } from './email'

const env = { RESEND_API_KEY: 'k', EMAIL_FROM: 'Studio AutoPilot <noreply@studioautopilot.in>' } as unknown as Env
const LINK = 'https://studioautopilot.in/terms/acknowledge?token=abc'

const answer = (status: number, body: unknown) =>
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify(body), { status }))

afterEach(() => vi.restoreAllMocks())

describe('a client document email', () => {
  it('goes out with a plain-text part and keeps the message id', async () => {
    const f = answer(200, { id: 're_42' })
    const r = await sendClientDocEmail(env, 'pulkit@example.com', 'Terms for Pulkit', LINK, 'Hi Pulkit,<br><br>Please read &amp; agree.')
    expect(r).toMatchObject({ status: 'sent', id: 're_42' })
    const sent = JSON.parse(String(f.mock.calls[0]![1]!.body)) as { text: string; html: string }
    expect(sent.text).toContain('Hi Pulkit,\n\nPlease read & agree.')
    expect(sent.text).toContain(LINK)
    expect(sent.html).toContain(LINK)
  })

  it('says why the email service refused, not just "failed"', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    answer(403, { statusCode: 403, message: 'The studioautopilot.in domain is not verified.', name: 'validation_error' })
    const r = await sendClientDocEmail(env, 'pulkit@example.com', 'Terms', LINK, 'Hi')
    expect(r.status).toBe('failed')
    expect(r.error).toMatch(/sending domain needs verifying/)
    expect(r.error).toMatch(/domain is not verified/)
  })

  it('refuses to email a link the client could not open', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const f = vi.spyOn(globalThis, 'fetch')
    const r = await sendClientDocEmail(env, 'pulkit@example.com', 'Terms', '/terms/acknowledge?token=abc', 'Hi')
    expect(r).toMatchObject({ status: 'failed', error: expect.stringMatching(/APP_URL/) })
    expect(f).not.toHaveBeenCalled()
  })

  it('without a key or an address, says so instead of pretending', async () => {
    expect((await sendClientDocEmail({ ...env, RESEND_API_KEY: '' } as Env, 'a@b.c', 'T', LINK, 'Hi')).status).toBe('provider_missing')
    expect(await sendClientDocEmail(env, null, 'T', LINK, 'Hi')).toMatchObject({ status: 'failed', error: expect.stringMatching(/email not found/) })
  })
})
