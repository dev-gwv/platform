import { describe, expect, it } from 'vitest'
import { issuedLink, issuedQuotation, quotationNumber, sendQuotationEmailRequest } from './client-docs'
import { projectDetail } from './projects'

const PROJECT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const QUOTE = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'

describe('quotationNumber', () => {
  it('joins the prefix and the project id with one dash', () => {
    expect(quotationNumber('Q-', PROJECT)).toBe('Q-AAAAAAAA')
    expect(quotationNumber('QT', PROJECT)).toBe('QT-AAAAAAAA')
  })

  it('falls back to Q when the studio has no prefix', () => {
    expect(quotationNumber(null, PROJECT)).toBe('Q-AAAAAAAA')
    expect(quotationNumber('  ', PROJECT)).toBe('Q-AAAAAAAA')
    expect(quotationNumber('-', PROJECT)).toBe('Q-AAAAAAAA')
  })
})

describe('issuing a quotation', () => {
  it('returns the quotation id with the link', () => {
    const r = issuedQuotation.parse({ id: QUOTE, link: 'https://x/quotation?token=t' })
    expect(r.id).toBe(QUOTE)
  })

  it('still reads as a plain link for older callers', () => {
    expect(issuedLink.parse({ id: QUOTE, link: 'https://x' })).toEqual({ link: 'https://x' })
  })
})

describe('emailing a quotation', () => {
  it('takes the studio subject and note, trimmed', () => {
    const r = sendQuotationEmailRequest.parse({ to_email: ' a@b.in ', subject: ' Hi ', message: ' Note ' })
    expect(r).toEqual({ to_email: 'a@b.in', subject: 'Hi', message: 'Note' })
  })

  it('still accepts the old body with only an address', () => {
    expect(sendQuotationEmailRequest.safeParse({}).success).toBe(true)
  })
})

describe('projectDetail acceptance', () => {
  const base = {
    id: PROJECT,
    name: 'Wedding',
    status: 'active',
    client_id: QUOTE,
    client_name: null,
    client_phone: null,
    package_cost: 1,
    additional_deliverables_cost: 0,
    total_cost: 1,
    show_quotation: true,
    created_at: '2026-01-01T00:00:00.000Z',
    deliverables: [],
    payments: [],
  }

  it('defaults to not accepted', () => {
    const r = projectDetail.safeParse(base)
    expect(r.success && r.data.quotation_accepted_at).toBeNull()
  })

  it('reads the latest acceptance', () => {
    const r = projectDetail.parse({
      ...base,
      quotation_accepted_at: '2026-02-01T10:00:00.000Z',
      quotation_accepted_by: 'Priya',
    })
    expect(r.quotation_accepted_by).toBe('Priya')
  })
})
