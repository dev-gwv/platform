import { z } from 'zod'
import { uuid, isoDate, isoDateTime } from './shared/primitives'
import { myDeliverable } from './projects'

/**
 * Giving work out and the team's side of it: how loaded each person is, what
 * is coming due for the top bar, and one project as a team member sees it --
 * the days, who shot them, where the data is, and their own work. Never
 * money, never the client's phone.
 */

/** How much work a person already has, for the "Who will edit it?" list. */
export const deliverableWorkload = z.object({
  user_id: uuid,
  open: z.number().int(),
  late: z.number().int(),
  due_week: z.number().int(),
  next_due: isoDate.nullable(),
})
export type DeliverableWorkload = z.infer<typeof deliverableWorkload>

/** One thing coming due, for the chip in the top bar. */
export const myDueItem = z.object({
  kind: z.enum(['edit', 'task']),
  id: uuid,
  title: z.string(),
  project_id: uuid.nullable(),
  project_name: z.string().nullable(),
  due: isoDate,
  /** Days from today: negative is late, 0 is today. */
  days: z.number().int(),
  /** Who has it -- for a studio-wide line; null when it is the caller's own. */
  who: z.string().nullable(),
  mine: z.boolean(),
})
export type MyDueItem = z.infer<typeof myDueItem>

/** A shoot a deliverable comes from, and whether its data is in. */
export const workShoot = z.object({
  id: uuid,
  name: z.string(),
  shoot_date: isoDate.nullable(),
  data_ready: z.boolean(),
})
export type WorkShoot = z.infer<typeof workShoot>

export const myProjectCrew = z.object({
  user_id: uuid.nullable(),
  name: z.string(),
  role: z.string().nullable(),
  me: z.boolean(),
})

/** Where one set of cards is: the main copy, the backup, who copied them. */
export const myProjectData = z.object({
  id: uuid,
  label: z.string(),
  whose: z.string().nullable(),
  main: z.string().nullable(),
  folder_path: z.string().nullable(),
  cloud_link: z.string().nullable(),
  backup: z.string().nullable(),
  backup_folder_path: z.string().nullable(),
  backup_cloud_link: z.string().nullable(),
  stage: z.string(),
  copied_by: z.string().nullable(),
  date_received: isoDate.nullable(),
  handed_to_editor_at: isoDateTime.nullable(),
  card_count: z.number().int(),
  card_labels: z.array(z.string()).default([]),
  size_gb: z.number(),
  notes: z.string().nullable(),
})
export type MyProjectData = z.infer<typeof myProjectData>

export const myProjectShoot = z.object({
  id: uuid,
  name: z.string(),
  shoot_date: isoDate.nullable(),
  start_at: isoDateTime.nullable(),
  end_at: isoDateTime.nullable(),
  location: z.string().nullable(),
  map_link: z.string().nullable(),
  status: z.string(),
  crew: myProjectCrew.array(),
  data: myProjectData.array(),
})
export type MyProjectShoot = z.infer<typeof myProjectShoot>

export const myProjectTask = z.object({
  id: uuid,
  title: z.string(),
  status: z.string(),
  due_date: isoDate.nullable(),
})

export const myProjectSubmission = z.object({
  id: uuid,
  deliverable_id: uuid.nullable(),
  deliverable_title: z.string().nullable(),
  submission_link: z.string().nullable(),
  status: z.string(),
  review_notes: z.string().nullable(),
  version: z.number().int().nullable(),
  created_at: isoDateTime,
})

/** One project, as someone who works on it sees it. */
export const myProject = z.object({
  id: uuid,
  name: z.string(),
  client_name: z.string().nullable(),
  first_date: isoDate.nullable(),
  last_date: isoDate.nullable(),
  shoots: myProjectShoot.array(),
  deliverables: myDeliverable.array(),
  tasks: myProjectTask.array(),
  submissions: myProjectSubmission.array(),
})
export type MyProject = z.infer<typeof myProject>
