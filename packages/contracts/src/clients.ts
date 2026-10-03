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
