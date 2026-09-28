import { z } from 'zod'
import { isoDateTime } from './shared/primitives'

/**
 * The studio's own WhatsApp number (0203). The screens never see the token:
 * only whether it works, which number it is, and how Meta reaches us.
 */
const digits = (what: string) => z.string().trim().regex(/^[0-9]{5,30}$/, `${what} is a long number from Meta.`)

export const whatsappConnectRequest = z.object({
  phone_number_id: digits('Phone number ID'),
  waba_id: digits('WhatsApp Business Account ID'),
  access_token: z.string().trim().min(20, 'Paste the permanent access token.').max(1000),
  app_secret: z.string().trim().max(200).nullish(),
})
export type WhatsappConnectRequest = z.infer<typeof whatsappConnectRequest>

export const whatsappEmbeddedRequest = z.object({
  code: z.string().trim().min(10).max(2000),
  phone_number_id: digits('Phone number ID'),
  waba_id: digits('WhatsApp Business Account ID'),
})
export type WhatsappEmbeddedRequest = z.infer<typeof whatsappEmbeddedRequest>

export const whatsappStatus = z.object({
  entitled: z.boolean(),
  /** The server can store a token (WHATSAPP_TOKEN_KEY is set). */
  ready: z.boolean(),
  /** "Connect with Facebook" is set up on this server. */
  embedded: z.object({ app_id: z.string(), config_id: z.string() }).nullable(),
  connection: z
    .object({
      phone_number_id: z.string(),
      waba_id: z.string(),
      display_phone: z.string().nullable(),
      verified_name: z.string().nullable(),
      via: z.enum(['manual', 'embedded']),
      status: z.enum(['connected', 'error']),
      last_error: z.string().nullable(),
      connected_at: isoDateTime,
      templates_synced_at: isoDateTime.nullable(),
      /** For a number on the studio's own Meta app: where Meta posts, and the token its handshake echoes. */
      webhook_url: z.string(),
      verify_token: z.string(),
      has_app_secret: z.boolean(),
    })
    .nullable(),
})
export type WhatsappStatus = z.infer<typeof whatsappStatus>

export const studioWhatsappTemplate = z.object({
  name: z.string(),
  language: z.string(),
  status: z.string(),
  category: z.string().nullable(),
  body: z.string().nullable(),
  param_count: z.number().int(),
})
export type StudioWhatsappTemplate = z.infer<typeof studioWhatsappTemplate>
