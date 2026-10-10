import { describe, expect, it } from 'vitest'
import { tidy, toBlocks } from './rich-text'

describe("the assistant's answer, drawn", () => {
  it('drops internal page addresses but keeps ordinary brackets', () => {
    expect(tidy('Open **Team → People** in the menu (screen/employees).')).toBe('Open **Team → People** in the menu.')
    expect(tidy('Go to Leads (/leads) and press Add.')).toBe('Go to Leads and press Add.')
    expect(tidy('Enter their mobile/email (optional).')).toBe('Enter their mobile/email (optional).')
  })

  it('reads numbered steps, bullets and paragraphs', () => {
    const blocks = toBlocks('Do this:\n1. Open Team\n2. Press **Add**\n\n- one\n- two\nDone.')
    expect(blocks.map((b) => [b.kind, b.lines.length])).toEqual([
      ['p', 1],
      ['ol', 2],
      ['ul', 2],
      ['p', 1],
    ])
    expect(blocks[1]!.lines[1]).toBe('Press **Add**')
  })
})

describe('a link the model wrote', () => {
  it('keeps an internal target instead of leaving naked brackets', () => {
    // tidy() stripped "(/employees)" before inline() ever saw it, so a perfectly
    // good Markdown link degraded to the literal text "[Team → People]" and the
    // internal-Link branch was unreachable for every path.
    expect(tidy('Open [Team → People](/employees) to add someone.')).toBe(
      'Open [Team → People](/employees) to add someone.',
    )
  })

  it('still drops a bare address said in passing', () => {
    expect(tidy('Open Team → People (screen/employees) to add someone.')).toBe(
      'Open Team → People to add someone.',
    )
    expect(tidy('Go to Leads (/follow-ups) first.')).toBe('Go to Leads first.')
  })
})

describe('headings the prompt taught it to write', () => {
  it('draws them instead of printing hashes', () => {
    // The corpus hands the model "### Title" headings, so it writes them back.
    const blocks = toBlocks('### Steps\n1. Open Team\n2. Press Add')
    expect(blocks[0]).toEqual({ kind: 'h', lines: ['Steps'] })
    expect(blocks[1]!.kind).toBe('ol')
  })

  it('never merges two headings into one', () => {
    const blocks = toBlocks('## One\n## Two')
    expect(blocks).toHaveLength(2)
  })
})
