import { z } from 'zod'
import { uuid, isoDateTime, email as emailSchema, GSTIN_PATTERN } from './shared/primitives'

/** Format-checked when given; blank clears the field either way. */
const gstinInput = z.string().trim().toUpperCase().max(20)
  .refine((v) => !v || GSTIN_PATTERN.test(v), 'Invalid GSTIN format')

export const client = z.object({
  id: uuid,
  company_id: uuid,
  name: z.string(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  alternate_phone: z.string().nullable(),
  address: z.string().nullable(),
  city: z.string().nullable(),
  /** Free-text tag — Referral, Repeat, Vendor — used for segmentation, not an enum. */
  relation: z.string().nullable(),
  /** For a compliant B2B tax invoice; absent for most retail/individual clients. */
  gstin: z.string().nullable(),
  notes: z.string().nullable(),
  created_at: isoDateTime,
})
export type Client = z.infer<typeof client>

export const createClientRequest = z.object({
  name: z.string().trim().min(1).max(160),
  email: emailSchema.optional(),
  phone: z.string().trim().max(20).optional(),
  alternate_phone: z.string().trim().max(20).optional(),
  address: z.string().trim().max(400).optional(),
  city: z.string().trim().max(120).optional(),
  relation: z.string().trim().max(60).optional(),
  gstin: gstinInput.optional(),
  notes: z.string().trim().max(2000).optional(),
})
export type CreateClientRequest = z.infer<typeof createClientRequest>

/** Every optional field accepts null so an edit can explicitly clear one, not just leave it out. */
export const updateClientRequest = z.object({
  name: z.string().trim().min(1).max(160).optional(),
  email: z.preprocess((v) => (v === '' ? null : v), emailSchema.nullable().optional()),
  phone: z.string().trim().max(20).nullable().optional(),
  alternate_phone: z.string().trim().max(20).nullable().optional(),
  address: z.string().trim().max(400).nullable().optional(),
  city: z.string().trim().max(120).nullable().optional(),
  relation: z.string().trim().max(60).nullable().optional(),
  gstin: gstinInput.nullable().optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
})
export type UpdateClientRequest = z.infer<typeof updateClientRequest>

export const clientListQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().max(200).optional(),
  sort: z.enum(['recent', 'name', 'city']).optional(),
})
export type ClientListQuery = z.infer<typeof clientListQuery>

export const clientListPage = z.object({
  items: z.array(client),
  total: z.number().int(),
  page: z.number().int(),
  page_size: z.number().int(),
})
export type ClientListPage = z.infer<typeof clientListPage>

export const duplicateClientResponse = z.object({
  existing_client: client,
})
export type DuplicateClientResponse = z.infer<typeof duplicateClientResponse>

/** A client's birthday or anniversary (0243). The year is optional. */
export const clientOccasion = z.object({
  id: uuid,
  client_id: uuid,
  project_id: uuid.nullable(),
  kind: z.enum(['birthday', 'anniversary']),
  person_name: z.string(),
  month: z.number().int().min(1).max(12),
  day: z.number().int().min(1).max(31),
  year: z.number().int().nullable(),
  wish: z.boolean(),
  source: z.enum(['studio', 'client_form', 'wedding_day']),
})
export type ClientOccasion = z.infer<typeof clientOccasion>

export const saveOccasionRequest = z.object({
  client_id: uuid,
  project_id: uuid.nullable().optional(),
  kind: z.enum(['birthday', 'anniversary']),
  person_name: z.string().trim().max(80).default(''),
  month: z.number().int().min(1).max(12),
  day: z.number().int().min(1).max(31),
  year: z.number().int().min(1900).max(2100).nullable().optional(),
  wish: z.boolean().optional(),
})
export type SaveOccasionRequest = z.infer<typeof saveOccasionRequest>

export const updateOccasionRequest = saveOccasionRequest.omit({ client_id: true }).partial()
export type UpdateOccasionRequest = z.infer<typeof updateOccasionRequest>

/** Everything the project's Wishes tab needs. */
export const projectWishes = z.object({
  client: z.object({ id: uuid, name: z.string(), phone: z.string().nullable(), email: z.string().nullable() }),
  studio_name: z.string(),
  occasions: z.array(clientOccasion),
})
export type ProjectWishes = z.infer<typeof projectWishes>

/** The studio's dates coming round soon, for the dashboard and Clients. */
export const upcomingWish = clientOccasion.extend({
  client_name: z.string(),
  client_phone: z.string().nullable(),
  on: z.string(),
})
export type UpcomingWish = z.infer<typeof upcomingWish>

// ── the details form a client fills (0244) ─────────────────────────
/** A day and month, the year optional. */
export const detailsDate = z.object({
  day: z.number().int().min(1).max(31),
  month: z.number().int().min(1).max(12),
  year: z.number().int().min(1900).max(2100).nullable().optional(),
})
export type DetailsDate = z.infer<typeof detailsDate>

/** One event of the function, as the client knows it. */
export const detailsEvent = z.object({
  name: z.string().trim().min(1).max(80),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  start_time: z.string().regex(/^\d{1,2}:\d{2}$/).nullable().optional(),
  hours: z.number().min(0.5).max(24).nullable().optional(),
  venue: z.string().trim().max(300).nullable().optional(),
  guests: z.number().int().min(1).max(100000).nullable().optional(),
})
export type DetailsEvent = z.infer<typeof detailsEvent>

const optText = (max: number) => z.string().trim().max(max).optional()

/** What the client sends from /details/:token. */
export const clientDetailsRequest = z.object({
  name: z.string().trim().min(1, 'Please add your name.').max(120),
  partner_name: optText(120),
  phone: optText(30),
  partner_phone: optText(30),
  email: z.union([emailSchema, z.literal('')]).optional(),
  address: optText(500),
  city: optText(120),
  occasion: optText(60),
  birthday: detailsDate.nullable().optional(),
  partner_birthday: detailsDate.nullable().optional(),
  wedding: detailsDate.nullable().optional(),
  events: z.array(detailsEvent).max(12).default([]),
})
export type ClientDetailsRequest = z.infer<typeof clientDetailsRequest>

/** What the form shows: the studio, and on a project's link what is known. */
export const publicClientDetails = z.object({
  kind: z.enum(['project', 'studio']),
  studio: z.object({
    name: z.string(),
    logo_url: z.string().nullable(),
    phone: z.string().nullable(),
    brand_color: z.string().nullable(),
  }),
  project_name: z.string().nullable(),
  submitted: z.boolean(),
  prefill: z
    .object({
      name: z.string().nullable(),
      phone: z.string().nullable(),
      partner_phone: z.string().nullable(),
      email: z.string().nullable(),
      address: z.string().nullable(),
      city: z.string().nullable(),
      occasions: z.array(
        z.object({ kind: z.enum(['birthday', 'anniversary']), person_name: z.string(), day: z.number(), month: z.number(), year: z.number().nullable() }),
      ),
      events: z.array(
        z.object({
          name: z.string(),
          date: z.string().nullable(),
          start_time: z.string().nullable(),
          hours: z.coerce.number().nullable(),
          venue: z.string().nullable(),
          guests: z.coerce.number().nullable().default(null),
        }),
      ),
    })
    .nullable(),
})
export type PublicClientDetails = z.infer<typeof publicClientDetails>

export const clientDetailsResult = z.object({
  project_made: z.boolean(),
  days_added: z.number(),
  events_waiting: z.number(),
  held: z.boolean(),
})
export type ClientDetailsResult = z.infer<typeof clientDetailsResult>

/** A project's details link, and what came back from it. */
export const projectDetailsStatus = z.object({
  sent_at: isoDateTime.nullable(),
  last_submitted_at: isoDateTime.nullable(),
  /** Events the client sent that are not on the Shoots tab yet. */
  waiting: z.array(detailsEvent),
})
export type ProjectDetailsStatus = z.infer<typeof projectDetailsStatus>

export const detailsLinkIssued = z.object({ url: z.string() })
export type DetailsLinkIssued = z.infer<typeof detailsLinkIssued>
