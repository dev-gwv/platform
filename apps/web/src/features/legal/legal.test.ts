import { describe, expect, it } from 'vitest'
import { LEGAL, LEGAL_LINKS } from './legal'
import legalPages from '../../routes/legal.tsx?raw'
import legalPage from './LegalPage.tsx?raw'
import landing from '../marketing/Landing.tsx?raw'
import indexHtml from '../../../index.html?raw'

/**
 * Meta's review reads the public pages. They must name the product Studio
 * AutoPilot and the company that runs it -- never the old trading name.
 */
describe('public pages name the product and the company', () => {
  it('runs Studio AutoPilot under Grateful World Ventures (OPC) Private Limited', () => {
    expect(LEGAL.appName).toBe('Studio AutoPilot')
    expect(LEGAL.operatorName).toBe('Grateful World Ventures (OPC) Private Limited')
  })

  it.each([
    ['legal pages', legalPages],
    ['legal shell', legalPage],
    ['landing page', landing],
    ['index.html', indexHtml],
    ['legal settings', JSON.stringify(LEGAL)],
  ])('%s never says "IPC Studios"', (_name, text) => {
    expect(text).not.toMatch(/IPC Studios/i)
  })

  it('links every policy page from the landing page footer', () => {
    expect(landing).toContain('LegalLinks')
    expect(LEGAL_LINKS.map((l) => l.to)).toEqual(
      expect.arrayContaining(['/privacy-policy', '/data-deletion', '/terms-and-conditions']),
    )
  })

  it("carries the company's registration details from its certificates", () => {
    expect(LEGAL.cin).toBe('U80301DL2022OPC401949')
    expect(LEGAL.gstin).toBe('07AAJCG9243K1Z5')
    expect(LEGAL.address.join(' ')).toContain('Shahdara, Delhi 110053')
    expect(landing).toContain('LEGAL.cin &&')
  })

  it('prints the address, phone and GSTIN only when they are filled in', () => {
    expect(landing).toContain('LEGAL.address.length > 0')
    expect(landing).toContain('LEGAL.gstin &&')
  })
})
