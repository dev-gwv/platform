import { z } from 'zod'
import { uuid, isoDate, isoDateTime } from './shared/primitives'

export const attendanceStatus = z.enum(['present', 'late', 'half_day', 'absent'])

export const attendanceRecord = z.object({
  id: uuid,
  a_date: isoDate,
  check_in_at: isoDateTime.nullable(),
  check_out_at: isoDateTime.nullable(),
  status: attendanceStatus,
  /** Minutes past the studio's expected start. 0 unless the status is 'late'. */
  late_minutes: z.number().int().default(0),
  /** Where they were marked (0206), and how far from its centre. */
  place_name: z.string().nullable().default(null),
  check_in_distance_m: z.number().int().nullable().default(null),
  /** 'auto_login' when the app marked it on open. */
  source: z.string().nullable().default(null),
  /** Nobody checked out: the nightly sweep closed the day. */
  closed_by_system: z.boolean().default(false),
  /** How sure the phone was of where it was, in metres (0224). */
  accuracy_m: z.number().int().nullable().default(null),
  selfie_file_id: uuid.nullable().default(null),
})
export type AttendanceRecord = z.infer<typeof attendanceRecord>

export const checkInRequest = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  /** The app marked this on open, not a tap. */
  auto: z.boolean().optional(),
  /** The phone's own estimate of how far off the fix may be. */
  accuracy_m: z.number().min(0).max(100000).optional(),
  /** A selfie just uploaded through /files, when the studio asks for one. */
  selfie_file_id: uuid.optional(),
})

/** What a check-in recorded, so the app can say it plainly. */
export const checkInResponse = z.object({
  id: uuid,
  status: attendanceStatus,
  late_minutes: z.number().int(),
  place_name: z.string().nullable(),
  distance_m: z.number().int().nullable(),
})
export type CheckInResponse = z.infer<typeof checkInResponse>

export const checkOutRequest = z.object({
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
})

/** POST /hr/check-in's refusal body, and the rule the member is under. */
export const attendanceMode = z.enum(['required', 'anywhere', 'off'])
export type AttendanceMode = z.infer<typeof attendanceMode>

/** GET /hr/attendance/me: today's row and the rule that decides it (0206). */
export const myAttendanceToday = z.object({
  today: attendanceRecord.nullable(),
  mode: attendanceMode,
  /** The one place they must be at, when their rule names one. Null: any studio place. */
  place_name: z.string().nullable(),
  /** 'person' | 'position' | 'studio' | 'freelancer'. */
  rule_from: z.string(),
  /**
   * The studio tracks attendance at all (0223): a location, a place or a rule.
   * Until it does, nobody is marked, prompted for location, or swept absent.
   */
  configured: z.boolean().default(true),
  /** Attendance is switched on for the studio (0224). Off: nothing to do. */
  enabled: z.boolean().default(false),
  selfie_required: z.boolean().default(false),
  /** "10:00": the studio's (or their rule's) start of day, and its grace. */
  day_start: z.string().nullable().default(null),
  grace_min: z.number().int().default(15),
  day_end: z.string().nullable().default(null),
  /** The studio has at least one active place: without one there is no fence. */
  fenced: z.boolean(),
  day_off: z.string().nullable(),
  on_leave: z.boolean(),
  /** Booked on a shoot today: "I've reached" at the venue is the day's mark. */
  shoot_today: z
    .object({ slot_id: uuid, name: z.string(), start_at: isoDateTime, end_at: isoDateTime, arrived_at: isoDateTime.nullable() })
    .nullable()
    .default(null),
})
export type MyAttendanceToday = z.infer<typeof myAttendanceToday>

// ── places and rules (0206) ─────────────────────────────────────
export const attendancePlace = z.object({
  id: uuid,
  name: z.string(),
  lat: z.number(),
  lng: z.number(),
  radius_m: z.number().int(),
  is_active: z.boolean(),
  /** The studio's own spot: edited on the location card, not here. */
  is_primary: z.boolean(),
})
export type AttendancePlace = z.infer<typeof attendancePlace>

export const attendancePlaceInput = z.object({
  name: z.string().trim().min(1).max(80),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  radius_m: z.number().int().min(20).max(5000),
  is_active: z.boolean().default(true),
})
export type AttendancePlaceInput = z.infer<typeof attendancePlaceInput>

export const attendanceRule = z.object({
  id: uuid,
  scope: z.enum(['role', 'user']),
  role_id: uuid.nullable(),
  user_id: uuid.nullable(),
  /** The position's or the person's name, for the list. */
  label: z.string(),
  mode: attendanceMode,
  place_id: uuid.nullable(),
  radius_m: z.number().int().nullable(),
  expected_checkin_time: z.string().nullable(),
  late_grace_minutes: z.number().int().nullable(),
})
export type AttendanceRule = z.infer<typeof attendanceRule>

export const attendanceRuleInput = z
  .object({
    scope: z.enum(['role', 'user']),
    role_id: uuid.nullable().optional(),
    user_id: uuid.nullable().optional(),
    mode: attendanceMode,
    place_id: uuid.nullable().optional(),
    radius_m: z.number().int().min(20).max(5000).nullable().optional(),
    expected_checkin_time: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/).nullable().optional(),
    late_grace_minutes: z.number().int().min(0).max(240).nullable().optional(),
  })
  .refine((v) => (v.scope === 'role' ? !!v.role_id && !v.user_id : !!v.user_id && !v.role_id), {
    message: 'A rule is for one position or one person.',
  })
export type AttendanceRuleInput = z.infer<typeof attendanceRuleInput>
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
  /** Where they were marked (0206), how far from it, and whether the app did it. */
  place_name: z.string().nullable().default(null),
  check_in_distance_m: z.number().int().nullable().default(null),
  source: z.string().nullable().default(null),
  closed_by_system: z.boolean().default(false),
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
  /** Working days it takes (a day off inside it is not counted; half a day is 0.5). */
  days: z.coerce.number().optional(),
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

/** Deciding leave: approve as unpaid when the person's days have run out (0228). */
export const decideLeaveRequest = decideRequest.extend({ as_unpaid: z.boolean().optional() })
export type DecideLeaveRequest = z.infer<typeof decideLeaveRequest>

/** The kinds of leave a studio can give an allowance for. */
export const allowanceKind = z.enum(['casual', 'sick', 'paid'])
export type AllowanceKind = z.infer<typeof allowanceKind>

/** Days a year of one kind of leave (0228). */
export const leaveAllowance = z.object({ kind: allowanceKind, days_per_year: z.coerce.number() })
export type LeaveAllowance = z.infer<typeof leaveAllowance>
export const saveLeaveAllowancesRequest = z.object({
  allowances: z.array(z.object({ kind: allowanceKind, days_per_year: z.number().min(0).max(365).nullable() })).max(3),
})
export type SaveLeaveAllowancesRequest = z.infer<typeof saveLeaveAllowancesRequest>

/** "8 of 12 casual left": one person's balance of one kind for the year. */
export const leaveBalance = z.object({
  user_id: uuid,
  user_name: z.string().nullable(),
  kind: allowanceKind,
  allowance: z.coerce.number(),
  used: z.coerce.number(),
  pending: z.coerce.number(),
  remaining: z.coerce.number(),
})
export type LeaveBalance = z.infer<typeof leaveBalance>

export const companyHoliday = z.object({ id: uuid, holiday_date: isoDate, name: z.string() })
export type CompanyHoliday = z.infer<typeof companyHoliday>
export const createHolidayRequest = z.object({ holiday_date: isoDate, name: z.string().trim().min(1).max(80) })

export const attendancePolicy = z.object({
  /** 0 = Sunday … 6 = Saturday. */
  weekly_off: z.number().int().min(0).max(6).array(),
})
export type AttendancePolicy = z.infer<typeof attendancePolicy>

const clock = z.string().regex(/^\d{2}:\d{2}$/, 'expected HH:MM')

/** Everything the owner sets about attendance (0224). Off until switched on. */
export const attendanceSettings = attendancePolicy.extend({
  enabled: z.boolean(),
  enabled_at: isoDateTime.nullable(),
  day_start: clock.nullable(),
  grace_min: z.number().int().min(0).max(240),
  day_end: clock.nullable(),
  half_day_hours: z.number().min(1).max(12).nullable(),
  selfie_required: z.boolean(),
  /** 0 = lateness is never deducted; 3 = every three late marks cost half a day. */
  late_marks_per_half_day: z.number().int().min(0).max(10),
})
export type AttendanceSettings = z.infer<typeof attendanceSettings>

/**
 * PATCH /hr/policy. Only weekly_off: an admin or manager may change it. Any
 * other field is the owner's, and the whole set is saved together.
 */
export const updateAttendanceSettings = attendanceSettings
  .omit({ enabled_at: true })
  .partial()
export type UpdateAttendanceSettings = z.infer<typeof updateAttendanceSettings>

/** One person on the Today board. Only people the studio tracks. */
export const todayBoardRow = z.object({
  user_id: uuid,
  name: z.string(),
  avatar_url: z.string().nullable().default(null),
  status: attendanceStatus.nullable(),
  check_in_at: isoDateTime.nullable(),
  check_out_at: isoDateTime.nullable(),
  late_minutes: z.number().int().default(0),
  place_name: z.string().nullable(),
  distance_m: z.number().int().nullable(),
  accuracy_m: z.number().int().nullable(),
  selfie_file_id: uuid.nullable(),
  source: z.string().nullable(),
  closed_by_system: z.boolean().default(false),
  /** 'full' or 'half' approved leave that day. */
  leave: z.enum(['full', 'half']).nullable(),
  shoot: z
    .object({ name: z.string(), start_at: isoDateTime, end_at: isoDateTime, arrived_at: isoDateTime.nullable() })
    .nullable(),
  /** This person's own start of day and grace ("10:00"). */
  expected: z.string().nullable(),
  grace: z.number().int(),
})
export type TodayBoardRow = z.infer<typeof todayBoardRow>

export const todayBoard = z.object({
  date: isoDate,
  enabled: z.boolean(),
  day_off: z.string().nullable(),
  rows: todayBoardRow.array(),
})
export type TodayBoard = z.infer<typeof todayBoard>

/** One person's day in the month register, before it becomes a code. */
export const registerCell = z.object({
  day: isoDate,
  status: attendanceStatus.nullable(),
  source: z.string().nullable(),
  day_off: z.string().nullable(),
  leave: z.enum(['full', 'half']).nullable(),
  leave_unpaid: z.boolean(),
  shoot: z.boolean(),
})
export type RegisterCell = z.infer<typeof registerCell>

export const monthRegister = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/),
  /** The first day the studio tracked; days before it carry no mark. */
  tracked_from: isoDate.nullable(),
  today: isoDate,
  late_marks_per_half_day: z.number().int(),
  people: z.array(z.object({ user_id: uuid, name: z.string(), cells: registerCell.array() })),
})
export type MonthRegister = z.infer<typeof monthRegister>

/** A Google Maps link (or plain "lat, lng") turned into a pin. */
export const resolveLinkRequest = z.object({ url: z.string().trim().min(3).max(2000) })
export const resolvedPin = z.object({ lat: z.number(), lng: z.number() })

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
