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
