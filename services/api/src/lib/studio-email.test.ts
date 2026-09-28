import { describe, expect, it } from 'vitest'
import { studioFooter, studioFrom, type StudioBrand } from './email'

const brand = (over: Partial<StudioBrand> = {}): StudioBrand => ({
  name: 'Asha Studio',
  logoUrl: null,
  replyTo: 'hello@asha.in',
  fromName: null,
  footerLine: null,
  whiteLabel: false,
  ...over,
})

describe('a studio’s email', () => {
  it('comes from the studio via IPC Studios, or from the studio alone with white label', () => {
    expect(studioFrom('IPC Studios <noreply@ipc.in>', brand())).toBe('"Asha Studio via IPC Studios" <noreply@ipc.in>')
    expect(studioFrom('noreply@ipc.in', brand({ whiteLabel: true, fromName: 'Asha Films' }))).toBe('"Asha Films" <noreply@ipc.in>')
  })

  it('cannot smuggle a second address in through the name', () => {
    expect(studioFrom('noreply@ipc.in', brand({ whiteLabel: true, fromName: 'Evil" <x@y.z>\r\nBcc: a@b.c' }))).toBe('"Evil x@y.zBcc: a@b.c" <noreply@ipc.in>')
  })

  it('says IPC Studios in the footer only without white label', () => {
    expect(studioFooter(brand())).toBe('Sent for Asha Studio by IPC Studios.')
    expect(studioFooter(brand({ whiteLabel: true, footerLine: 'Asha · Jaipur' }))).toBe('Asha · Jaipur')
  })
})
