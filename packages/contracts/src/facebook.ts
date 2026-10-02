import { z } from 'zod'
import { uuid, isoDateTime } from './shared/primitives'

/**
 * Facebook (Meta) parity — minimal viable. OAuth URLs are derived from the
 * existing META_* env; page + import state lives in fb_pages /
 * fb_lead_imports (migration 0100). Tokens are never returned to the client.
 */

export const fbConnectionStatus = z.enum(['active', 'expired', 'revoked', 'error'])
export type FbConnectionStatus = z.infer<typeof fbConnectionStatus>

export const fbConnectUrlResponse = z.object({
  connect_url: z.string().nullable(),
  app_id: z.string().nullable(),
  redirect_uri: z.string().nullable(),
  missing_config: z.array(z.string()).default([]),
})
export type FbConnectUrlResponse = z.infer<typeof fbConnectUrlResponse>

export const fbStatusResponse = z.object({
  connected: z.boolean(),
  page_count: z.number().int(),
  connected_page_count: z.number().int(),
  webhook_subscribed_count: z.number().int().default(0),
  missing_config: z.array(z.string()).default([]),
  last_synced_at: isoDateTime.nullable().default(null),
  last_error: z.string().nullable().default(null),
  /** The server can seal page tokens (WHATSAPP_TOKEN_KEY, or a dev key). */
  ready: z.boolean().default(true),
  /** Where the Meta app's leadgen webhook must point; one address for every studio. */
  webhook_url: z.string().nullable().default(null),
  /** When the last lead came in through a connected page. */
  last_lead_at: isoDateTime.nullable().default(null),
})
export type FbStatusResponse = z.infer<typeof fbStatusResponse>

export const fbPage = z.object({
  id: uuid,
  page_id: z.string(),
  page_name: z.string(),
  category: z.string().nullable(),
  is_connected: z.boolean(),
  webhook_subscribed: z.boolean(),
  last_synced_at: isoDateTime.nullable(),
  last_error: z.string().nullable(),
  created_at: isoDateTime,
  connected_via: z.enum(['oauth', 'token']).nullable().default(null),
  subscribed_at: isoDateTime.nullable().default(null),
  /** We hold a token for this page, so Connect will work. */
  has_token: z.boolean().default(false),
})
export type FbPage = z.infer<typeof fbPage>

export const fbPageConnectRequest = z.object({
  page_id: z.string().trim().min(1).max(64),
  page_name: z.string().trim().min(1).max(160).optional(),
})
export type FbPageConnectRequest = z.infer<typeof fbPageConnectRequest>

/** Our side is off and the token is gone; `unsubscribed` is whether Facebook confirmed it stopped posting. */
export const fbDisconnectResponse = z.object({ ok: z.literal(true), unsubscribed: z.boolean() })
export type FbDisconnectResponse = z.infer<typeof fbDisconnectResponse>

/** POST /meta/check: true when Facebook no longer accepts our tokens and the connection was forgotten. */
export const fbCheckResponse = z.object({ expired: z.boolean() })
export type FbCheckResponse = z.infer<typeof fbCheckResponse>

/** POST /meta/reset ("Disconnect Facebook"): how many pages were forgotten, how many Facebook confirmed unsubscribed. */
export const fbResetResponse = z.object({ ok: z.literal(true), forgotten: z.number().int(), unsubscribed: z.number().int() })
export type FbResetResponse = z.infer<typeof fbResetResponse>

export const fbTokenRequest = z.object({
  /** Manual long-lived page/user token (used when OAuth is not configured). */
  token: z.string().trim().min(10).max(2000),
})
export type FbTokenRequest = z.infer<typeof fbTokenRequest>

/** "Connect with Facebook" sent the browser back with ?code=; the server trades it for page tokens. */
export const fbExchangeRequest = z.object({
  code: z.string().trim().min(10).max(4000),
})
export type FbExchangeRequest = z.infer<typeof fbExchangeRequest>

/** GET /crm/sources/:id/leads — the per-source FB import log. */
export const fbImportStatus = z.enum(['imported', 'duplicate', 'failed', 'pending'])
export type FbImportStatus = z.infer<typeof fbImportStatus>

export const fbLeadImport = z.object({
  id: uuid,
  source_id: uuid.nullable(),
  page_id: z.string().nullable(),
  page_name: z.string().nullable(),
  leadgen_id: z.string().nullable(),
  name: z.string().nullable(),
  phone: z.string().nullable(),
  email: z.string().nullable(),
  status: fbImportStatus,
  error: z.string().nullable(),
  lead_id: uuid.nullable(),
  created_at: isoDateTime,
})
export type FbLeadImport = z.infer<typeof fbLeadImport>

export const fbImportsQuery = z.object({
  search: z.string().trim().max(200).optional(),
  status: fbImportStatus.optional(),
  page: z.string().trim().max(64).optional(),
  date_from: isoDateTime.optional(),
  date_to: isoDateTime.optional(),
  sort: z.enum(['newest', 'oldest']).default('newest'),
  limit: z.coerce.number().int().min(1).max(200).default(100),
})
export type FbImportsQuery = z.infer<typeof fbImportsQuery>

export const fbImportsSummary = z.object({
  total: z.number().int(),
  imported: z.number().int(),
  duplicates: z.number().int(),
  failed: z.number().int(),
  pending: z.number().int(),
})
export type FbImportsSummary = z.infer<typeof fbImportsSummary>

export const fbTestImportRequest = z.object({
  name: z.string().trim().max(160).optional(),
  phone: z.string().trim().min(6).max(30),
  email: z.string().trim().max(200).optional(),
  page_id: z.string().trim().max(64).optional(),
  page_name: z.string().trim().max(160).optional(),
})
export type FbTestImportRequest = z.infer<typeof fbTestImportRequest>
