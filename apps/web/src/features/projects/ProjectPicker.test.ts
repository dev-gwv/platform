import { describe, expect, it } from 'vitest'
import { pickedName } from './ProjectPicker'

describe('pickedName', () => {
  const loaded = [{ id: 'p1', name: 'Priya & Rahul Wedding' }]

  it('shows nothing when no project is chosen', () => {
    expect(pickedName('', 'Ignored', loaded)).toBeNull()
  })

  it('uses the name the caller already has first', () => {
    expect(pickedName('p1', 'From the row', loaded)).toBe('From the row')
  })

  it('falls back to a match in what was loaded', () => {
    expect(pickedName('p1', null, loaded)).toBe('Priya & Rahul Wedding')
  })

  it('says it does not know, so the project itself is read', () => {
    expect(pickedName('p9', undefined, loaded)).toBeNull()
  })
})
