import { z } from 'zod'

/**
 * Upload a quotation, and the project makes itself (owner, 18 Nov; 0311).
 *
 * What was read off the studio's own quotation PDF or photo: the client, each
 * event with its date and team, what the client receives with its promised
 * time, and the money. Everything may be missing -- a quotation is the
 * studio's own design, not a form -- and a missing thing stays blank on the
 * project rather than being guessed.
 */
const isoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)

export const quotationEvent = z.object({
  name: z.string().trim().min(1).max(160),
  date: isoDay.nullable(),
  /** "HH:MM", 24-hour, only when the quotation says when it starts. */
  start_time: z.string().regex(/^\d{2}:\d{2}$/).nullable(),
  hours: z.number().min(0).max(24).nullable(),
  city: z.string().trim().max(200).nullable(),
  guests: z.number().int().min(0).max(100000).nullable(),
  /** The team as roles: "Candid Photographer" × 1, "Drone" × 1. */
  team: z.array(z.object({ role: z.string().trim().min(1).max(80), quantity: z.number().int().min(1).max(40) })).max(20),
})
export type QuotationEvent = z.infer<typeof quotationEvent>

export const quotationDeliverableKind = z.enum(['film', 'reel', 'photos', 'album', 'e_invite', 'gallery', 'other'])
export type QuotationDeliverableKind = z.infer<typeof quotationDeliverableKind>

export const quotationDeliverable = z.object({
  title: z.string().trim().min(1).max(200),
  kind: quotationDeliverableKind,
  /** Days after the last event the quotation promises it ("Reels 2 weeks" = 14). */
  due_days: z.number().int().min(0).max(730).nullable(),
  /** An add-on with its own price, or a line of the package. */
  is_add_on: z.boolean(),
  price: z.number().min(0).nullable(),
})
export type QuotationDeliverable = z.infer<typeof quotationDeliverable>

export const quotationReading = z.object({
  client_name: z.string().trim().max(160).nullable(),
  client_phone: z.string().trim().max(20).nullable(),
  client_email: z.string().trim().max(200).nullable(),
  project_name: z.string().trim().max(160).nullable(),
  events: z.array(quotationEvent).max(30),
  deliverables: z.array(quotationDeliverable).max(60),
  total: z.number().min(0).nullable(),
  /** The payment plan as the quotation words it: "To book 30%". */
  payment_plan: z.array(z.object({ label: z.string().trim().min(1).max(120), percent: z.number().min(0).max(100).nullable() })).max(10),
  /** Anything worth keeping that has no field: "Team meals arranged by the client". */
  notes: z.string().trim().max(1000).nullable(),
})
export type QuotationReading = z.infer<typeof quotationReading>

/** Is the upload on for this studio (0311: one studio first). */
export const quotationImportState = z.object({ enabled: z.boolean() })

/** The tasks the upload gave out, as the screen says them. */
export const quotationTask = z.object({
  id: z.string(),
  kind: z.enum(['edit', 'data_copy', 'e_invite', 'event_timeline']),
  role: z.enum(['video_editor', 'photo_editor', 'album_designer', 'designer', 'admin', 'manager']),
  title: z.string(),
  due_date: isoDay.nullable(),
  who: z.array(z.string()),
  /** Days it will be late, when the person's queue cannot fit it in time. */
  late_days: z.number().int().min(0).default(0),
})
/** Work already given on another project that now waits behind an earlier promise. */
export const quotationMovedTask = z.object({
  title: z.string(),
  project: z.string(),
  who: z.string(),
  from: isoDay.nullable(),
  to: isoDay,
  late_days: z.number().int().min(0),
})
export const quotationTasksResult = z.object({ tasks: z.array(quotationTask), moved: z.array(quotationMovedTask).default([]) })
export type QuotationTasksResult = z.infer<typeof quotationTasksResult>
