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
