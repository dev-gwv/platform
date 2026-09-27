import { z } from 'zod'
import { uuid, isoDate, isoDateTime } from './shared/primitives'

/**
 * Enquiry forms (0195): one QR per vendor the studio works with. A scan opens
 * a short form at /enquire/<code>; what is sent becomes a lead credited to
 * that QR. The vendor can be given a page of their own, /enquiry-view/<token>,
 * that lists what their QR brought in.
 */

// ── studio side ──────────────────────────────────────────────────
export const enquiryForm = z.object({
  id: uuid,
  name: z.string(),
  kind: z.string().nullable(),
  phone: z.string().nullable(),
  notes: z.string().nullable(),
  code: z.string(),
  source_id: uuid,
  show_phone: z.boolean(),
  is_active: z.boolean(),
  archived_at: isoDateTime.nullable(),
  created_at: isoDateTime,
  scans: z.number().int(),
  enquiries: z.number().int(),
  booked: z.number().int(),
  last_enquiry_at: isoDateTime.nullable(),
  page_views: z.number().int(),
  page_viewed_at: isoDateTime.nullable(),
  /** The public form, the one the QR opens. */
  form_url: z.string(),
  /** The vendor's page, or null while it is off. */
  page_url: z.string().nullable(),
})
export type EnquiryForm = z.infer<typeof enquiryForm>

const text = (max: number) => z.string().trim().max(max)

export const createEnquiryFormRequest = z.object({
  name: text(120).min(1, 'Give the form a name.'),
  kind: text(60).nullish(),
  phone: text(30).nullish(),
  notes: text(1000).nullish(),
})
export type CreateEnquiryFormRequest = z.input<typeof createEnquiryFormRequest>

export const updateEnquiryFormRequest = z
  .object({
    name: text(120).min(1),
    kind: text(60).nullable(),
    phone: text(30).nullable(),
    notes: text(1000).nullable(),
    show_phone: z.boolean(),
    is_active: z.boolean(),
    archived: z.boolean(),
  })
  .partial()
  .refine((v) => Object.values(v).some((x) => x !== undefined), 'Nothing to change.')
export type UpdateEnquiryFormRequest = z.infer<typeof updateEnquiryFormRequest>

export const enquiryFormPageRequest = z.object({ on: z.boolean() })

export const enquiryFormLead = z.object({
  id: uuid,
  name: z.string().nullable(),
  phone: z.string().nullable(),
  status: z.string(),
  event_type: z.string().nullable(),
  event_date: isoDate.nullable(),
  created_at: isoDateTime,
})
export type EnquiryFormLead = z.infer<typeof enquiryFormLead>

// ── public side ──────────────────────────────────────────────────
export const publicEnquiryForm = z.object({
  studio: z.string(),
  form_name: z.string(),
  is_open: z.boolean(),
})
export type PublicEnquiryForm = z.infer<typeof publicEnquiryForm>

export const enquiryEventTypes = ['Wedding', 'Pre-wedding', 'Engagement', 'Birthday', 'Maternity', 'Baby shoot', 'Corporate', 'Other'] as const

export const submitEnquiryRequest = z.object({
  name: text(120).min(2, 'Please tell us your name.'),
  phone: z
    .string()
    .trim()
    .refine((v) => v.replace(/\D/g, '').length >= 10 && v.replace(/\D/g, '').length <= 13, 'Please enter a valid mobile number.'),
  email: z.string().trim().email('Please check the email.').max(200).or(z.literal('')).nullish(),
  event_type: text(80).nullish(),
  event_date: isoDate.or(z.literal('')).nullish(),
  city: text(120).nullish(),
  message: text(2000).nullish(),
  /** Left empty by people; bots fill every field they see. */
  website: z.string().max(500).optional(),
})
export type SubmitEnquiryRequest = z.input<typeof submitEnquiryRequest>

export const enquiryViewLead = z.object({
  name: z.string().nullable(),
  phone: z.string().nullable(),
  enquired_on: isoDateTime,
  event_type: z.string().nullable(),
  event_date: isoDate.nullable(),
  status: z.enum(['New', 'In talks', 'Booked', 'Not booked']),
})

export const publicEnquiryView = z.object({
  studio: z.string(),
  form_name: z.string(),
  scans: z.number().int(),
  enquiries: z.number().int(),
  booked: z.number().int(),
  leads: z.array(enquiryViewLead),
})
export type PublicEnquiryView = z.infer<typeof publicEnquiryView>
