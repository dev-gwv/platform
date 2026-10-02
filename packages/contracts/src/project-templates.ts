import { z } from 'zod'
import { uuid, isoDateTime } from './shared/primitives'

export const projectTemplate = z.object({
  id: uuid,
  company_id: uuid,
  name: z.string(),
  description: z.string().nullable(),
  // The create request leaves description/duration_hours out entirely when
  // omitted (they're `.nullish()` there, not defaulted to null before
  // storage), so a stored item can genuinely lack the key -- `.default(null)`
  // here tolerates that instead of 500ing the whole list the moment one does.
  deliverables_json: z.array(z.object({
    name: z.string(),
    description: z.string().nullable().default(null),
    quantity: z.number().int().positive(),
  })).default([]),
  shoots_json: z.array(z.object({
    name: z.string(),
    kind: z.string().nullable().default(null),
    duration_hours: z.number().positive().nullable().default(null),
  })).default([]),
  tasks_json: z.array(z.object({
    title: z.string(),
    priority: z.string().default('medium'),
    sort_order: z.number().int().default(0),
  })).default([]),
  /** The one every studio starts with (0232); editing it makes it the studio's own. */
  is_sample: z.boolean().default(false),
  created_at: isoDateTime,
})
export type ProjectTemplate = z.infer<typeof projectTemplate>

export const projectTemplateList = z.object({
  items: z.array(projectTemplate),
})
export type ProjectTemplateList = z.infer<typeof projectTemplateList>

export const createProjectTemplateRequest = z.object({
  name: z.string().trim().min(2).max(160),
  description: z.string().trim().max(1000).nullish(),
  deliverables_json: z.array(z.object({
    name: z.string().trim().min(1).max(200),
    description: z.string().trim().max(500).nullish(),
    quantity: z.number().int().positive().default(1),
  })).default([]),
  shoots_json: z.array(z.object({
    name: z.string().trim().min(1).max(200),
    kind: z.string().trim().max(100).nullish(),
    duration_hours: z.number().positive().nullish(),
  })).default([]),
  tasks_json: z.array(z.object({
    title: z.string().trim().min(1).max(200),
    priority: z.string().default('medium'),
    sort_order: z.number().int().default(0),
  })).default([]),
})
export type CreateProjectTemplateRequest = z.infer<typeof createProjectTemplateRequest>
