import { z } from 'zod'
import { uuid, isoDate, isoDateTime } from './shared/primitives'

export const shootStatus = z.enum(['planned', 'confirmed', 'completed', 'cancelled'])
export type ShootStatus = z.infer<typeof shootStatus>

/**
 * One line of "who and what this day needs" — a service by name and how many
 * of it. Named rather than referenced by id: the picker lets a studio type
 * "Drone pilot" for the first time, and the server upserts the service behind
 * it, so nobody has to visit a settings page before booking a shoot.
 */
export const shootRequirementInput = z.object({
  name: z.string().trim().min(1).max(80),
  quantity: z.number().int().min(1).max(99).default(1),
})
export type ShootRequirementInput = z.infer<typeof shootRequirementInput>

export const shootRequirement = z.object({
  service_id: uuid,
  name: z.string(),
  quantity: z.number().int(),
})
export type ShootRequirement = z.infer<typeof shootRequirement>

export const shootListItem = z.object({
  id: uuid,
  name: z.string(),
  project_id: uuid,
  project_name: z.string().nullable(),
  client_name: z.string().nullable(),
  shoot_date: isoDate.nullable(),
  start_at: isoDateTime.nullable(),
  end_at: isoDateTime.nullable(),
  location: z.string().nullable(),
  map_link: z.string().nullable(),
  status: shootStatus,
  /** What the day was planned to need — the booking screen fills against it. */
  requirements: z.array(shootRequirement),
})
export type ShootListItem = z.infer<typeof shootListItem>

/**
 * A shoot on someone's own list: the shoot, and who else is on it -- names
 * and roles only, never what anyone is paid.
 */
export const myShoot = shootListItem.extend({
  crew: z
    .array(z.object({ user_id: uuid, name: z.string(), service_name: z.string().nullable() }))
    .default([]),
})
export type MyShoot = z.infer<typeof myShoot>

/** A service this company has used before, offered as you type. */
export const serviceOption = z.object({ id: uuid, name: z.string() })
export type ServiceOption = z.infer<typeof serviceOption>

export const createServiceRequest = z.object({ name: z.string().trim().min(1).max(120) })
export type CreateServiceRequest = z.infer<typeof createServiceRequest>

export const updateServiceRequest = createServiceRequest
export type UpdateServiceRequest = z.infer<typeof updateServiceRequest>

/**
 * Whatever the client sent, trimmed. It used to have to be a URL, and studios
 * paste short links, plus codes and "Taj Palace, Jaipur (shared from
 * WhatsApp)" -- the 422 that answered those made the Create Project wizard
 * drop the shoot without a word. The web shows the value as a link only when
 * it starts with http(s); anything else is shown as text to copy.
 *
 * An empty or blank string clears it: forms submit "" for "no link", and
 * rejecting that with a 422 would make the field impossible to clear.
 */
const mapLink = z.preprocess(
  (v) => (typeof v === 'string' && v.trim() === '' ? null : v),
  z.string().trim().max(500).nullish(),
)

export const createShootRequest = z.object({
  project_id: uuid,
  name: z.string().trim().min(1).max(160),
  shoot_date: isoDate.optional(),
  start_at: isoDateTime.optional(),
  end_at: isoDateTime.optional(),
  location: z.string().trim().max(200).optional(),
  map_link: mapLink.optional(),
  status: shootStatus.default('planned'),
  // Optional rather than defaulted: a caller with no crew to record should not
  // have to send an empty array to say so.
  requirements: z.array(shootRequirementInput).max(40).optional(),
})
export type CreateShootRequest = z.infer<typeof createShootRequest>

export const updateShootRequest = z.object({
  name: z.string().trim().min(1).max(160).optional(),
  shoot_date: isoDate.nullable().optional(),
  start_at: isoDateTime.nullable().optional(),
  end_at: isoDateTime.nullable().optional(),
  location: z.string().trim().max(200).nullable().optional(),
  map_link: mapLink.optional(),
  status: shootStatus.optional(),
  requirements: z.array(shootRequirementInput).max(40).optional(),
})
export type UpdateShootRequest = z.infer<typeof updateShootRequest>

/**
 * A saved shape a studio repeats. 'shoot' is a whole day — its requirements
 * and its internal work; 'internal_work' is just the edit-room list. The
 * payload is the shape itself — the requirements and the internal-work titles
 * that get stamped onto a shoot when the preset is applied.
 */
export const shootPresetKind = z.enum(['shoot', 'internal_work'])
export type ShootPresetKind = z.infer<typeof shootPresetKind>

export const shootPresetPayload = z.object({
  requirements: z.array(shootRequirementInput).max(40).default([]),
  internal_work: z.array(z.string().trim().min(1).max(200)).max(40).default([]),
})
export type ShootPresetPayload = z.infer<typeof shootPresetPayload>

export const shootPreset = z.object({
  id: uuid,
  kind: shootPresetKind,
  name: z.string(),
  payload: shootPresetPayload,
})
export type ShootPreset = z.infer<typeof shootPreset>

export const saveShootPresetRequest = z.object({
  kind: shootPresetKind,
  name: z.string().trim().min(1).max(80),
  payload: shootPresetPayload,
})
export type SaveShootPresetRequest = z.infer<typeof saveShootPresetRequest>
