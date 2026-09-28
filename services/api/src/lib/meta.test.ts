import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  fetchMetaLead,
  isMetaLeadgenPayload,
  mapGraphLead,
  metaLeadgenIds,
  verifyMetaSignature,
  type MetaLeadgenPayload,
} from './meta'

const hmacHex = async (secret: string, body: string) => {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body))
  return Array.from(new Uint8Array(mac))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

describe('verifyMetaSignature', () => {
  it('accepts the sha256= header Meta sends and refuses anything else', async () => {
    const body = '{"object":"page","entry":[]}'
    const good = `sha256=${await hmacHex('app-secret', body)}`
    expect(await verifyMetaSignature(body, good, 'app-secret')).toBe(true)
    expect(await verifyMetaSignature(body, good, 'other-secret')).toBe(false)
    expect(await verifyMetaSignature(body + ' ', good, 'app-secret')).toBe(false)
    expect(await verifyMetaSignature(body, '', 'app-secret')).toBe(false)
    expect(await verifyMetaSignature(body, good, '')).toBe(false)
  })
})

describe('leadgen payload', () => {
  const payload: MetaLeadgenPayload = {
    object: 'page',
    entry: [
      {
        id: '123',
        changes: [
          { field: 'leadgen', value: { leadgen_id: 'L1', form_id: 'F1', page_id: '123', created_time: 1 } },
          { field: 'feed', value: {} },
          { field: 'leadgen', value: { leadgen_id: 'L2' } },
        ],
      },
    ],
  }

  it('recognises the shape and lists every leadgen id', () => {
    expect(isMetaLeadgenPayload(payload)).toBe(true)
    expect(isMetaLeadgenPayload({ phone: '9876543210' })).toBe(false)
    expect(metaLeadgenIds(payload).map((l) => l.leadgen_id)).toEqual(['L1', 'L2'])
    expect(metaLeadgenIds(payload)[0]!.meta).toMatchObject({ form_id: 'F1', page_id: '123' })
  })

  it('maps Graph field_data to name, phone, email and keeps the rest', () => {
    const lead = mapGraphLead({
      field_data: [
        { name: 'full_name', values: ['Aanya Sharma'] },
        { name: 'phone_number', values: ['+919876543210'] },
        { name: 'email', values: ['a@x.in'] },
        { name: 'event_date', values: ['2026-12-10'] },
      ],
    })
    expect(lead).toMatchObject({ name: 'Aanya Sharma', phone: '+919876543210', email: 'a@x.in' })
    expect(lead.fields.event_date).toBe('2026-12-10')
    expect(mapGraphLead({ field_data: [{ name: 'first_name', values: ['A'] }, { name: 'last_name', values: ['S'] }] }).name).toBe('A S')
  })
})

describe('fetchMetaLead', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('calls the Graph API with the page token and maps the answer', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      expect(url).toContain('/L1?')
      expect(url).toContain('access_token=page-token')
      return new Response(JSON.stringify({ id: 'L1', field_data: [{ name: 'phone_number', values: ['9876543210'] }] }), { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)
    const lead = await fetchMetaLead('page-token', 'L1')
    expect(lead.phone).toBe('9876543210')
  })

  it('throws on a non-2xx so the caller logs it', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 400 })))
    await expect(fetchMetaLead('t', 'L1')).rejects.toThrow(/400/)
  })
})
