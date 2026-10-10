import { z } from 'zod'
import { uuid, isoDateTime } from './shared/primitives'

/**
 * An enquiry is what arrives; a lead is what someone works.
 *
 * Most enquiries are never worked at all, which is exactly why they are not
 * leads — a lead list nobody trusts is a lead list nobody opens. Converting
 * moves one across and records which lead it became.
 */
/** The five system statuses every studio starts with. A studio can add its own
 * alongside them (via the `enquiry_status` custom-lookups category), so the
 * column itself is free text -- this enum is only for code that means one of
 * these five specifically (the summary buckets, the open/closed split). */
export const enquiryStatus = z.enum(['new', 'reviewed', 'contacted', 'converted', 'closed'])
export type EnquiryStatus = z.infer<typeof enquiryStatus>

export const enquiry = z.object({
  id: uuid,
  name: z.string(),
  phone: z.string().nullable(),
  email: z.string().nullable(),
  message: z.string().nullable(),
  source: z.string().nullable(),
  enquiry_status: z.string(),
  assigned_to: uuid.nullable(),
  assigned_to_name: z.string().nullable(),
  converted_lead_id: uuid.nullable(),
  created_at: isoDateTime,
})
export type Enquiry = z.infer<typeof enquiry>

export const enquirySummary = z.object({
  total_count: z.number().int(),
  open_count: z.number().int(),
  new_count: z.number().int(),
  reviewed_count: z.number().int(),
  contacted_count: z.number().int(),
  converted_count: z.number().int(),
  closed_count: z.number().int(),
})
export type EnquirySummary = z.infer<typeof enquirySummary>

export const enquiryList = z.object({
  items: z.array(enquiry),
  summary: enquirySummary,
  /** created_at of the last row when more rows exist, else null. */
  next_cursor: isoDateTime.nullable().default(null),
})
export type EnquiryList = z.infer<typeof enquiryList>

export const saveEnquiryRequest = z.object({
  name: z.string().trim().min(1).max(120),
  phone: z.string().trim().max(30).nullish(),
  email: z
    .string()
    .trim()
    .max(160)
    .nullish()
    .refine((v) => !v || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), 'Email format is invalid.'),
  message: z.string().trim().max(5000).nullish(),
  source: z.string().trim().max(60).nullish(),
  enquiry_status: z.string().trim().min(1).max(60).default('new'),
  assigned_to: uuid.nullish(),
})
export type SaveEnquiryRequest = z.infer<typeof saveEnquiryRequest>

export const convertEnquiryRequest = z.object({
  notes: z.string().trim().max(5000).nullish(),
})
export type ConvertEnquiryRequest = z.infer<typeof convertEnquiryRequest>

export const convertEnquiryResponse = z.object({
  lead_id: uuid,
  already_converted: z.boolean().default(false),
  linked_existing: z.boolean().default(false),
})
export type ConvertEnquiryResponse = z.infer<typeof convertEnquiryResponse>
