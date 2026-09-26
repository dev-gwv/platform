import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  sendWhatsAppTemplate,
  sendWhatsAppText,
  whatsappConfigured,
  whatsappLink,
  whatsappOptChanges,
  whatsappStatusUpdates,
} from './whatsapp'

describe('whatsapp', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('is configured only with both halves', () => {
    expect(whatsappConfigured({ WHATSAPP_PHONE_NUMBER_ID: '1', WHATSAPP_ACCESS_TOKEN: '' })).toBe(false)
    expect(whatsappConfigured({ WHATSAPP_PHONE_NUMBER_ID: '1', WHATSAPP_ACCESS_TOKEN: 't' })).toBe(true)
  })

  it('posts a text message to the phone number id and returns the message id', async () => {
    const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
      expect(url).toBe('https://graph.facebook.com/v21.0/123/messages')
      expect(init.headers).toMatchObject({ Authorization: 'Bearer tok' })
      const body = JSON.parse(String(init.body)) as { to: string; text: { body: string }; type: string }
      expect(body).toMatchObject({ to: '919876543210', type: 'text', text: { body: 'Hi Priya' } })
      return new Response(JSON.stringify({ messages: [{ id: 'wamid.1' }] }), { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)
    const r = await sendWhatsAppText({ WHATSAPP_PHONE_NUMBER_ID: '123', WHATSAPP_ACCESS_TOKEN: 'tok' }, '919876543210', 'Hi Priya')
    expect(r.message_id).toBe('wamid.1')
  })

  it('throws on a provider refusal so attempt() logs it', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"error":"bad token"}', { status: 401 })))
    await expect(sendWhatsAppText({ WHATSAPP_PHONE_NUMBER_ID: '1', WHATSAPP_ACCESS_TOKEN: 't' }, '9', 'x')).rejects.toThrow(/401/)
  })

  it('builds the wa.me fallback link', () => {
    expect(whatsappLink('919876543210', 'Hi & bye')).toBe('https://wa.me/919876543210?text=Hi%20%26%20bye')
  })

  it('sends a template with its body parameters in order', async () => {
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as Record<string, unknown>
      expect(body).toMatchObject({
        to: '919876543210',
        type: 'template',
        template: {
          name: 'ipc_leave_decision',
          language: { code: 'en' },
          components: [{ type: 'body', parameters: [{ type: 'text', text: 'Priya' }, { type: 'text', text: 'Studio' }] }],
        },
      })
      return new Response(JSON.stringify({ messages: [{ id: 'wamid.T' }] }), { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)
    const r = await sendWhatsAppTemplate(
      { WHATSAPP_PHONE_NUMBER_ID: '1', WHATSAPP_ACCESS_TOKEN: 't' },
      '919876543210',
      { name: 'ipc_leave_decision', language: 'en' },
      ['Priya', 'Studio'],
    )
    expect(r.message_id).toBe('wamid.T')
  })

  it("names Meta's reason when a template send is refused", async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: { message: 'Template name does not exist' } }), { status: 404 })))
    await expect(
      sendWhatsAppTemplate({ WHATSAPP_PHONE_NUMBER_ID: '1', WHATSAPP_ACCESS_TOKEN: 't' }, '9', { name: 'x', language: 'en' }, []),
    ).rejects.toThrow(/Template name does not exist/)
  })

  it('reads delivery receipts and STOP replies from a webhook post', () => {
    const body = {
      object: 'whatsapp_business_account',
      entry: [
        {
          changes: [
            {
              field: 'messages',
              value: {
                statuses: [
                  { id: 'wamid.1', status: 'delivered' },
                  { id: 'wamid.2', status: 'failed', errors: [{ code: 131026, title: 'Message undeliverable' }] },
                  { id: 'wamid.3', status: 'deleted' },
                ],
                messages: [
                  { from: '919876543210', type: 'text', text: { body: ' stop ' } },
                  { from: '91999', text: { body: 'hello' } },
                ],
              },
            },
          ],
        },
      ],
    }
    expect(whatsappStatusUpdates(body)).toEqual([
      { id: 'wamid.1', status: 'delivered', error: null },
      { id: 'wamid.2', status: 'failed', error: 'Message undeliverable' },
    ])
    expect(whatsappOptChanges(body)).toEqual([{ from: '919876543210', out: true }])
    expect(whatsappStatusUpdates({ object: 'page' })).toEqual([])
  })
})
