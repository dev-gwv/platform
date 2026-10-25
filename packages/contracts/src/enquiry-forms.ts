import { z } from 'zod'
import { uuid, isoDate, isoDateTime } from './shared/primitives'

/**
 * Enquiry forms (0195): one QR per vendor the studio works with. A scan opens
 * a short form at /enquire/<code>; what is sent becomes a lead credited to
 * that QR. The vendor can be given a page of their own, /enquiry-view/<token>,
 * that lists what their QR brought in.
 */

// ── what a form asks (0240) ──────────────────────────────────────
/** Name and phone are always asked. Each of these is off, optional or required. */
export const ENQUIRY_FIELD_KEYS = ['email', 'event_type', 'event_date', 'city', 'services', 'guests', 'budget', 'message'] as const
export type EnquiryFieldKey = (typeof ENQUIRY_FIELD_KEYS)[number]
export const enquiryFieldSetting = z.enum(['off', 'optional', 'required'])
export type EnquiryFieldSetting = z.infer<typeof enquiryFieldSetting>
// The defaults are a new form's (0274): email, event, date and "Anything else?".
export const enquiryFields = z.object({
  email: enquiryFieldSetting.default('optional'),
  event_type: enquiryFieldSetting.default('optional'),
  event_date: enquiryFieldSetting.default('optional'),
  city: enquiryFieldSetting.default('off'),
  services: enquiryFieldSetting.default('off'),
  guests: enquiryFieldSetting.default('off'),
  budget: enquiryFieldSetting.default('off'),
  message: enquiryFieldSetting.default('optional'),
})
export type EnquiryFields = z.infer<typeof enquiryFields>
export const enquiryPurpose = z.enum(['vendor', 'website'])
export const enquiryAccent = z.enum(['blue', 'green', 'violet', 'amber', 'rose', 'teal', 'slate'])
/** Where a client lands after sending (0274). */
export const enquiryAfterSubmit = z.enum(['whatsapp', 'thanks', 'link'])
export type EnquiryAfterSubmit = z.infer<typeof enquiryAfterSubmit>

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
  purpose: enquiryPurpose.default('vendor'),
  title: z.string().nullable().default(null),
  intro: z.string().nullable().default(null),
  thank_you: z.string().nullable().default(null),
  accent: enquiryAccent.nullable().default(null),
  show_logo: z.boolean().default(true),
  fields: enquiryFields.default({}),
  /** What a studio pastes into its own website. */
  embed_code: z.string(),
  is_main: z.boolean().default(false),
  slug: z.string().nullable().default(null),
  after_submit: enquiryAfterSubmit.default('whatsapp'),
  whatsapp_phone: z.string().nullable().default(null),
  whatsapp_text: z.string().nullable().default(null),
  redirect_url: z.string().nullable().default(null),
})
export type EnquiryForm = z.infer<typeof enquiryForm>

const text = (max: number) => z.string().trim().max(max)

export const createEnquiryFormRequest = z.object({
  name: text(120).min(1, 'Give the form a name.'),
  kind: text(60).nullish(),
  phone: text(30).nullish(),
  notes: text(1000).nullish(),
  purpose: enquiryPurpose.optional(),
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
    purpose: enquiryPurpose,
    title: text(120).nullable(),
    intro: text(300).nullable(),
    thank_you: text(300).nullable(),
    accent: enquiryAccent.nullable(),
    show_logo: z.boolean(),
    fields: enquiryFields,
    after_submit: enquiryAfterSubmit,
    /** "" clears it, so the studio's own number is used. */
    whatsapp_phone: z.string().trim().max(20).nullable(),
    whatsapp_text: text(300).nullable(),
    redirect_url: z.string().trim().max(500).nullable(),
  })
  .partial()
  .refine((v) => Object.values(v).some((x) => x !== undefined), 'Nothing to change.')
export type UpdateEnquiryFormRequest = z.infer<typeof updateEnquiryFormRequest>

export const enquiryFormPageRequest = z.object({ on: z.boolean() })

export const enquiryFormLead = z.object({
  id: uuid,
  name: z.string().nullable(),
  phone: z.string().nullable(),
  email: z.string().nullable().default(null),
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
  purpose: enquiryPurpose.default('vendor'),
  title: z.string().nullable().default(null),
  intro: z.string().nullable().default(null),
  thank_you: z.string().nullable().default(null),
  accent: enquiryAccent.nullable().default(null),
  logo_url: z.string().nullable().default(null),
  fields: enquiryFields.default({}),
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
  budget: z.number().min(0).max(1e10).nullish(),
  /** Left empty by people; bots fill every field they see. */
  website: z.string().max(500).optional(),
})
export type SubmitEnquiryRequest = z.input<typeof submitEnquiryRequest>

export const enquiryViewLead = z.object({
  name: z.string().nullable(),
  phone: z.string().nullable(),
  /** 0276: with the full number, unless the studio hides a partner's details. */
  email: z.string().nullable().default(null),
  city: z.string().nullable().default(null),
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

// ── the main form and its partners (0274) ─────────────────────────
/** The hub: the studio's main form, the numbers chats fall back to, and its lists. */
export const enquiryHub = z.object({
  form: enquiryForm,
  /** The studio's own number when the form has none (+91…), or null. */
  default_whatsapp_phone: z.string().nullable(),
  studio: z.string(),
  /** The readable link anyone opens: /f/<slug>. */
  share_url: z.string(),
  services: z.array(z.string()),
  /** Owners and managers change the form, partners and downloads; staff only share. */
  can_manage: z.boolean(),
})
export type EnquiryHub = z.infer<typeof enquiryHub>

export const setEnquiryServicesRequest = z.object({
  values: z.array(z.string().trim().min(1).max(60)).max(30),
})

/** A partner QR's own question (0281): a typed answer or one pick from a list. */
export const enquiryQuestion = z.object({
  id: z.string().regex(/^[a-z0-9]{4,12}$/),
  label: z.string().trim().min(1, 'Write the question.').max(120),
  kind: z.enum(['text', 'choice']),
  options: z.array(z.string().trim().min(1).max(60)).max(20).default([]),
  required: z.boolean().default(false),
})
export type EnquiryQuestion = z.infer<typeof enquiryQuestion>
export const enquiryQuestions = z
  .array(enquiryQuestion)
  .max(10, 'Up to ten questions.')
  .refine((qs) => qs.every((q) => q.kind === 'text' || q.options.length >= 2), 'Give each list at least two choices.')

export const enquiryPartner = z.object({
  id: uuid,
  name: z.string(),
  label: z.string().nullable(),
  party_id: uuid.nullable(),
  vendor_name: z.string().nullable(),
  phone: z.string().nullable(),
  notes: z.string().nullable(),
  code: z.string(),
  show_phone: z.boolean(),
  scans: z.number().int(),
  enquiries: z.number().int(),
  booked: z.number().int(),
  last_enquiry_at: isoDateTime.nullable(),
  /** When the partner last opened their private page (0274). */
  page_viewed_at: isoDateTime.nullish(),
  archived_at: isoDateTime.nullable(),
  created_at: isoDateTime,
  /** The main form with ?p=<code>: what their QR opens. */
  form_url: z.string(),
  /** Their private page, or null while sharing is stopped. */
  page_url: z.string().nullable(),
  /** 0281: their QR's own after-send; null = same as the main form. */
  after_submit: enquiryAfterSubmit.nullable().default(null),
  whatsapp_phone: z.string().nullable().default(null),
  whatsapp_text: z.string().nullable().default(null),
  redirect_url: z.string().nullable().default(null),
  thank_you: z.string().nullable().default(null),
  /** 0281: what this QR is for ("Priya & Rahul's wedding"), and its own questions. */
  occasion: z.string().nullable().default(null),
  questions: z.array(enquiryQuestion).catch([]).default([]),
})
export type EnquiryPartner = z.infer<typeof enquiryPartner>

const partnerName = z.string().trim().min(2, 'Give the partner a name.').max(80)
export const createEnquiryPartnerRequest = z.object({
  name: partnerName,
  label: text(120).nullish(),
  phone: text(30).nullish(),
  party_id: uuid.nullish(),
  notes: text(1000).nullish(),
  occasion: text(120).nullish(),
  questions: enquiryQuestions.optional(),
})
export type CreateEnquiryPartnerRequest = z.input<typeof createEnquiryPartnerRequest>

export const updateEnquiryPartnerRequest = z
  .object({
    name: partnerName,
    label: text(120).nullable(),
    phone: text(30).nullable(),
    party_id: uuid.nullable(),
    notes: text(1000).nullable(),
    show_phone: z.boolean(),
    archived: z.boolean(),
    /** 0281: null = same as the main form (and clears the four below). */
    after_submit: enquiryAfterSubmit.nullable(),
    /** "" clears it, so the form's number (then the studio's) is used. */
    whatsapp_phone: z.string().trim().max(20).nullable(),
    whatsapp_text: text(300).nullable(),
    redirect_url: z.string().trim().max(500).nullable(),
    thank_you: text(300).nullable(),
    occasion: text(120).nullable(),
    questions: enquiryQuestions,
  })
  .partial()
  .refine((v) => Object.values(v).some((x) => x !== undefined), 'Nothing to change.')
export type UpdateEnquiryPartnerRequest = z.infer<typeof updateEnquiryPartnerRequest>

/** A vendor (parties) that has no partner QR yet. */
export const enquiryVendor = z.object({
  id: uuid,
  name: z.string(),
  phone: z.string().nullable(),
  categories: z.array(z.string()),
  state: z.string().nullable(),
  partner_id: uuid.nullable(),
})
export type EnquiryVendor = z.infer<typeof enquiryVendor>

// ── public, 0274 ──────────────────────────────────────────────────
export const publicEnquiryFormV2 = publicEnquiryForm.extend({
  city: z.string().nullable().default(null),
  services: z.array(z.string()).default([]),
  event_types: z.array(z.string()).default([]),
  /** "Sent via <partner>" on the form. */
  partner: z.string().nullable().default(null),
  /** So the thank-you screen says the right words before sending. */
  goes_to: z.enum(['whatsapp', 'link']).nullable().default(null),
  /** 0281: what a partner's QR is for, and its own questions. */
  occasion: z.string().nullable().default(null),
  questions: z.array(enquiryQuestion).catch([]).default([]),
})
export type PublicEnquiryFormV2 = z.infer<typeof publicEnquiryFormV2>

export const submitEnquiryRequestV2 = z.object({
  name: z.string().max(200).default(''),
  phone: z.string().max(40).default(''),
  email: z.string().max(300).nullish(),
  event_type: z.string().max(120).nullish(),
  event_date: z.string().max(20).nullish(),
  city: z.string().max(200).nullish(),
  services: z.array(z.string().max(100)).max(40).nullish(),
  guests: z.union([z.number(), z.string()]).nullish(),
  budget: z.union([z.number(), z.string()]).nullish(),
  message: z.string().max(4000).nullish(),
  /** Left empty by people; bots fill every field they see. */
  website: z.string().max(500).optional(),
  /** A partner's code, from ?p=. */
  p: z.string().max(20).nullish(),
  /** Answers to a partner QR's own questions, by question id (0281). */
  answers: z.record(z.string().max(40), z.string().max(500)).nullish(),
})
export type SubmitEnquiryRequestV2 = z.input<typeof submitEnquiryRequestV2>

/** 201 after a send: where the client goes next, if anywhere. */
export const submitEnquiryResponse = z.object({
  received: z.literal(true),
  redirect_url: z.string().nullable(),
})

export const publicPartnerView = publicEnquiryView.extend({
  /** 0276: the partner sees each lead's real number and email. */
  full_details: z.boolean().default(false),
  city: z.string().nullable().default(null),
  logo_url: z.string().nullable().default(null),
})

// ── leads download ────────────────────────────────────────────────
export const leadsExportQuery = z.object({
  format: z.enum(['xlsx', 'csv']),
  partner_id: uuid.optional(),
  /** form = the main form's own leads; partner = every partner's. */
  from: z.enum(['form', 'partner']).optional(),
  source: z.string().max(60).optional(),
  q: z.string().max(100).optional(),
})
export const leadsExportResponse = z.object({
  filename: z.string(),
  content_type: z.string(),
  /** base64 */
  data: z.string(),
  rows: z.number().int(),
})
export type LeadsExportResponse = z.infer<typeof leadsExportResponse>
