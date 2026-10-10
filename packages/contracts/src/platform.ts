import { z } from 'zod'
import { email, uuid, isoDateTime } from './shared/primitives'
import { planGate } from './auth'

/**
 * Platform console contracts — the cross-tenant vendor view. Every payload here
 * is served only to `platform_admins`; the row shapes mirror the security-definer
 * RPCs `platform_list_studios` / `platform_usage_summary` (migration 0019).
 */

export const platformStudio = z.object({
  id: uuid,
  name: z.string(),
  owner_email: email.nullable(),
  plan_gate: planGate,
  plan_expiry: isoDateTime.nullable(),
  user_count: z.coerce.number().int(),
  project_count: z.coerce.number().int(),
  created_at: isoDateTime,
  // Lovable parity: extra columns for search/sort/CSV/details. All optional.
  owner_name: z.string().nullable().nullish(),
  owner_phone: z.string().nullable().nullish(),
  plan_key: z.string().nullable().nullish(),
  days_remaining: z.coerce.number().int().nullish(),
  active_today: z.coerce.number().int().nullish(),
  last_seen: isoDateTime.nullable().nullish(),
  /** When this studio's access ends: the paid plan, else the trial, else grace (0210). */
  access_until: isoDateTime.nullable().nullish(),
  /** IPC Diamond member or not (0214). */
  member_tier: z.enum(['outsider', 'diamond']).nullish(),
})
export type PlatformStudio = z.infer<typeof platformStudio>

export const platformStudioList = z.array(platformStudio)

export const platformUsage = z.object({
  studio_count: z.coerce.number().int(),
  active_studio_count: z.coerce.number().int(),
  total_users: z.coerce.number().int(),
  revenue_last_30d: z.coerce.number(),
  // Lovable parity: heartbeat rollup. All optional so old RPC shape still parses.
  active_today: z.coerce.number().int().nullish(),
  active_week: z.coerce.number().int().nullish(),
  active_month: z.coerce.number().int().nullish(),
  inactive_count: z.coerce.number().int().nullish(),
  sessions_30d: z.coerce.number().int().nullish(),
  events_30d: z.coerce.number().int().nullish(),
  avg_sessions_per_studio: z.coerce.number().nullish(),
  avg_session_seconds: z.coerce.number().nullish(),
  modules: z.array(z.object({ module: z.string(), events: z.coerce.number().int() })).nullish(),
  top_studios: z.array(z.object({ company_id: z.string(), company_name: z.string().nullable(), events: z.coerce.number().int() })).nullish(),
  recent_events: z.array(z.object({
    company_id: z.string(), route: z.string().nullable(), module: z.string().nullable(), occurred_at: z.string(),
  })).nullish(),
  // Lovable parity round 2: funnel + health + logs. All optional.
  activation_funnel: z.record(z.string(), z.coerce.number().int()).nullish(),
  health_by_studio: z.array(z.object({
    company_id: z.string(),
    health_label: z.string(),
    last_active: z.string().nullable(),
    sessions: z.coerce.number().int().nullish(),
  })).nullish(),
  activity_logs: z.array(z.object({
    company_id: z.string(),
    company_name: z.string().nullable().nullish(),
    module: z.string().nullable().nullish(),
    route: z.string().nullable().nullish(),
    occurred_at: z.string(),
  })).nullish(),
})
export type PlatformUsage = z.infer<typeof platformUsage>

export const platformCreateStudioRequest = z.object({
  name: z.string().trim().min(2).max(160),
  owner_email: email,
  owner_name: z.string().trim().max(160).nullish(),
  owner_phone: z.string().trim().max(40).nullish(),
  plan_key: z.string().trim().max(80).nullish(),
})
export type PlatformCreateStudioRequest = z.infer<typeof platformCreateStudioRequest>

export const platformUsageQuery = z.object({
  days: z.coerce.number().int().min(1).max(365).default(30),
  module: z.string().max(60).nullish(),
  search: z.string().max(120).nullish(),
})
export type PlatformUsageQuery = z.infer<typeof platformUsageQuery>

export const usageTrackRequest = z.object({
  route: z.string().trim().max(200),
  module: z.string().trim().max(60).default('other'),
  event_name: z.string().trim().max(60).default('route_viewed'),
  session_id: z.string().trim().max(80).nullish(),
  session_started_at: z.string().max(40).nullish(),
  user_agent: z.string().max(400).nullish(),
  device_type: z.string().max(20).nullish(),
  heartbeat: z.boolean().nullish(),
})
export type UsageTrackRequest = z.infer<typeof usageTrackRequest>

/** A vendor plan action on one tenant. `months` applies only to `extend`. */
export const platformPlanAction = z
  .object({
    action: z.enum(['extend', 'expire', 'trial']),
    months: z.number().int().min(1).max(60).optional(),
  })
  .refine((v) => v.action !== 'extend' || typeof v.months === 'number', {
    message: 'months is required to extend',
    path: ['months'],
  })
export type PlatformPlanAction = z.infer<typeof platformPlanAction>

/** One "I am an IPC Diamond member" screenshot, for the platform inbox (0214). */
export const diamondClaimStatus = z.enum(['pending', 'approved', 'rejected', 'revoked'])
export type DiamondClaimStatus = z.infer<typeof diamondClaimStatus>

export const platformDiamondClaim = z.object({
  id: uuid,
  company_id: uuid,
  company_name: z.string(),
  member_tier: z.enum(['outsider', 'diamond']),
  owner_email: z.string().nullable(),
  file_id: uuid.nullable(),
  status: diamondClaimStatus,
  /** 'auto' when Claude decided, a user id when a person did. */
  decided_by: z.string().nullable(),
  decided_at: isoDateTime.nullable(),
  reason: z.string().nullable(),
  reading: z
    .object({
      is_whatsapp_group_chat: z.boolean().optional(),
      group_title: z.string().nullable().optional(),
      confidence: z.string().optional(),
    })
    .passthrough()
    .nullable(),
  created_at: isoDateTime,
  access_until: isoDateTime.nullable(),
})
export type PlatformDiamondClaim = z.infer<typeof platformDiamondClaim>

export const platformDiamondDecision = z.object({
  approve: z.boolean(),
  reason: z.string().trim().max(500).optional(),
})
export type PlatformDiamondDecision = z.infer<typeof platformDiamondDecision>

// ── Email health (0217) ─────────────────────────────────────
/** One email the app tried to send, and what the email service said. */
export const emailLogRow = z.object({
  id: z.string().uuid(),
  kind: z.string(),
  to_address: z.string(),
  subject: z.string().nullable(),
  status: z.enum(['sent', 'failed', 'skipped']),
  provider_message_id: z.string().nullable(),
  error: z.string().nullable(),
  created_at: z.string(),
})
export type EmailLogRow = z.infer<typeof emailLogRow>

/**
 * Is email set up, and is it working? Never carries the key itself -- only
 * whether one is set.
 */
export const emailHealth = z.object({
  key_set: z.boolean(),
  from: z.string().nullable(),
  from_domain: z.string().nullable(),
  app_url: z.string().nullable(),
  /** The sending domain as Resend sees it; null when it could not be read. */
  domain: z.object({ name: z.string(), status: z.string() }).nullable(),
  /** Why the domain could not be read (a send-only key, no key, not added). */
  domain_note: z.string().nullable(),
  last_7_days: z.object({ sent: z.number(), failed: z.number(), skipped: z.number() }),
  recent: emailLogRow.array(),
})
export type EmailHealth = z.infer<typeof emailHealth>

export const emailTestRequest = z.object({ to: z.string().trim().email().max(320) })
export const emailTestResult = z.object({
  status: z.enum(['sent', 'provider_missing', 'failed']),
  id: z.string().nullable().default(null),
  error: z.string().nullable().default(null),
})
/** What happened to a sent email after Resend took it: delivered, bounced, … */
export const emailDelivery = z.object({ last_event: z.string().nullable(), note: z.string().nullable() })

// ── The old app's subscribers (0218) ─────────────────────────────
/** One row of the old app's Studio Access "Export CSV". */
export const legacyStudioInput = z.object({
  old_company_id: z.string().trim().min(1).max(120),
  studio_name: z.string().trim().min(1).max(200),
  owner_name: z.string().trim().max(200).nullish(),
  email: z.string().trim().max(320).nullish(),
  phone: z.string().trim().max(40).nullish(),
  plan: z.string().trim().max(80).nullish(),
  expires_at: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
  old_created_at: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
})
export type LegacyStudioInput = z.infer<typeof legacyStudioInput>

export const legacyImportRequest = z.object({ rows: z.array(legacyStudioInput).min(1).max(5000) })
export type LegacyImportRequest = z.infer<typeof legacyImportRequest>

export const legacyImportResult = z.object({
  imported: z.number().int(),
  updated: z.number().int(),
  carried: z.number().int(),
})
export type LegacyImportResult = z.infer<typeof legacyImportResult>

export const legacyStudio = z.object({
  id: uuid,
  old_company_id: z.string(),
  studio_name: z.string(),
  owner_name: z.string().nullable(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  plan: z.string().nullable(),
  expires_at: z.string().nullable(),
  old_created_at: z.string().nullable(),
  joined_company_id: uuid.nullable(),
  joined_name: z.string().nullable(),
  carried_at: isoDateTime.nullable(),
})
export type LegacyStudio = z.infer<typeof legacyStudio>
export const legacyStudioList = z.array(legacyStudio)

/** The whole plan catalogue, for the platform's "Assign plan" (0226). */
export const platformPlan = z.object({
  id: uuid,
  key: z.string(),
  name: z.string(),
  price: z.coerce.number(),
  billing_interval: z.string(),
  duration_days: z.number().int().nullable(),
  audience: z.string().nullable(),
  is_active: z.boolean(),
  /** Platform → Plans (0256): the tier, its limits, and the studios on it now. */
  tier: z.string().nullable().optional(),
  limits: z.record(z.string(), z.coerce.number()).optional(),
  sort_order: z.number().int().optional(),
  studios: z.number().int().optional(),
})
export type PlatformPlan = z.infer<typeof platformPlan>
export const platformPlanList = z.array(platformPlan)

/** Paying studios and studios on their free trial, for Platform → Plans. */
export const platformPlanCounts = z.object({ paying: z.number().int(), on_trial: z.number().int() })
export type PlatformPlanCounts = z.infer<typeof platformPlanCounts>

export const platformPlanOnSaleRequest = z.object({ on_sale: z.boolean() })

export const platformAssignPlanRequest = z.object({ plan_key: z.string().trim().min(1).max(80) })

/** Orders Razorpay took money for that never gave the studio its plan (0226). */
export const paymentRecovery = z.object({
  stuck: z.array(
    z.object({
      order_id: uuid,
      company_id: uuid,
      company_name: z.string().nullable(),
      plan_name: z.string().nullable(),
      amount: z.coerce.number(),
      created_at: z.string(),
      razorpay_order_id: z.string(),
      captured_payment_id: z.string().nullable(),
    }),
  ),
  unmatched: z.array(
    z.object({
      event_id: z.string(),
      processed_at: z.string(),
      payment_id: z.string().nullable(),
      razorpay_order_id: z.string().nullable(),
      amount: z.coerce.number().nullable(),
      email: z.string().nullable(),
    }),
  ),
  /** Can the API ask Razorpay directly (keys set)? */
  can_check: z.boolean(),
})
export type PaymentRecovery = z.infer<typeof paymentRecovery>
export const paymentCreditResult = z.object({ expires_at: z.string().nullable(), duplicate: z.boolean(), payment_id: z.string() })
