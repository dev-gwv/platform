import { z } from 'zod'
import { uuid, isoDateTime } from './shared/primitives'

/**
 * Sequences (0202): a lead's follow-up plan where each step is a reminder, a
 * WhatsApp message or an email, written once and sent on its day.
 */
export const sequenceChannel = z.enum(['reminder', 'whatsapp', 'email'])
export type SequenceChannel = z.infer<typeof sequenceChannel>

const text = (max: number) => z.string().trim().max(max)

export const sequenceStepInput = z
  .object({
    day_offset: z.number().int().min(0).max(365),
    channel: sequenceChannel,
    send_hour: z.number().int().min(6).max(21).default(10),
    subject: text(150).nullish(),
    body: text(4000).nullish(),
    note: text(300).nullish(),
  })
  .superRefine((s, ctx) => {
    if (s.channel !== 'reminder' && !s.body) ctx.addIssue({ code: 'custom', path: ['body'], message: 'Write the message for this step.' })
    if (s.channel === 'email' && !s.subject) ctx.addIssue({ code: 'custom', path: ['subject'], message: 'An email needs a subject.' })
  })
export type SequenceStepInput = z.input<typeof sequenceStepInput>

export const sequenceInput = z.object({
  name: text(80).min(2, 'Give the sequence a name.'),
  description: text(500).nullish(),
  is_active: z.boolean().default(true),
  auto_start: z.boolean().default(false),
  /** A stage (name or status key): starts when a lead reaches it. Empty = new leads. */
  stage_filter: text(60).nullish(),
  source_filter: text(40).nullish(),
  stop_on_reply: z.boolean().default(true),
  steps: z.array(sequenceStepInput).min(1, 'Add at least one step.').max(20),
})
export type SequenceInput = z.input<typeof sequenceInput>

export const sequencePatch = z
  .object({ is_active: z.boolean(), auto_start: z.boolean() })
  .partial()
export type SequencePatch = z.infer<typeof sequencePatch>

export const sequenceStep = z.object({
  step_no: z.number().int(),
  day_offset: z.number().int(),
  channel: sequenceChannel,
  send_hour: z.number().int(),
  subject: z.string().nullable(),
  body: z.string().nullable(),
  note: z.string().nullable(),
  template_name: z.string().nullable(),
})
export type SequenceStep = z.infer<typeof sequenceStep>

export const sequence = z.object({
  id: uuid,
  name: z.string(),
  description: z.string().nullable(),
  is_active: z.boolean(),
  auto_start: z.boolean(),
  stage_filter: z.string().nullable(),
  source_filter: z.string().nullable(),
  stop_on_reply: z.boolean(),
  starter_key: z.string().nullable(),
  steps: z.array(sequenceStep),
  active_leads: z.number().int(),
  sent: z.number().int(),
  waiting: z.number().int(),
  replied: z.number().int(),
})
export type Sequence = z.infer<typeof sequence>

export const sequenceSendStatus = z.enum(['queued', 'sending', 'manual', 'sent', 'skipped', 'failed'])
export type SequenceSendStatus = z.infer<typeof sequenceSendStatus>

/** One message a sequence wrote, with the words already filled in. */
export const sequenceSend = z.object({
  id: uuid,
  lead_id: uuid,
  lead_name: z.string().nullable(),
  phone: z.string().nullable(),
  email: z.string().nullable(),
  sequence_name: z.string(),
  step_no: z.number().int(),
  channel: z.enum(['whatsapp', 'email']),
  subject: z.string().nullable(),
  text: z.string(),
  status: sequenceSendStatus,
  error: z.string().nullable(),
  due_at: isoDateTime,
  sent_at: isoDateTime.nullable(),
})
export type SequenceSend = z.infer<typeof sequenceSend>

export const leadSequence = z.object({
  current: z
    .object({
      cadence_id: uuid,
      name: z.string(),
      step_no: z.number().int(),
      total_steps: z.number().int(),
      next_at: isoDateTime.nullable(),
      next_channel: sequenceChannel.nullable(),
      started_at: isoDateTime,
      completed_at: isoDateTime.nullable(),
      stopped_at: isoDateTime.nullable(),
      stopped_reason: z.string().nullable(),
    })
    .nullable(),
  sends: z.array(sequenceSend),
})
export type LeadSequence = z.infer<typeof leadSequence>

export const enrollRequest = z.object({ lead_ids: z.array(uuid).min(1).max(200) })
export type EnrollRequest = z.infer<typeof enrollRequest>

// ── Higher-tier switches and the studio's branding ──────────
export const entitlementKey = z.enum(['sequences_auto', 'whatsapp_api', 'white_label'])
export type EntitlementKey = z.infer<typeof entitlementKey>

export const entitlementsResponse = z.object({ keys: z.array(entitlementKey) })
export type EntitlementsResponse = z.infer<typeof entitlementsResponse>

export const setEntitlementRequest = z.object({ key: entitlementKey, enabled: z.boolean() })
export type SetEntitlementRequest = z.infer<typeof setEntitlementRequest>

export const brandingInput = z.object({
  from_name: text(60).min(2).nullish(),
  reply_to: z.string().trim().email('Enter an email address.').max(200).nullish(),
  footer_line: text(200).nullish(),
})
export type BrandingInput = z.infer<typeof brandingInput>

export const branding = z.object({
  enabled: z.boolean(),
  studio_name: z.string(),
  logo_url: z.string().nullable(),
  from_name: z.string().nullable(),
  reply_to: z.string().nullable(),
  footer_line: z.string().nullable(),
})
export type Branding = z.infer<typeof branding>
