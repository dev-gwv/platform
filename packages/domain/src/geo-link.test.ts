import { describe, expect, it } from 'vitest'
import { coordsFromText, isMapsHost } from './geo-link'

describe('a pin from a pasted link', () => {
  it('prefers the place pin over the map centre', () => {
    expect(
      coordsFromText('https://www.google.com/maps/place/Studio/@19.0700,72.8700,17z/data=!3m1!4b1!4m6!3m5!1s0x0:0x0!8m2!3d19.0760!4d72.8777'),
    ).toEqual({ lat: 19.076, lng: 72.8777 })
  })

  it('reads the map centre, a search, a direction and a geo: link', () => {
    expect(coordsFromText('https://www.google.com/maps/@28.6139,77.2090,15z')).toEqual({ lat: 28.6139, lng: 77.209 })
    expect(coordsFromText('https://maps.google.com/?q=12.9716,77.5946')).toEqual({ lat: 12.9716, lng: 77.5946 })
    expect(coordsFromText('https://www.google.com/maps/search/?api=1&query=12.9716%2C77.5946')).toEqual({ lat: 12.9716, lng: 77.5946 })
    expect(coordsFromText('https://www.google.com/maps/dir/?api=1&destination=18.52,73.85')).toEqual({ lat: 18.52, lng: 73.85 })
    expect(coordsFromText('geo:22.5726,88.3639?z=16')).toEqual({ lat: 22.5726, lng: 88.3639 })
  })

  it('takes plain numbers too', () => {
    expect(coordsFromText(' 19.0760, 72.8777 ')).toEqual({ lat: 19.076, lng: 72.8777 })
  })

  it('says nothing for a link with no pin, or impossible numbers', () => {
    expect(coordsFromText('https://maps.app.goo.gl/AbCdEf123')).toBeNull()
    expect(coordsFromText('Bandra West, Mumbai')).toBeNull()
    expect(coordsFromText('120.5, 72.1')).toBeNull()
    expect(coordsFromText('0, 0')).toBeNull()
  })

  it('follows short links only on Google', () => {
    expect(isMapsHost('maps.app.goo.gl')).toBe(true)
    expect(isMapsHost('www.google.co.in')).toBe(true)
    expect(isMapsHost('google.com')).toBe(true)
    expect(isMapsHost('evil.example.com')).toBe(false)
    expect(isMapsHost('google.com.evil.io')).toBe(false)
  })
})
