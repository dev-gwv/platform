import { describe, expect, it } from 'vitest'
import { designWriteRequest } from '@ipc/contracts'
import { cleanDesignWriting, designWriterMessages } from './design-writer'

describe('design writer', () => {
  it('asks for the part, the tone and the facts, and never to invent', () => {
    const msgs = designWriterMessages(designWriteRequest.parse({ kind: 'about', tone: 'premium', studio: 'Cine World', hint: 'known for candid' }))
    expect(msgs[0]!.content).toMatch(/Never invent prices/)
    expect(msgs[1]!.content).toMatch(/About Us/)
    expect(msgs[1]!.content).toMatch(/premium/)
    expect(msgs[1]!.content).toMatch(/Studio: Cine World/)
    expect(msgs[1]!.content).toMatch(/known for candid/)
  })

  it('keeps the lines it was given to improve', () => {
    const msgs = designWriterMessages(designWriteRequest.parse({ kind: 'deliverables', lines: ['Wedding film: 8-10 minutes', 'Album INR 25,000/-'] }))
    expect(msgs[1]!.content).toContain('- Album INR 25,000/-')
    expect(msgs[1]!.content).toMatch(/at most 12 lines/)
  })

  it('cleans a list: bullets, numbers, headings and markdown go', () => {
    const raw = 'Here are your deliverables:\n1. **400+ edited photos**\n- Cinematic film\n• Teaser\n\n'
    expect(cleanDesignWriting('deliverables', raw).lines).toEqual(['400+ edited photos', 'Cinematic film', 'Teaser'])
  })

  it('cleans a paragraph: quotes and thinking go', () => {
    expect(cleanDesignWriting('tagline', '<think>hmm</think>"Stories that live forever"').text).toBe('Stories that live forever')
  })

  it('caps a list at its size', () => {
    expect(cleanDesignWriting('addon', 'a\nb\nc\nd\ne\nf').lines).toHaveLength(4)
  })
})
