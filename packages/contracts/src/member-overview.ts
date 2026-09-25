import { z } from 'zod'
import { uuid, isoDate, isoDateTime } from './shared/primitives'
import { profileCompleteness } from './settings'

/**
 * One team member, seen from every side: who they are, how complete their
 * profile is, this month's attendance, the work on their plate, and what
 * they have been paid.
 *
 * Every section is trimmed on the server for the person asking. `null` means
 * "not yours to see", not "nothing there": the private details are for the
 * owner and the member; pay is for whoever handles salaries or payouts (and
 * the member); the work list is for whoever can see projects (and the member).
 */
export const memberOverview = z.object({
  member: z.object({
    user_id: uuid,
    name: z.string(),
    email: z.string().nullable(),
    phone: z.string().nullable(),
    alternate_phone: z.string().nullable(),
    address: z.string().nullable(),
    avatar_url: z.string().nullable(),
    role: z.string(),
    status: z.string(),
    engagement_type: z.string().nullable(),
    login_enabled: z.boolean(),
    /** The studio's owner (nobody but the owner changes the owner). */
    is_owner: z.boolean(),
    created_at: isoDateTime,
    role_names: z.string().array(),
    /** Pay basis -- only for team_salaries or the member. */
    salary: z.number().nullable(),
    freelancer_rate: z.number().nullable(),
  }),
  profile: profileCompleteness,
  /** Owner or the member only. Account numbers and PAN never leave in full. */
  private: z
    .object({
      date_of_birth: isoDate.nullable(),
      blood_group: z.string().nullable(),
      joined_on: isoDate.nullable(),
      emergency_name: z.string().nullable(),
      emergency_relation: z.string().nullable(),
      emergency_phone: z.string().nullable(),
      upi_id: z.string().nullable(),
      bank_account_name: z.string().nullable(),
      bank_account_last4: z.string().nullable(),
      bank_ifsc: z.string().nullable(),
      pan_on_file: z.boolean(),
    })
    .nullable(),
  /** This month in India time. Null without the attendance module (unless it is you). */
  attendance: z
    .object({
      month: z.string(),
      present: z.number().int(),
      late: z.number().int(),
      absent: z.number().int(),
      leave_days: z.number(),
      late_minutes: z.number().int(),
      today: z
        .object({
          status: z.string().nullable(),
          check_in_at: isoDateTime.nullable(),
          check_out_at: isoDateTime.nullable(),
          on_leave: z.boolean(),
        })
        .nullable(),
    })
    .nullable(),
  work: z
    .object({
      shoots: z
        .object({
          id: uuid,
          shoot_id: uuid.nullable(),
          shoot_name: z.string().nullable(),
          service_name: z.string().nullable(),
          project_id: uuid.nullable(),
          project_name: z.string().nullable(),
          client_name: z.string().nullable(),
          start_at: isoDateTime,
          end_at: isoDateTime,
          location: z.string().nullable(),
        })
        .array(),
      deliverables: z
        .object({
          id: uuid,
          title: z.string(),
          project_id: uuid,
          project_name: z.string().nullable(),
          status: z.string(),
          estimated_date: isoDate.nullable(),
          started_at: isoDateTime.nullable(),
          late: z.boolean(),
        })
        .array(),
      /** Null when the tasks are not yours to see (owner, admin, manager, or your own). */
      tasks: z
        .object({
          id: uuid,
          title: z.string(),
          project_id: uuid.nullable(),
          project_name: z.string().nullable(),
          status: z.string(),
          priority: z.string(),
          due_date: isoDate.nullable(),
          late: z.boolean(),
        })
        .array()
        .nullable(),
      shoots_this_month: z.number().int(),
    })
    .nullable(),
  /** Upcoming and pending leave. Null unless you decide leave, or it is yours. */
  leave: z
    .object({
      id: uuid,
      kind: z.string(),
      start_date: isoDate,
      end_date: isoDate,
      half_day: z.boolean(),
      status: z.string(),
    })
    .array()
    .nullable(),
  salaries: z
    .object({
      id: uuid,
      month: z.number().int(),
      year: z.number().int(),
      base_amount: z.number(),
      paid_amount: z.number(),
      status: z.string(),
    })
    .array()
    .nullable(),
  payouts: z
    .object({
      id: uuid,
      amount: z.number(),
      period_start: isoDate,
      period_end: isoDate,
      status: z.string(),
      payment_mode: z.string().nullable(),
      reference: z.string().nullable(),
      created_at: isoDateTime,
    })
    .array()
    .nullable(),
  /** What the person asking may do from this page. */
  can: z.object({
    edit: z.boolean(),
    see_pay: z.boolean(),
    manage_access: z.boolean(),
  }),
})
export type MemberOverview = z.infer<typeof memberOverview>
