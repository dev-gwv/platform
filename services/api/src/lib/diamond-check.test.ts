import { describe, expect, it, vi } from 'vitest'
import { checkDiamondScreenshot, judge, type MessagesClient } from './diamond-check'

const png = { mime: 'image/png', bytes: new Uint8Array([1, 2, 3]) }

const replying = (body: unknown, stop_reason = 'end_turn') => {
  const create = vi.fn().mockResolvedValue({
    stop_reason,
    content: typeof body === 'string' ? [] : [{ type: 'text', text: JSON.stringify(body) }],
  })
  return { client: { beta: { messages: { create } } } as unknown as MessagesClient, create }
}

describe('the rule', () => {
  it('approves the IPC Diamonds - Premium group, however the dash is drawn', () => {
    for (const t of ['IPC Diamonds - Premium', 'IPC Diamonds – Premium', 'ipc diamonds premium', 'IPC Diamond - Premium'])
      expect(judge({ is_whatsapp_group_chat: true, group_title: t, confidence: 'high' }).decision).toBe('approve')
  })

  it('rejects another group and says what it read', () => {
    const v = judge({ is_whatsapp_group_chat: true, group_title: 'IPC Gold Members', confidence: 'high' })
    expect(v).toMatchObject({ decision: 'reject', reason: expect.stringContaining('IPC Gold Members') })
  })

  it('rejects something that is not a WhatsApp group chat, and a title too blurred to read', () => {
    expect(judge({ is_whatsapp_group_chat: false, group_title: 'IPC Diamonds - Premium', confidence: 'high' }).decision).toBe('reject')
    expect(judge({ is_whatsapp_group_chat: true, group_title: 'IPC Diamonds - Premium', confidence: 'low' }).decision).toBe('reject')
  })
})

describe('the check', () => {
  it('sends the image and approves on a matching reading', async () => {
    const { client, create } = replying({ is_whatsapp_group_chat: true, group_title: 'IPC Diamonds - Premium', confidence: 'high' })
    const v = await checkDiamondScreenshot('k', png, client)
    expect(v.decision).toBe('approve')
    const req = create.mock.calls[0]![0]
    expect(req.model).toBe('claude-opus-5-5')
    expect(req.fallbacks).toBe('default')
    expect(req.messages[0].content[0]).toMatchObject({ type: 'image', source: { type: 'base64', media_type: 'image/png' } })
  })

  it('hands a refusal, a failure or a missing key to a person', async () => {
    expect((await checkDiamondScreenshot('k', png, replying('none', 'refusal').client)).decision).toBe('manual')
    const failing = { beta: { messages: { create: vi.fn().mockRejectedValue(new Error('down')) } } } as unknown as MessagesClient
    expect((await checkDiamondScreenshot('k', png, failing)).decision).toBe('manual')
    expect((await checkDiamondScreenshot(undefined, png)).decision).toBe('manual')
  })

  it('refuses a file that is not an image', async () => {
    const v = await checkDiamondScreenshot('k', { mime: 'application/pdf', bytes: new Uint8Array([1]) })
    expect(v.decision).toBe('reject')
  })
})
