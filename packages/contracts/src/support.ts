import { z } from 'zod'

/**
 * Support requests (0271): Help → Report a problem, and the assistant's hand-over.
 * The studio writes; our team answers from the support Google Sheet; replies land
 * back here and in the bell.
 */
export const supportKind = z.enum(['problem', 'question', 'billing', 'idea'])
export type SupportKind = z.infer<typeof supportKind>

export const supportStatus = z.enum(['open', 'answered', 'waiting', 'closed'])
export type SupportStatus = z.infer<typeof supportStatus>

export const supportMessage = z.object({
  id: z.string(),
  sender: z.enum(['me', 'support']),
  author_name: z.string().nullable(),
  body: z.string(),
  files: z.array(z.object({ id: z.string(), name: z.string(), url: z.string() })).default([]),
  created_at: z.string(),
})
export type SupportMessage = z.infer<typeof supportMessage>

export const supportRequest = z.object({
  id: z.string(),
  subject: z.string(),
  kind: supportKind,
  urgency: z.enum(['normal', 'high']),
  status: supportStatus,
  created_by_name: z.string().nullable(),
  /** The person asking wrote it (owners and admins also see the studio's other requests). */
  mine: z.boolean(),
  created_at: z.string(),
  updated_at: z.string(),
  messages: z.array(supportMessage),
})
export type SupportRequest = z.infer<typeof supportRequest>

export const supportRequestList = z.object({
  items: z.array(supportRequest),
  /** Requests still waiting for our answer (open or waiting), for the help bubble's count. */
  open: z.number().int(),
})
export type SupportRequestList = z.infer<typeof supportRequestList>

export const createSupportRequest = z.object({
  kind: supportKind.default('problem'),
  body: z.string().trim().min(5, 'Tell us what happened in a sentence or two.').max(5000),
  /** It is stopping the studio's work today. */
  urgent: z.boolean().default(false),
  page_url: z.string().max(500).optional(),
  file_ids: z.array(z.string().uuid()).max(5).default([]),
  /** The assistant's conversation that led here (question and answer), carried to the team. */
  context: z.string().max(8000).optional(),
})
export type CreateSupportRequest = z.infer<typeof createSupportRequest>

export const replySupportRequest = z.object({
  body: z.string().trim().min(1).max(5000),
  file_ids: z.array(z.string().uuid()).max(5).default([]),
})

/** POST /webhooks/support-sheet: a reply our team wrote in the support Sheet. */
export const supportSheetReply = z.object({
  secret: z.string().max(200),
  ticketId: z.string().uuid(),
  reply: z.string().max(5000).default(''),
  status: z.enum(['replied', 'fixed', 'resolved']),
  by: z.string().max(120).optional(),
})
