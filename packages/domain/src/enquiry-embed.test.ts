import { describe, expect, it } from 'vitest'
import { enquiryEmbedCode } from './enquiry-embed'

describe('enquiryEmbedCode', () => {
  it('frames the embed version of the form and listens to that origin only', () => {
    const code = enquiryEmbedCode('https://app.studioautopilot.in/enquire/abc2345')
    expect(code).toContain('src="https://app.studioautopilot.in/enquire/abc2345?embed=1"')
    expect(code).toContain('e.origin!=="https://app.studioautopilot.in"')
    expect(code).toContain('title="Enquiry form"')
  })
})
