import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Hide amounts covers every rupee on the studio's own screens, so those
 * screens format through `useINR()` / `<Money>` / `screenINR`, never a raw
 * `formatINR(`.
 *
 * The rule's other half: documents (quotation, invoice, receipt, payslip,
 * terms and their editors), public pages and the messages sent to clients
 * never mask -- a client must always see the real figure. Those files keep
 * `formatINR` and are listed here by name. Platform admin pages are the
 * platform's, not a studio's, and keep it too.
 *
 * Add a file here only if it is one of those; anything else uses `useINR()`.
 */
const ALLOWED = new Set([
  'shared/ui/format.ts',
  'shared/money/hide.ts',
  // Documents and the messages that carry them to the client.
  'features/billing/InvoicePaper.tsx',
  'features/billing/ReceiptPaper.tsx',
  'features/billing/InvoiceEditor.tsx',
  'features/billing/SendReceiptDialog.tsx',
  'features/billing/share.ts',
  'features/billing/receiptShare.ts',
  'features/payroll/PayslipPaper.tsx',
  'features/projects/QuotationDocument.tsx',
  'features/terms/TermsComposer.tsx',
  'features/crm/QuoteViewer.tsx',
  'features/crm/QuotePaper.tsx',
  'routes/projects/$id.quotation.tsx',
  'features/projects/tabs/BillingTab.tsx',
  'routes/billing/payments.tsx',
  'features/crm/QuoteBuilder.tsx',
  // Public pages and the document pages themselves.
  'routes/quote-accept.tsx',
  'routes/client-portal.tsx',
  'routes/public-invoice.tsx',
  'routes/receipt.tsx',
  'routes/quotation.tsx',
  'routes/invoice-detail.tsx',
  'routes/billing/payment-receipt.tsx',
  'routes/subscription.tsx',
  // Studio AutoPilot's own prices, never a studio's money.
  'features/billing/PlanPicker.tsx',
  'features/platform/plan-rows.ts',
  'routes/refer.tsx',
])

const allowed = (rel: string) =>
  ALLOWED.has(rel) || rel.startsWith('routes/platform/') || /\.test\.tsx?$/.test(rel)

describe('hide amounts', () => {
  it('no studio screen formats rupees with a raw formatINR', () => {
    const walk = (dir: string): string[] =>
      readdirSync(dir).flatMap((f) => {
        const p = join(dir, f)
        return statSync(p).isDirectory() ? walk(p) : /\.tsx?$/.test(f) ? [p] : []
      })
    const root = join(__dirname, '..', '..')
    const hits = walk(root)
      .map((p) => ({ p, rel: relative(root, p).split(sep).join('/') }))
      .filter(({ rel }) => !allowed(rel))
      .filter(({ p }) => /\bformatINR\(/.test(readFileSync(p, 'utf8')))
      .map(({ rel }) => rel)
    expect(hits).toEqual([])
  })
})
