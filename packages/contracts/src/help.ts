import { z } from 'zod'

/** One question the Help panel answers (0236). */
export const helpFaq = z.object({
  id: z.string(),
  question: z.string(),
  answer: z.string(),
  sort_order: z.number().int(),
})
export type HelpFaq = z.infer<typeof helpFaq>

/** A video for a page, added or replaced from the platform console (0236). */
export const helpVideo = z.object({
  page_key: z.string(),
  title: z.string(),
  url: z.string(),
})
export type HelpVideo = z.infer<typeof helpVideo>

/** Everything Help shows: who to reach, the answers, and the added videos. Public. */
export const helpContent = z.object({
  support_whatsapp: z.string().nullable(),
  support_email: z.string().nullable(),
  /** Book a call: the first person's Google booking page, else the server's ONBOARDING_CALL_URL. */
  support_call_url: z.string().nullable().default(null),
  /**
   * Everyone who takes support calls, each with their own Google Calendar
   * booking page (0290). Two or more and Book a support call asks whom.
   */
  support_calls: z.array(z.object({ name: z.string(), url: z.string() })).default([]),
  faqs: z.array(helpFaq),
  videos: z.array(helpVideo),
})
export type HelpContent = z.infer<typeof helpContent>

export const saveHelpContactsRequest = z.object({
  support_whatsapp: z
    .string()
    .trim()
    .transform((v) => v.replace(/[^0-9]/g, ''))
    .refine((v) => v === '' || /^[0-9]{10,15}$/.test(v), 'A WhatsApp number with its country code, e.g. 91 98765 43210.')
    .nullable(),
  support_email: z.string().trim().email('That email does not look right.').or(z.literal('')).nullable(),
})
export type SaveHelpContactsRequest = z.infer<typeof saveHelpContactsRequest>

export const saveHelpFaqRequest = z.object({
  question: z.string().trim().min(3, 'Write the question.').max(300),
  answer: z.string().trim().min(1, 'Write the answer.').max(4000),
  sort_order: z.number().int().optional(),
})
export type SaveHelpFaqRequest = z.infer<typeof saveHelpFaqRequest>

export const saveHelpVideoRequest = z.object({
  title: z.string().trim().min(2).max(120),
  url: z.string().trim().url().startsWith('https://', 'The link must start with https://'),
})
export type SaveHelpVideoRequest = z.infer<typeof saveHelpVideoRequest>
