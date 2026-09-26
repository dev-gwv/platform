import { z } from 'zod'
import { uuid, isoDate, isoDateTime, money } from './shared/primitives'
import { invoiceLineInput } from './billing'

export const leadStatus = z.enum([
  'new',
  'contacted',
  'qualified',
  'proposal_sent',
  'converted',
  'lost',
])
export type LeadStatus = z.infer<typeof leadStatus>

export const leadSource = z.enum([
  'facebook',
  'webform',
  'referral',
  'manual',
  'enquiry',
  'instagram',
  'whatsapp',
  'google_form',
  'csv_import',
  'other',
])
export type LeadSource = z.infer<typeof leadSource>

export const leadQuality = z.enum(['hot', 'warm', 'cold'])
export type LeadQuality = z.infer<typeof leadQuality>

export const contactedStatus = z.enum(['uncontacted', 'contacted', 'unreachable'])
export type ContactedStatus = z.infer<typeof contactedStatus>

export const crmLead = z.object({
  id: uuid,
  name: z.string().nullable(),
  phone: z.string().nullable(),
  email: z.string().nullable(),
  source: leadSource,
  status: leadStatus,
  assigned_to: uuid.nullable(),
  assignee_name: z.string().nullable(),
  notes: z.string().nullable(),
  /** The next promised contact. Null means nobody has agreed to call back. */
  follow_up_at: isoDateTime.nullable(),
  last_contacted_at: isoDateTime.nullable(),
  converted_at: isoDateTime.nullable(),
  is_hot: z.boolean(),
  /** Lovable parity: lead temperature. 'hot' mirrors is_hot (kept in sync by trigger). */
  quality: leadQuality.nullable().default(null),
  /** Lovable parity: whether anyone has reached them (derived, but explicit). */
  contacted_status: contactedStatus.default('uncontacted'),
  /** Hidden from the working lists; still counted in history and reports. */
  is_archived: z.boolean().default(false),
  /** Set when this row was folded into another by a merge. */
  merged_into: uuid.nullable().default(null),
  /** The project this lead became, once converted. */
  converted_project_id: uuid.nullable().default(null),
  /**
   * The client this lead became. Set by both converts — the one that also
   * makes a project, and the "won, project comes later" one, which is the
   * only record that convert leaves behind at all.
   */
  converted_client_id: uuid.nullable().default(null),
  /** Deal value in INR (for forecast). */
  deal_value: z.number().nullable().default(null),
  probability: z.number().int().min(0).max(100).nullable().default(null),
  lost_reason: z.string().nullable().default(null),
  lost_competitor: z.string().nullable().default(null),
  sla_due_at: isoDateTime.nullable().default(null),
  /** The pipeline and stage the deal sits in; status is derived from the stage's kind. */
  pipeline_id: uuid.nullable().default(null),
  stage_id: uuid.nullable().default(null),
  stage_name: z.string().nullable().default(null),
  /** The person and (optionally) the organisation this deal belongs to. */
  contact_id: uuid.nullable().default(null),
  crm_company_id: uuid.nullable().default(null),
  crm_company_name: z.string().nullable().default(null),
  title: z.string().nullable().default(null),
  close_date: isoDate.nullable().default(null),
  event_type: z.string().nullable().default(null),
  event_date: isoDate.nullable().default(null),
  event_location: z.string().nullable().default(null),
  alternate_phone: z.string().nullable().default(null),
  city: z.string().nullable().default(null),
  currency: z.string().default('INR'),
  score: z.number().int().default(0),
  /** Free-text segment tag — "Hot Lead, Already Booked", "Referral VIP" — for quick filtering beyond the structured fields. */
  group_name: z.string().nullable().default(null),
  /**
   * Whether the studio is free on this lead's event_date (0193).
   *
   * Derived, never stored: computed from the studio's shoots and the other
   * open leads wanting the same day. 'unknown' is a lead with no date yet —
   * the honest answer to a question nobody has asked.
   */
  date_status: z.enum(['free', 'contested', 'booked', 'unknown']).default('unknown'),
  /** Open leads wanting this date, this one included. 2 means one rival. */
  date_wanted_by: z.number().int().default(0),
  created_at: isoDateTime,
})
export type CrmLead = z.infer<typeof crmLead>

/** GET /crm/leads query. Server filters are additive — unknown/absent params are ignored. */
export const leadsQuery = z.object({
  include_archived: z
    .union([z.literal('1'), z.literal('0'), z.literal('true'), z.literal('false')])
    .optional()
    .transform((v) => v === '1' || v === 'true'),
  limit: z.coerce.number().int().min(1).max(5000).default(2000),
  pipeline_id: uuid.optional(),
  stage_id: uuid.optional(),
  contact_id: uuid.optional(),
  crm_company_id: uuid.optional(),
  /** Free text over name, phone, email and title. */
  q: z.string().trim().max(200).optional(),
  /** Lovable inbox parity filters (all optional, all ignored when absent). */
  source: leadSource.optional(),
  stage: z.string().trim().max(60).optional(),
  quality: leadQuality.optional(),
  contacted: contactedStatus.optional(),
  group: z.string().trim().max(120).optional(),
  budget_min: z.coerce.number().min(0).optional(),
  budget_max: z.coerce.number().min(0).optional(),
  city: z.string().trim().max(120).optional(),
  event_date: isoDate.optional(),
  event_date_from: isoDate.optional(),
  event_date_to: isoDate.optional(),
  date_created: z.enum(['today', 'last7', 'this_month']).optional(),
  date_from: isoDate.optional(),
  date_to: isoDate.optional(),
  follow_up: z.enum(['today', 'upcoming', 'overdue', 'none']).optional(),
  assigned: uuid.optional(),
  unassigned: z
    .union([z.literal('1'), z.literal('0'), z.literal('true'), z.literal('false')])
    .optional()
    .transform((v) => v === '1' || v === 'true'),
})
export type LeadsQuery = z.infer<typeof leadsQuery>

/** A move to lost is only valid with its reason — mirrors the DB trigger. */
const lostNeedsReason = (v: { status?: string | undefined; lost_reason?: string | null | undefined }): boolean =>
  v.status !== 'lost' || (typeof v.lost_reason === 'string' && v.lost_reason.length > 0)

export const updateLeadRequest = z
  .object({
    name: z.string().trim().max(160).nullable().optional(),
    phone: z.string().trim().max(30).nullable().optional(),
    email: z.string().trim().max(200).nullable().optional(),
    status: leadStatus.optional(),
    assigned_to: uuid.nullable().optional(),
    notes: z.string().max(4000).nullable().optional(),
    follow_up_at: isoDateTime.nullable().optional(),
    is_hot: z.boolean().optional(),
    /** Lovable parity: explicit temperature + reach state (trigger keeps is_hot/last_contacted_at consistent). */
    quality: leadQuality.nullable().optional(),
    contacted_status: contactedStatus.optional(),
    is_archived: z.boolean().optional(),
    deal_value: z.number().min(0).max(1_00_00_000).nullable().optional(),
    probability: z.number().int().min(0).max(100).nullable().optional(),
    lost_reason: z.string().trim().min(3).max(500).nullable().optional(),
    lost_competitor: z.string().trim().max(120).nullable().optional(),
    title: z.string().trim().max(160).nullable().optional(),
    close_date: isoDate.nullable().optional(),
    event_type: z.string().trim().max(80).nullable().optional(),
    event_date: isoDate.nullable().optional(),
    event_location: z.string().trim().max(200).nullable().optional(),
    alternate_phone: z.string().trim().max(30).nullable().optional(),
    city: z.string().trim().max(120).nullable().optional(),
    currency: z.string().regex(/^[A-Z]{3}$/).optional(),
    contact_id: uuid.nullable().optional(),
    crm_company_id: uuid.nullable().optional(),
    group_name: z.string().trim().max(120).nullable().optional(),
  })
  .refine(lostNeedsReason, {
    message: 'Tell us why it was lost (3+ chars).',
    path: ['lost_reason'],
  })
export type UpdateLeadRequest = z.infer<typeof updateLeadRequest>

/** Public webhook body (Meta / web form). */
export const captureLeadRequest = z.object({
  name: z.string().max(160).optional(),
  phone: z.string().max(30),
  email: z.string().max(200).optional(),
  meta: z.record(z.unknown()).optional(),
})
export type CaptureLeadRequest = z.infer<typeof captureLeadRequest>

/** Adding a lead by hand. The phone is the identity — everything else can wait. */
/**
 * add_lead() hands back the EXISTING row when the number is already known, so
 * "added" would be a lie half the time. The response says which happened.
 */
export const createLeadResponse = z.object({
  lead: crmLead,
  /** False when an existing lead with this number was opened instead. */
  created: z.boolean(),
})
export type CreateLeadResponse = z.infer<typeof createLeadResponse>

export const createLeadRequest = z.object({
  name: z.string().trim().max(160).optional(),
  phone: z.string().trim().min(6).max(30),
  email: z.string().trim().max(200).optional(),
  source: leadSource.default('manual'),
  notes: z.string().max(2000).optional(),
  assigned_to: uuid.nullable().optional(),
  follow_up_at: isoDateTime.nullable().optional(),
  deal_value: z.number().min(0).max(1_00_00_000).optional(),
  probability: z.number().int().min(0).max(100).optional(),
  title: z.string().trim().max(160).optional(),
  close_date: isoDate.optional(),
  event_type: z.string().trim().max(80).optional(),
  event_date: isoDate.optional(),
  event_location: z.string().trim().max(200).optional(),
  alternate_phone: z.string().trim().max(30).optional(),
  city: z.string().trim().max(120).optional(),
  pipeline_id: uuid.optional(),
  stage_id: uuid.optional(),
  crm_company_id: uuid.optional(),
  group_name: z.string().trim().max(120).optional(),
  /** Lovable parity: temperature + reach state at creation. */
  quality: leadQuality.optional(),
  contacted_status: contactedStatus.optional(),
  lost_reason: z.string().trim().min(3).max(500).optional(),
})
export type CreateLeadRequest = z.infer<typeof createLeadRequest>

/** One member of the round-robin rota new leads are handed to. */
export const distributionStrategy = z.enum(['round_robin', 'specific', 'least_loaded'])
export type DistributionStrategy = z.infer<typeof distributionStrategy>

export const distributionRule = z.object({
  id: uuid,
  user_id: uuid,
  user_name: z.string().nullable(),
  priority: z.number().int(),
  is_active: z.boolean(),
  lead_count: z.number().int(),
  /** Lovable parity: named rule, source filter, strategy, rotation state. */
  name: z.string().nullable().default(null),
  source_filter: z.array(z.string().max(40)).default([]),
  strategy: distributionStrategy.default('round_robin'),
  last_assigned_at: isoDateTime.nullable().default(null),
  assigned_count: z.number().int().default(0),
})
export type DistributionRule = z.infer<typeof distributionRule>

export const updateDistributionRequest = z.object({
  priority: z.number().int().min(0).max(100).optional(),
  is_active: z.boolean().optional(),
  name: z.string().trim().min(2).max(80).nullable().optional(),
  source_filter: z.array(z.string().trim().max(40)).max(20).optional(),
  strategy: distributionStrategy.optional(),
})
export type UpdateDistributionRequest = z.infer<typeof updateDistributionRequest>

export const createDistributionRequest = z.object({
  user_id: uuid,
  priority: z.number().int().min(0).max(100).default(0),
  name: z.string().trim().min(2).max(80).optional(),
  source_filter: z.array(z.string().trim().max(40)).max(20).default([]),
  strategy: distributionStrategy.default('round_robin'),
})
export type CreateDistributionRequest = z.infer<typeof createDistributionRequest>

/**
 * A place leads arrive from. The key is the credential the webhook is called
 * with, so it is minted server-side and only ever shown to the studio.
 */
export const leadSourceKind = z.enum(['webform', 'meta'])
export type LeadSourceKind = z.infer<typeof leadSourceKind>

/** Lovable parity: elementor / landing / generic webhook / other source types. */
export const webhookSourceType = z.enum(['website_form', 'google_form', 'elementor', 'landing_page', 'webhook', 'other'])
export type WebhookSourceType = z.infer<typeof webhookSourceType>

export const leadSourceRow = z.object({
  id: uuid,
  label: z.string().nullable(),
  source_key: z.string(),
  kind: leadSourceKind,
  is_active: z.boolean(),
  created_at: isoDateTime,
  lead_count: z.number().int(),
  last_lead_at: isoDateTime.nullable(),
  /** Lovable parity: type, origin guard, per-source defaults, last receipt. */
  source_type: webhookSourceType.default('webhook'),
  allowed_origin: z.string().nullable().default(null),
  default_source: z.string().nullable().default(null),
  default_stage: z.string().nullable().default(null),
  default_quality: leadQuality.nullable().default(null),
  default_assigned_to: uuid.nullable().default(null),
  last_received_at: isoDateTime.nullable().default(null),
})
export type LeadSourceRow = z.infer<typeof leadSourceRow>

export const createLeadSourceRequest = z.object({
  label: z.string().trim().min(2).max(80),
  kind: leadSourceKind.default('webform'),
  source_type: webhookSourceType.default('webhook'),
  allowed_origin: z.string().trim().max(200).nullish(),
  default_source: leadSource.optional(),
  default_quality: leadQuality.optional(),
  default_assigned_to: uuid.nullish(),
})
export type CreateLeadSourceRequest = z.infer<typeof createLeadSourceRequest>

export const updateLeadSourceRequest = z.object({
  label: z.string().trim().min(2).max(80).optional(),
  is_active: z.boolean().optional(),
  source_type: webhookSourceType.optional(),
  allowed_origin: z.string().trim().max(200).nullable().optional(),
  default_source: leadSource.nullable().optional(),
  default_quality: leadQuality.nullable().optional(),
  default_assigned_to: uuid.nullable().optional(),
})
export type UpdateLeadSourceRequest = z.infer<typeof updateLeadSourceRequest>

/** Audit trail for a lead - every status/patch carries who and when. */
export const leadEvent = z.object({
  id: uuid,
  lead_id: uuid,
  from_status: leadStatus.nullable(),
  to_status: leadStatus.nullable(),
  actor_id: uuid.nullable(),
  actor_name: z.string().nullable(),
  note: z.string().nullable(),
  created_at: isoDateTime,
})
export type LeadEvent = z.infer<typeof leadEvent>

// ── bulk edits ────────────────────────────────────────────────
export const bulkLeadPatch = z.object({
  ids: z.array(uuid).min(1).max(200),
  patch: z
    .object({
      status: leadStatus.optional(),
      stage_id: uuid.optional(),
      lost_reason: z.string().trim().min(3).max(500).optional(),
      lost_competitor: z.string().trim().max(120).optional(),
      assigned_to: uuid.nullable().optional(),
      is_hot: z.boolean().optional(),
      /** Lovable bulk parity: temperature, reach state, segment tag, note append. */
      quality: leadQuality.nullable().optional(),
      contacted_status: contactedStatus.optional(),
      group_name: z.string().trim().max(120).nullable().optional(),
      note: z.string().trim().max(2000).optional(),
      follow_up_at: isoDateTime.nullable().optional(),
      is_archived: z.boolean().optional(),
      deal_value: z.number().min(0).max(1_00_00_000).nullable().optional(),
      probability: z.number().int().min(0).max(100).nullable().optional(),
      close_date: isoDate.nullable().optional(),
    })
    .refine((p) => Object.keys(p).length > 0, 'Nothing to change.')
    .refine(lostNeedsReason, {
      message: 'Tell us why it was lost (3+ chars).',
      path: ['lost_reason'],
    }),
})
export type BulkLeadPatch = z.infer<typeof bulkLeadPatch>

/** What each lead looked like before a bulk edit — the undo payload. */
export const leadSnapshot = z.object({
  id: uuid,
  status: leadStatus,
  assigned_to: uuid.nullable(),
  is_hot: z.boolean(),
  quality: leadQuality.nullable().default(null),
  contacted_status: contactedStatus.default('uncontacted'),
  group_name: z.string().nullable().default(null),
  follow_up_at: isoDateTime.nullable(),
  is_archived: z.boolean(),
  deal_value: z.coerce.number().nullable().default(null),
  probability: z.number().int().nullable().default(null),
  lost_reason: z.string().nullable().default(null),
  lost_competitor: z.string().nullable().default(null),
  stage_id: uuid.nullable().default(null),
  close_date: isoDate.nullable().default(null),
})
export type LeadSnapshot = z.infer<typeof leadSnapshot>

export const bulkPatchResponse = z.object({
  updated: z.number().int(),
  previous: z.array(leadSnapshot),
})
export type BulkPatchResponse = z.infer<typeof bulkPatchResponse>

export const bulkUndoRequest = z.object({ previous: z.array(leadSnapshot).min(1).max(200) })
export type BulkUndoRequest = z.infer<typeof bulkUndoRequest>

export const bulkUndoResponse = z.object({ restored: z.number().int() })
export type BulkUndoResponse = z.infer<typeof bulkUndoResponse>

// ── duplicates ────────────────────────────────────────────────
export const duplicateLead = z.object({
  id: uuid,
  name: z.string().nullable(),
  phone: z.string().nullable(),
  /** Lovable parity: masked match value + quality/assignee context for the pick. */
  email: z.string().nullable().default(null),
  quality: leadQuality.nullable().default(null),
  contacted_status: contactedStatus.default('uncontacted'),
  assigned_to: uuid.nullable().default(null),
  assignee_name: z.string().nullable().default(null),
  status: leadStatus,
  source: leadSource,
  notes: z.string().nullable(),
  created_at: isoDateTime,
})
export const duplicateGroup = z.object({
  /** Null for email-only groups (no shared phone). */
  phone_norm: z.string().nullable().default(null),
  /** Lovable parity: phone-only, email-only, or both-fields groups. */
  match_type: z.enum(['phone', 'email', 'both']).default('phone'),
  match_value_masked: z.string().default(''),
  lead_ids: z.array(uuid),
  lead_count: z.number().int(),
  leads: z.array(duplicateLead),
})
export type DuplicateGroup = z.infer<typeof duplicateGroup>

export const mergeLeadsRequest = z.object({
  survivor_id: uuid,
  duplicate_ids: z.array(uuid).min(1).max(20),
})
export type MergeLeadsRequest = z.infer<typeof mergeLeadsRequest>

export const mergeLeadsResponse = z.object({ merged: z.number().int() })
export type MergeLeadsResponse = z.infer<typeof mergeLeadsResponse>

export const unmergeLeadsRequest = z.object({ survivor_id: uuid })
export const unmergeLeadsResponse = z.object({ restored: z.number().int() })

/** Lovable parity: resolving a group without merging. */
export const resolveDuplicateRequest = z.object({
  survivor_id: uuid,
  duplicate_ids: z.array(uuid).min(1).max(20),
  action: z.enum(['keep_separate', 'archive']),
})
export type ResolveDuplicateRequest = z.infer<typeof resolveDuplicateRequest>

export const resolveDuplicateResponse = z.object({ resolved: z.number().int() })
export type ResolveDuplicateResponse = z.infer<typeof resolveDuplicateResponse>

// ── CSV import ────────────────────────────────────────────────
export const csvImportPreviewRequest = z.object({
  csv: z.string().min(1).max(500_000),
})
export type CsvImportPreviewRequest = z.infer<typeof csvImportPreviewRequest>

export const csvImportRow = z.object({
  row: z.number().int(),
  name: z.string().nullable(),
  phone: z.string().nullable(),
  email: z.string().nullable(),
  source: leadSource,
  notes: z.string().nullable(),
  valid: z.boolean(),
  error: z.string().nullable(),
  phone_norm: z.string().nullable(),
  is_duplicate: z.boolean(),
})
export type CsvImportRow = z.infer<typeof csvImportRow>

export const csvImportPreviewResponse = z.object({
  columns: z.array(z.string()),
  rows: z.array(csvImportRow),
  total: z.number().int(),
  valid: z.number().int(),
  duplicates: z.number().int(),
})
export type CsvImportPreviewResponse = z.infer<typeof csvImportPreviewResponse>

export const csvImportCommitRequest = z.object({
  rows: z
    .array(
      z.object({
        name: z.string().max(160).nullable().optional(),
        phone: z.string().min(6).max(30),
        email: z.string().max(200).nullable().optional(),
        source: leadSource.default('manual'),
        notes: z.string().max(2000).nullable().optional(),
        /** Lovable parity: richer columns + alias-tolerant extras. */
        city: z.string().max(120).nullable().optional(),
        event_type: z.string().max(80).nullable().optional(),
        event_date: isoDate.nullable().optional(),
        event_location: z.string().max(200).nullable().optional(),
        deal_value: z.number().min(0).max(1_00_00_000).nullable().optional(),
        group_name: z.string().max(120).nullable().optional(),
        alternate_phone: z.string().max(30).nullable().optional(),
        quality: leadQuality.nullable().optional(),
      }),
    )
    .min(1)
    .max(500),
  skip_duplicates: z.boolean().default(true),
  /** Lovable parity: skip = ignore known numbers, update = patch them, create = import anyway. */
  mode: z.enum(['skip', 'update', 'create']).default('skip'),
})
export type CsvImportCommitRequest = z.infer<typeof csvImportCommitRequest>

export const csvImportRowError = z.object({
  row: z.number().int(),
  error: z.string(),
})
export type CsvImportRowError = z.infer<typeof csvImportRowError>

export const csvImportCommitResponse = z.object({
  created: z.number().int(),
  skipped: z.number().int(),
  invalid: z.number().int(),
  /** Rows patched in place when mode = 'update'. */
  updated: z.number().int().default(0),
  ids: z.array(uuid),
  /** Per-row errors so the dialog can show what failed and why. */
  errors: z.array(csvImportRowError).default([]),
})
export type CsvImportCommitResponse = z.infer<typeof csvImportCommitResponse>

// ── templates ─────────────────────────────────────────────────
export const templateKind = z.enum(['whatsapp', 'email', 'note'])
export type TemplateKind = z.infer<typeof templateKind>

export const crmTemplate = z.object({
  id: uuid,
  name: z.string(),
  body: z.string(),
  kind: templateKind,
  created_at: isoDateTime,
  /** Lovable parity: grouping, usage telemetry, soft-archive. */
  category: z.string().nullable().default(null),
  usage_count: z.number().int().default(0),
  is_active: z.boolean().default(true),
})
export type CrmTemplate = z.infer<typeof crmTemplate>

export const createTemplateRequest = z.object({
  name: z.string().trim().min(2).max(80),
  body: z.string().trim().min(2).max(2000),
  kind: templateKind.default('whatsapp'),
  category: z.string().trim().max(80).nullish(),
})
export type CreateTemplateRequest = z.infer<typeof createTemplateRequest>

export const updateTemplateRequest = z.object({
  name: z.string().trim().min(2).max(80).optional(),
  body: z.string().trim().min(2).max(2000).optional(),
  kind: templateKind.optional(),
  category: z.string().trim().max(80).nullable().optional(),
  is_active: z.boolean().optional(),
})
export type UpdateTemplateRequest = z.infer<typeof updateTemplateRequest>

/**
 * Sending a template to one lead. The server renders the body with the lead's
 * fields, records the contact on the lead's history, and hands back the link
 * that opens WhatsApp or the mail client with the message already filled in.
 */
export const sendTemplateRequest = z.object({
  template_id: uuid,
  channel: z.enum(['whatsapp', 'email']),
})
export type SendTemplateRequest = z.infer<typeof sendTemplateRequest>

export const sendTemplateResponse = z.object({
  /** A link to open (wa.me / mailto:), or null when the API delivered it itself. */
  url: z.string().nullable(),
  rendered: z.string(),
  /** 'api' = sent by the WhatsApp Cloud API; 'link' = opens the person's own app. */
  delivery: z.enum(['api', 'link']),
})
export type SendTemplateResponse = z.infer<typeof sendTemplateResponse>

// ── reports ───────────────────────────────────────────────────
export const crmStatsQuery = z.object({
  from: isoDate,
  to: isoDate,
  /** Narrow the whole report to one channel, or to one person's leads. */
  source: z.string().trim().max(40).optional(),
  assignee: uuid.optional(),
})
export type CrmStatsQuery = z.infer<typeof crmStatsQuery>

export const crmStats = z.object({
  from: isoDate,
  to: isoDate,
  total: z.number().int(),
  overdue: z.number().int(),
  uncontacted: z.number().int(),
  created: z.number().int(),
  won: z.number().int(),
  lost: z.number().int(),
  conversion_rate: z.number(),
  byStatus: z.record(z.string(), z.number().int()),
  bySource: z.record(z.string(), z.number().int()),
  /** Lost in the range, by reason and by who they went to. */
  byLostReason: z.record(z.string(), z.number().int()).default({}),
  byCompetitor: z.record(z.string(), z.number().int()).default({}),
  /** Lovable parity: pipeline value, quality split, follow-up health, trends. */
  pipeline_value: z.coerce.number().default(0),
  quality_breakdown: z.record(z.string(), z.number().int()).default({}),
  follow_up_health: z.object({
    overdue: z.number().int().default(0),
    due_today: z.number().int().default(0),
    due_tomorrow: z.number().int().default(0),
    upcoming_7d: z.number().int().default(0),
    no_follow_up: z.number().int().default(0),
  }).default({}),
  activity_trend: z.array(z.object({ day: z.string(), count: z.number().int() })).default([]),
  won_lost_trend: z.array(z.object({ day: z.string(), won: z.number().int(), lost: z.number().int() })).default([]),
  proposal_count: z.number().int().default(0),
  proposal_value: z.coerce.number().default(0),
  warnings: z.array(z.string()).default([]),
})
export type CrmStats = z.infer<typeof crmStats>

export const crmTeamStatsRow = z.object({
  user_id: uuid,
  user_name: z.string(),
  open: z.number().int(),
  overdue: z.number().int(),
  due_today: z.number().int(),
  uncontacted: z.number().int(),
  hot: z.number().int(),
  created: z.number().int(),
  won: z.number().int(),
  lost: z.number().int(),
  /** Leads created in the range that were first contacted within the SLA. */
  within_sla: z.number().int(),
  sla_hours: z.number().int(),
  avg_first_response_hours: z.number().nullable(),
  /** Lovable parity: per-member outreach + pipeline warnings. */
  whatsapp: z.number().int().default(0),
  messages: z.number().int().default(0),
  notes: z.number().int().default(0),
  pipeline_value: z.coerce.number().default(0),
  warnings: z.array(z.string()).default([]),
})
export type CrmTeamStatsRow = z.infer<typeof crmTeamStatsRow>

// ── workflows ─────────────────────────────────────────────────
export const workflowTrigger = z.enum(['lead_created', 'stage_changed', 'follow_up_overdue', 'activity_logged', 'score_changed', 'manual'])
export type WorkflowTrigger = z.infer<typeof workflowTrigger>

export const conditionOp = z.enum(['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'contains', 'in', 'is_null', 'not_null'])
export type ConditionOp = z.infer<typeof conditionOp>

/** One clause over the lead's facts (see @ipc/domain CONDITION_FIELDS). */
export const fieldCondition = z.object({
  field: z.string().trim().min(1).max(40),
  op: conditionOp.default('eq'),
  value: z.union([z.string().max(200), z.number(), z.boolean(), z.array(z.union([z.string().max(200), z.number()])).max(50)]).optional(),
})
export type FieldCondition = z.infer<typeof fieldCondition>

export const workflowCondition = z.object({
  source: leadSource.optional(),
  to_status: leadStatus.optional(),
  from_status: leadStatus.optional(),
  is_hot: z.boolean().optional(),
  conditions: z.array(fieldCondition).max(20).optional(),
})
export type WorkflowCondition = z.infer<typeof workflowCondition>

export const workflowAction = z.enum([
  'assign_to',
  'set_follow_up_days',
  'mark_hot',
  'add_note',
  'notify_assignee',
  'notify_user',
  'start_cadence',
  'set_stage',
  'create_task',
  'add_score',
  'send_template',
])
export type WorkflowAction = z.infer<typeof workflowAction>

export const workflowActionConfig = z
  .object({
    action: workflowAction,
    user_id: uuid.optional(),
    days: z.number().int().min(0).max(365).optional(),
    note: z.string().trim().max(500).optional(),
    title: z.string().trim().max(120).optional(),
    cadence_id: uuid.optional(),
    stage_id: uuid.optional(),
    lost_reason: z.string().trim().min(3).max(500).optional(),
    subject: z.string().trim().max(200).optional(),
    points: z.number().int().min(-100).max(100).optional(),
    template_id: uuid.optional(),
    channel: z.enum(['whatsapp', 'email']).optional(),
  })
  .refine(
    (v) =>
      (v.action !== 'assign_to' && v.action !== 'notify_user' || !!v.user_id) &&
      (v.action !== 'set_follow_up_days' || typeof v.days === 'number') &&
      (v.action !== 'add_note' || !!v.note) &&
      (v.action !== 'start_cadence' || !!v.cadence_id) &&
      (v.action !== 'set_stage' || !!v.stage_id) &&
      (v.action !== 'create_task' || !!v.subject) &&
      (v.action !== 'add_score' || typeof v.points === 'number') &&
      (v.action !== 'send_template' || !!v.template_id),
    { message: 'This action needs a value.' },
  )
export type WorkflowActionConfig = z.infer<typeof workflowActionConfig>

export const workflowDelayConfig = z.object({
  amount: z.number().int().min(1).max(365),
  unit: z.enum(['minutes', 'hours', 'days']).default('days'),
})
export type WorkflowDelayConfig = z.infer<typeof workflowDelayConfig>

export const workflowBranchConfig = z.object({
  conditions: z.array(fieldCondition).min(1).max(20),
  /** Step numbers (1-based) to continue at; null = the next step. */
  yes_step: z.number().int().min(1).max(100).nullable().default(null),
  no_step: z.number().int().min(1).max(100).nullable().default(null),
})
export type WorkflowBranchConfig = z.infer<typeof workflowBranchConfig>

export const workflowStepInput = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('action'), config: workflowActionConfig }),
  z.object({ kind: z.literal('delay'), config: workflowDelayConfig }),
  z.object({ kind: z.literal('branch'), config: workflowBranchConfig }),
  z.object({ kind: z.literal('exit'), config: z.object({}).default({}) }),
])
export type WorkflowStepInput = z.infer<typeof workflowStepInput>

export const workflowStep = z.discriminatedUnion('kind', [
  z.object({ id: uuid, step_no: z.number().int(), kind: z.literal('action'), config: workflowActionConfig }),
  z.object({ id: uuid, step_no: z.number().int(), kind: z.literal('delay'), config: workflowDelayConfig }),
  z.object({ id: uuid, step_no: z.number().int(), kind: z.literal('branch'), config: workflowBranchConfig }),
  z.object({ id: uuid, step_no: z.number().int(), kind: z.literal('exit'), config: z.object({}).default({}) }),
])
export type WorkflowStep = z.infer<typeof workflowStep>

export const workflow = z.object({
  id: uuid,
  name: z.string(),
  trigger: workflowTrigger,
  condition: workflowCondition,
  is_active: z.boolean(),
  allow_reenroll: z.boolean(),
  exit_on_reply: z.boolean(),
  steps: z.array(workflowStep),
  active_count: z.number().int().default(0),
  completed_count: z.number().int().default(0),
  errored_count: z.number().int().default(0),
  last_enrolled_at: isoDateTime.nullable().default(null),
  created_at: isoDateTime,
  /** Lovable automation parity: severity, cooldown, notify routing, default-rule key. */
  severity: z.enum(['info', 'warning', 'critical']).default('info'),
  cooldown_hours: z.number().int().default(24),
  notify_assignee: z.boolean().default(true),
  notify_roles: z.array(z.string()).default([]),
  rule_key: z.string().nullable().default(null),
})
export type Workflow = z.infer<typeof workflow>

export const createWorkflowRequest = z.object({
  name: z.string().trim().min(2).max(80),
  trigger: workflowTrigger,
  condition: workflowCondition.default({}),
  steps: z.array(workflowStepInput).min(1).max(100),
  is_active: z.boolean().default(true),
  allow_reenroll: z.boolean().default(false),
  exit_on_reply: z.boolean().default(true),
  severity: z.enum(['info', 'warning', 'critical']).default('info'),
  cooldown_hours: z.number().int().min(0).max(720).default(24),
  notify_assignee: z.boolean().default(true),
  notify_roles: z.array(z.string().trim().max(40)).max(10).default([]),
})
export type CreateWorkflowRequest = z.infer<typeof createWorkflowRequest>

export const updateWorkflowRequest = createWorkflowRequest.partial()
export type UpdateWorkflowRequest = z.infer<typeof updateWorkflowRequest>

/** One line of what an enrollment actually did, kept per step. */
export const enrollmentStep = z.object({
  step: z.number().int(),
  kind: z.enum(['action', 'delay', 'branch', 'exit']),
  result: z.string().nullable().optional(),
  at: isoDateTime,
})
export type EnrollmentStep = z.infer<typeof enrollmentStep>

export const workflowEnrollment = z.object({
  id: uuid,
  workflow_id: uuid,
  workflow_name: z.string().nullable().default(null),
  lead_id: uuid,
  lead_name: z.string().nullable().default(null),
  current_step: z.number().int(),
  next_at: isoDateTime.nullable(),
  status: z.enum(['active', 'completed', 'exited', 'errored']),
  exit_reason: z.string().nullable(),
  steps_run: z.number().int(),
  /** The trail the executor writes; empty until a step has run. */
  log: z.array(enrollmentStep).default([]),
  enrolled_at: isoDateTime,
})
export type WorkflowEnrollment = z.infer<typeof workflowEnrollment>

export const enrollWorkflowRequest = z.object({ lead_ids: z.array(uuid).min(1).max(200) })
export type EnrollWorkflowRequest = z.infer<typeof enrollWorkflowRequest>

export const enrollWorkflowResponse = z.object({ enrolled: z.number().int() })
export type EnrollWorkflowResponse = z.infer<typeof enrollWorkflowResponse>

/**
 * A template a workflow asked to send. The API drains this on the hourly
 * tick; when it cannot, the failure lived only in a server log.
 */
export const outboxRow = z.object({
  id: uuid,
  lead_id: uuid,
  lead_name: z.string().nullable().default(null),
  template_name: z.string().nullable().default(null),
  channel: z.enum(['whatsapp', 'email']),
  status: z.enum(['pending', 'sent', 'manual', 'failed']),
  error: z.string().nullable(),
  created_at: isoDateTime,
  sent_at: isoDateTime.nullable(),
})
export type OutboxRow = z.infer<typeof outboxRow>

// ── scoring ───────────────────────────────────────────────────
export const scoringRule = z.object({
  id: uuid,
  label: z.string(),
  field: z.string(),
  op: conditionOp,
  value: z.unknown().nullable().default(null),
  points: z.number().int(),
  is_active: z.boolean(),
  position: z.number().int(),
})
export type ScoringRule = z.infer<typeof scoringRule>

/** Same shape a workflow condition takes, so the two rule editors agree. */
const scoringValue = z.union([
  z.string().max(200),
  z.number(),
  z.boolean(),
  z.array(z.union([z.string().max(200), z.number()])).max(50),
])

export const createScoringRuleRequest = z.object({
  label: z.string().trim().min(2).max(80),
  field: z.string().trim().min(1).max(40),
  op: conditionOp.default('eq'),
  value: scoringValue.optional(),
  points: z.number().int().min(-100).max(100),
})
export type CreateScoringRuleRequest = z.infer<typeof createScoringRuleRequest>

export const updateScoringRuleRequest = createScoringRuleRequest.partial().extend({
  is_active: z.boolean().optional(),
  position: z.number().int().min(0).max(1000).optional(),
})
export type UpdateScoringRuleRequest = z.infer<typeof updateScoringRuleRequest>

export const recomputeScoresResponse = z.object({ rescored: z.number().int() })
export type RecomputeScoresResponse = z.infer<typeof recomputeScoresResponse>

// ── saved views (per person, every device) ────────────────────
export const savedViewQuery = z.object({
  search: z.string().max(200).default(''),
  filters: z.array(z.string().max(40)).max(20).default([]),
  status: z.string().max(40).default('all'),
  assignee: z.string().max(60).default('all'),
})
export type SavedViewQuery = z.infer<typeof savedViewQuery>

export const savedViewVisibility = z.enum(['private', 'team', 'everyone'])
export type SavedViewVisibility = z.infer<typeof savedViewVisibility>

export const savedView = z.object({
  id: uuid,
  /** Creator — the UI only offers rename/delete on your own. */
  user_id: uuid,
  name: z.string(),
  query: savedViewQuery,
  /** private = mine only; team / everyone = shared with the studio. */
  visibility: savedViewVisibility.default('private'),
  owner_name: z.string().nullable().default(null),
  created_at: isoDateTime,
})
export type SavedView = z.infer<typeof savedView>

export const createSavedViewRequest = z.object({
  name: z.string().trim().min(1).max(80),
  query: savedViewQuery,
  visibility: savedViewVisibility.default('private'),
})
export type CreateSavedViewRequest = z.infer<typeof createSavedViewRequest>

export const updateSavedViewRequest = z
  .object({
    name: z.string().trim().min(1).max(80).optional(),
    query: savedViewQuery.optional(),
    visibility: savedViewVisibility.optional(),
  })
  .refine((v) => Object.keys(v).length > 0, 'Nothing to change.')
export type UpdateSavedViewRequest = z.infer<typeof updateSavedViewRequest>

// ── settings ──────────────────────────────────────────────────
export const crmSettings = z.object({
  /** Hours a new lead may wait before first contact and still count as on time. */
  sla_hours: z.number().int().min(1).max(720),
  /** A lead scoring at or above this is shown as hot. */
  hot_score: z.number().int().min(1).max(1000).default(60),
})
export type CrmSettings = z.infer<typeof crmSettings>

export const updateCrmSettingsRequest = crmSettings.partial()
export type UpdateCrmSettingsRequest = z.infer<typeof updateCrmSettingsRequest>

// ── cadences ──────────────────────────────────────────────────
export const cadenceStep = z.object({
  id: uuid,
  step_no: z.number().int().min(1).max(30),
  /** Days after the cadence starts. 0 = the same day. */
  day_offset: z.number().int().min(0).max(365),
  template_id: uuid.nullable(),
  template_name: z.string().nullable().default(null),
  note: z.string().nullable(),
  /** Lovable parity: per-step routing hints for Mark-as-Sent. */
  recommended_delay_days: z.number().int().nullable().default(null),
  next_stage: z.string().nullable().default(null),
  next_follow_up_days: z.number().int().nullable().default(null),
})
export type CadenceStep = z.infer<typeof cadenceStep>

export const cadence = z.object({
  id: uuid,
  name: z.string(),
  is_active: z.boolean(),
  steps: z.array(cadenceStep),
  /** Leads currently on it. */
  active_leads: z.number().int().default(0),
  created_at: isoDateTime,
  /** Lovable parity: stage preset the drawer filters on + source scope. */
  description: z.string().nullable().default(null),
  stage_filter: z.string().nullable().default(null),
  source_filter: z.string().nullable().default(null),
})
export type Cadence = z.infer<typeof cadence>

export const cadenceStepInput = z.object({
  day_offset: z.number().int().min(0).max(365),
  template_id: uuid.nullable().optional(),
  note: z.string().trim().max(300).nullable().optional(),
  recommended_delay_days: z.number().int().min(0).max(365).nullable().optional(),
  next_stage: z.string().trim().max(60).nullable().optional(),
  next_follow_up_days: z.number().int().min(0).max(365).nullable().optional(),
})
export type CadenceStepInput = z.infer<typeof cadenceStepInput>

export const createCadenceRequest = z.object({
  name: z.string().trim().min(2).max(80),
  description: z.string().trim().max(500).nullish(),
  stage_filter: z.string().trim().max(60).nullish(),
  source_filter: z.string().trim().max(40).nullish(),
  steps: z
    .array(cadenceStepInput)
    .min(1)
    .max(30)
    .refine((steps) => steps.every((s, i) => i === 0 || s.day_offset >= steps[i - 1]!.day_offset), {
      message: 'Steps must be in day order.',
    }),
})
export type CreateCadenceRequest = z.infer<typeof createCadenceRequest>

export const updateCadenceRequest = z.object({
  name: z.string().trim().min(2).max(80).optional(),
  is_active: z.boolean().optional(),
  description: z.string().trim().max(500).nullable().optional(),
  stage_filter: z.string().trim().max(60).nullable().optional(),
  source_filter: z.string().trim().max(40).nullable().optional(),
})
export type UpdateCadenceRequest = z.infer<typeof updateCadenceRequest>

/** Lovable parity: Mark-as-Sent — log the send, move follow-up + stage. */
export const markCadenceSentRequest = z.object({
  next_follow_up_days: z.number().int().min(0).max(365).nullable().optional(),
  next_stage_id: uuid.nullable().optional(),
  note: z.string().trim().max(500).nullable().optional(),
})
export type MarkCadenceSentRequest = z.infer<typeof markCadenceSentRequest>

export const startCadenceRequest = z.object({ cadence_id: uuid })
export type StartCadenceRequest = z.infer<typeof startCadenceRequest>

/** Where a lead sits on its cadence, or null when it is on none. */
export const leadCadence = z.object({
  cadence_id: uuid,
  cadence_name: z.string(),
  step_no: z.number().int(),
  total_steps: z.number().int(),
  next_at: isoDateTime.nullable(),
  started_at: isoDateTime,
  completed_at: isoDateTime.nullable(),
  stopped_at: isoDateTime.nullable(),
})
export type LeadCadence = z.infer<typeof leadCadence>

// ── lead → project ────────────────────────────────────────────
export const convertLeadRequest = z
  .object({
    /** An existing client, or none to create one from the lead. */
    client_id: uuid.optional(),
    client: z
      .object({
        name: z.string().trim().min(1).max(160).optional(),
        email: z.string().trim().max(200).optional(),
        phone: z.string().trim().max(30).optional(),
        city: z.string().trim().max(120).optional(),
      })
      .optional(),
    /** Omit for a client-only convert (no project yet — the project link stays null). */
    project: z.object({
      name: z.string().trim().min(1).max(200),
      package_cost: z.number().finite().nonnegative().default(0),
      status: z.enum(['active', 'on_hold']).default('active'),
    }).optional(),
    /** An accepted quote whose lines become the project's deliverables. */
    quote_id: uuid.optional(),
  })
  .refine((v) => !(v.client_id && v.client), {
    message: 'Pick a client or describe a new one, not both.',
  })
export type ConvertLeadRequest = z.infer<typeof convertLeadRequest>

export const convertLeadResponse = z.object({
  client_id: uuid,
  /** Null for a client-only convert — the lead is won, no project yet. */
  project_id: uuid.nullable(),
})
export type ConvertLeadResponse = z.infer<typeof convertLeadResponse>

// ── ad-hoc responses, named ───────────────────────────────────
export const idResponse = z.object({ id: uuid })
export type IdResponse = z.infer<typeof idResponse>

/** POST /crm/workflows/seed — installs the 7 default automation workflows. */
export const seedWorkflowsResponse = z.object({ seeded: z.number().int() })
export type SeedWorkflowsResponse = z.infer<typeof seedWorkflowsResponse>

export const cadenceStartResponse = z.object({ next_at: isoDateTime.nullable() })
export type CadenceStartResponse = z.infer<typeof cadenceStartResponse>

// ── pipelines and stages ──────────────────────────────────────
export const stageKind = z.enum(['open', 'won', 'lost'])
export type StageKind = z.infer<typeof stageKind>

/** The fields a stage can insist on before a deal enters it. */
export const stageRequiredField = z.enum(['deal_value', 'close_date', 'email', 'name', 'assigned_to', 'title', 'lost_reason'])
export type StageRequiredField = z.infer<typeof stageRequiredField>

export const pipelineStage = z.object({
  id: uuid,
  pipeline_id: uuid,
  name: z.string(),
  key: z.string(),
  position: z.number().int(),
  kind: stageKind,
  probability_default: z.number().int().min(0).max(100),
  wip_limit: z.number().int().nullable(),
  required_fields: z.array(stageRequiredField),
  /** Open, unarchived deals in the stage right now. */
  deal_count: z.number().int().default(0),
})
export type PipelineStage = z.infer<typeof pipelineStage>

export const pipeline = z.object({
  id: uuid,
  name: z.string(),
  is_default: z.boolean(),
  position: z.number().int(),
  stages: z.array(pipelineStage),
  created_at: isoDateTime,
})
export type Pipeline = z.infer<typeof pipeline>

const stageKey = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z][a-z0-9_]{0,39}$/, 'Keys are lowercase letters, digits and underscores.')

export const createPipelineRequest = z.object({
  name: z.string().trim().min(2).max(80),
  is_default: z.boolean().default(false),
})
export type CreatePipelineRequest = z.infer<typeof createPipelineRequest>

export const updatePipelineRequest = z.object({
  name: z.string().trim().min(2).max(80).optional(),
  is_default: z.literal(true).optional(),
  position: z.number().int().min(0).max(1000).optional(),
})
export type UpdatePipelineRequest = z.infer<typeof updatePipelineRequest>

export const createStageRequest = z.object({
  name: z.string().trim().min(1).max(60),
  key: stageKey.optional(),
  kind: stageKind.default('open'),
  position: z.number().int().min(0).max(1000).optional(),
  probability_default: z.number().int().min(0).max(100).optional(),
  wip_limit: z.number().int().min(1).max(1000).nullable().optional(),
  required_fields: z.array(stageRequiredField).max(7).default([]),
})
export type CreateStageRequest = z.infer<typeof createStageRequest>

export const updateStageRequest = z.object({
  name: z.string().trim().min(1).max(60).optional(),
  kind: stageKind.optional(),
  position: z.number().int().min(0).max(1000).optional(),
  probability_default: z.number().int().min(0).max(100).optional(),
  wip_limit: z.number().int().min(1).max(1000).nullable().optional(),
  required_fields: z.array(stageRequiredField).max(7).optional(),
})
export type UpdateStageRequest = z.infer<typeof updateStageRequest>

export const reorderStagesRequest = z.object({ stage_ids: z.array(uuid).min(1).max(50) })
export type ReorderStagesRequest = z.infer<typeof reorderStagesRequest>

/** POST /crm/leads/:id/stage — the one way a deal moves between stages. */
export const moveStageRequest = z.object({
  stage_id: uuid,
  lost_reason: z.string().trim().min(3).max(500).optional(),
  lost_competitor: z.string().trim().max(120).optional(),
})
export type MoveStageRequest = z.infer<typeof moveStageRequest>

export const moveStageResponse = z.object({ status: leadStatus, stage_id: uuid })
export type MoveStageResponse = z.infer<typeof moveStageResponse>

// ── lost reasons ──────────────────────────────────────────────
export const lostReason = z.object({
  id: uuid,
  label: z.string(),
  position: z.number().int(),
  is_active: z.boolean(),
})
export type LostReason = z.infer<typeof lostReason>

export const createLostReasonRequest = z.object({ label: z.string().trim().min(3).max(80) })
export type CreateLostReasonRequest = z.infer<typeof createLostReasonRequest>

export const updateLostReasonRequest = z.object({
  label: z.string().trim().min(3).max(80).optional(),
  position: z.number().int().min(0).max(1000).optional(),
  is_active: z.boolean().optional(),
})
export type UpdateLostReasonRequest = z.infer<typeof updateLostReasonRequest>

// ── contacts and companies ────────────────────────────────────
export const contactLifecycle = z.enum(['lead', 'mql', 'sql', 'customer', 'other'])
export type ContactLifecycle = z.infer<typeof contactLifecycle>

export const crmContact = z.object({
  id: uuid,
  name: z.string().nullable(),
  phone: z.string().nullable(),
  email: z.string().nullable(),
  lifecycle: contactLifecycle,
  owner_id: uuid.nullable(),
  owner_name: z.string().nullable().default(null),
  source: z.string().nullable(),
  crm_company_id: uuid.nullable(),
  crm_company_name: z.string().nullable().default(null),
  notes: z.string().nullable(),
  is_archived: z.boolean(),
  /** Deals on this contact: all, and the ones still open. */
  deal_count: z.number().int().default(0),
  open_deal_count: z.number().int().default(0),
  last_contacted_at: isoDateTime.nullable().default(null),
  created_at: isoDateTime,
})
export type CrmContact = z.infer<typeof crmContact>

export const contactsQuery = z.object({
  q: z.string().trim().max(200).optional(),
  include_archived: z
    .union([z.literal('1'), z.literal('0'), z.literal('true'), z.literal('false')])
    .optional()
    .transform((v) => v === '1' || v === 'true'),
  crm_company_id: uuid.optional(),
  limit: z.coerce.number().int().min(1).max(5000).default(1000),
})
export type ContactsQuery = z.infer<typeof contactsQuery>

export const createContactRequest = z.object({
  name: z.string().trim().min(1).max(160),
  phone: z.string().trim().min(6).max(30).optional(),
  email: z.string().trim().max(200).optional(),
  lifecycle: contactLifecycle.default('lead'),
  owner_id: uuid.nullable().optional(),
  crm_company_id: uuid.nullable().optional(),
  notes: z.string().max(4000).optional(),
})
export type CreateContactRequest = z.infer<typeof createContactRequest>

export const updateContactRequest = z.object({
  name: z.string().trim().max(160).nullable().optional(),
  phone: z.string().trim().max(30).nullable().optional(),
  email: z.string().trim().max(200).nullable().optional(),
  lifecycle: contactLifecycle.optional(),
  owner_id: uuid.nullable().optional(),
  crm_company_id: uuid.nullable().optional(),
  notes: z.string().max(4000).nullable().optional(),
  is_archived: z.boolean().optional(),
})
export type UpdateContactRequest = z.infer<typeof updateContactRequest>

export const crmCompany = z.object({
  id: uuid,
  name: z.string(),
  domain: z.string().nullable(),
  phone: z.string().nullable(),
  city: z.string().nullable(),
  notes: z.string().nullable(),
  owner_id: uuid.nullable(),
  owner_name: z.string().nullable().default(null),
  is_archived: z.boolean(),
  contact_count: z.number().int().default(0),
  deal_count: z.number().int().default(0),
  open_value: z.coerce.number().default(0),
  created_at: isoDateTime,
})
export type CrmCompany = z.infer<typeof crmCompany>

export const createCrmCompanyRequest = z.object({
  name: z.string().trim().min(1).max(160),
  domain: z.string().trim().max(200).optional(),
  phone: z.string().trim().max(30).optional(),
  city: z.string().trim().max(120).optional(),
  notes: z.string().max(4000).optional(),
  owner_id: uuid.nullable().optional(),
})
export type CreateCrmCompanyRequest = z.infer<typeof createCrmCompanyRequest>

export const updateCrmCompanyRequest = z.object({
  name: z.string().trim().min(1).max(160).optional(),
  domain: z.string().trim().max(200).nullable().optional(),
  phone: z.string().trim().max(30).nullable().optional(),
  city: z.string().trim().max(120).nullable().optional(),
  notes: z.string().max(4000).nullable().optional(),
  owner_id: uuid.nullable().optional(),
  is_archived: z.boolean().optional(),
})
export type UpdateCrmCompanyRequest = z.infer<typeof updateCrmCompanyRequest>

// ── forecast ──────────────────────────────────────────────────
const forecastBucket = z.object({
  count: z.number().int(),
  total_value: z.coerce.number(),
  weighted: z.coerce.number(),
})

export const crmForecast = z.object({
  from: isoDate,
  to: isoDate,
  count: z.number().int(),
  total_value: z.coerce.number(),
  /** Σ deal_value × probability over open deals, plus won deals at 100%. */
  weighted: z.coerce.number(),
  won_value: z.coerce.number(),
  open_value: z.coerce.number(),
  won_count: z.number().int().default(0),
  lost_count: z.number().int().default(0),
  /** won / (won + lost) over deals closed in the range; null when none closed. */
  win_rate: z.coerce.number().nullable().default(null),
  avg_cycle_days: z.coerce.number().nullable().default(null),
  by_stage: z.array(forecastBucket.extend({ stage_id: uuid.nullable(), name: z.string(), kind: stageKind })),
  by_owner: z.array(forecastBucket.extend({ user_id: uuid.nullable(), name: z.string() })),
  by_month: z.array(forecastBucket.extend({ month: z.string().regex(/^\d{4}-\d{2}$/) })),
})
export type CrmForecast = z.infer<typeof crmForecast>

// ── activities ────────────────────────────────────────────────
export const activityType = z.enum(['call', 'email', 'meeting', 'note', 'task', 'whatsapp', 'sms'])
export type ActivityType = z.infer<typeof activityType>
export const activityDirection = z.enum(['in', 'out', 'none'])
export type ActivityDirection = z.infer<typeof activityDirection>
export const activityProvider = z.enum(['manual', 'twilio', 'gmail', 'o365', 'whatsapp'])
export type ActivityProvider = z.infer<typeof activityProvider>

export const crmActivity = z.object({
  id: uuid,
  lead_id: uuid.nullable(),
  lead_name: z.string().nullable().default(null),
  contact_id: uuid.nullable(),
  contact_name: z.string().nullable().default(null),
  type: activityType,
  direction: activityDirection,
  subject: z.string().nullable(),
  body: z.string().nullable(),
  outcome: z.string().nullable(),
  started_at: isoDateTime.nullable(),
  ended_at: isoDateTime.nullable(),
  duration_s: z.number().int().nullable(),
  due_at: isoDateTime.nullable(),
  done_at: isoDateTime.nullable(),
  assigned_to: uuid.nullable(),
  assignee_name: z.string().nullable().default(null),
  actor_id: uuid.nullable(),
  actor_name: z.string().nullable().default(null),
  provider: activityProvider,
  external_id: z.string().nullable().default(null),
  /** Where a meeting is; collected by the form and kept on the row. */
  location: z.string().nullable().default(null),
  created_at: isoDateTime,
})
export type CrmActivity = z.infer<typeof crmActivity>

export const activitiesQuery = z.object({
  lead_id: uuid.optional(),
  contact_id: uuid.optional(),
  type: activityType.optional(),
  assigned_to: uuid.optional(),
  /** Only tasks still open, oldest due first. */
  open_tasks: z
    .union([z.literal('1'), z.literal('0'), z.literal('true'), z.literal('false')])
    .optional()
    .transform((v) => v === '1' || v === 'true'),
  limit: z.coerce.number().int().min(1).max(1000).default(200),
})
export type ActivitiesQuery = z.infer<typeof activitiesQuery>

export const createActivityRequest = z
  .object({
    lead_id: uuid.optional(),
    contact_id: uuid.optional(),
    type: activityType,
    direction: activityDirection.default('none'),
    subject: z.string().trim().max(200).optional(),
    body: z.string().max(8000).optional(),
    outcome: z.string().trim().max(60).optional(),
    started_at: isoDateTime.optional(),
    ended_at: isoDateTime.optional(),
    duration_s: z.number().int().min(0).max(86400).optional(),
    due_at: isoDateTime.optional(),
    assigned_to: uuid.nullable().optional(),
  })
  .refine((v) => !!v.lead_id || !!v.contact_id, { message: 'An activity belongs to a deal or a contact.', path: ['lead_id'] })
  .refine((v) => v.type !== 'task' || !!v.subject, { message: 'Say what the task is.', path: ['subject'] })
export type CreateActivityRequest = z.infer<typeof createActivityRequest>

export const updateActivityRequest = z.object({
  subject: z.string().trim().max(200).nullable().optional(),
  location: z.string().trim().max(200).nullable().optional(),
  body: z.string().max(8000).nullable().optional(),
  outcome: z.string().trim().max(60).nullable().optional(),
  started_at: isoDateTime.nullable().optional(),
  ended_at: isoDateTime.nullable().optional(),
  duration_s: z.number().int().min(0).max(86400).nullable().optional(),
  due_at: isoDateTime.nullable().optional(),
  /** true stamps done_at now; false clears it. */
  done: z.boolean().optional(),
  assigned_to: uuid.nullable().optional(),
})
export type UpdateActivityRequest = z.infer<typeof updateActivityRequest>

/** GET /crm/leads/:id/timeline — the stage trail and the activities, merged. */
export const timelineItem = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('event'), at: isoDateTime, event: leadEvent }),
  z.object({ kind: z.literal('activity'), at: isoDateTime, activity: crmActivity }),
])
export type TimelineItem = z.infer<typeof timelineItem>

export const timelineQuery = z.object({
  before: isoDateTime.optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
})
export type TimelineQuery = z.infer<typeof timelineQuery>

export const timelineResponse = z.object({
  items: z.array(timelineItem),
  /** Pass back as ?before= for the next page; null when there is no more. */
  next_cursor: isoDateTime.nullable(),
})
export type TimelineResponse = z.infer<typeof timelineResponse>

// ── calls, meetings, email sync ───────────────────────────────
export const placeCallRequest = z.object({
  lead_id: uuid,
  /** The agent's own number, rung first. Defaults to the caller's profile phone. */
  agent_phone: z.string().trim().min(6).max(30).optional(),
})
export type PlaceCallRequest = z.infer<typeof placeCallRequest>

export const placeCallResponse = z.object({
  activity: crmActivity,
  /** true = Twilio is ringing; false = logged as a manual call, open dial_url. */
  placed: z.boolean(),
  provider: z.enum(['twilio', 'manual']),
  call_sid: z.string().nullable(),
  dial_url: z.string().nullable(),
})
export type PlaceCallResponse = z.infer<typeof placeCallResponse>

export const scheduleMeetingRequest = z
  .object({
    lead_id: uuid,
    subject: z.string().trim().min(1).max(200),
    starts_at: isoDateTime,
    ends_at: isoDateTime,
    location: z.string().trim().max(200).optional(),
    notes: z.string().max(4000).optional(),
    /** Invite the lead by email when they have one. */
    invite_lead: z.boolean().default(true),
  })
  .refine((v) => v.ends_at > v.starts_at, { message: 'The meeting must end after it starts.', path: ['ends_at'] })
export type ScheduleMeetingRequest = z.infer<typeof scheduleMeetingRequest>

export const scheduleMeetingResponse = z.object({
  activity: crmActivity,
  /** GET this for the .ics file. */
  ics_url: z.string(),
})
export type ScheduleMeetingResponse = z.infer<typeof scheduleMeetingResponse>

export const emailSyncRequest = z.object({ since_days: z.number().int().min(1).max(90).default(7) })
export type EmailSyncRequest = z.infer<typeof emailSyncRequest>

export const emailSyncResponse = z.object({
  status: z.enum(['not_configured', 'ok', 'error']),
  provider: z.enum(['gmail', 'o365']).nullable(),
  fetched: z.number().int(),
  imported: z.number().int(),
  /** Messages whose counterpart matched no contact or lead by email. */
  unmatched: z.number().int(),
  message: z.string().nullable().default(null),
})
export type EmailSyncResponse = z.infer<typeof emailSyncResponse>

export const integrationProvider = z.enum(['gmail', 'o365', 'twilio'])
export type IntegrationProvider = z.infer<typeof integrationProvider>

export const crmIntegration = z.object({
  provider: integrationProvider,
  status: z.enum(['not_configured', 'connected', 'error']),
  /** Whether this deployment carries the credentials for it. */
  credentials_present: z.boolean(),
  config: z.record(z.unknown()).default({}),
  last_error: z.string().nullable().default(null),
  last_sync_at: isoDateTime.nullable().default(null),
  connected_by: uuid.nullable().default(null),
  updated_at: isoDateTime.nullable().default(null),
})
export type CrmIntegration = z.infer<typeof crmIntegration>

export const updateIntegrationRequest = z.object({
  status: z.enum(['connected', 'not_configured']).optional(),
  config: z.record(z.union([z.string().max(200), z.number(), z.boolean()])).optional(),
})
export type UpdateIntegrationRequest = z.infer<typeof updateIntegrationRequest>

// ── per-person preferences ────────────────────────────────────
export const inboxColumn = z.enum(['lead', 'stage', 'score', 'source', 'owner', 'value', 'close', 'company', 'follow_up', 'created'])
export type InboxColumn = z.infer<typeof inboxColumn>

export const crmUserPrefs = z.object({
  columns: z.array(inboxColumn).max(12).default(['lead', 'stage', 'score', 'source', 'owner', 'value', 'follow_up']),
  default_view_id: uuid.nullable().default(null),
  density: z.enum(['comfortable', 'compact']).default('comfortable'),
  pipeline_id: uuid.nullable().default(null),
})
export type CrmUserPrefs = z.infer<typeof crmUserPrefs>

export const updateCrmUserPrefsRequest = crmUserPrefs.partial()
export type UpdateCrmUserPrefsRequest = z.infer<typeof updateCrmUserPrefsRequest>

// ── quotes ────────────────────────────────────────────────────
export const quoteStatus = z.enum(['draft', 'sent', 'accepted', 'declined', 'expired'])
export type QuoteStatus = z.infer<typeof quoteStatus>

export const quoteItem = z.object({
  id: uuid.optional(),
  description: z.string(),
  quantity: z.coerce.number(),
  rate: z.coerce.number(),
  amount: z.coerce.number(),
  gst_rate: z.coerce.number(),
  taxable: z.coerce.number(),
  cgst: z.coerce.number(),
  sgst: z.coerce.number(),
  igst: z.coerce.number(),
})
export type QuoteItem = z.infer<typeof quoteItem>

export const crmQuote = z.object({
  id: uuid,
  lead_id: uuid,
  lead_name: z.string().nullable().default(null),
  quote_number: z.string(),
  title: z.string().nullable(),
  status: quoteStatus,
  valid_until: isoDate.nullable(),
  place_of_supply: z.string().nullable(),
  intra_state: z.boolean(),
  subtotal: z.coerce.number(),
  discount: z.coerce.number(),
  taxable: z.coerce.number(),
  tax: z.coerce.number(),
  total: z.coerce.number(),
  notes: z.string().nullable(),
  terms: z.string().nullable(),
  sent_at: isoDateTime.nullable(),
  accepted_at: isoDateTime.nullable(),
  accepted_by_name: z.string().nullable(),
  accepted_by_email: z.string().nullable().default(null),
  /** Kept as evidence when a client accepts through the public link. */
  accepted_ip: z.string().nullable().default(null),
  declined_at: isoDateTime.nullable(),
  decline_reason: z.string().nullable(),
  items: z.array(quoteItem).default([]),
  created_at: isoDateTime,
})
export type CrmQuote = z.infer<typeof crmQuote>

export const createQuoteRequest = z.object({
  lead_id: uuid,
  title: z.string().trim().max(160).optional(),
  valid_until: isoDate.optional(),
  place_of_supply: z.string().trim().max(60).default(''),
  /** Same state as the studio: CGST + SGST; otherwise IGST. */
  intra_state: z.boolean().default(true),
  discount: money.default(0),
  notes: z.string().max(4000).optional(),
  terms: z.string().max(8000).optional(),
  lines: z.array(invoiceLineInput).min(1).max(50),
})
export type CreateQuoteRequest = z.infer<typeof createQuoteRequest>

/** Same shape as creation, minus the lead (a quote never moves to a different deal): an edit resends title, terms, and lines together. */
export const updateQuoteRequest = createQuoteRequest.omit({ lead_id: true })
export type UpdateQuoteRequest = z.infer<typeof updateQuoteRequest>

export const sendQuoteRequest = z.object({
  /** Also deliver the link on WhatsApp (Cloud API when connected, else a wa.me link) or by email. */
  channel: z.enum(['none', 'whatsapp', 'email']).default('none'),
  ttl_hours: z.number().int().min(1).max(8760).default(720),
})
export type SendQuoteRequest = z.infer<typeof sendQuoteRequest>

export const sendQuoteResponse = z.object({
  /** The public page the client opens. */
  url: z.string(),
  /** A link to open (wa.me / mailto:) when the channel needs the person's own app; null when delivered or none. */
  open_url: z.string().nullable(),
  delivery: z.enum(['none', 'api', 'link']),
})
export type SendQuoteResponse = z.infer<typeof sendQuoteResponse>

/** What the client sees on the public page. */
/** Recording an answer that arrived off the link — by phone, in person. */
export const setQuoteOutcomeRequest = z.object({
  status: z.enum(['accepted', 'declined', 'sent']),
  /** Who accepted, when the studio is recording it on their behalf. */
  name: z.string().trim().max(160).optional(),
  reason: z.string().trim().max(500).optional(),
})
export type SetQuoteOutcomeRequest = z.infer<typeof setQuoteOutcomeRequest>

export const crmQuoteStatusResponse = z.object({ status: quoteStatus })
export type CrmQuoteStatusResponse = z.infer<typeof crmQuoteStatusResponse>

export const publicQuote = z.object({
  quote_number: z.string(),
  title: z.string().nullable(),
  status: quoteStatus,
  valid_until: isoDate.nullable(),
  subtotal: z.coerce.number(),
  discount: z.coerce.number(),
  taxable: z.coerce.number(),
  tax: z.coerce.number(),
  total: z.coerce.number(),
  notes: z.string().nullable(),
  terms: z.string().nullable(),
  accepted_at: isoDateTime.nullable(),
  declined_at: isoDateTime.nullable(),
  place_of_supply: z.string().nullable().default(null),
  intra_state: z.boolean().default(true),
  studio: z.string(),
  client_name: z.string().nullable(),
  items: z.array(quoteItem),
  expired: z.boolean(),
})
export type PublicQuote = z.infer<typeof publicQuote>

export const acceptQuoteRequest = z.object({
  name: z.string().trim().min(1).max(160),
  email: z.string().trim().max(200).optional(),
})
export type AcceptQuoteRequest = z.infer<typeof acceptQuoteRequest>

export const declineQuoteRequest = z.object({ reason: z.string().trim().max(500).optional() })
export type DeclineQuoteRequest = z.infer<typeof declineQuoteRequest>

export const okResponse = z.object({ ok: z.boolean() })
export type OkResponse = z.infer<typeof okResponse>
