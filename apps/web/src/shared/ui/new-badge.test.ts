import { describe, expect, it } from 'vitest'
import { isNew, NEW_UNTIL } from './new-badge'

describe('"New" for a week', () => {
  it('shows through its last day (India date) and goes by itself after', () => {
    expect(isNew('galleryDrive', '2026-10-31')).toBe(true)
    expect(isNew('galleryDrive', NEW_UNTIL.galleryDrive)).toBe(true)
    expect(isNew('galleryDrive', '2026-11-08')).toBe(false)
    expect(isNew(undefined, '2026-10-31')).toBe(false)
  })
})
