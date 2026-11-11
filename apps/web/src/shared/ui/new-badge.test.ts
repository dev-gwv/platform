import { describe, expect, it } from 'vitest'
import { isNew, newFor, NEW_UNTIL, PHOTO_SHARING_VISITS, photoSharingUsed } from './new-badge'

describe('"New" for a week', () => {
  it('shows through its last day (India date) and goes by itself after', () => {
    expect(isNew('galleryDrive', '2026-10-31')).toBe(true)
    expect(isNew('galleryDrive', NEW_UNTIL.galleryDrive)).toBe(true)
    expect(isNew('galleryDrive', '2026-11-08')).toBe(false)
    expect(isNew(undefined, '2026-10-31')).toBe(false)
  })

  it('keeps a gallery feature new until the studio makes its first gallery, whatever the date', () => {
    expect(newFor('galleryDrive', false, '2027-06-01')).toBe(true)
    // Unknown (still loading, or not someone who can list galleries): no pill.
    expect(newFor('galleryDrive', null, '2026-11-01')).toBe(false)
    expect(newFor(undefined, false)).toBe(false)
  })
})

describe('Photo sharing reads "New" for each person until they use it (owner, 11 Nov)', () => {
  it('shows whatever the date or the studio\'s galleries, until this person has used it', () => {
    expect(newFor('galleryApp', true, '2027-06-01', false)).toBe(true)
    expect(newFor('galleryApp', false, '2026-11-01', true)).toBe(false)
    // The studio rule stays for Google Drive.
    expect(newFor('galleryDrive', true, '2027-06-01', false)).toBe(false)
  })

  it('counts as used once closed or after enough visits; unknown reads as used so nothing flashes', () => {
    expect(photoSharingUsed(undefined, false)).toBe(true)
    expect(photoSharingUsed(undefined, true)).toBe(false)
    expect(photoSharingUsed({ shown: 2, closed: false }, true)).toBe(false)
    expect(photoSharingUsed({ shown: PHOTO_SHARING_VISITS, closed: false }, true)).toBe(true)
    expect(photoSharingUsed({ shown: 0, closed: true }, true)).toBe(true)
  })
})
