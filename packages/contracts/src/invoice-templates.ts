import { z } from 'zod'
import { uuid, isoDateTime } from './shared/primitives'

const layoutJsonDefaults = {
  show_header: true,
  show_footer: true,
  show_gst: true,
  show_bank_details: false,
  header_text: null as string | null,
  footer_text: null as string | null,
  bank_details: null as string | null,
  terms_and_conditions: null as string | null,
  design: 'classic' as InvoiceDesign,
  accent: '#4f46e5',
  show_logo: true,
  signatory_name: null as string | null,
  signatory_title: null as string | null,
  signature_image: null as string | null,
}

/**
 * Who signs the invoice (owner, 26 Oct: it could only be changed by asking us):
 * a name, a title and a drawn or uploaded signature, a small PNG/JPEG data URL.
 */
const signatureImage = z
  .string()
  .max(300_000, 'Keep the signature image small (under 200 KB).')
  .regex(/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/, 'Use a PNG or JPG image.')

/**
 * How a printed invoice looks. Each design is a whole page style -- header,
 * table and totals -- painted in the studio's accent colour, so a studio can
 * pick a look without learning a layout editor.
 */
export const INVOICE_DESIGNS = ['classic', 'modern', 'minimal', 'bold', 'elegant'] as const
export const invoiceDesign = z.enum(INVOICE_DESIGNS)
export type InvoiceDesign = z.infer<typeof invoiceDesign>
const hexColour = z.string().regex(/^#[0-9a-fA-F]{6}$/)

export const invoiceTemplateLayout = z.object({
  show_header: z.boolean().default(true),
  show_footer: z.boolean().default(true),
  show_gst: z.boolean().default(true),
  show_bank_details: z.boolean().default(false),
  header_text: z.string().nullable().default(null),
  footer_text: z.string().nullable().default(null),
  bank_details: z.string().nullable().default(null),
  terms_and_conditions: z.string().nullable().default(null),
  design: invoiceDesign.catch('classic').default('classic'),
  accent: hexColour.catch('#4f46e5').default('#4f46e5'),
  show_logo: z.boolean().default(true),
  signatory_name: z.string().nullable().catch(null).default(null),
  signatory_title: z.string().nullable().catch(null).default(null),
  signature_image: z.string().nullable().catch(null).default(null),
})
export type InvoiceTemplateLayout = z.infer<typeof invoiceTemplateLayout>

export const invoiceTemplate = z.object({
  id: uuid,
  company_id: uuid,
  name: z.string(),
  layout_json: invoiceTemplateLayout.default(layoutJsonDefaults),
  is_default: z.boolean().default(false),
  created_at: isoDateTime,
})
export type InvoiceTemplate = z.infer<typeof invoiceTemplate>

export const invoiceTemplateList = z.object({
  items: z.array(invoiceTemplate),
})
export type InvoiceTemplateList = z.infer<typeof invoiceTemplateList>

export const createInvoiceTemplateRequest = z.object({
  name: z.string().trim().min(2).max(160),
  layout_json: z.object({
    show_header: z.boolean().default(true),
    show_footer: z.boolean().default(true),
    show_gst: z.boolean().default(true),
    show_bank_details: z.boolean().default(false),
    header_text: z.string().trim().max(500).nullish(),
    footer_text: z.string().trim().max(500).nullish(),
    bank_details: z.string().trim().max(500).nullish(),
    terms_and_conditions: z.string().trim().max(1000).nullish(),
    design: invoiceDesign.default('classic'),
    accent: hexColour.default('#4f46e5'),
    show_logo: z.boolean().default(true),
    signatory_name: z.string().trim().max(80).nullish(),
    signatory_title: z.string().trim().max(60).nullish(),
    signature_image: signatureImage.nullish(),
  }).default(layoutJsonDefaults),
  is_default: z.boolean().default(false),
})
export type CreateInvoiceTemplateRequest = z.infer<typeof createInvoiceTemplateRequest>

/** Set who signs every invoice, from the invoice itself (PUT /billing/signature). */
export const invoiceSignatureRequest = z.object({
  signatory_name: z.string().trim().max(80).nullable(),
  signatory_title: z.string().trim().max(60).nullable(),
  signature_image: signatureImage.nullable(),
})
export type InvoiceSignatureRequest = z.infer<typeof invoiceSignatureRequest>

/**
 * A reusable Notes snippet -- independent of layoutJsonDefaults' print-layout
 * templates above. A studio picks one to fill an invoice's free-text Notes
 * field without leaving the form, the same way a saved payment mode or
 * expense category works.
 */
export const invoiceNoteTemplate = z.object({
  id: uuid,
  company_id: uuid,
  title: z.string(),
  content: z.string(),
  /** 'note' fills the invoice Notes field; 'terms' fills Terms & conditions. Legacy rows read as 'note'. */
  template_type: z.enum(['terms', 'note']).default('note'),
  is_default: z.boolean(),
  created_at: isoDateTime,
})
export type InvoiceNoteTemplate = z.infer<typeof invoiceNoteTemplate>

export const invoiceNoteTemplateList = z.object({
  items: z.array(invoiceNoteTemplate),
})
export type InvoiceNoteTemplateList = z.infer<typeof invoiceNoteTemplateList>

export const createInvoiceNoteTemplateRequest = z.object({
  title: z.string().trim().min(1).max(160),
  content: z.string().trim().min(1).max(2000),
  template_type: z.enum(['terms', 'note']).default('note'),
  is_default: z.boolean().default(false),
})
export type CreateInvoiceNoteTemplateRequest = z.infer<typeof createInvoiceNoteTemplateRequest>
