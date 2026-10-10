import { describe, expect, it } from 'vitest'
import type { ReceivedPayment } from '@ipc/contracts'
import {
  blankPaymentForm,
  checkPaymentForm,
  formFromReceived,
  invoiceChoices,
  ledgerCreateBody,
  ledgerPatchBody,
  moreLabel,
  paymentQuestions,
} from './payment-form'

const TODAY = '2026-10-10'
const P = '11111111-1111-4111-8111-111111111111'
const P2 = '22222222-2222-4222-8222-222222222222'
const C = '33333333-3333-4333-8333-333333333333'
const I = '44444444-4444-4444-8444-444444444444'

const row: ReceivedPayment = {
  id: '55555555-5555-4555-8555-555555555555',
  project_id: P,
  project_name: 'Mehta Wedding',
  invoice_id: null,
  invoice_number: null,
  client_id: C,
  client_name: 'Priya Mehta',
  client_phone: null,
  client_email: null,
  amount: 40000,
  description: 'Advance',
  status: 'pending',
  is_gst: true,
  gst_number: '27ABCDE1234F1Z5',
  date_received: '2026-09-30',
  file_url: 'https://example.com/r.pdf',
  receipt_number: null,
  mode: 'Cash',
  reference: 'UTR123',
  created_at: '2026-09-30T10:00:00.000Z',
}

describe('formFromReceived', () => {
  it('fills every question from a Payments list row', () => {
    expect(formFromReceived(row, TODAY)).toEqual({
      clientId: C,
      projectId: P,
      invoiceId: '',
      amount: '40000',
      paidOn: '2026-09-30',
      mode: 'Cash',
      received: false,
      reference: 'UTR123',
      description: 'Advance',
      isGst: true,
      gstNumber: '27ABCDE1234F1Z5',
      fileUrl: 'https://example.com/r.pdf',
    })
  })
  it('falls back to today and blanks for what the row lacks', () => {
    const f = formFromReceived({ ...row, project_id: null, client_id: null, date_received: null, mode: null, status: 'paid', file_url: null }, TODAY)
    expect(f).toMatchObject({ projectId: '', clientId: '', paidOn: TODAY, mode: '', received: true, fileUrl: '' })
  })
})

describe('checkPaymentForm', () => {
  const ok = blankPaymentForm(TODAY, { amount: '5000', projectId: P })
  it('passes a filled form', () => {
    expect(checkPaymentForm(ok, { needsLink: true })).toBeNull()
  })
  it('wants an amount above zero', () => {
    expect(checkPaymentForm({ ...ok, amount: '0' }, { needsLink: true })).toBe('Enter the amount.')
  })
  it('wants a project or an invoice only when started from nothing', () => {
    const loose = { ...ok, projectId: '' }
    expect(checkPaymentForm(loose, { needsLink: true })).toMatch(/project or the invoice/)
    expect(checkPaymentForm({ ...loose, invoiceId: I }, { needsLink: true })).toBeNull()
    expect(checkPaymentForm(loose, { needsLink: false })).toBeNull()
  })
  it('refuses a GST tick without a real number', () => {
    expect(checkPaymentForm({ ...ok, isGst: true, gstNumber: '12' }, { needsLink: true })).toMatch(/GST/)
  })
})

describe('ledger bodies', () => {
  it('creates against an invoice with no project (0145)', () => {
    const body = ledgerCreateBody(blankPaymentForm(TODAY, { clientId: C, invoiceId: I, amount: '1200', description: '  ' }))
    expect(body).toEqual({
      invoice_id: I,
      client_id: C,
      amount: 1200,
      description: null,
      status: 'paid',
      is_gst: false,
      gst_number: null,
      date_received: TODAY,
      file_url: null,
      mode: 'UPI',
    })
    expect(body).not.toHaveProperty('project_id')
  })
  it('sends a promise as pending', () => {
    expect(ledgerCreateBody(blankPaymentForm(TODAY, { projectId: P, amount: '1', received: false })).status).toBe('pending')
  })
  it('patches without unlinking the project or the client', () => {
    const same = ledgerPatchBody(formFromReceived(row, TODAY), row)
    expect(same).not.toHaveProperty('project_id')
    expect(same).not.toHaveProperty('client_id')
    expect(same).toMatchObject({ amount: 40000, status: 'pending', gst_number: '27ABCDE1234F1Z5', file_url: 'https://example.com/r.pdf' })
    const moved = ledgerPatchBody({ ...formFromReceived(row, TODAY), projectId: P2 }, row)
    expect(moved.project_id).toBe(P2)
  })
  it('drops the GST number once GST is unticked', () => {
    expect(ledgerPatchBody({ ...formFromReceived(row, TODAY), isGst: false }, row).gst_number).toBeNull()
  })
})

describe('paymentQuestions', () => {
  it('asks only what each save path keeps', () => {
    expect(paymentQuestions('pick')).toEqual({ place: true, status: true, invoice: true, reference: false, gst: true, receiptLink: true })
    expect(paymentQuestions('project')).toEqual({ place: false, status: true, invoice: true, reference: true, gst: true, receiptLink: false })
    expect(paymentQuestions('invoice')).toEqual({ place: false, status: false, invoice: false, reference: true, gst: false, receiptLink: false })
  })
  it('names them on the More link', () => {
    expect(moreLabel(paymentQuestions('pick'))).toBe('+ Note, GST or receipt link')
    expect(moreLabel(paymentQuestions('project'))).toBe('+ Reference, note or GST')
    expect(moreLabel(paymentQuestions('invoice'))).toBe('+ Reference or note')
  })
})

describe('invoiceChoices', () => {
  const inv = (id: string, over: Partial<{ status: string; balance_due: number; project_id: string | null }> = {}) => ({
    id,
    invoice_number: id,
    balance_due: 100,
    status: 'sent',
    project_id: P,
    ...over,
  })
  const rows = [
    inv('a'),
    inv('b', { project_id: P2 }),
    inv('c', { project_id: null }),
    inv('paid', { balance_due: 0 }),
    inv('draft', { status: 'draft' }),
    inv('gone', { status: 'cancelled' }),
  ]
  it('offers what is still owed, not drafts or cancelled ones', () => {
    expect(invoiceChoices(rows, '', '').map((i) => i.id)).toEqual(['a', 'b', 'c'])
  })
  it('narrows to the picked project', () => {
    expect(invoiceChoices(rows, P, '').map((i) => i.id)).toEqual(['a'])
  })
  it('keeps the invoice already chosen', () => {
    expect(invoiceChoices(rows, P, 'paid').map((i) => i.id)).toEqual(['a', 'paid'])
  })
})
