import { z } from 'zod'
import { isoDateTime, uuid } from './shared/primitives'

/**
 * Messaging wallet (migration 0186). Money is whole paise everywhere.
 * Studios see the price they pay per message; only the platform console sees
 * Meta's cost and the markup.
 */

const paise = z.coerce.number().int()

export const messageChannel = z.enum(['whatsapp', 'email'])
export type MessageChannel = z.infer<typeof messageChannel>

export const messagingEvent = z.enum(['start_reminder', 'leave_decided', 'payslip_ready', 'shoot_tomorrow', 'client_payment_due'])
export type MessagingEvent = z.infer<typeof messagingEvent>

/** `emailOnly`: there is no WhatsApp template for it (it goes to clients). */
export const MESSAGING_EVENTS: ReadonlyArray<{ key: MessagingEvent; label: string; detail: string; emailOnly?: boolean }> = [
  { key: 'start_reminder', label: 'Start reminders', detail: 'To the editor or team member, when work should start.' },
  { key: 'leave_decided', label: 'Leave decisions', detail: 'To the person who asked, when leave is approved or not.' },
  { key: 'payslip_ready', label: 'Payslip ready', detail: 'To the team member, when their payslip is shared.' },
  { key: 'shoot_tomorrow', label: 'Shoot tomorrow', detail: 'To the crew, the evening before a shoot.' },
  {
    key: 'client_payment_due',
    label: 'Payment reminders to clients',
    detail: 'To your client, 3 days before an invoice is due, on the day, then 3 and 10 days after, while money is due.',
    emailOnly: true,
  },
]

export const messageStatus = z.enum([
  'queued', 'sending', 'sent', 'delivered', 'read', 'failed', 'skipped_no_balance', 'skipped_opt_out', 'skipped_limit',
])
export type MessageStatus = z.infer<typeof messageStatus>

export const ledgerSource = z.enum(['recharge_manual', 'razorpay', 'whatsapp', 'email', 'adjustment', 'refund'])
export type LedgerSource = z.infer<typeof ledgerSource>

export const messageCategory = z.enum(['utility', 'marketing', 'authentication', 'email'])
export type MessageCategory = z.infer<typeof messageCategory>

export const rechargeStatus = z.enum(['pending', 'fulfilled', 'rejected', 'cancelled'])
export type RechargeStatus = z.infer<typeof rechargeStatus>

export const walletState = z.object({
  balance_paise: paise,
  low_balance_paise: paise,
  /** Below the alert level and something is switched on that needs money. */
  low: z.boolean(),
  whatsapp_live: z.boolean(),
  /** The platform's switch (0188). Off: WhatsApp is hidden and never sent. */
  whatsapp_enabled: z.boolean().default(false),
})
export type WalletState = z.infer<typeof walletState>

export const messagingPrice = z.object({
  channel: messageChannel,
  category: messageCategory,
  price_paise: paise,
  free_monthly: z.coerce.number().int(),
})
export type MessagingPrice = z.infer<typeof messagingPrice>

export const rechargeRequest = z.object({
  id: uuid,
  amount_paise: paise,
  note: z.string().nullable(),
  status: rechargeStatus,
  created_at: isoDateTime,
  decided_at: isoDateTime.nullable(),
  admin_note: z.string().nullable(),
})
export type RechargeRequest = z.infer<typeof rechargeRequest>

export const messagingSetting = z.object({
  event: messagingEvent,
  whatsapp: z.boolean(),
  email: z.boolean(),
})
export type MessagingSetting = z.infer<typeof messagingSetting>

export const outboxMessage = z.object({
  id: uuid,
  channel: messageChannel,
  to_address: z.string(),
  template_key: z.string().nullable(),
  subject: z.string().nullable(),
  status: messageStatus,
  cost_paise: paise,
  error: z.string().nullable(),
  created_at: isoDateTime,
  refunded: z.boolean(),
})
export type OutboxMessage = z.infer<typeof outboxMessage>

export const messagingUsage = z.object({
  whatsapp_count: z.coerce.number().int(),
  whatsapp_paise: paise,
  email_free_used: z.coerce.number().int(),
  email_free_monthly: z.coerce.number().int(),
  email_charged_count: z.coerce.number().int(),
  email_paise: paise,
  skipped_no_balance: z.coerce.number().int(),
  /** Every email this month (free and paid) against the studio's cap. */
  email_month_count: z.coerce.number().int().default(0),
  email_monthly_cap: z.coerce.number().int().default(10000),
  skipped_limit: z.coerce.number().int().default(0),
})
export type MessagingUsage = z.infer<typeof messagingUsage>

export const messagingSummary = z.object({
  wallet: walletState,
  usage: messagingUsage,
  prices: z.array(messagingPrice),
  settings: z.array(messagingSetting),
  requests: z.array(rechargeRequest),
  recent: z.array(outboxMessage),
  email_live: z.boolean(),
  whatsapp_enabled: z.boolean().default(false),
})
export type MessagingSummary = z.infer<typeof messagingSummary>

export const ledgerEntry = z.object({
  id: uuid,
  kind: z.enum(['credit', 'debit']),
  amount_paise: paise,
  balance_after: paise,
  source: ledgerSource,
  reference: z.string().nullable(),
  note: z.string().nullable(),
  message_id: uuid.nullable(),
  created_at: isoDateTime,
})
export type LedgerEntry = z.infer<typeof ledgerEntry>

export const ledgerQuery = z.object({
  source: ledgerSource.optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
})

export const createRechargeRequest = z.object({
  amount_paise: z.number().int().min(10000, 'The smallest recharge is ₹100.').max(10000000, 'The largest recharge is ₹1,00,000.'),
  note: z.string().trim().max(300).optional(),
})
export type CreateRechargeRequest = z.infer<typeof createRechargeRequest>

export const updateMessagingSettings = z.object({
  events: z.array(messagingSetting).max(10).optional(),
  low_balance_paise: z.number().int().min(0).max(10000000).optional(),
})
export type UpdateMessagingSettings = z.infer<typeof updateMessagingSettings>

export const testMessageRequest = z.object({ channel: messageChannel })
export const testMessageResult = z.object({ id: uuid, status: messageStatus, error: z.string().nullable() })
export type TestMessageResult = z.infer<typeof testMessageResult>

// ── platform console ─────────────────────────────────────────────

export const platformWallet = z.object({
  company_id: uuid,
  company_name: z.string(),
  balance_paise: paise,
  low_balance_paise: paise,
  overdraft_paise: paise,
  pending_requests: z.coerce.number().int(),
  month_whatsapp: z.coerce.number().int(),
  month_emails: z.coerce.number().int(),
  month_charged_paise: paise,
  last_activity: isoDateTime.nullable(),
  email_monthly_cap: z.coerce.number().int().default(10000),
})
export type PlatformWallet = z.infer<typeof platformWallet>

export const platformRechargeRequest = rechargeRequest.extend({
  company_id: uuid,
  company_name: z.string(),
  requested_by_name: z.string().nullable(),
  balance_paise: paise,
})
export type PlatformRechargeRequest = z.infer<typeof platformRechargeRequest>

export const platformCreditRequest = z.object({
  company_id: uuid,
  amount_paise: z.number().int().min(1).max(10000000),
  reference: z.string().trim().min(1, 'Add the payment reference.').max(200),
  note: z.string().trim().max(500).optional(),
  request_id: uuid.optional(),
})
export type PlatformCreditRequest = z.infer<typeof platformCreditRequest>

export const platformAdjustRequest = z.object({
  company_id: uuid,
  /** Positive adds, negative takes away. */
  amount_paise: z.number().int().min(-10000000).max(10000000).refine((v) => v !== 0, 'Enter an amount.'),
  note: z.string().trim().min(1, 'Say why.').max(500),
})
export type PlatformAdjustRequest = z.infer<typeof platformAdjustRequest>

export const platformOverdraftRequest = z.object({
  company_id: uuid,
  overdraft_paise: z.number().int().min(0).max(100000),
})

export const platformEmailCapRequest = z.object({
  company_id: uuid,
  email_monthly_cap: z.number().int().min(0).max(1000000),
})
export type PlatformEmailCapRequest = z.infer<typeof platformEmailCapRequest>

/** The platform switch and this month's totals across every studio. */
export const platformMessagingSettings = z.object({
  whatsapp_enabled: z.boolean(),
  month_emails: z.coerce.number().int(),
  month_whatsapp: z.coerce.number().int(),
  month_skipped_limit: z.coerce.number().int(),
})
export type PlatformMessagingSettings = z.infer<typeof platformMessagingSettings>

export const platformSetMessagingSettings = z.object({ whatsapp_enabled: z.boolean() })

export const platformRejectRecharge = z.object({ note: z.string().trim().max(300).optional() })

export const platformPrice = z.object({
  id: uuid,
  channel: messageChannel,
  category: messageCategory,
  meta_cost_paise: paise,
  markup_pct: z.coerce.number(),
  markup_fixed_paise: paise,
  free_monthly: z.coerce.number().int(),
  effective_from: isoDateTime,
  price_paise: paise,
})
export type PlatformPrice = z.infer<typeof platformPrice>

export const platformSetPrice = z.object({
  channel: messageChannel,
  category: messageCategory,
  meta_cost_paise: z.number().int().min(0).max(100000),
  markup_pct: z.number().min(0).max(1000),
  markup_fixed_paise: z.number().int().min(0).max(100000),
  free_monthly: z.number().int().min(0).max(1000000).optional(),
})
export type PlatformSetPrice = z.infer<typeof platformSetPrice>

export const templateStatus = z.enum(['approved', 'pending', 'rejected', 'paused'])
export type TemplateStatus = z.infer<typeof templateStatus>

export const whatsappTemplate = z.object({
  id: uuid,
  key: z.string(),
  name: z.string(),
  meta_template_name: z.string(),
  language: z.string(),
  category: z.enum(['utility', 'marketing', 'authentication']),
  body: z.string(),
  variables: z.array(z.string()),
  status: templateStatus,
  updated_at: isoDateTime,
})
export type WhatsappTemplate = z.infer<typeof whatsappTemplate>

export const saveWhatsappTemplate = z.object({
  key: z.string().regex(/^[a-z0-9_]{2,60}$/, 'Use lowercase letters, numbers and _.'),
  name: z.string().trim().min(1).max(80),
  meta_template_name: z.string().regex(/^[a-z0-9_]{1,250}$/, 'Use the exact name from WhatsApp Manager.'),
  language: z.string().regex(/^[a-z]{2,3}(_[A-Z]{2})?$/).default('en'),
  category: z.enum(['utility', 'marketing', 'authentication']).default('utility'),
  body: z.string().trim().min(1).max(1024),
  variables: z.array(z.string().trim().max(80)).max(20).default([]),
  status: templateStatus.default('pending'),
})
export type SaveWhatsappTemplate = z.infer<typeof saveWhatsappTemplate>

export const platformOutboxMessage = z.object({
  id: uuid,
  company_id: uuid,
  company_name: z.string(),
  channel: messageChannel,
  to_address: z.string(),
  template_key: z.string().nullable(),
  status: messageStatus,
  cost_paise: paise,
  error: z.string().nullable(),
  created_at: isoDateTime,
  sent_at: isoDateTime.nullable(),
  refunded: z.boolean(),
})
export type PlatformOutboxMessage = z.infer<typeof platformOutboxMessage>

export const marginRow = z.object({
  month: z.string(),
  channel: messageChannel,
  messages: z.coerce.number().int(),
  charged_paise: paise,
  cost_paise: paise,
  margin_paise: paise,
})
export type MarginRow = z.infer<typeof marginRow>

export const messagesCronResult = z.object({
  ok: z.literal(true),
  claimed: z.number().int(),
  sent: z.number().int(),
  failed: z.number().int(),
})

// ── payment reminders to clients (0188) ──────────────────────────

/** What a reminder on this invoice would cost now, and when the last one went. */
export const paymentReminderQuote = z.object({
  client_email: z.string().nullable(),
  price_paise: paise,
  free_monthly: z.coerce.number().int(),
  free_used: z.coerce.number().int(),
  month_emails: z.coerce.number().int(),
  email_monthly_cap: z.coerce.number().int(),
  can_afford: z.boolean(),
  /** The studio has automatic reminders switched on. */
  auto_on: z.boolean(),
  last_sent_at: isoDateTime.nullable(),
  reminders_sent: z.coerce.number().int(),
})
export type PaymentReminderQuote = z.infer<typeof paymentReminderQuote>

export const paymentReminderResult = z.object({
  id: uuid.nullable(),
  /** A message status, or no_email when the client has no usable address. */
  status: z.union([messageStatus, z.literal('no_email')]),
  error: z.string().nullable(),
  cost_paise: paise,
  free_allowance: z.boolean(),
  /** A second click inside 10 minutes: this is the first reminder, not a new one. */
  repeated: z.boolean(),
})
export type PaymentReminderResult = z.infer<typeof paymentReminderResult>
