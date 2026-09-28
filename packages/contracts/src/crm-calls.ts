import { z } from 'zod'
import { uuid, isoDate, isoDateTime } from './shared/primitives'

/**
 * Today's calls (0201): the caller's open leads, most owed first, each with
 * the reason it is on the list.
 */
export const callQueueScope = z.enum(['mine', 'all'])
export type CallQueueScope = z.infer<typeof callQueueScope>

export const callQueueItem = z.object({
  id: uuid,
  name: z.string().nullable(),
  phone: z.string().nullable(),
  event_type: z.string().nullable(),
  event_date: isoDate.nullable(),
  city: z.string().nullable(),
  status: z.string(),
  quality: z.string().nullable(),
  follow_up_at: isoDateTime.nullable(),
  last_contacted_at: isoDateTime.nullable(),
  last_call_outcome: z.string().nullable(),
  call_attempts: z.number().int(),
  assigned_to: uuid.nullable(),
  priority: z.number().int(),
  reason: z.string(),
})
export type CallQueueItem = z.infer<typeof callQueueItem>

/** "My day" (0205): what one caller did today, and the leads they worked. */
export const dayLeadLine = z.object({
  id: uuid,
  name: z.string().nullable(),
  phone: z.string().nullable(),
  last_type: z.string(),
  last_outcome: z.string().nullable(),
  last_note: z.string().nullable(),
  last_at: isoDateTime,
  next_at: isoDateTime.nullable(),
})
export type DayLeadLine = z.infer<typeof dayLeadLine>

export const dayReport = z.object({
  user_id: uuid,
  day: isoDate,
  calls_made: z.number().int(),
  calls_answered: z.number().int(),
  messages: z.number().int(),
  follow_ups_done: z.number().int(),
  leads_moved: z.number().int(),
  quotes_sent: z.number().int(),
  booked: z.number().int(),
  leads_touched: z.number().int(),
  overdue_left: z.number().int(),
  due_today_left: z.number().int(),
  lead_lines: dayLeadLine.array(),
})
export type DayReport = z.infer<typeof dayReport>

/** One row per caller, for owners and managers. */
export const dayReportRow = z.object({
  user_id: uuid,
  user_name: z.string(),
  calls_made: z.number().int(),
  calls_answered: z.number().int(),
  messages: z.number().int(),
  quotes_sent: z.number().int(),
  booked: z.number().int(),
  leads_touched: z.number().int(),
  overdue_left: z.number().int(),
})
export type DayReportRow = z.infer<typeof dayReportRow>
