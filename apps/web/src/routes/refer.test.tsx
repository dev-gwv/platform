import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { EndedReferral } from './refer'

/**
 * A referral link whose offer has ended (0316) still reaches the studio: its
 * name and logo, one plain sentence and a short form -- never the offer.
 */
describe('an ended referral link', () => {
  const html = (logo: string | null = null) =>
    renderToStaticMarkup(<EndedReferral slug="priya-abc123" studio={{ studio_name: 'Asha Studio', logo_url: logo, active: false }} />)

  it('names the studio and says the offer has ended, in plain words', () => {
    const page = html()
    expect(page).toContain('Asha Studio')
    expect(page).toContain('This offer has ended, but Asha Studio would still love to hear from you.')
    expect(page).not.toContain('does not open')
  })

  it('asks only for a name, a phone and an optional message', () => {
    const page = html()
    expect(page).toContain('Your name')
    expect(page).toContain('Your phone')
    expect(page).toContain('Message')
    expect(page.match(/<input/g)).toHaveLength(2)
    expect(page.match(/<textarea/g)).toHaveLength(1)
    expect(page).toContain('Send to Asha Studio')
  })

  it('shows no offer or reward', () => {
    const page = html().toLowerCase()
    for (const word of ['gift', 'offer:', 'reward', '₹', 'off your', 'valid till']) expect(page).not.toContain(word)
  })

  it("shows the studio's logo when it has one", () => {
    expect(html('https://cdn.example/logo.png')).toContain('src="https://cdn.example/logo.png"')
  })
})
