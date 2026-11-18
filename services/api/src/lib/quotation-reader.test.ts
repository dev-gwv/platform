import { describe, expect, it } from 'vitest'
import { readQuotation, type MessagesClient } from './quotation-reader'

const answer = {
  client_name: 'Nupur Jain',
  client_phone: null,
  client_email: null,
  project_name: 'Nupur Jain Wedding',
  events: [
    { name: 'Haldi', date: '2027-02-13', start_time: null, hours: 6, city: 'Delhi', guests: null, team: [{ role: 'Candid Photographer', quantity: 1 }] },
    { name: 'Wedding', date: '13 Feb', start_time: '7pm', hours: 99, city: '', guests: null, team: [] },
  ],
  deliverables: [
    { title: 'Instagram reels', kind: 'reel', due_days: 14, is_add_on: false, price: null },
    { title: 'Mystery', kind: 'hologram', due_days: null, is_add_on: false, price: null },
  ],
  total: 200000,
  payment_plan: [{ label: 'To book', percent: 30 }],
  notes: null,
}

function fake(text: string, seen: unknown[] = []): MessagesClient {
  return {
    beta: {
      messages: {
        create: (async (req: unknown) => {
          seen.push(req)
          return { stop_reason: 'end_turn', content: [{ type: 'text', text }] }
        }) as unknown as MessagesClient['beta']['messages']['create'],
      },
    },
  }
}

describe('readQuotation', () => {
  it('sends a PDF as a document and keeps only well-formed answers', async () => {
    const seen: unknown[] = []
    const r = await readQuotation(undefined, { mime: 'application/pdf', bytes: new Uint8Array([37, 80, 68, 70]) }, '2026-11-18', fake(JSON.stringify(answer), seen))
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const req = seen[0] as { messages: { content: { type: string }[] }[] }
    expect(req.messages[0]!.content[0]!.type).toBe('document')
    expect(r.reading.events[1]).toMatchObject({ date: null, start_time: null, hours: null, city: null })
    expect(r.reading.deliverables[1]!.kind).toBe('other')
    expect(r.reading.total).toBe(200000)
  })

  it('sends a photo as an image', async () => {
    const seen: unknown[] = []
    await readQuotation(undefined, { mime: 'image/jpeg', bytes: new Uint8Array([1]) }, '2026-11-18', fake(JSON.stringify(answer), seen))
    const req = seen[0] as { messages: { content: { type: string }[] }[] }
    expect(req.messages[0]!.content[0]!.type).toBe('image')
  })

  it('refuses other files and says when it is not switched on', async () => {
    expect(await readQuotation('k', { mime: 'text/plain', bytes: new Uint8Array([1]) }, '2026-11-18')).toMatchObject({ ok: false })
    expect(await readQuotation(undefined, { mime: 'application/pdf', bytes: new Uint8Array([1]) }, '2026-11-18')).toMatchObject({
      ok: false,
      why: expect.stringContaining('not switched on'),
    })
  })

  it('says so when the answer is not JSON', async () => {
    const r = await readQuotation(undefined, { mime: 'application/pdf', bytes: new Uint8Array([1]) }, '2026-11-18', fake('sorry'))
    expect(r.ok).toBe(false)
  })
})
