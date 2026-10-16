import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const { classify, isAppOrigin, deepLinkTarget } = require('../src/links.cjs') as {
  classify: (raw: string, origin: string) => 'app' | 'sign-in' | 'blank' | 'external' | 'blocked'
  isAppOrigin: (raw: string, origin: string) => boolean
  deepLinkTarget: (raw: string, origin: string) => string | null
}

const SITE = 'https://studioautopilot.in'

describe('where a link opens in the desktop app', () => {
  it('keeps our own pages in the app', () => {
    expect(classify('https://studioautopilot.in/leads?view=list', SITE)).toBe('app')
    expect(classify('https://studioautopilot.in/p/abc123', SITE)).toBe('app')
    expect(classify('blob:https://studioautopilot.in/5f1c-4e', SITE)).toBe('app')
  })

  it('sends the API, other subdomains and other sites to the browser', () => {
    // A file on the API (a logo, a receipt) is not the app.
    expect(classify('https://api.studioautopilot.in/public/files/1', SITE)).toBe('external')
    expect(classify('http://studioautopilot.in/leads', SITE)).toBe('external')
    expect(classify('https://studioautopilot.in.evil.com/', SITE)).toBe('external')
    expect(classify('https://gallery.frameline.app/e/42', SITE)).toBe('external')
    expect(classify('https://maps.google.com/?q=Jaipur', SITE)).toBe('external')
  })

  it('sends WhatsApp, mail, the dialler and UPI to the phone or computer', () => {
    expect(classify('https://wa.me/919999999999?text=Hi', SITE)).toBe('external')
    expect(classify('whatsapp://send?phone=919999999999', SITE)).toBe('external')
    expect(classify('mailto:client@example.com?subject=Invoice', SITE)).toBe('external')
    expect(classify('tel:+919999999999', SITE)).toBe('external')
    expect(classify('upi://pay?pa=studio@okaxis', SITE)).toBe('external')
  })

  it('keeps Facebook and Google sign-in inside the app', () => {
    expect(classify('https://www.facebook.com/v19.0/dialog/oauth?client_id=1', SITE)).toBe('sign-in')
    expect(classify('https://accounts.google.com/gsi/select?client_id=1', SITE)).toBe('sign-in')
    expect(classify('https://checkout.razorpay.com/v1/checkout.js', SITE)).toBe('sign-in')
    // Only over https.
    expect(classify('http://www.facebook.com/dialog/oauth', SITE)).toBe('external')
  })

  it('waits on an empty tab and refuses what a page should never open', () => {
    expect(classify('', SITE)).toBe('blank')
    expect(classify('about:blank', SITE)).toBe('blank')
    expect(classify('file:///etc/passwd', SITE)).toBe('blocked')
    expect(classify('javascript:alert(1)', SITE)).toBe('blocked')
    expect(classify('data:text/html,<h1>x</h1>', SITE)).toBe('blocked')
    expect(classify('blob:https://evil.example/5f1c', SITE)).toBe('blocked')
    expect(classify('not a url', SITE)).toBe('blocked')
  })

  it('treats a local test build as the app', () => {
    expect(classify('http://localhost:5199/dashboard', 'http://localhost:5199')).toBe('app')
    expect(isAppOrigin('http://localhost:5199/help', 'http://localhost:5199')).toBe(true)
    expect(isAppOrigin('https://example.com', 'http://localhost:5199')).toBe(false)
  })
})

describe('studioautopilot:// links', () => {
  it('open a page of our site', () => {
    expect(deepLinkTarget('studioautopilot://open/leads?view=list', SITE)).toBe('https://studioautopilot.in/leads?view=list')
    expect(deepLinkTarget('studioautopilot://projects/42', SITE)).toBe('https://studioautopilot.in/projects/42')
    expect(deepLinkTarget('studioautopilot://open', SITE)).toBe('https://studioautopilot.in/')
  })

  it('never lead anywhere else', () => {
    expect(deepLinkTarget('https://studioautopilot.in/leads', SITE)).toBeNull()
    expect(deepLinkTarget('studioautopilot://open//evil.com/x', SITE)).not.toMatch(/^https:\/\/evil\.com/)
    expect(deepLinkTarget('nonsense', SITE)).toBeNull()
  })
})
