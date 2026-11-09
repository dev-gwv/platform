import { describe, expect, it } from 'vitest'
import { designDoc, DESIGN_PAGE_KINDS } from '@ipc/contracts'
import { blankPage, TEMPLATES, templateFor } from './templates'
import { openedLine, sendText } from './SendDesignDialog'

describe('quotation designer, step 2', () => {
  it('makes a valid blank page of every kind', () => {
    const doc = { version: 1 as const, theme: templateFor('royal').theme, pages: DESIGN_PAGE_KINDS.map((k) => blankPage(k, 'Cine World')) }
    expect(designDoc.parse(doc).pages.map((p) => p.kind)).toEqual([...DESIGN_PAGE_KINDS])
  })

  it('has six looks, each with a unique key', () => {
    expect(TEMPLATES.map((t) => t.key)).toEqual(['ivory', 'midnight', 'blush', 'sage', 'royal', 'mono'])
  })

  it('offers three packages, the middle one to raise', () => {
    expect(blankPage('packages').data.packages.map((p) => p.name)).toEqual(['Silver', 'Gold', 'Platinum'])
  })

  it('says whether the client opened it', () => {
    expect(openedLine(0, null)).toBe('Not opened yet')
    expect(openedLine(1, '2026-11-02T13:10:00Z')).toBe('Opened once · last 2 Nov, 6:40 pm')
    expect(openedLine(3, '2026-11-02T13:10:00Z')).toMatch(/^Opened 3 times · last 2 Nov/)
  })

  it('writes the WhatsApp words with the link', () => {
    expect(sendText('https://x/d/abc', 'Akshay & Riya', 'Cine World', 'Wedding quotation')).toBe(
      'Hi Akshay & Riya, here is your quotation from Cine World: Wedding quotation\nhttps://x/d/abc',
    )
    expect(sendText('https://x/d/abc', '', '', 'Q')).toBe('Hi, here is your quotation: Q\nhttps://x/d/abc')
  })
})
