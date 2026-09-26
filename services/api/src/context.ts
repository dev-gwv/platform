import type { PlanGate } from '@ipc/contracts'
import type { AppRole, ResolvedAccess } from '@ipc/permissions'

/** Secrets + vars from the runtime env (process.env under Bun). */
export interface Env {
  ENVIRONMENT: string
  /** Postgres connection string the API connects as (the `authenticator` role). */
  DATABASE_URL: string
  /** HS256 secret for signing/verifying app JWTs (replaces GoTrue). */
  JWT_SECRET: string
  CRON_SECRET: string
  /** Email (Resend) for verification mail. */
  RESEND_API_KEY: string
  EMAIL_FROM: string
  /** Where "Suggest a feature" is emailed (optional; the platform inbox has them all regardless). */
  PLATFORM_FEEDBACK_EMAIL?: string
  /** Public web app origin, used to build the verification link. */
  APP_URL: string
  RAZORPAY_KEY_ID: string
  RAZORPAY_KEY_SECRET: string
  RAZORPAY_WEBHOOK_SECRET: string
  /** Meta lead-ads webhook subscription handshake secret. */
  META_VERIFY_TOKEN: string
  /** Meta app secret: verifies X-Hub-Signature-256 on lead-ads webhook posts. */
  META_APP_SECRET: string
  /** Page access token used to fetch a lead's fields from the Graph API by leadgen_id. */
  META_PAGE_ACCESS_TOKEN: string
  /** WhatsApp Cloud API: the sending phone number id and its access token. */
  WHATSAPP_PHONE_NUMBER_ID: string
  WHATSAPP_ACCESS_TOKEN: string
  /**
   * Verify token for the WhatsApp Business Account webhook handshake
   * (GET /webhooks/whatsapp). Optional: falls back to META_VERIFY_TOKEN.
   */
  WHATSAPP_VERIFY_TOKEN?: string
  /** Twilio Programmable Voice for click-to-call (lib/twilio.ts). All three or none. */
  TWILIO_ACCOUNT_SID: string
  TWILIO_AUTH_TOKEN: string
  TWILIO_FROM_NUMBER: string
  /** Mailbox sync (lib/email-sync.ts): 'gmail' | 'o365', a bearer token, and the mailbox address. */
  EMAIL_SYNC_PROVIDER: string
  EMAIL_SYNC_TOKEN: string
  EMAIL_SYNC_MAILBOX: string
  /**
   * Refresh-token cookie mode. '1' moves the refresh token into an HttpOnly
   * cookie on the API origin (see lib/session-cookie.ts). Unset = body token.
   */
  AUTH_COOKIE: string
  /** 'lax' (default) or 'none' (app and API on different sites; needs Secure). */
  AUTH_COOKIE_SAMESITE: string
  /** Optional cookie Domain attribute, e.g. .yourstudio.in */
  AUTH_COOKIE_DOMAIN: string
  /** Comma-separated allowlist of browser origins; empty = allow all (dev). */
  ALLOWED_ORIGINS: string
  /**
   * Header the proxy in front of the API writes the client address to.
   * Default X-Forwarded-For (last hop). See lib/client-ip.ts.
   */
  CLIENT_IP_HEADER: string
  /**
   * Sentry DSN. Unset = errors are logged only and no traces, cron check-ins
   * or performance data are sent. Read at startup by `instrument.ts`, which
   * is why it is process env rather than a binding.
   */
  SENTRY_DSN: string
  /**
   * 0..1. Share of requests traced. Default 0.1 in production, 1 elsewhere.
   * 0 turns tracing off while leaving error reporting on.
   */
  SENTRY_TRACES_SAMPLE_RATE: string
  /** debug | info | warn | error (default info). */
  LOG_LEVEL: string
  /** Build/release identifier surfaced by /health and error reports. */
  APP_VERSION: string
  /** Google OAuth Client ID for GIS id_token verification (optional). */
  GOOGLE_CLIENT_ID: string
}

/**
 * Per-request auth context, resolved once by middleware and read everywhere.
 * Tenancy lives HERE, never in handlers — the repository layer takes
 * `companyId` from this and refuses a query without it.
 */
export interface AuthContext {
  userId: string
  companyId: string
  role: AppRole
  isOwner: boolean
  /** Member of the cross-tenant platform_admins allowlist (vendor console). */
  isPlatformAdmin: boolean
  displayName: string
  email: string
  planGate: PlanGate
  planExpiry: string | null
  access: ResolvedAccess
}

/** Hono generics: bind Env + typed context Variables. */
export interface AppEnv {
  Bindings: Env
  Variables: {
    auth: AuthContext
    /** Set by the request-id middleware on every request. */
    requestId: string
  }
}
