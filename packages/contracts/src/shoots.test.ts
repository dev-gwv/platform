import { describe, expect, it } from 'vitest'
import { createShootRequest, updateShootRequest } from './shoots'

const PROJECT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'

/**
 * A map link is whatever the studio pasted -- a short link, a plus code, a
 * venue name shared from WhatsApp. Insisting on a URL here answered those
 * with a 422 and the Create Project wizard dropped the shoot silently.
 */
describe.each([
  [
    'createShootRequest',
    (body: object) =>
      createShootRequest.safeParse({ project_id: PROJECT, name: 'Mehendi', ...body }),
  ],
  ['updateShootRequest', (body: object) => updateShootRequest.safeParse(body)],
])('%s map_link', (_name, parse) => {
  it('stores plain text, trimmed', () => {
    const r = parse({ map_link: '  Taj Palace, Jaipur (shared from WhatsApp)  ' })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.map_link).toBe('Taj Palace, Jaipur (shared from WhatsApp)')
  })

  it('still accepts a real link', () => {
    const r = parse({ map_link: 'https://maps.app.goo.gl/abc' })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.map_link).toBe('https://maps.app.goo.gl/abc')
  })

  it('treats an empty or blank string as clearing it', () => {
    for (const blank of ['', '   ']) {
      const r = parse({ map_link: blank })
      expect(r.success).toBe(true)
      if (r.success) expect(r.data.map_link).toBeNull()
    }
  })

  it('leaves it undefined when it is left out', () => {
    const r = parse({})
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.map_link).toBeUndefined()
  })

  it('rejects more than 500 characters', () => {
    expect(parse({ map_link: 'x'.repeat(501) }).success).toBe(false)
    expect(parse({ map_link: 'x'.repeat(500) }).success).toBe(true)
  })
})
