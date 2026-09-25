import { z } from 'zod'
import { uuid, isoDate, isoDateTime } from './shared/primitives'

export const attendanceStatus = z.enum(['present', 'late', 'absent'])

export const attendanceRecord = z.object({
  id: uuid,
  a_date: isoDate,
  check_in_at: isoDateTime.nullable(),
  check_out_at: isoDateTime.nullable(),
  status: attendanceStatus,
  /** Minutes past the studio's expected start. 0 unless the status is 'late'. */
  late_minutes: z.number().int().default(0),
})
export type AttendanceRecord = z.infer<typeof attendanceRecord>

export const checkInRequest = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
})
export type CheckInRequest = z.infer<typeof checkInRequest>

export const companyFence = z.object({
  lat: z.number(),
  lng: z.number(),
  radius_m: z.number().int(),
  timezone: z.string().default('Asia/Kolkata'),
  /** When off, check-in still works but location is not validated — for a shoot day away from the studio, or while re-measuring. */
  is_active: z.boolean().default(true),
  /**
   * HH:MM, or null when the studio has not declared a start of day.
   *
   * Null is the important value: nobody can be late for a day that has no
   * declared start, so lateness stays off until an owner sets this.
   */
  expected_checkin_time: z.string().nullable().default(null),
  /** Minutes after the start that are still forgiven. */
  late_grace_minutes: z.number().int().default(15),
  /** HH:MM, or null — after this, a day with no check-in reads as missed. */
  missed_cutoff_time: z.string().nullable().default(null),
})
export type CompanyFence = z.infer<typeof companyFence>

export const setFenceRequest = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  // Under 20m and GPS drift alone locks people out; over 5km is not a fence.
  radius_m: z.number().int().min(20).max(5000).default(150),
  timezone: z.string().min(3).max(60).default('Asia/Kolkata'),
  is_active: z.boolean().default(true),
  // HH:MM or HH:MM:SS — an <input type="time"> sends the first, Postgres
  // returns the second. An empty input means "no start of day declared", so
  // '' is coerced to null rather than rejected.
  expected_checkin_time: z
    .string()
    .regex(/^(\d{2}:\d{2}(:\d{2})?)?$/, 'Use HH:MM')
    .transform((v) => v || null)
    .nullable()
    .default(null),
  // Four hours is already generous; beyond it the concept stops meaning
  // anything and the studio wants a later start time instead.
  late_grace_minutes: z.number().int().min(0).max(240).default(15),
  missed_cutoff_time: z
    .string()
    .regex(/^(\d{2}:\d{2}(:\d{2})?)?$/, 'Use HH:MM')
    .transform((v) => v || null)
    .nullable()
    .default(null),
})
export type SetFenceRequest = z.infer<typeof setFenceRequest>

/**
 * One person's day, as the attendance dashboard reads it.
 *
 * `status` is what was recorded; whether someone is still checked in is
 * derived from the two timestamps rather than stored, so it cannot drift out
 * of agreement with them.
 */
export const attendanceDayRow = z.object({
  user_id: uuid,
  name: z.string(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  engagement_type: z.string().nullable(),
  status: attendanceStatus,
  check_in_at: isoDateTime.nullable(),
  check_out_at: isoDateTime.nullable(),
  /** Set when an owner or admin corrected the day by hand. */
  corrected_by: uuid.nullable().default(null),
  correction_note: z.string().nullable().default(null),
  /** Minutes past the studio's expected start. 0 unless the status is 'late'. */
  late_minutes: z.number().int().default(0),
  /** On approved leave that day: not absent. */
  on_leave: z.boolean().default(false),
  /** A holiday's name or 'Weekly off': nobody was expected in. */
  day_off: z.string().nullable().default(null),
})
export type AttendanceDayRow = z.infer<typeof attendanceDayRow>

/** Paginated day-roster response — returned when page/page_size are requested. Array shape is kept otherwise. */
export const attendanceDayPage = z.object({
  items: attendanceDayRow.array(),
  total: z.number().int(),
  page: z.number().int(),
  page_size: z.number().int(),
})
export type AttendanceDayPage = z.infer<typeof attendanceDayPage>

/** An owner or admin fixing one person's day: forgot to tap in, wrong side of the fence. */
export const setAttendanceRequest = z
  .object({
    status: attendanceStatus,
    check_in_at: isoDateTime.nullable().optional(),
    check_out_at: isoDateTime.nullable().optional(),
    note: z.string().trim().max(300).optional(),
  })
  .refine(
    (v) => !v.check_in_at || !v.check_out_at || new Date(v.check_out_at) >= new Date(v.check_in_at),
    { message: 'Check-out must be after check-in.', path: ['check_out_at'] },
  )
export type SetAttendanceRequest = z.infer<typeof setAttendanceRequest>

// ── leave, holidays, weekly off, corrections (0177) ─────────────────

export const leaveKind = z.enum(['casual', 'sick', 'paid', 'unpaid', 'other'])
export type LeaveKind = z.infer<typeof leaveKind>
export const leaveStatus = z.enum(['pending', 'approved', 'rejected', 'cancelled'])

export const leaveRequest = z.object({
  id: uuid,
  user_id: uuid,
  user_name: z.string().nullable().default(null),
  kind: leaveKind,
  start_date: isoDate,
  end_date: isoDate,
  half_day: z.boolean(),
  reason: z.string().nullable(),
  status: leaveStatus,
  decided_by_name: z.string().nullable().default(null),
  decided_at: isoDateTime.nullable(),
  decision_note: z.string().nullable(),
  created_at: isoDateTime,
})
export type LeaveRequest = z.infer<typeof leaveRequest>

export const createLeaveRequest = z
  .object({
    kind: leaveKind.default('casual'),
    start_date: isoDate,
    end_date: isoDate,
    half_day: z.boolean().default(false),
    reason: z.string().trim().max(500).nullable().optional(),
  })
  .refine((v) => v.end_date >= v.start_date, { message: 'The leave ends before it starts.' })
  .refine((v) => !v.half_day || v.start_date === v.end_date, { message: 'A half day is a single day.' })
export type CreateLeaveRequest = z.input<typeof createLeaveRequest>

export const decideRequest = z.object({
  approve: z.boolean(),
  note: z.string().trim().max(500).nullable().optional(),
})
export type DecideRequest = z.infer<typeof decideRequest>

export const companyHoliday = z.object({ id: uuid, holiday_date: isoDate, name: z.string() })
export type CompanyHoliday = z.infer<typeof companyHoliday>
export const createHolidayRequest = z.object({ holiday_date: isoDate, name: z.string().trim().min(1).max(80) })

export const attendancePolicy = z.object({
  /** 0 = Sunday … 6 = Saturday. */
  weekly_off: z.number().int().min(0).max(6).array(),
})
export type AttendancePolicy = z.infer<typeof attendancePolicy>

export const attendanceCorrection = z.object({
  id: uuid,
  user_id: uuid,
  user_name: z.string().nullable().default(null),
  a_date: isoDate,
  check_in_at: isoDateTime,
  check_out_at: isoDateTime.nullable(),
  reason: z.string(),
  status: z.enum(['pending', 'approved', 'rejected']),
  decision_note: z.string().nullable(),
  created_at: isoDateTime,
})
export type AttendanceCorrection = z.infer<typeof attendanceCorrection>

export const createCorrectionRequest = z
  .object({
    a_date: isoDate,
    check_in_at: isoDateTime,
    check_out_at: isoDateTime.nullable().optional(),
    reason: z.string().trim().min(3).max(500),
  })
  .refine((v) => !v.check_out_at || Date.parse(v.check_out_at) > Date.parse(v.check_in_at), { message: 'Check-out must be after check-in.' })
export type CreateCorrectionRequest = z.input<typeof createCorrectionRequest>
