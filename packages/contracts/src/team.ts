import { z } from 'zod'
import { uuid, isoDate, isoDateTime, money } from './shared/primitives'

/**
 * How a person is engaged. Drives which fields the directory asks for and how
 * the studio thinks about their cost: salaried staff vs per-shoot crew.
 */
export const engagementType = z.enum(['in_house', 'freelancer'])
export type EngagementType = z.infer<typeof engagementType>

export const memberStatus = z.enum(['active', 'inactive', 'pending'])

/** One financial component of a person's pay — freely combined (salary + commission, say). */
export const payComponent = z.enum(['monthly_salary', 'freelancer_rate', 'commission', 'stipend'])
export type PayComponent = z.infer<typeof payComponent>

/** Lifecycle of THIS pay arrangement — separate from the person's own account status. */
export const paymentStatus = z.enum(['active', 'paused', 'ended'])
export type PaymentStatus = z.infer<typeof paymentStatus>

/** The app-role ladder an owner may hand out. Owner (super_admin) is not one. */
export const assignableRole = z.enum(['admin', 'manager', 'employee'])
export type AssignableRole = z.infer<typeof assignableRole>

/**
 * Which part of the job a role belongs to. Display-only: it groups the roles
 * page and nothing is gated on it, which is why an unstaged role is allowed —
 * the UI reads a stage off the name when the studio hasn't said.
 */
export const productionStage = z.enum(['pre', 'production', 'post', 'other'])
export type ProductionStage = z.infer<typeof productionStage>

/** A studio's own job roles — Photographer, Editor, Drone Op… */
export const employeeRole = z.object({
  id: uuid,
  type_name: z.string(),
  role_code: z.string(),
  stage: productionStage.nullable(),
  member_count: z.number().int(),
})
export type EmployeeRole = z.infer<typeof employeeRole>

export const upsertEmployeeRoleRequest = z.object({
  type_name: z.string().trim().min(2).max(60),
  role_code: z
    .string()
    .trim()
    .min(2)
    .max(40)
    .regex(/^[a-z0-9_]+$/, 'lowercase letters, numbers and underscores only'),
  stage: productionStage.optional(),
})
export type UpsertEmployeeRoleRequest = z.infer<typeof upsertEmployeeRoleRequest>

/**
 * The catalogue every studio starts from — the roles a photography business
 * books whoever they are. Platform-owned and read-only: picking one copies it
 * into the studio's own roles, so renaming it later is their business alone.
 */
export const libraryRole = z.object({
  id: uuid,
  type_name: z.string(),
  role_code: z.string(),
  stage: productionStage,
})
export type LibraryRole = z.infer<typeof libraryRole>

export const assignRolesRequest = z.object({ role_ids: z.array(uuid).max(20).default([]) })
export type AssignRolesRequest = z.infer<typeof assignRolesRequest>

/**
 * Full directory row.
 *
 * `email` is nullable — a directory-only freelancer may be a phone number and
 * nothing more. `salary` is nullable for a second reason: the API blanks it for
 * callers without the team_salaries module, so an absent figure means "not
 * yours to see" as often as "not set".
 */
export const directoryMember = z.object({
  user_id: uuid,
  name: z.string(),
  email: z.string().nullable(),
  role: z.string(),
  phone: z.string().nullable(),
  alternate_phone: z.string().nullable(),
  status: z.string(),
  engagement_type: z.string().nullable(),
  login_enabled: z.boolean(),
  salary: z.number().nullable(),
  /** Per-shoot/day rate for freelancers — separate from the monthly salary above. */
  freelancer_rate: money.nullable().default(null),
  address: z.string().nullable(),
  /** Freelance-friendly: salaried, or paid per shoot/day/project. */
  payout_type: z.enum(['salary', 'per_shoot', 'per_day', 'per_project', 'custom']).nullable(),
  commission_pct: z.number().min(0).max(100).nullable(),
  commission_basis: z.enum(['revenue', 'payment', 'profit', 'manual']).nullable(),
  stipend_amount: money.nullable(),
  pay_effective_from: isoDate.nullable(),
  pay_effective_to: isoDate.nullable(),
  compensation_notes: z.string().nullable(),
  /** Top-level pay classification: a built-in key or a studio-defined lookup value. */
  payment_type: z.string().nullable(),
  pay_components: z.array(payComponent).default([]),
  payment_status: paymentStatus,
  created_at: isoDateTime,
  role_names: z.array(z.string()),
  role_ids: z.array(uuid),
})
export type DirectoryMember = z.infer<typeof directoryMember>

/**
 * Add a member. The wizard's six steps collapse into this one payload.
 *
 * `create_login` is the fork: with it, email + password are required and the
 * person can sign in; without it they are directory-only — bookable, assignable,
 * with no identity to phish. `salary` is only ever accepted from an owner (the
 * API re-checks; a payload alone must not be able to write compensation).
 */
export const addMemberRequest = z
  .object({
    engagement_type: engagementType.default('in_house'),
    create_login: z.boolean().default(true),
    name: z.string().trim().min(2).max(120),
    phone: z.string().trim().min(6).max(20),
    email: z.string().trim().toLowerCase().email().optional(),
    alternate_phone: z.string().trim().max(20).optional(),
    password: z.string().min(6).max(72).optional(),
    role: assignableRole.default('employee'),
    role_ids: z.array(uuid).max(20).default([]),
    salary: money.optional(),
    /** Per-shoot/day rate — the freelancer counterpart to `salary`. */
    freelancer_rate: money.optional(),
    address: z.string().trim().max(300).optional(),
    payout_type: z.enum(['salary', 'per_shoot', 'per_day', 'per_project', 'custom']).optional(),
    commission_pct: z.number().min(0).max(100).optional(),
    commission_basis: z.enum(['revenue', 'payment', 'profit', 'manual']).optional(),
    stipend_amount: money.optional(),
    pay_effective_from: isoDate.optional(),
    pay_effective_to: isoDate.optional(),
    compensation_notes: z.string().trim().max(2000).optional(),
    payment_type: z.string().trim().min(1).max(60).optional(),
    pay_components: z.array(payComponent).max(4).default([]),
    payment_status: paymentStatus.default('active'),
  })
  .superRefine((v, ctx) => {
    if (v.create_login) {
      if (!v.email) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['email'], message: 'email is required for a login' })
      }
      if (!v.password) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['password'],
          message: 'password is required for a login',
        })
      }
    }
    // A pay arrangement needs a start date once one is set up at all -- the
    // date the studio agreed to pay this, not an afterthought.
    if (v.payment_type && !v.pay_effective_from) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['pay_effective_from'], message: 'effective from is required' })
    }
  })
export type AddMemberRequest = z.infer<typeof addMemberRequest>

/**
 * `temp_password` survives from the pre-wizard flow: null whenever the owner
 * set the password themselves, which is now the normal path.
 */
export const addMemberResponse = z.object({
  user_id: uuid,
  temp_password: z.string().nullable(),
  /**
   * The email already signs in to IPC, so this studio was added to that login
   * rather than a new one made: they sign in with their own password, and the
   * one typed here was not used.
   */
  linked_existing_login: z.boolean().default(false),
})
export type AddMemberResponse = z.infer<typeof addMemberResponse>

/** Paginated directory response — returned when page/page_size are requested. Array shape is kept for callers without them. */
export const directoryPage = z.object({
  items: directoryMember.array(),
  total: z.number().int(),
  page: z.number().int(),
  page_size: z.number().int(),
})
export type DirectoryPage = z.infer<typeof directoryPage>

export const updateMemberRequest = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  status: memberStatus.optional(),
  role: assignableRole.optional(),
  engagement_type: engagementType.optional(),
  salary: money.nullable().optional(),
  freelancer_rate: money.nullable().optional(),
  phone: z.string().trim().max(20).nullable().optional(),
  alternate_phone: z.string().trim().max(20).nullable().optional(),
  address: z.string().trim().max(300).nullable().optional(),
  payout_type: z.enum(['salary', 'per_shoot', 'per_day', 'per_project', 'custom']).nullable().optional(),
  commission_pct: z.number().min(0).max(100).nullable().optional(),
  commission_basis: z.enum(['revenue', 'payment', 'profit', 'manual']).nullable().optional(),
  stipend_amount: money.nullable().optional(),
  pay_effective_from: isoDate.nullable().optional(),
  pay_effective_to: isoDate.nullable().optional(),
  compensation_notes: z.string().trim().max(2000).nullable().optional(),
  payment_type: z.string().trim().min(1).max(60).nullable().optional(),
  pay_components: z.array(payComponent).max(4).optional(),
  payment_status: paymentStatus.optional(),
})
export type UpdateMemberRequest = z.infer<typeof updateMemberRequest>

/** One row of the pending-invitations panel. */
export const invitationStatus = z.enum(['pending', 'accepted', 'revoked', 'expired'])
export type InvitationStatus = z.infer<typeof invitationStatus>

export const invitation = z.object({
  id: uuid,
  email: z.string(),
  name: z.string(),
  role: z.string(),
  phone: z.string().nullable().default(null),
  status: invitationStatus.default('pending'),
  expires_at: isoDateTime,
  created_at: isoDateTime,
  last_sent_at: isoDateTime,
  send_count: z.number().int(),
  expired: z.boolean(),
})
export type Invitation = z.infer<typeof invitation>

export const createInvitationRequest = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.string().trim().toLowerCase().email(),
  role: assignableRole.default('employee'),
  phone: z.string().trim().max(20).optional(),
  alternate_phone: z.string().trim().max(20).optional(),
  engagement_type: engagementType.optional(),
  salary: money.optional(),
  address: z.string().trim().max(300).optional(),
  role_ids: z.array(uuid).max(20).default([]),
})
export type CreateInvitationRequest = z.infer<typeof createInvitationRequest>

/** The email is the token's target, so it stays fixed; revoke and re-invite for a wrong address. */
export const updateInvitationRequest = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  role: assignableRole.optional(),
})
export type UpdateInvitationRequest = z.infer<typeof updateInvitationRequest>

/**
 * The link is returned so the owner can pass it on directly — WhatsApp is how
 * this actually reaches most crew, and the email may never be opened.
 */
export const invitationLink = z.object({
  id: uuid,
  invite_link: z.string(),
  expires_at: isoDateTime,
})
export type InvitationLink = z.infer<typeof invitationLink>

/** What the accept screen shows before the invitee commits to a password. */
export const invitationPreview = z.object({
  email: z.string(),
  name: z.string(),
  company_name: z.string(),
  role: z.string(),
  expires_at: isoDateTime,
  /**
   * The invited email already signs in to IPC (another studio's team, or a
   * studio of its own). Accepting then adds this studio to that login, so the
   * page asks for the existing password instead of a new one.
   */
  has_account: z.boolean().default(false),
})
export type InvitationPreview = z.infer<typeof invitationPreview>

export const acceptInvitationRequest = z.object({
  token: z.string().min(10),
  // A new login needs 8+ (checked by the API); an existing one is checked
  // against whatever it already has, which older accounts set shorter.
  password: z.string().min(1).max(200),
})
export type AcceptInvitationRequest = z.infer<typeof acceptInvitationRequest>

/** Monthly salary ledger row — one person's pay for one calendar month. */
export const monthlySalaryStatus = z.enum(['unpaid', 'partial', 'paid', 'partially_paid'])
export type MonthlySalaryStatus = z.infer<typeof monthlySalaryStatus>

export const monthlySalary = z.object({
  id: uuid,
  user_id: uuid,
  name: z.string().nullable().default(null),
  email: z.string().nullable().default(null),
  phone: z.string().nullable().default(null),
  engagement_type: z.string().nullable().default(null),
  month: z.number().int().min(1).max(12),
  year: z.number().int().min(2000).max(2100),
  base_amount: money,
  paid_amount: money.default(0),
  status: monthlySalaryStatus.default('unpaid'),
  created_at: isoDateTime,
})
export type MonthlySalary = z.infer<typeof monthlySalary>

export const monthlySalaryList = z.object({
  items: z.array(monthlySalary),
  totals: z.object({
    base: money,
    paid: money,
    pending: money,
    count: z.number().int(),
    paid_count: z.number().int(),
    partial_count: z.number().int(),
    unpaid_count: z.number().int(),
  }),
})
export type MonthlySalaryList = z.infer<typeof monthlySalaryList>

export const generateMonthlySalariesRequest = z.object({
  month: z.number().int().min(1).max(12),
  year: z.number().int().min(2000).max(2100),
})
export type GenerateMonthlySalariesRequest = z.infer<typeof generateMonthlySalariesRequest>

export const updateMonthlySalaryRequest = z.object({
  paid_amount: money.optional(),
  status: monthlySalaryStatus.optional(),
})
export type UpdateMonthlySalaryRequest = z.infer<typeof updateMonthlySalaryRequest>
