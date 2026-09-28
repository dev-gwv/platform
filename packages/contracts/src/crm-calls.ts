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
