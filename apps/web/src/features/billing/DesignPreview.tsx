import { useQuery } from '@tanstack/react-query'
import { companyProfile, type InvoiceDetail } from '@ipc/contracts'
import { callApi } from '@/shared/api/client'
import { InvoicePaper, type LayoutOverride } from './InvoicePaper'

const today = new Date().toISOString().slice(0, 10)

/** A believable invoice to show a design on: the studio's own letterhead, a sample wedding client. */
const SAMPLE: InvoiceDetail = {
  id: '00000000-0000-4000-8000-000000000001',
  invoice_number: 'INV-0042',
  invoice_date: today,
  due_date: today,
  status: 'sent',
  gst_number: '09ABCDE1234F1Z5',
  subject: 'Wedding photography and films, 12–14 December',
  payment_terms: 'Net 15',
  place_of_supply: '09',
  intra_state: false,
  client_id: null,
  project_id: null,
  client_name: 'Asian Travel Paradise',
  client_gstin: null,
  client_address: 'Upper Ground Floor, Reliance Plaza\nNoida, Uttar Pradesh 201012',
  client_phone: null,
  client_email: null,
  project_name: null,
  notes: 'Thank you for trusting us with your day.',
  bank_details: null,
  terms: 'Balance payable before the album is delivered.',
  template_id: null,
  template_layout: null,
  subtotal: 165000,
  discount: 0,
  discount_type: 'flat',
  taxable: 165000,
  tax: 29700,
  total: 194700,
  amount_paid: 100000,
  balance_due: 94700,
  created_at: new Date().toISOString(),
  items: [
    { id: '00000000-0000-4000-8000-000000000011', description: 'Candid photography · 3 days', subtext: 'Two photographers, all events', quantity: 1, rate: 120000, amount: 120000, gst_rate: 18, cgst: 0, sgst: 0, igst: 21600, hsn_sac: '998387' },
    { id: '00000000-0000-4000-8000-000000000012', description: 'Wedding film', subtext: '4-minute teaser and full film', quantity: 1, rate: 45000, amount: 45000, gst_rate: 18, cgst: 0, sgst: 0, igst: 8100, hsn_sac: '998387' },
  ],
  attachments: [],
  payments: [],
}

/**
 * A design shown small, exactly as it prints: the real invoice sheet, scaled
 * down, so what the studio picks is what the client gets.
 */
export function DesignPreview({ layout, scale = 0.42 }: { layout: LayoutOverride; scale?: number }) {
  const { data: company } = useQuery({
    queryKey: ['settings', 'company'],
    queryFn: () => callApi('/settings/company', { responseSchema: companyProfile }),
    staleTime: 60_000,
  })
  const width = 820
  return (
    <div className="relative overflow-hidden rounded-md border border-border bg-slate-100" style={{ height: 560 * scale * 1.9 }} aria-hidden>
      <div className="pointer-events-none absolute left-1/2 top-3 origin-top" style={{ width, transform: `translateX(-50%) scale(${scale})` }}>
        <InvoicePaper
          invoice={SAMPLE}
          layoutOverride={layout}
          company={{
            name: company?.display_name ?? company?.name ?? 'Your Studio',
            legal_name: company?.legal_name ?? null,
            logo_url: company?.invoice_logo_url ?? company?.avatar_url ?? null,
            invoice_address: company?.invoice_address ?? null,
            invoice_phone: company?.invoice_phone ?? null,
            invoice_email: company?.invoice_email ?? null,
            invoice_gst_number: company?.invoice_gst_number ?? '07AAJCG9243K1Z5',
            city: company?.city ?? null,
            state: company?.state ?? null,
          }}
        />
      </div>
    </div>
  )
}
