import { z } from 'zod'
import { uuid, isoDate } from './shared/primitives'

/**
 * review = submitted, waiting for the person who gave the task; blocked =
 * stuck, with a reason. Both are open work.
 */
export const taskStatus = z.enum(['to_do', 'in_progress', 'review', 'blocked', 'completed', 'cancelled'])
export type TaskStatus = z.infer<typeof taskStatus>

/** The tags offered when adding a task. The column is free text, so older or imported tags still show. */
export const TASK_TAGS = ['Shoot', 'Editing', 'Client', 'Office', 'General'] as const
export const taskTag = z.string().trim().min(1).max(40)

/** An http(s) link, as typed. */
export const webLink = z
  .string()
  .trim()
  .max(1000)
  .refine((v) => {
    try {
      const u = new URL(v)
      return u.protocol === 'http:' || u.protocol === 'https:'
    } catch {
      return false
    }
  }, 'Paste a link that starts with http:// or https://')

/** The newest work submitted against a task, shown on its card. */
export const taskLatestSubmission = z.object({
  id: uuid,
  link: z.string().nullable(),
  status: z.string(),
  submitted_at: z.string(),
})
export type TaskLatestSubmission = z.infer<typeof taskLatestSubmission>

export const taskPriority = z.enum(['low', 'medium', 'high', 'urgent'])
export type TaskPriority = z.infer<typeof taskPriority>

/**
 * A studio-defined label and colour layered on top of the canonical
 * low/medium/high/urgent -- "Rush", amber, say -- kept for display and
 * reporting; the canonical value underneath still drives sorting.
 */
// Matches StatusBadge's tone set exactly — that component is a locked
// primitive across the app, and a custom priority is shown with it too.
export const taskPriorityTone = z.enum(['neutral', 'success', 'warning', 'danger', 'info'])
export type TaskPriorityTone = z.infer<typeof taskPriorityTone>

export const companyTaskPriority = z.object({
  id: uuid,
  code: z.string(),
  label: z.string(),
  tone: taskPriorityTone,
  sort_order: z.number().int(),
})
export type CompanyTaskPriority = z.infer<typeof companyTaskPriority>

export const createTaskPriorityRequest = z.object({
  code: z.string().trim().min(1).max(40).regex(/^[a-z0-9_-]+$/, 'lowercase letters, numbers, - or _ only'),
  label: z.string().trim().min(1).max(60),
  tone: taskPriorityTone.default('neutral'),
})
export type CreateTaskPriorityRequest = z.infer<typeof createTaskPriorityRequest>

/** Label and tone can be corrected after the fact; the code is the key other rows point to, so it stays fixed. */
export const updateTaskPriorityRequest = z.object({
  label: z.string().trim().min(1).max(60).optional(),
  tone: taskPriorityTone.optional(),
})
export type UpdateTaskPriorityRequest = z.infer<typeof updateTaskPriorityRequest>

/** A task as shown in lists and on the board. */
export const taskListItem = z.object({
  id: uuid,
  title: z.string(),
  description: z.string().nullable().default(null),
  status: taskStatus,
  priority: taskPriority,
  custom_priority_code: z.string().nullable().default(null),
  custom_priority_label: z.string().nullable().default(null),
  custom_priority_tone: taskPriorityTone.nullable().default(null),
  custom_status_code: z.string().nullable().default(null),
  custom_status_label: z.string().nullable().default(null),
  due_date: isoDate.nullable(),
  project_id: uuid.nullable(),
  project_name: z.string().nullable(),
  deliverable_id: uuid.nullable().default(null),
  parent_task_id: uuid.nullable().default(null),
  voice_note_url: z.string().nullable().default(null),
  assignee_names: z.array(z.string()).default([]),
  assignee_ids: z.array(uuid).default([]),
  sort_order: z.number().int().default(0),
  tag: z.string().default('General'),
  blocked_reason: z.string().nullable().default(null),
  created_by: uuid.nullable().default(null),
  created_by_name: z.string().nullable().default(null),
  latest_submission: taskLatestSubmission.nullable().default(null),
  /** Last change; for a completed task, when it was done ("Done this week"). */
  updated_at: z.string().nullable().default(null),
})
export type TaskListItem = z.infer<typeof taskListItem>

export const createTaskRequest = z.object({
  project_id: uuid.nullable().default(null),
  deliverable_id: uuid.nullable().default(null),
  parent_task_id: uuid.nullable().optional(),
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).optional(),
  status: taskStatus.default('to_do'),
  priority: taskPriority.default('medium'),
  custom_priority_code: z.string().nullable().optional(),
  due_date: isoDate.optional(),
  voice_note_url: z.string().trim().max(500).nullable().optional(),
  tag: taskTag.default('General'),
  assignees: z.array(uuid).default([]),
})
export type CreateTaskRequest = z.infer<typeof createTaskRequest>

export const updateTaskStatusRequest = z.object({ status: taskStatus })
export type UpdateTaskStatusRequest = z.infer<typeof updateTaskStatusRequest>

/** Everything about a task the create form set, editable afterwards. Assignees are optional here — omit to leave them as-is, send a (possibly empty) array to replace the set. */
export const updateTaskRequest = z.object({
  project_id: uuid.nullable().optional(),
  deliverable_id: uuid.nullable().optional(),
  parent_task_id: uuid.nullable().optional(),
  title: z.string().trim().min(1).max(200).optional(),
  description: z.string().trim().max(2000).nullable().optional(),
  status: taskStatus.optional(),
  priority: taskPriority.optional(),
  custom_priority_code: z.string().nullable().optional(),
  due_date: isoDate.nullable().optional(),
  voice_note_url: z.string().trim().max(500).nullable().optional(),
  tag: taskTag.optional(),
  assignees: z.array(uuid).optional(),
})
export type UpdateTaskRequest = z.infer<typeof updateTaskRequest>

/** The person on a task hands in their work: a link, and a note if needed. */
export const submitTaskRequest = z.object({
  link: webLink,
  note: z.string().trim().max(2000).optional(),
})
export type SubmitTaskRequest = z.infer<typeof submitTaskRequest>

/** Stuck: say why, so the person who gave it can help. */
export const blockTaskRequest = z.object({
  reason: z.string().trim().min(1, 'Say what is blocking this task.').max(500),
})
export type BlockTaskRequest = z.infer<typeof blockTaskRequest>

/** Approve, or send back with what needs to change. */
export const reviewTaskRequest = z
  .object({
    approve: z.boolean(),
    note: z.string().trim().max(2000).optional(),
  })
  .refine((v) => v.approve || (v.note ?? '').length > 0, {
    message: 'Say what needs to change.',
    path: ['note'],
  })
export type ReviewTaskRequest = z.infer<typeof reviewTaskRequest>

/** One line of a task's history: who did what, when. */
export const taskActivityItem = z.object({
  id: uuid,
  user_id: uuid.nullable(),
  user_name: z.string().nullable(),
  action: z.string(),
  created_at: z.string(),
})
export type TaskActivityItem = z.infer<typeof taskActivityItem>

/** Work handed in against a task. */
export const taskSubmissionItem = z.object({
  id: uuid,
  link: z.string().nullable(),
  note: z.string().nullable(),
  status: z.string(),
  review_notes: z.string().nullable(),
  submitted_by: uuid.nullable(),
  submitted_by_name: z.string().nullable(),
  created_at: z.string(),
})
export type TaskSubmissionItem = z.infer<typeof taskSubmissionItem>

export const generateTasksRequest = z.object({
  project_id: uuid,
  assignees: z.array(uuid).default([]),
})
export type GenerateTasksRequest = z.infer<typeof generateTasksRequest>

/** Persist a lane's card order after a drag. */
export const setBoardOrderRequest = z.object({
  board_view: z.string().default('default'),
  lane_key: taskStatus,
  task_ids: z.array(uuid),
})
export type SetBoardOrderRequest = z.infer<typeof setBoardOrderRequest>

/** A reusable checklist: the same tasks a studio raises every wedding. */
export const taskBundleItem = z.object({
  id: uuid,
  title: z.string(),
  priority: taskPriority,
  sort_order: z.number().int(),
})
export type TaskBundleItem = z.infer<typeof taskBundleItem>

export const taskBundle = z.object({
  id: uuid,
  name: z.string(),
  items: z.array(taskBundleItem),
})
export type TaskBundle = z.infer<typeof taskBundle>

export const createBundleRequest = z.object({
  name: z.string().trim().min(2).max(120),
  items: z
    .array(
      z.object({
        title: z.string().trim().min(1).max(200),
        priority: taskPriority.default('medium'),
      }),
    )
    .min(1)
    .max(50),
})
export type CreateBundleRequest = z.infer<typeof createBundleRequest>

/** Same shape as creation: editing a bundle resends its name and full checklist together. */
export const updateBundleRequest = createBundleRequest
export type UpdateBundleRequest = z.infer<typeof updateBundleRequest>

export const applyBundleRequest = z.object({
  project_id: uuid.nullable().default(null),
  assignees: z.array(uuid).default([]),
})
export type ApplyBundleRequest = z.infer<typeof applyBundleRequest>
