import { z } from 'zod'
import { uuid, isoDateTime } from './shared/primitives'

export const reminderPriority = z.enum(['low', 'medium', 'high', 'urgent'])
export type ReminderPriority = z.infer<typeof reminderPriority>

export const reminderStatus = z.enum(['active', 'completed', 'dismissed'])
export type ReminderStatus = z.infer<typeof reminderStatus>

/**
 * What a reminder can be about. Mirrors the reminders_entity_type_check
 * constraint (last widened in 0181, for deliverables): a value here that the
 * constraint does not allow passes validation and then fails the insert.
 * supabase/tests/remind-me.test.ts fails if the two lists ever differ.
 */
export const reminderEntityType = z.enum([
  'lead',
  'project',
  'client',
  'invoice',
  'enquiry',
  'task',
  'shoot',
  'deliverable',
  'custom',
  'general',
])
export type ReminderEntityType = z.infer<typeof reminderEntityType>

export const reminder = z.object({
  id: uuid,
  company_id: uuid,
  /** Who it's for — the person who sees it in their list and can complete it. */
  user_id: uuid,
  /** Who made it — themself, or an admin setting a reminder for someone else. */
  created_by: uuid.nullable().default(null),
  title: z.string(),
  description: z.string().nullable(),
  priority: reminderPriority,
  status: reminderStatus,
  entity_type: reminderEntityType.nullable(),
  entity_id: uuid.nullable(),
  /** Resolved server-side from entity_type/entity_id — a lead's name, a project's name, and so on. */
  entity_name: z.string().nullable().default(null),
  due_at: isoDateTime.nullable(),
  created_at: isoDateTime,
})
export type Reminder = z.infer<typeof reminder>

export const reminderSummary = z.object({
  total_count: z.number().int(),
  active_count: z.number().int(),
  overdue_count: z.number().int(),
  due_today_count: z.number().int(),
})
export type ReminderSummary = z.infer<typeof reminderSummary>

export const reminderList = z.object({
  items: z.array(reminder),
  summary: reminderSummary,
})
export type ReminderList = z.infer<typeof reminderList>

export const createReminderRequest = z.object({
  title: z.string().trim().min(2).max(200),
  description: z.string().trim().max(2000).nullish(),
  priority: reminderPriority.default('medium'),
  entity_type: reminderEntityType.nullish(),
  entity_id: uuid.nullish(),
  due_at: isoDateTime.nullish(),
  /** Omit to set it for yourself; pass a teammate's id to set it for them instead. */
  assigned_to: uuid.nullish(),
})
export type CreateReminderRequest = z.infer<typeof createReminderRequest>

/** GET /reminders query — Lovable parity filters, all optional. */
export const remindersQuery = z.object({
  status: reminderStatus.optional(),
  priority: reminderPriority.optional(),
  /** Assignee (who it's for). */
  user_id: uuid.optional(),
  assigned_to: uuid.optional(),
  entity_type: reminderEntityType.optional(),
  entity_id: uuid.optional(),
  due_from: isoDateTime.optional(),
  due_to: isoDateTime.optional(),
  overdue_only: z
    .union([z.literal('1'), z.literal('0'), z.literal('true'), z.literal('false')])
    .optional()
    .transform((v) => v === '1' || v === 'true'),
  search: z.string().trim().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(50),
  cursor: isoDateTime.optional(),
})
export type RemindersQuery = z.infer<typeof remindersQuery>
