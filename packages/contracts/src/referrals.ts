import { z } from 'zod'
import { uuid, isoDateTime, isoDate, money } from './shared/primitives'

export const referralRewardType = z.enum([
  'percentage',
  'fixed',
  'credit',
  'custom',
  'cashback',
  'free_pre_wedding',
  'free_maternity',
  'extra_album',
  'discount',
])
export type ReferralRewardType = z.infer<typeof referralRewardType>

export const referralCampaignStatus = z.enum(['active', 'paused', 'ended', 'archived'])
export type ReferralCampaignStatus = z.infer<typeof referralCampaignStatus>

export const referralSubmissionStatus = z.enum([
  'pending',
  'converted',
  'rewarded',
  'rejected',
  'new',
  'contacted',
  'booked',
  'duplicate',
])
export type ReferralSubmissionStatus = z.infer<typeof referralSubmissionStatus>

export const referralRewardStatus = z.enum(['not_due', 'due', 'given', 'cancelled'])
export type ReferralRewardStatus = z.infer<typeof referralRewardStatus>

export const referralCampaign = z.object({
  id: uuid,
  company_id: uuid,
  name: z.string(),
  slug: z.string(),
  description: z.string().nullable(),
  reward_type: referralRewardType,
  reward_value: money,
  reward_description: z.string().nullable(),
  /** Lovable parity: display title for the share dialog + project/client link + archived state. */
  reward_title: z.string().nullable().default(null),
  project_id: uuid.nullable().default(null),
  project_name: z.string().nullable().default(null),
  client_id: uuid.nullable().default(null),
  client_name: z.string().nullable().default(null),
  status: referralCampaignStatus,
  created_at: isoDateTime,
})
export type ReferralCampaign = z.infer<typeof referralCampaign>

export const referralCampaignSummary = z.object({
  total_campaigns: z.number().int(),
  active_campaigns: z.number().int(),
  total_submissions: z.number().int(),
  converted_submissions: z.number().int(),
  total_rewards: money,
})
export type ReferralCampaignSummary = z.infer<typeof referralCampaignSummary>

export const referralSubmission = z.object({
  id: uuid,
  campaign_id: uuid,
  campaign_name: z.string(),
  referrer_name: z.string().nullable(),
  referrer_phone: z.string().nullable(),
  client_name: z.string(),
  client_phone: z.string().nullable(),
  client_email: z.string().nullable(),
  status: referralSubmissionStatus,
  reward_granted: z.boolean(),
  reward_amount: money.nullable(),
  /** Lovable parity: reward lifecycle separate from submission status. */
  reward_status: referralRewardStatus.default('not_due'),
  notes: z.string().nullable(),
  /** What the referred client's event is, when it is, and how many functions it has. */
  event_type: z.string().nullable().default(null),
  event_date: isoDate.nullable().default(null),
  functions_count: z.number().int().nullable().default(null),
  /** Lovable parity: referrer/project/source/lead links. */
  referring_client_name: z.string().nullable().default(null),
  referred_name: z.string().nullable().default(null),
  referred_phone: z.string().nullable().default(null),
  referred_email: z.string().nullable().default(null),
  project_id: uuid.nullable().default(null),
  project_name: z.string().nullable().default(null),
  source: z.string().default('referral_link'),
  crm_lead_id: uuid.nullable().default(null),
  created_at: isoDateTime,
})
export type ReferralSubmission = z.infer<typeof referralSubmission>

export const referralCampaignList = z.object({
  campaigns: z.array(referralCampaign),
  summary: referralCampaignSummary,
})
export type ReferralCampaignList = z.infer<typeof referralCampaignList>

export const createReferralCampaignRequest = z.object({
  name: z.string().trim().min(2).max(160),
  description: z.string().trim().max(1000).nullish(),
  reward_type: referralRewardType.default('fixed'),
  reward_value: money.default(0),
  reward_description: z.string().trim().max(200).nullish(),
  reward_title: z.string().trim().max(160).nullish(),
  project_id: uuid.nullish(),
  client_id: uuid.nullish(),
})
export type CreateReferralCampaignRequest = z.infer<typeof createReferralCampaignRequest>

export const getOrCreateCampaignRequest = z.object({ project_id: uuid })
export type GetOrCreateCampaignRequest = z.infer<typeof getOrCreateCampaignRequest>

export const updateReferralSubmissionRequest = z.object({
  status: referralSubmissionStatus.optional(),
  reward_status: referralRewardStatus.optional(),
  notes: z.string().trim().max(2000).nullish(),
  /** What the referring client was actually given, in rupees. */
  reward_amount: z.number().finite().min(0).max(10_00_000).nullish(),
})
export type UpdateReferralSubmissionRequest = z.infer<typeof updateReferralSubmissionRequest>

export const referralSubmissionsQuery = z.object({
  campaign_id: uuid.optional(),
  status: referralSubmissionStatus.optional(),
  reward_status: referralRewardStatus.optional(),
  search: z.string().trim().max(200).optional(),
  project_id: uuid.optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
  cursor: isoDateTime.optional(),
})
export type ReferralSubmissionsQuery = z.infer<typeof referralSubmissionsQuery>

export const referralSubmissionList = z.object({
  items: z.array(referralSubmission),
  next_cursor: isoDateTime.nullable().default(null),
})
export type ReferralSubmissionList = z.infer<typeof referralSubmissionList>

export const publicReferralCampaign = z.object({
  campaign_id: uuid,
  name: z.string(),
  description: z.string().nullable(),
  reward_type: referralRewardType,
  reward_value: money,
  reward_description: z.string().nullable(),
  studio_name: z.string().nullable(),
  // Lovable parity: header branding + referrer + reward title. All optional.
  logo_url: z.string().nullable().nullish(),
  referring_client_name: z.string().nullable().nullish(),
  reward_title: z.string().nullable().nullish(),
})
export type PublicReferralCampaign = z.infer<typeof publicReferralCampaign>

export const submitReferralRequest = z.object({
  referrer_name: z.string().trim().max(160).nullish(),
  referrer_phone: z.string().trim().max(40).nullish(),
  client_name: z.string().trim().min(2).max(160),
  client_phone: z.string().trim().max(40).nullish(),
  client_email: z.string().trim().max(200).nullish(),
  notes: z.string().trim().max(2000).nullish(),
  event_type: z.string().trim().max(80).nullish(),
  event_date: isoDate.nullish(),
  functions_count: z.number().int().min(0).max(50).nullish(),
  referring_client_name: z.string().trim().max(160).nullish(),
  source: z.string().trim().max(40).nullish(),
})
export type SubmitReferralRequest = z.infer<typeof submitReferralRequest>

export const submitReferralResponse = z.object({
  id: uuid,
  /** True when the same phone/email already exists in this campaign. */
  duplicate: z.boolean().default(false),
  crm_lead_id: uuid.nullable().default(null),
})
export type SubmitReferralResponse = z.infer<typeof submitReferralResponse>
