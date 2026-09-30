import { describe, expect, it } from 'vitest'
import { isCloudflare, resolveClientIp } from './client-ip'

const h = (m: Record<string, string>) => ({ get: (k: string) => m[Object.keys(m).find((x) => x.toLowerCase() === k.toLowerCase()) ?? ''] ?? null })

describe('client address behind Cloudflare', () => {
  it('uses CF-Connecting-IP when the request really came from Cloudflare', () => {
    expect(resolveClientIp(h({ 'X-Forwarded-For': '104.23.1.9', 'CF-Connecting-IP': '49.36.10.2' }), undefined)).toBe('49.36.10.2')
    expect(resolveClientIp(h({ 'X-Forwarded-For': '2a06:98c1::5', 'CF-Connecting-IP': '49.36.10.2' }), undefined)).toBe('49.36.10.2')
  })

  it('ignores a forged CF-Connecting-IP from anyone else', () => {
    expect(resolveClientIp(h({ 'X-Forwarded-For': '1.2.3.4, 5.6.7.8', 'CF-Connecting-IP': '9.9.9.9' }), undefined)).toBe('5.6.7.8')
  })

  it('behaves as before without Cloudflare', () => {
    expect(resolveClientIp(h({ 'X-Forwarded-For': '5.6.7.8' }), undefined)).toBe('5.6.7.8')
    expect(resolveClientIp(h({}), undefined)).toBe('unknown')
  })

  it('knows Cloudflare addresses', () => {
    expect(isCloudflare('172.70.1.1')).toBe(true)
    expect(isCloudflare('::ffff:162.158.3.4')).toBe(true)
    expect(isCloudflare('2606:4700:3030::6815:1dc7')).toBe(true)
    expect(isCloudflare('72.61.239.209')).toBe(false)
    expect(isCloudflare('2a02:4780:12:640::1')).toBe(false)
    expect(isCloudflare('not-an-ip')).toBe(false)
  })
})
