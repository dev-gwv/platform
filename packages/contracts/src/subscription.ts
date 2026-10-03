import { z } from 'zod'
import { uuid, money } from './shared/primitives'

export const plan = z.object({
  id: uuid,
  key: z.string(),
  name: z.string(),
  price: money,
  billing_interval: z.enum(['monthly', 'yearly', 'biennial']),
  // Lovable parity: richer plan cards. All optional.
  description: z.string().nullable().nullish(),
  currency: z.string().nullish(),
  duration_days: z.number().int().nullish(),
  features: z.array(z.string()).nullish(),
  is_active: z.boolean().nullish(),
  /** What the card is decorated with: the badge, the saving, the per-month figure. */
  badge: z.string().nullable().nullish(),
  billing_label: z.string().nullable().nullish(),
  savings_label: z.string().nullable().nullish(),
  monthly_equivalent: money.nullish(),
  sort_order: z.number().int().nullish(),
  /** 0241: starter / pro / max, the plan's limits (missing = unlimited) and its extras. */
  tier: z.enum(['starter', 'pro', 'max']).nullish(),
  limits: z.lazy(() => planLimits).nullish(),
  includes: z.array(z.string()).nullish(),
})
export type Plan = z.infer<typeof plan>

/** What a plan allows; a missing key is unlimited. Leads are never limited. */
export const PLAN_LIMIT_KEYS = ['projects_per_month', 'invoices_per_month', 'team_logins', 'enquiry_forms'] as const
export type PlanLimitKey = (typeof PLAN_LIMIT_KEYS)[number]
export const planLimits = z.object({
  projects_per_month: z.number().int().optional(),
  invoices_per_month: z.number().int().optional(),
  team_logins: z.number().int().optional(),
  enquiry_forms: z.number().int().optional(),
})
export type PlanLimits = z.infer<typeof planLimits>

/** The studio's plan, its limits and what it has used (my_plan_usage, 0241). */
export const planUsage = z.object({
  plan_key: z.string().nullable(),
  plan_name: z.string().nullable(),
  tier: z.enum(['starter', 'pro', 'max']).nullable(),
  limits: planLimits,
  includes: z.array(z.string()),
  used: z.object({
    projects_per_month: z.number().int(),
    invoices_per_month: z.number().int(),
    team_logins: z.number().int(),
    enquiry_forms: z.number().int(),
  }),
})
export type PlanUsage = z.infer<typeof planUsage>

export const subscriptionStatus = z.object({
  plan_key: z.string().nullable(),
  plan_name: z.string().nullable(),
  plan_gate: z.enum(['active', 'grandfathered', 'grace', 'expired']),
  plan_expiry: z.string().nullable(),
  /** When access ends, whichever gate holds it open -- a trial's last day included (0210). */
  access_until: z.string().nullable().nullish(),
  /** Whole days until access_until; negative once it has passed. */
  days_left: z.number().int().nullable().nullish(),
  can_purchase: z.boolean().default(true),
  /**
   * Where the plan on the account came from: a paid order, a trial nobody
   * paid for, or a grandfathering grant. Two studios both reading "Active"
   * for different reasons is the whole point of showing it.
   */
  plan_source: z.enum(['paid', 'trial', 'grandfathered', 'grace', 'none']).default('none'),
  latest_order_id: z.string().nullable().nullish(),
  latest_order_status: z.string().nullable().nullish(),
  webhook_configured: z.boolean().nullish(),
  /** IPC Diamond members get 30 days and member prices; everyone else 7 days and one plan (0214). */
  member_tier: z.enum(['outsider', 'diamond']).default('outsider'),
  /** The studio's latest screenshot claim, for the verify card. */
  diamond_claim: z
    .object({
      status: z.enum(['pending', 'approved', 'rejected', 'revoked']),
      reason: z.string().nullable(),
      created_at: z.string(),
    })
    .nullable()
    .default(null),
  /** Where to find the IPC Diamonds group, set by the platform (0217). */
  diamond_group_link: z.string().nullable().default(null),
  history: z.array(z.object({
    id: z.string(), plan_name: z.string().nullable(), amount: z.number().nullable(),
    status: z.string().nullable(), created_at: z.string().nullable(), expires_at: z.string().nullable(),
  })).nullish(),
})
export type SubscriptionStatus = z.infer<typeof subscriptionStatus>

/** "I am an IPC Diamond member": the screenshot of the group, uploaded through /files first. */
export const diamondClaimRequest = z.object({ file_id: uuid })
export type DiamondClaimRequest = z.infer<typeof diamondClaimRequest>

export const diamondClaimResult = z.object({
  status: z.enum(['pending', 'approved', 'rejected']),
  reason: z.string().nullable(),
  /** When access now ends, after an approval. */
  access_until: z.string().nullable(),
})
export type DiamondClaimResult = z.infer<typeof diamondClaimResult>

export const createOrderRequest = z.object({ plan_id: uuid })
export type CreateOrderRequest = z.infer<typeof createOrderRequest>

/**
 * What checkout needs. When Razorpay is configured the order exists at the
 * provider and `razorpay_order_id` + `key_id` open Checkout; when it is not
 * (a dev bench) both are null and the client may activate directly — the API
 * refuses that path outside dev-like environments.
 */
export const createOrderResponse = z.object({
  order_id: uuid,
  amount: money,
  currency: z.string().default('INR'),
  razorpay_order_id: z.string().nullable().default(null),
  key_id: z.string().nullable().default(null),
})
export type CreateOrderResponse = z.infer<typeof createOrderResponse>

export const activateRequest = z.object({
  order_id: uuid,
  payment_id: z.string().min(1).max(100),
  signature: z.string().min(1).max(200).optional(),
})
export type ActivateRequest = z.infer<typeof activateRequest>

export const activateResponse = z.object({
  duplicate: z.boolean(),
  expires_at: z.string(),
})
export type ActivateResponse = z.infer<typeof activateResponse>
