import { z } from 'zod'
import { isoDateTime, uuid } from './shared/primitives'

/**
 * "Suggest a feature": a few words, a voice note, a screenshot -- any one is
 * enough -- from any screen, to the platform team.
 */
export const createFeatureRequest = z
  .object({
    body: z.string().trim().max(4000).optional(),
    voice_file_id: uuid.optional(),
    voice_seconds: z.number().int().min(0).max(600).optional(),
    screenshot_file_id: uuid.optional(),
    page_url: z.string().max(1000).optional(),
  })
  .refine((r) => !!r.body || !!r.voice_file_id || !!r.screenshot_file_id, {
    message: 'Say something, record a voice note, or add a screenshot.',
  })
export type CreateFeatureRequest = z.infer<typeof createFeatureRequest>

export const featureRequestStatus = z.enum(['new', 'planned', 'done', 'declined'])
export type FeatureRequestStatus = z.infer<typeof featureRequestStatus>

export const featureRequest = z.object({
  id: uuid,
  company_id: uuid,
  company_name: z.string().nullish(),
  user_id: uuid,
  user_name: z.string().nullish(),
  user_email: z.string().nullish(),
  body: z.string().nullish(),
  voice_file_id: uuid.nullish(),
  voice_seconds: z.number().int().nullish(),
  screenshot_file_id: uuid.nullish(),
  page_url: z.string().nullish(),
  user_agent: z.string().nullish(),
  status: featureRequestStatus,
  admin_note: z.string().nullish(),
  created_at: isoDateTime,
})
export type FeatureRequest = z.infer<typeof featureRequest>

export const updateFeatureRequest = z.object({
  status: featureRequestStatus.optional(),
  admin_note: z.string().max(2000).optional(),
})
export type UpdateFeatureRequest = z.infer<typeof updateFeatureRequest>
