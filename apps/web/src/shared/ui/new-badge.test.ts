import { describe, expect, it } from 'vitest'
import { isNew, newFor, NEW_UNTIL } from './new-badge'

describe('"New" for a week', () => {
  it('shows through its last day (India date) and goes by itself after', () => {
    expect(isNew('galleryDrive', '2026-10-31')).toBe(true)
    expect(isNew('galleryDrive', NEW_UNTIL.galleryDrive)).toBe(true)
    expect(isNew('galleryDrive', '2026-11-08')).toBe(false)
    expect(isNew(undefined, '2026-10-31')).toBe(false)
  })

  it('keeps a gallery feature new until the studio makes its first gallery, whatever the date', () => {
    expect(newFor('galleryDrive', false, '2027-06-01')).toBe(true)
    expect(newFor('galleryApp', true, '2026-11-01')).toBe(false)
    // Unknown (still loading, or not someone who can list galleries): no pill.
    expect(newFor('galleryDrive', null, '2026-11-01')).toBe(false)
    expect(newFor(undefined, false)).toBe(false)
  })
})
