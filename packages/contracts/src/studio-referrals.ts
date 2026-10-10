import { z } from 'zod'

/**
 * Refer a studio (0237). The terms are the platform owner's to set; each is
 * null until decided, and the screens say "being finalised" meanwhile.
 */
export const studioRefTerms = z.object({
  reward: z.coerce.number().nullable(),
  discount_pct: z.coerce.number().nullable(),
  hold_days: z.number().int().nullable(),
})
export type StudioRefTerms = z.infer<typeof studioRefTerms>

/** One studio the caller brought in -- its name and dates, never its money or people. */
export const studioReferralRow = z.object({
  id: z.string(),
  studio_name: z.string(),
  signed_up_at: z.string(),
  paid_at: z.string().nullable(),
  reward_amount: z.coerce.number().nullable(),
  rewarded_at: z.string().nullable(),
  void_reason: z.string().nullable(),
})
export type StudioReferralRow = z.infer<typeof studioReferralRow>

export const myStudioReferrals = z.object({
  code: z.string(),
  link: z.string(),
  terms: studioRefTerms,
  referrals: z.array(studioReferralRow),
})
export type MyStudioReferrals = z.infer<typeof myStudioReferrals>

/** The platform owner's list: who brought in whom. */
export const platformStudioReferral = studioReferralRow.extend({
  referrer_name: z.string(),
  code: z.string(),
})
export type PlatformStudioReferral = z.infer<typeof platformStudioReferral>

export const platformStudioReferrals = z.object({
  terms: studioRefTerms,
  referrals: z.array(platformStudioReferral),
})
export type PlatformStudioReferrals = z.infer<typeof platformStudioReferrals>

export const saveStudioRefTermsRequest = z.object({
  reward: z.number().min(0).max(1_000_000).nullable(),
  discount_pct: z.number().min(0).max(100).nullable(),
  hold_days: z.number().int().min(0).max(365).nullable(),
})
export type SaveStudioRefTermsRequest = z.infer<typeof saveStudioRefTermsRequest>

export const settleStudioReferralRequest = z.discriminatedUnion('action', [
  z.object({ action: z.literal('reward'), amount: z.number().min(0).max(1_000_000) }),
  z.object({ action: z.literal('void'), reason: z.string().trim().min(2).max(300) }),
  z.object({ action: z.literal('reopen') }),
])
export type SettleStudioReferralRequest = z.infer<typeof settleStudioReferralRequest>
