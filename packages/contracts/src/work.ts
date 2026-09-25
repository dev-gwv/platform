import { z } from 'zod'
import { uuid, isoDateTime } from './shared/primitives'

/** 'sent' = delivered to the client straight from review (0115/0155). */
export const workStatus = z.enum(['submitted', 'approved', 'rejected', 'sent'])

/** Plain words for each status, the same everywhere the team sees one. */
export const WORK_STATUS_LABEL: Record<z.infer<typeof workStatus>, string> = {
  submitted: 'Waiting for review',
  approved: 'Approved',
  rejected: 'Sent back',
  sent: 'Sent to client',
}

export const workSubmission = z.object({
  id: uuid,
  project_id: uuid.nullable(),
  task_id: uuid.nullable(),
  title: z.string().nullable().default(null),
  work_type: z.string().nullable().default(null),
  method: z.string().nullable().default(null),
  storage_ref: z.string().nullable().default(null),
  hard_disk_label: z.string().nullable().default(null),
  review_required: z.boolean().default(true),
  review_state: z.string().nullable().default(null),
  version: z.number().int().default(1),
  client_sent_at: z.string().nullable().default(null),
  /**
   * When the client link was pulled. The send dialog promises the link can be
   * revoked; without this the app could not say whether it had been, so the
   * promise had nothing behind it.
   */
  revoked_at: z.string().nullable().default(null),
  client_channel: z.string().nullable().default(null),
  submission_link: z.string().nullable(),
  location_note: z.string().nullable(),
  notes: z.string().nullable(),
  status: workStatus,
  review_notes: z.string().nullable(),
  created_at: isoDateTime,
  /** Who handed it in -- a reviewer needs to know whom to ask. */
  submitted_by_name: z.string().nullable().default(null),
  // Lovable parity: hard-disk handover (additive, defaulted).
  disk_name: z.string().nullable().default(null),
  disk_location: z.string().nullable().default(null),
  folder_path: z.string().nullable().default(null),
  /** The deliverable this work is for, when the editor said which. */
  deliverable_id: uuid.nullable().default(null),
  deliverable_title: z.string().nullable().default(null),
})
export type WorkSubmission = z.infer<typeof workSubmission>

export const submitWorkRequest = z.object({
  task_id: uuid.nullable().default(null),
  project_id: uuid.nullable().default(null),
  /** Which deliverable it is for: submitting moves that deliverable to Review. */
  deliverable_id: uuid.nullable().default(null),
  title: z.string().trim().min(1).max(200).optional(),
  work_type: z.string().trim().max(60).optional(),
  method: z.string().trim().max(60).optional(),
  storage_ref: z.string().trim().max(200).optional(),
  hard_disk_label: z.string().trim().max(160).optional(),
  folder_path: z.string().trim().max(500).optional(),
  review_required: z.boolean().default(true),
  submission_link: z.string().trim().min(1).max(500),
  /** Which physical drive or folder this actually lives on, if the link alone doesn't say. */
  location_note: z.string().trim().max(200).optional(),
  notes: z.string().max(1000).optional(),
  disk_name: z.string().trim().max(160).optional(),
  disk_location: z.string().trim().max(200).optional(),
})
export type SubmitWorkRequest = z.infer<typeof submitWorkRequest>

/** Same shape as submission, minus which task/project it's against -- that link doesn't change after the fact. */
export const updateWorkSubmissionRequest = submitWorkRequest.omit({ task_id: true, project_id: true, deliverable_id: true })
export type UpdateWorkSubmissionRequest = z.infer<typeof updateWorkSubmissionRequest>

/**
 * Work sent back always says what to change: the editor gets those words with
 * the notification and on their list, and work sent back without them only
 * comes back the same.
 */
export const reviewWorkRequest = z
  .object({
    approve: z.boolean(),
    review_notes: z.string().trim().max(1000).optional(),
  })
  .refine((r) => r.approve || !!r.review_notes, {
    message: 'Say what needs changing.',
    path: ['review_notes'],
  })
export type ReviewWorkRequest = z.infer<typeof reviewWorkRequest>

export const workReminderSettings = z.object({
  enabled: z.boolean(),
  reminder_days: z.array(z.number().int()),
})
export type WorkReminderSettings = z.infer<typeof workReminderSettings>

export const updateWorkReminderSettingsRequest = z.object({
  enabled: z.boolean(),
  reminder_days: z.array(z.number().int().min(0).max(60)).max(10),
})
export type UpdateWorkReminderSettingsRequest = z.infer<typeof updateWorkReminderSettingsRequest>
