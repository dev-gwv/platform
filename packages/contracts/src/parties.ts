import { z } from 'zod'
import { uuid } from './shared/primitives'

/** A vendor, freelancer, or other party an expense was paid to or received from. */
export const party = z.object({
  id: uuid,
  name: z.string(),
  kind: z.enum(['vendor', 'freelancer', 'other']),
  // Lovable parity: parties manager fields. All optional.
  phone: z.string().nullable().nullish(),
  email: z.string().nullable().nullish(),
  gstin: z.string().nullable().nullish(),
  address: z.string().nullable().nullish(),
  state: z.string().nullable().nullish(),
  is_active: z.boolean().nullish(),
})
export type Party = z.infer<typeof party>

export const createPartyRequest = z.object({
  name: z.string().trim().min(1).max(120),
  kind: z.enum(['vendor', 'freelancer', 'other']).default('vendor'),
  phone: z.string().trim().max(40).nullish(),
  email: z.string().trim().max(200).nullish(),
  gstin: z.string().trim().max(20).nullish(),
  address: z.string().trim().max(400).nullish(),
  state: z.string().trim().max(80).nullish(),
  is_active: z.boolean().nullish(),
})
export type CreatePartyRequest = z.infer<typeof createPartyRequest>

export const updatePartyRequest = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  kind: z.enum(['vendor', 'freelancer', 'other']).optional(),
  phone: z.string().trim().max(40).nullable().optional(),
  email: z.string().trim().max(200).nullable().optional(),
  gstin: z.string().trim().max(20).nullable().optional(),
  address: z.string().trim().max(400).nullable().optional(),
  state: z.string().trim().max(80).nullable().optional(),
  is_active: z.boolean().optional(),
})
export type UpdatePartyRequest = z.infer<typeof updatePartyRequest>
