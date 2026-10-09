import { afterEach, describe, expect, it, vi } from 'vitest'
import { emailSyncConfigured, fetchRecentMessages, planEmailImport, type SyncedMessage } from './email-sync'

describe('email sync', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('is off without a provider, token and mailbox', () => {
    expect(emailSyncConfigured({ EMAIL_SYNC_PROVIDER: '', EMAIL_SYNC_TOKEN: 't', EMAIL_SYNC_MAILBOX: 'a@b.in' })).toBe(false)
    expect(emailSyncConfigured({ EMAIL_SYNC_PROVIDER: 'gmail', EMAIL_SYNC_TOKEN: '', EMAIL_SYNC_MAILBOX: 'a@b.in' })).toBe(false)
    expect(emailSyncConfigured({ EMAIL_SYNC_PROVIDER: 'o365', EMAIL_SYNC_TOKEN: 't', EMAIL_SYNC_MAILBOX: 'a@b.in' })).toBe(true)
  })

  it('imports nothing when unconfigured, without touching the network', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    expect(await fetchRecentMessages({ EMAIL_SYNC_PROVIDER: '', EMAIL_SYNC_TOKEN: '', EMAIL_SYNC_MAILBOX: '' })).toEqual([])
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('normalises Gmail messages, telling inbound from outbound by the mailbox', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes('/messages?')) return new Response(JSON.stringify({ messages: [{ id: 'm1' }, { id: 'm2' }] }))
      if (url.includes('/messages/m1')) {
        return new Response(
          JSON.stringify({
            id: 'm1',
            snippet: 'Thanks for the quote',
            internalDate: '1757000000000',
            payload: { headers: [{ name: 'From', value: 'Priya <priya@x.in>' }, { name: 'To', value: 'studio@ipc.in' }, { name: 'Subject', value: 'Re: quote' }] },
          }),
        )
      }
      return new Response(
        JSON.stringify({
          id: 'm2',
          snippet: 'Here it is',
          internalDate: '1757000100000',
          payload: { headers: [{ name: 'From', value: 'studio@ipc.in' }, { name: 'To', value: 'rahul@y.in' }, { name: 'Subject', value: 'Quote' }] },
        }),
      )
    })
    vi.stubGlobal('fetch', fetchMock)
    const out = await fetchRecentMessages({ EMAIL_SYNC_PROVIDER: 'gmail', EMAIL_SYNC_TOKEN: 't', EMAIL_SYNC_MAILBOX: 'studio@ipc.in' })
    expect(out).toEqual([
      { external_id: 'm1', direction: 'in', subject: 'Re: quote', snippet: 'Thanks for the quote', counterpart: 'priya@x.in', at: new Date(1757000000000).toISOString() },
      { external_id: 'm2', direction: 'out', subject: 'Quote', snippet: 'Here it is', counterpart: 'rahul@y.in', at: new Date(1757000100000).toISOString() },
    ])
  })

  it('normalises Microsoft Graph messages the same way', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            value: [
              { id: 'g1', subject: 'Hi', bodyPreview: 'Hello', receivedDateTime: '2026-09-05T10:00:00Z', from: { emailAddress: { address: 'Priya@X.in' } }, toRecipients: [{ emailAddress: { address: 'studio@ipc.in' } }] },
            ],
          }),
        ),
      ),
    )
    const out = await fetchRecentMessages({ EMAIL_SYNC_PROVIDER: 'o365', EMAIL_SYNC_TOKEN: 't', EMAIL_SYNC_MAILBOX: 'studio@ipc.in' })
    expect(out[0]).toMatchObject({ external_id: 'g1', direction: 'in', counterpart: 'priya@x.in', subject: 'Hi' })
  })

  it('throws on a provider refusal', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('denied', { status: 403 })))
    await expect(fetchRecentMessages({ EMAIL_SYNC_PROVIDER: 'gmail', EMAIL_SYNC_TOKEN: 't', EMAIL_SYNC_MAILBOX: 'a@b.in' })).rejects.toThrow(/403/)
  })
})

describe('planEmailImport', () => {
  const msg = (external_id: string, counterpart: string): SyncedMessage => ({
    external_id,
    direction: 'in',
    subject: external_id,
    snippet: '',
    counterpart,
    at: '2026-10-01T10:00:00.000Z',
  })
  const leads = new Map([
    ['priya@x.in', { lead_id: 'L1', contact_id: 'C1' }],
    ['rahul@y.in', { lead_id: 'L2', contact_id: null }],
  ])
  const contacts = new Map([['meera@z.in', 'C3']])

  it('files a message under its lead, else its contact, and counts the rest', () => {
    const { batches, unmatched } = planEmailImport(
      [msg('m1', 'priya@x.in'), msg('m2', 'rahul@y.in'), msg('m3', 'meera@z.in'), msg('m4', 'nobody@q.in')],
      leads,
      contacts,
    )
    expect(unmatched).toBe(1)
    expect(batches.map((b) => b.map((r) => [r.external_id, r.lead_id, r.contact_id]))).toEqual([
      [
        ['m1', 'L1', 'C1'],
        ['m2', 'L2', null],
        ['m3', null, 'C3'],
      ],
    ])
  })

  it('never puts one lead twice in a batch, keeping the order', () => {
    const { batches } = planEmailImport(
      [msg('m1', 'priya@x.in'), msg('m2', 'meera@z.in'), msg('m3', 'priya@x.in'), msg('m4', 'rahul@y.in')],
      leads,
      contacts,
    )
    expect(batches.map((b) => b.map((r) => r.external_id))).toEqual([['m1', 'm2'], ['m3', 'm4']])
  })

  it('keeps a repeated message once', () => {
    const { batches, unmatched } = planEmailImport(
      [msg('m1', 'priya@x.in'), msg('m1', 'priya@x.in'), msg('m9', 'x@q.in'), msg('m9', 'x@q.in')],
      leads,
      contacts,
    )
    expect(batches.flat().map((r) => r.external_id)).toEqual(['m1'])
    expect(unmatched).toBe(2)
  })
})
