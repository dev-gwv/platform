import { z } from 'zod'
import { email, phone, uuid, isoDateTime } from './shared/primitives'

/**
 * Auth contracts. Identity = Supabase Auth (Firebase dropped).
 * The Supabase session (access token) is the credential; the server resolves
 * company + role from it. These contracts cover only the app-level payloads.
 */

/** Register a brand-new studio: creates the auth user + company + owner admin. */
export const registerRequest = z.object({
  company_name: z.string().trim().min(2).max(120),
  admin_name: z.string().trim().min(2).max(120),
  email,
  password: z.string().min(8).max(200),
  phone: phone,
})
export type RegisterRequest = z.infer<typeof registerRequest>

/** Email + password sign-in. */
export const loginRequest = z.object({
  email,
  password: z.string().min(1).max(200),
})
export type LoginRequest = z.infer<typeof loginRequest>

/**
 * What every sign-in path returns: a short-lived bearer access token plus the
 * refresh token that rotates it. `expires_in` is seconds on the access token.
 */
export const authToken = z.object({
  access_token: z.string(),
  /** Empty when the API keeps the refresh token in its HttpOnly cookie. */
  refresh_token: z.string(),
  token_type: z.literal('bearer'),
  expires_in: z.number().int().positive(),
  /** True only right after a brand-new Google sign-in with no studio yet -- route to /complete-setup instead of the dashboard. */
  needs_setup: z.boolean().default(false),
})
export type AuthToken = z.infer<typeof authToken>

/** Finishes setting up a studio for someone who just signed in via Google as a brand-new identity. */
export const completeSetupRequest = z.object({
  company_name: z.string().trim().min(2).max(120),
  admin_name: z.string().trim().min(2).max(120),
  phone: phone,
})
export type CompleteSetupRequest = z.infer<typeof completeSetupRequest>

/**
 * Exchange a refresh token for a fresh pair (the old one is spent). The token
 * is optional in the body because in cookie mode (AUTH_COOKIE=1) the API reads
 * it from the HttpOnly cookie instead.
 */
export const refreshRequest = z.object({ refresh_token: z.string().min(1).optional() })
export type RefreshRequest = z.infer<typeof refreshRequest>

/** Sign out this device. The refresh token identifies the session to kill. */
export const logoutRequest = z.object({ refresh_token: z.string().min(1).optional() })
export type LogoutRequest = z.infer<typeof logoutRequest>

/** /auth/register response — email verification is required before sign-in. */
export const registerResult = z.object({
  verification_required: z.literal(true),
  email,
  /** Present only outside production (ENVIRONMENT !== 'production') for tests. */
  verification_token: z.string().optional(),
})
export type RegisterResult = z.infer<typeof registerResult>

/** Confirm an email via the token from the verification link. */
export const verifyEmailRequest = z.object({ token: z.string().min(1) })
export type VerifyEmailRequest = z.infer<typeof verifyEmailRequest>

/** Re-send the verification email. */
export const resendVerificationRequest = z.object({ email })
export type ResendVerificationRequest = z.infer<typeof resendVerificationRequest>

/** Start a password reset. Always answered the same way — no account enumeration. */
export const forgotPasswordRequest = z.object({ email })
export type ForgotPasswordRequest = z.infer<typeof forgotPasswordRequest>

export const forgotPasswordResult = z.object({
  ok: z.literal(true),
  /** Present only outside production (ENVIRONMENT !== 'production') for tests. */
  reset_token: z.string().optional(),
})
export type ForgotPasswordResult = z.infer<typeof forgotPasswordResult>

/** Finish a password reset with the token from the emailed link. */
export const resetPasswordRequest = z.object({
  token: z.string().min(1),
  password: z.string().min(8).max(200),
})
export type ResetPasswordRequest = z.infer<typeof resetPasswordRequest>

/**
 * Change the password while signed in. The current one is the proof it is
 * really them; every OTHER session is revoked and this device gets a fresh pair.
 */
export const changePasswordRequest = z
  .object({
    current_password: z.string().min(1).max(200),
    new_password: z.string().min(8).max(200),
  })
  .refine((v) => v.current_password !== v.new_password, {
    message: 'Choose a password you have not used before.',
    path: ['new_password'],
  })
export type ChangePasswordRequest = z.infer<typeof changePasswordRequest>

/** Plan-gate state resolved for the current company. */
export const planGate = z.enum(['active', 'grace', 'grandfathered', 'expired'])
export type PlanGate = z.infer<typeof planGate>

/** One studio a login belongs to. */
export const studioMembership = z.object({
  profile_id: uuid,
  company_id: uuid,
  company_name: z.string(),
  role: z.enum(['platform_admin', 'super_admin', 'admin', 'manager', 'employee', 'none']),
  is_owner: z.boolean(),
})
export type StudioMembership = z.infer<typeof studioMembership>

/** The whole-session payload the client hydrates from after login. */
export const sessionState = z.object({
  user_id: uuid,
  company_id: uuid,
  role: z.enum(['platform_admin', 'super_admin', 'admin', 'manager', 'employee', 'none']),
  is_owner: z.boolean(),
  /** Member of the cross-tenant platform_admins allowlist (vendor console). */
  is_platform_admin: z.boolean().default(false),
  display_name: z.string(),
  email,
  plan_gate: planGate,
  plan_expiry: isoDateTime.nullable(),
  /** Effective module permission keys, pre-composed server-side. */
  permissions: z.array(z.string()),
  /**
   * Every studio this login can open, the current one included. One person
   * can be on several studios' teams under one email -- a freelancer, or an
   * owner running more than one studio -- and this is what the studio
   * switcher lists. `profile_id` is the id to hand to POST /auth/switch.
   */
  studios: z.array(studioMembership).default([]),
  /**
   * Whether the studio's three-step setup is over: finished, skipped, or
   * already satisfied (a teammate, a client and a project exist). Defaults to
   * true so an older API never walks anyone through setup by accident.
   */
  setup_done: z.boolean().default(true),
  /** The first setup step still outstanding (1 team, 2 client, 3 project), or null. */
  setup_step: z.number().int().min(1).max(3).nullable().default(null),
})
export type SessionState = z.infer<typeof sessionState>

/** Open a different studio this login belongs to. */
export const switchStudioRequest = z.object({
  profile_id: uuid,
  /** The session being left, so its refresh family is revoked (body mode). */
  refresh_token: z.string().min(10).max(500).optional(),
})
export type SwitchStudioRequest = z.infer<typeof switchStudioRequest>
