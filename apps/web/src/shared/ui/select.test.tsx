import { describe, expect, it } from 'vitest'
import { itemsFrom } from './select'

describe('Select options', () => {
  it('keeps the options inside an <optgroup>, under its label', () => {
    const items = itemsFrom(
      <>
        <option value="">Not recorded</option>
        <optgroup label="Team">
          <option value="u1">Nitin</option>
          <option value="u2">Pulkit</option>
        </optgroup>
        <optgroup label="Outside helpers">
          <option value="p:1">Aman</option>
        </optgroup>
        <option value="__other">+ New helper…</option>
      </>,
    )
    expect(items.map((i) => [i.value, i.group ?? null])).toEqual([
      ['', null],
      ['u1', 'Team'],
      ['u2', 'Team'],
      ['p:1', 'Outside helpers'],
      ['__other', null],
    ])
  })
})
