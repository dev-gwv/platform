import { z } from 'zod'

/**
 * Support call bookings and their WhatsApp messages (0280).
 *
 * `supportCallNotice` is what the booking app sends to POST
 * /webhooks/support-call (docs/support-call-webhook.md); the rest is the
 * Platform -> Support calls page, which only platform admins can open.
 */

export const supportCallNoticeKind = z.enum(['booking.created', 'booking.rescheduled', 'booking.cancelled'])
export type SupportCallNoticeKind = z.infer<typeof supportCallNoticeKind>

const text = (max: number) => z.string().trim().max(max)

export const supportCallNotice = z.object({
  /** Unique per notice. A notice sent again with the same id is ignored. */
  id: text(200).min(1),
  event: supportCallNoticeKind,
  booking: z.object({
    /** The booking's own id; a reschedule keeps it. */
    id: text(200).min(1),
    start: z.string().datetime({ offset: true }),
    end: z.string().datetime({ offset: true }).nullish(),
    timezone: text(64).nullish(),
    event_type: text(120).nullish(),
    meeting_url: z.string().trim().url().max(1000).nullish(),
    notes: text(2000).nullish(),
    invitee: z.object({
      name: text(200).default(''),
      email: z.string().trim().max(320).nullish(),
      phone: text(40).nullish(),
      /** They ticked "remind me on WhatsApp". Without it nothing goes to their phone. */
      whatsapp_ok: z.boolean().default(false),
    }),
    utm: z
      .object({
        source: text(200).nullish(),
        medium: text(200).nullish(),
        campaign: text(200).nullish(),
        content: text(200).nullish(),
        term: text(200).nullish(),
      })
      .partial()
      .nullish(),
    /** The page the booking was made from (the embed's `parent`). */
    parent: text(1000).nullish(),
  }),
})
export type SupportCallNotice = z.infer<typeof supportCallNotice>

const templateName = z
  .string()
  .trim()
  .regex(/^[a-z0-9_]{1,512}$/, 'A template name is lowercase letters, numbers and _, as in Meta.')

/** The switches and numbers. Everything starts off. */
export const supportWhatsappSettings = z.object({
  official_on: z.boolean(),
  bot_on: z.boolean(),
  /** The support team's own numbers, digits with the country code first. */
  team_numbers: z.array(z.string().regex(/^\d{10,15}$/, 'A number is 10 to 15 digits, country code first.')).max(10),
  group_jid: z.string().regex(/^[\d-]+@g\.us$/, 'Pick the group from the list.').nullable(),
  group_name: z.string().max(200).nullable(),
  hourly_cap: z.number().int().min(1).max(60),
  daily_cap: z.number().int().min(1).max(300),
  daily_summary: z.boolean(),
  tpl_booked: templateName,
  tpl_reminder: templateName,
  tpl_cancelled: templateName,
  tpl_team: templateName,
})
export type SupportWhatsappSettings = z.infer<typeof supportWhatsappSettings>

/** The bot's connection, as the wa-bot container reports it. */
export const supportBotStatus = z.object({
  /** off: no bot on this server; open: linked and posting. */
  state: z.enum(['off', 'unreachable', 'connecting', 'qr', 'open', 'logged_out']),
  /** The QR to scan with the spare phone while state is 'qr'. */
  qr: z.string().nullable().default(null),
  /** The linked number, once open. */
  me: z.string().nullable().default(null),
  sent_last_hour: z.number().int().default(0),
  sent_today: z.number().int().default(0),
})
export type SupportBotStatus = z.infer<typeof supportBotStatus>

export const supportCallBookingRow = z.object({
  id: z.string(),
  status: z.enum(['booked', 'rescheduled', 'cancelled']),
  starts_at: z.string(),
  name: z.string(),
  studio_name: z.string().nullable(),
  whatsapp_ok: z.boolean(),
  has_phone: z.boolean(),
})

export const supportCallMessageRow = z.object({
  id: z.string(),
  channel: z.enum(['official', 'group']),
  audience: z.enum(['booker', 'team', 'group']),
  /** Masked: the last four digits only. */
  to: z.string().nullable(),
  what: z.string(),
  status: z.enum(['queued', 'sending', 'sent', 'failed', 'skipped']),
  last_error: z.string().nullable(),
  send_after: z.string(),
  sent_at: z.string().nullable(),
})
export type SupportCallMessageRow = z.infer<typeof supportCallMessageRow>

export const supportWhatsappOverview = z.object({
  settings: supportWhatsappSettings,
  /** Whether the server holds what each part needs. */
  ready: z.object({ webhook_secret: z.boolean(), official_api: z.boolean(), bot_secret: z.boolean() }),
  bot: supportBotStatus,
  bookings: z.array(supportCallBookingRow),
  messages: z.array(supportCallMessageRow),
})
export type SupportWhatsappOverview = z.infer<typeof supportWhatsappOverview>

export const supportBotGroup = z.object({ jid: z.string(), name: z.string(), size: z.number().int() })
export type SupportBotGroup = z.infer<typeof supportBotGroup>
