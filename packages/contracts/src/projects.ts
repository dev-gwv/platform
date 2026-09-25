import { z } from 'zod'
import { uuid, isoDate, isoDateTime, money } from './shared/primitives'

export const projectStatus = z.enum(['active', 'completed', 'cancelled', 'on_hold'])
export type ProjectStatus = z.infer<typeof projectStatus>

export const deliverableVisibility = z.enum(['client', 'internal'])
/**
 * Where a deliverable stands. The labels the studio sees are To do, Editing,
 * With client, Delivered and Dropped; the stored values predate 'review'.
 */
export const deliverableStatus = z.enum(['pending', 'in_progress', 'review', 'completed', 'cancelled'])
export type DeliverableStatus = z.infer<typeof deliverableStatus>
export const deliverableStartRule = z.enum([
  'this_shoot',
  'whole_project',
  'specific_shoots',
  'no_data',
])

/**
 * The link sent to the client. Only web addresses: it is rendered as a link
 * on screens other people open, so a `javascript:` value must never get in.
 * Blank is allowed and means "no link".
 */
const deliveryLink = z
  .string()
  .trim()
  .max(1000)
  .refine((v) => v === '' || /^https?:\/\/\S+$/i.test(v), 'Links must start with http:// or https://')

/** A deliverable as sent when creating a project. */
export const deliverableInput = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().max(2000).optional(),
  list_key: z.string().min(1).max(40).default('primary'),
  is_additional_charge: z.boolean().default(false),
  additional_charge_amount: money.default(0),
  visibility_scope: deliverableVisibility.default('client'),
  show_on_quotation: z.boolean().default(true),
  estimated_date: isoDate.optional(),
  start_rule: deliverableStartRule.default('whole_project'),
  delivery_days_after_start: z.number().int().min(0).optional(),
  work_type: z.string().max(80).optional(),
  internal_notes: z.string().max(2000).optional(),
  /** The one shoot it comes from; none means the whole project. */
  shoot_id: uuid.nullish(),
  /** The editor or designer on it. */
  assignee_id: uuid.nullish(),
  status: deliverableStatus.optional(),
  delivery_link: deliveryLink.nullish(),
})
export type DeliverableInput = z.infer<typeof deliverableInput>

export const updateDeliverableRequest = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  description: z.string().max(2000).nullable().optional(),
  list_key: z.string().min(1).max(40).optional(),
  is_additional_charge: z.boolean().optional(),
  additional_charge_amount: money.optional(),
  visibility_scope: deliverableVisibility.optional(),
  show_on_quotation: z.boolean().optional(),
  estimated_date: isoDate.nullable().optional(),
  start_rule: deliverableStartRule.optional(),
  delivery_days_after_start: z.number().int().min(0).nullable().optional(),
  work_type: z.string().max(80).nullable().optional(),
  internal_notes: z.string().max(2000).nullable().optional(),
  status: deliverableStatus.optional(),
  custom_status_code: z.string().max(40).nullable().optional(),
  shoot_id: uuid.nullable().optional(),
  assignee_id: uuid.nullable().optional(),
  delivery_link: deliveryLink.nullable().optional(),
})
export type UpdateDeliverableRequest = z.infer<typeof updateDeliverableRequest>

/**
 * Move a deliverable along. The editor on it may do this too -- not only
 * someone who can edit the project -- so the link reaches the record from the
 * person who sent it.
 */
export const setDeliverableStageRequest = z.object({
  status: deliverableStatus,
  /** The studio's own name for where it stands inside that step, if any. */
  custom_status_code: z.string().trim().max(40).nullish(),
  delivery_link: deliveryLink.nullish(),
})
export type SetDeliverableStageRequest = z.infer<typeof setDeliverableStageRequest>

export const projectPaymentStatus = z.enum(['paid', 'pending'])
export type ProjectPaymentStatus = z.infer<typeof projectPaymentStatus>

/** Amounts on a payment: more than zero -- a ₹0 "payment" is a mistake. */
const paymentAmount = money.refine((v) => v > 0, 'Enter the amount received.')
const gstNumber = z.string().trim().max(20).refine((v) => v === '' || v.length >= 5, 'That GST number looks too short.')

export const paymentInput = z.object({
  amount: paymentAmount,
  paid_on: isoDate.optional(),
  mode: z.string().max(40).optional(),
  reference: z.string().max(120).optional(),
  notes: z.string().max(500).optional(),
  // Lovable parity (additive): pending vs paid, client-facing description,
  // and GST receipt fields. All optional so old callers keep working.
  status: projectPaymentStatus.optional(),
  description: z.string().max(500).optional(),
  is_gst: z.boolean().optional(),
  gst_number: gstNumber.optional(),
  /** The project's invoice this money settles, if any. */
  invoice_id: uuid.nullable().optional(),
})
export type PaymentInput = z.infer<typeof paymentInput>

export const updatePaymentRequest = z.object({
  amount: paymentAmount.optional(),
  paid_on: isoDate.optional(),
  mode: z.string().max(40).nullable().optional(),
  reference: z.string().max(120).nullable().optional(),
  status: projectPaymentStatus.optional(),
  description: z.string().max(500).nullable().optional(),
  is_gst: z.boolean().optional(),
  gst_number: gstNumber.nullable().optional(),
  invoice_id: uuid.nullable().optional(),
})
export type UpdatePaymentRequest = z.infer<typeof updatePaymentRequest>

export const createProjectRequest = z.object({
  client_id: uuid,
  name: z.string().trim().min(1).max(200),
  package_cost: money.default(0),
  status: projectStatus.default('active'),
  show_quotation: z.boolean().default(false),
  deliverables: z.array(deliverableInput).default([]),
  payments: z.array(paymentInput).default([]),
})
export type CreateProjectRequest = z.infer<typeof createProjectRequest>

export const updateProjectRequest = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  status: projectStatus.optional(),
  package_cost: money.optional(),
  show_quotation: z.boolean().optional(),
})
export type UpdateProjectRequest = z.infer<typeof updateProjectRequest>

/** Row shape in the project list. */
export const projectListItem = z.object({
  id: uuid,
  name: z.string(),
  status: projectStatus,
  client_id: uuid,
  client_name: z.string().nullable(),
  /** Shown beside the name: a studio finds a project by whose wedding it is. */
  client_phone: z.string().nullable(),
  package_cost: money,
  total_cost: money,
  /** Summed from received_payments, so the list needs no second request. */
  received: money,
  created_at: isoDateTime,
  // Lovable parity (additive, nullable so old rows parse): sorting helpers.
  next_shoot_date: isoDate.nullable().default(null),
  tasks_overdue: z.number().int().default(0),
})
export type ProjectListItem = z.infer<typeof projectListItem>

/** Server pagination envelope for GET /projects (legacy callers still accept a bare array). */
export const projectListQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce.number().int().min(1).max(100).default(20),
  status: z.string().optional(),
  search: z.string().max(200).optional(),
  sort: z.enum(['recent', 'oldest', 'value_desc', 'pending_desc', 'received_desc', 'name', 'risk', 'completion', 'overdue', 'upcoming']).optional(),
})
export type ProjectListQuery = z.infer<typeof projectListQuery>

export const projectListPage = z.object({
  items: z.array(projectListItem),
  total: z.number().int(),
  page: z.number().int(),
  page_size: z.number().int(),
  /** Money across every project the filter matches, not just this page. */
  summary: z
    .object({ value: money, received: money, due: money })
    .default({ value: 0, received: 0, due: 0 }),
  /** Projects per status for the current search, for the status tabs. */
  status_counts: z.record(z.string(), z.number().int()).default({}),
})
export type ProjectListPage = z.infer<typeof projectListPage>

/** Deliverable as returned by the API — DB nulls tolerated (not input's optionals). */
export const deliverable = z.object({
  id: uuid,
  project_id: uuid,
  title: z.string(),
  description: z.string().nullish(),
  list_key: z.string(),
  is_additional_charge: z.boolean(),
  additional_charge_amount: money,
  visibility_scope: deliverableVisibility,
  show_on_quotation: z.boolean(),
  estimated_date: isoDate.nullish(),
  start_rule: deliverableStartRule,
  delivery_days_after_start: z.number().int().nullish(),
  work_type: z.string().nullish(),
  internal_notes: z.string().nullish(),
  // Tolerant on read: a row could in principle carry a status value from
  // before this enum was tightened, and this must not 500 the whole list.
  status: z.string(),
  custom_status_code: z.string().nullish(),
  shoot_id: uuid.nullish(),
  shoot_name: z.string().nullish(),
  shoot_date: isoDate.nullish(),
  assignee_id: uuid.nullish(),
  assignee_name: z.string().nullish(),
  delivery_link: z.string().nullish(),
  delivered_at: isoDateTime.nullish(),
  /** Written and voice notes on it; stage events are not counted. */
  notes_count: z.number().int().default(0),
  voice_count: z.number().int().default(0),
  /** The latest thing that happened on it, for the one-line activity on the card. */
  last_activity_at: isoDateTime.nullish(),
  last_activity_by: z.string().nullish(),
  last_activity_kind: z.enum(['text', 'voice', 'event']).nullish(),
  last_activity_body: z.string().nullish(),
})
export type Deliverable = z.infer<typeof deliverable>

/**
 * One entry on a deliverable's timeline: a written note, a voice note, or a
 * stage change the database recorded (body "moved:<status>").
 */
export const deliverableNote = z.object({
  id: uuid,
  deliverable_id: uuid,
  kind: z.enum(['text', 'voice', 'event']),
  body: z.string().nullish(),
  file_id: uuid.nullish(),
  duration_seconds: z.number().int().nullish(),
  author_id: uuid.nullish(),
  author_name: z.string().nullish(),
  /** For a submitted / approved / sent-back event: the work's link. */
  link: z.string().nullish(),
  created_at: isoDateTime,
})
export type DeliverableNote = z.infer<typeof deliverableNote>

export const createDeliverableNoteRequest = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('text'), body: z.string().trim().min(1, 'Write something first.').max(4000) }),
  z.object({
    kind: z.literal('voice'),
    file_id: uuid,
    duration_seconds: z.number().int().min(0).max(3600).optional(),
    body: z.string().trim().max(500).optional(),
  }),
])
export type CreateDeliverableNoteRequest = z.infer<typeof createDeliverableNoteRequest>

/** A deliverable on someone's own list: what, for whom, and by when. */
export const myDeliverable = z.object({
  id: uuid,
  project_id: uuid,
  project_name: z.string(),
  client_name: z.string().nullish(),
  title: z.string(),
  description: z.string().nullish(),
  status: z.string(),
  estimated_date: isoDate.nullish(),
  shoot_name: z.string().nullish(),
  delivery_link: z.string().nullish(),
  visibility_scope: deliverableVisibility,
  custom_status_code: z.string().nullish(),
  notes_count: z.number().int().default(0),
  voice_count: z.number().int().default(0),
})
export type MyDeliverable = z.infer<typeof myDeliverable>

// ── Granular catalog (Lovable parity): separate from generic project_templates ──
export const shootTypeItem = z.object({
  id: uuid,
  name: z.string(),
  category: z.string().nullable().default(null),
  usage_count: z.number().int().default(0),
  is_archived: z.boolean().default(false),
})
export type ShootTypeItem = z.infer<typeof shootTypeItem>

export const createShootTypeRequest = z.object({
  name: z.string().trim().min(1).max(120),
  category: z.string().trim().max(80).nullish(),
})
export type CreateShootTypeRequest = z.infer<typeof createShootTypeRequest>

export const deliverableTemplateItem = z.object({
  id: uuid,
  title: z.string(),
  shoot_type: z.string().nullable().default(null),
  delivery_days: z.number().int().nullable().default(null),
  due_basis: z.string().nullable().default(null),
  brief: z.string().nullable().default(null),
  is_combined: z.boolean().default(false),
  usage_count: z.number().int().default(0),
  is_archived: z.boolean().default(false),
})
export type DeliverableTemplateItem = z.infer<typeof deliverableTemplateItem>

export const createDeliverableTemplateRequest = z.object({
  title: z.string().trim().min(1).max(200),
  shoot_type: z.string().trim().max(120).nullish(),
  delivery_days: z.number().int().min(0).nullish(),
  due_basis: z.string().trim().max(40).nullish(),
  brief: z.string().trim().max(2000).nullish(),
  is_combined: z.boolean().default(false),
})
export type CreateDeliverableTemplateRequest = z.infer<typeof createDeliverableTemplateRequest>

export const workflowPresetItem = z.object({
  id: uuid,
  name: z.string(),
  shoot_type: z.string().nullable().default(null),
  shoot_time: z.string().nullable().default(null),
  shoot_city: z.string().nullable().default(null),
  requirements: z.array(z.string()).default([]),
  deliverables: z.array(z.string()).default([]),
  usage_count: z.number().int().default(0),
  is_archived: z.boolean().default(false),
})
export type WorkflowPresetItem = z.infer<typeof workflowPresetItem>

export const createWorkflowPresetRequest = z.object({
  name: z.string().trim().min(1).max(160),
  shoot_type: z.string().trim().max(120).nullish(),
  shoot_time: z.string().trim().max(40).nullish(),
  shoot_city: z.string().trim().max(120).nullish(),
  requirements: z.array(z.string().trim().min(1).max(120)).max(40).default([]),
  deliverables: z.array(z.string().trim().min(1).max(200)).max(40).default([]),
})
export type CreateWorkflowPresetRequest = z.infer<typeof createWorkflowPresetRequest>

export const projectDetail = z.object({
  id: uuid,
  name: z.string(),
  status: projectStatus,
  client_id: uuid,
  client_name: z.string().nullable(),
  client_phone: z.string().nullable(),
  // The Overview shows how to reach the client; phone alone meant looking
  // them up on another screen to send anything.
  client_email: z.string().nullable().default(null),
  client_address: z.string().nullable().default(null),
  package_cost: money,
  additional_deliverables_cost: money,
  total_cost: money,
  show_quotation: z.boolean(),
  created_at: isoDateTime,
  // Quotation display prefs + terms live on projects (see 0006 migration).
  // project-quotation (deliverables-based) is the canonical project quote;
  // the GST quote-accept flow is the CRM-deal quote and stays separate.
  quotation_terms: z.string().nullable().default(null),
  quotation_display_prefs: z.record(z.string(), z.boolean()).default({}),
  deliverables: z.array(deliverable),
  payments: z.array(
    z.object({
      id: uuid,
      amount: money,
      paid_on: isoDate,
      mode: z.string().nullable(),
      reference: z.string().nullable(),
      status: z.string().nullable().default(null),
      description: z.string().nullable().default(null),
      is_gst: z.boolean().default(false),
      gst_number: z.string().nullable().default(null),
      invoice_id: uuid.nullable().default(null),
      invoice_number: z.string().nullable().default(null),
    }),
  ),
})
export type ProjectDetail = z.infer<typeof projectDetail>

/** One instalment of the payment plan the client agreed to in the terms. */
export const planInstalment = z.object({
  label: z.string(),
  mode: z.enum(['percent', 'amount']),
  value: z.number(),
  due_trigger: z.string().nullable().default(null),
})
export type PlanInstalment = z.infer<typeof planInstalment>

/** The project's money beyond its payments: the agreed plan and its invoices. */
export const projectBilling = z.object({
  plan: z
    .object({
      document_id: uuid,
      title: z.string().nullable(),
      agreed_at: isoDateTime.nullable(),
      total_cost: money.nullable(),
      instalments: z.array(planInstalment),
    })
    .nullable(),
  /** Null when the person cannot see Billing. */
  invoices: z
    .array(
      z.object({
        id: uuid,
        invoice_number: z.string(),
        invoice_date: isoDate,
        due_date: isoDate.nullable(),
        status: z.string(),
        total: money,
        taxable: money,
        balance_due: money,
      }),
    )
    .nullable(),
})
export type ProjectBilling = z.infer<typeof projectBilling>

/**
 * One row of the tracking board: raw counters, not verdicts.
 *
 * The scoring lives in @ipc/domain so it can be tested and so the client can
 * re-sort and re-filter without another round trip. The server's job here is
 * only to count what is true.
 */
export const trackingReason = z.object({
  code: z.enum(['data', 'late', 'review', 'short_crew', 'invoice_overdue', 'low_progress', 'no_work', 'no_shoot']),
  count: z.number().int(),
  action: z.string(),
})

export const projectHealthSchema = z.object({
  completion: z.number(),
  band: z.enum(['critical', 'high', 'low_progress', 'healthy', 'completed']),
  score: z.number(),
  flags: z.object({
    critical: z.boolean(),
    high_risk: z.boolean(),
    low_progress: z.boolean(),
    data_missing: z.boolean(),
    overdue: z.boolean(),
    pending_review: z.boolean(),
    completed: z.boolean(),
  }),
  next_action: z.string(),
  reasons: trackingReason.array(),
})

export const projectTrackingRow = z.object({
  id: uuid,
  name: z.string(),
  status: projectStatus,
  client_name: z.string().nullable(),
  /** Money is only sent to someone who can see Billing. */
  total_cost: money.nullable().default(null),
  tasks_total: z.number().int(),
  tasks_done: z.number().int(),
  tasks_overdue: z.number().int(),
  deliverables_total: z.number().int(),
  deliverables_done: z.number().int(),
  /** Open deliverables past their due date. */
  deliverables_late: z.number().int().default(0),
  /** Sent to the client, waiting on them. */
  deliverables_with_client: z.number().int().default(0),
  /** Paid money only; a promised payment is not here. Null without Billing access. */
  received: money.nullable().default(null),
  /** Owed on invoices past their due date. Null without Billing access. */
  overdue_amount: money.nullable().default(null),
  invoices_overdue: z.number().int().default(0),
  data_records_total: z.number().int(),
  /** Records not yet in two places. */
  data_records_unverified: z.number().int(),
  /** Booked crew, shoot day passed, owe data, handed in none. */
  data_missing: z.number().int().default(0),
  data_issues: z.number().int().default(0),
  pending_reviews: z.number().int(),
  shoots_total: z.number().int(),
  shoots_done: z.number().int(),
  /** Upcoming shoots with fewer people booked than the roles need. */
  shoots_short: z.number().int().default(0),
  next_shoot_date: isoDate.nullable(),
  /** Earliest due date among open deliverables. */
  next_due_date: isoDate.nullable().default(null),
  last_activity_at: isoDateTime,
  /** Worked out on the server by @ipc/domain projectHealth -- one answer everywhere. */
  health: projectHealthSchema,
})
export type ProjectTrackingRow = z.infer<typeof projectTrackingRow>

/** One project opened up on the tracking page: what is late or waiting, and on whom. */
export const trackingBreakdown = z.object({
  deliverables: z
    .object({
      id: uuid,
      title: z.string(),
      stage: z.string(),
      assignee_name: z.string().nullable(),
      estimated_date: isoDate.nullable(),
      days_late: z.number().int(),
    })
    .array(),
  tasks: z
    .object({
      id: uuid,
      title: z.string(),
      due_date: isoDate.nullable(),
      days_late: z.number().int(),
      assignee_names: z.string().array(),
    })
    .array(),
  submissions: z
    .object({ id: uuid, title: z.string().nullable(), submitted_by_name: z.string().nullable(), created_at: isoDateTime })
    .array(),
  shoots: z
    .object({
      id: uuid,
      name: z.string(),
      shoot_date: isoDate.nullable(),
      needed: z.number().int(),
      booked: z.number().int(),
      data_missing: z.number().int(),
      data_unsafe: z.number().int(),
    })
    .array(),
  /** Null without Billing access. */
  money: z
    .object({
      total_cost: money,
      received: money,
      balance: money,
      invoices_overdue: z
        .object({ id: uuid, invoice_number: z.string().nullable(), due_date: isoDate.nullable(), balance_due: money })
        .array(),
    })
    .nullable(),
})
export type TrackingBreakdown = z.infer<typeof trackingBreakdown>

/**
 * One line of a saved package. A set is a template, so it carries what the
 * studio decided about the item — charged on top or included, printed on the
 * quotation or not — and none of the scheduling, which belongs to the project
 * it lands in, not to the package.
 */
export const deliverableSetItem = z.object({
  title: z.string().trim().min(1).max(200),
  is_additional_charge: z.boolean().default(false),
  additional_charge_amount: money.default(0),
  show_on_quotation: z.boolean().default(true),
})
export type DeliverableSetItem = z.infer<typeof deliverableSetItem>

export const deliverableSet = z.object({
  id: uuid,
  name: z.string(),
  items: z.array(deliverableSetItem),
})
export type DeliverableSet = z.infer<typeof deliverableSet>

export const saveDeliverableSetRequest = z.object({
  name: z.string().trim().min(1).max(80),
  items: z.array(deliverableSetItem).min(1).max(60),
})
export type SaveDeliverableSetRequest = z.infer<typeof saveDeliverableSetRequest>

/**
 * A studio's own stage inside one of the four steps -- "With manager",
 * "Approved", "Colour grading". `stage` is the step it sits in; `code` is
 * what a deliverable stores and never changes, so renaming is safe.
 */
export const stepKey = z.enum(['pending', 'in_progress', 'review', 'completed'])
export type StepKey = z.infer<typeof stepKey>
export const stageTone = z.enum(['slate', 'blue', 'violet', 'amber', 'green', 'rose', 'teal'])
export type StageTone = z.infer<typeof stageTone>

export const deliverableStage = z.object({
  id: uuid,
  code: z.string(),
  label: z.string(),
  stage: stepKey,
  color: z.string().nullish(),
  team_allowed: z.boolean(),
  sort_order: z.number().int(),
})
export type DeliverableStage = z.infer<typeof deliverableStage>

// ── Production board ───────────────────────────────────────────
/**
 * One deliverable on the production board: what it is, whose it is, where it
 * stands and by when. Open work, plus what was delivered in the last fortnight.
 */
export const boardDeliverable = z.object({
  id: uuid,
  project_id: uuid,
  project_name: z.string(),
  client_name: z.string().nullish(),
  title: z.string(),
  description: z.string().nullish(),
  status: z.string(),
  custom_status_code: z.string().nullish(),
  estimated_date: isoDate.nullish(),
  delivered_at: isoDateTime.nullish(),
  delivery_link: z.string().nullish(),
  visibility_scope: deliverableVisibility,
  shoot_id: uuid.nullish(),
  shoot_name: z.string().nullish(),
  shoot_date: isoDate.nullish(),
  assignee_id: uuid.nullish(),
  assignee_name: z.string().nullish(),
  notes_count: z.number().int().default(0),
  voice_count: z.number().int().default(0),
  last_activity_at: isoDateTime.nullish(),
  last_activity_by: z.string().nullish(),
  last_activity_kind: z.enum(['text', 'voice', 'event']).nullish(),
  last_activity_body: z.string().nullish(),
})
export type BoardDeliverable = z.infer<typeof boardDeliverable>

/** Someone in the studio who can carry production work. */
export const boardPerson = z.object({
  user_id: uuid,
  name: z.string(),
  role: z.string(),
  /** Booked on a shoot that runs today: why an edit might not be moving. */
  on_shoot_today: z.boolean(),
  /** Their open tasks, for the "and N open tasks" line. */
  open_tasks: z.number().int().default(0),
})
export type BoardPerson = z.infer<typeof boardPerson>

export const productionBoard = z.object({
  stages: z.array(deliverableStage),
  people: z.array(boardPerson),
  items: z.array(boardDeliverable),
  counts: z.object({
    open: z.number().int(),
    late: z.number().int(),
    due_today: z.number().int(),
    in_review: z.number().int(),
    unassigned: z.number().int(),
    dropped: z.number().int(),
    /** More open work exists than the board carries. */
    truncated: z.boolean(),
  }),
})
export type ProductionBoard = z.infer<typeof productionBoard>

/** One change to many deliverables at once: an editor, a stage, or a due date. */
export const bulkDeliverableRequest = z
  .object({
    ids: z.array(uuid).min(1, 'Pick at least one deliverable.').max(200),
    assignee_id: uuid.nullable().optional(),
    stage: z
      .object({ status: deliverableStatus, custom_status_code: z.string().trim().max(40).nullish() })
      .optional(),
    estimated_date: isoDate.nullable().optional(),
  })
  .refine(
    (v) => [v.assignee_id !== undefined, v.stage !== undefined, v.estimated_date !== undefined].filter(Boolean).length === 1,
    'Change one thing at a time: the editor, the stage or the due date.',
  )
export type BulkDeliverableRequest = z.infer<typeof bulkDeliverableRequest>

export const createDeliverableStageRequest = z.object({
  label: z.string().trim().min(2, 'Give the stage a name.').max(40),
  stage: stepKey,
  color: stageTone.default('slate'),
  team_allowed: z.boolean().default(true),
})
export type CreateDeliverableStageRequest = z.infer<typeof createDeliverableStageRequest>

export const updateDeliverableStageRequest = z.object({
  label: z.string().trim().min(2, 'Give the stage a name.').max(40).optional(),
  color: stageTone.optional(),
  team_allowed: z.boolean().optional(),
  sort_order: z.number().int().min(0).max(1000).optional(),
})
export type UpdateDeliverableStageRequest = z.infer<typeof updateDeliverableStageRequest>
