import { z } from 'zod'
import { uuid, isoDate, isoDateTime } from './shared/primitives'

/**
 * The client portal: one private link per project that the studio shares with
 * its client. No login -- the link is the key -- so the page carries only what
 * a couple needs: their shoots, their deliverables, what they owe (when the
 * studio shows it) and the terms they were sent.
 *
 * Only the link's SHA-256 is kept (0184). The raw link exists in the answer to
 * the create call and nowhere else.
 */

// ── studio side ──────────────────────────────────────────────────
export const createClientPortalLinkRequest = z.object({
  show_payments: z.boolean().default(true),
  show_team: z.boolean().default(false),
  allow_feedback: z.boolean().default(true),
  /** Days until the link stops working; null or absent = no expiry. */
  expires_in_days: z.number().int().min(1).max(3650).nullish(),
})
export type CreateClientPortalLinkRequest = z.input<typeof createClientPortalLinkRequest>

export const updateClientPortalLinkRequest = z
  .object({
    show_payments: z.boolean().optional(),
    show_team: z.boolean().optional(),
    allow_feedback: z.boolean().optional(),
    /** A number of days from now, or null to remove the expiry. */
    expires_in_days: z.number().int().min(1).max(3650).nullable().optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), 'Nothing to change.')
export type UpdateClientPortalLinkRequest = z.infer<typeof updateClientPortalLinkRequest>

export const clientPortalFeedbackKind = z.enum(['approved', 'change_requested'])
export type ClientPortalFeedbackKind = z.infer<typeof clientPortalFeedbackKind>

export const clientPortalFeedbackItem = z.object({
  id: uuid,
  deliverable_id: uuid,
  deliverable_title: z.string().nullable(),
  kind: clientPortalFeedbackKind,
  message: z.string().nullable(),
  created_at: isoDateTime,
})
export type ClientPortalFeedbackItem = z.infer<typeof clientPortalFeedbackItem>

/** The project's live link as the studio sees it (never the raw token). */
export const clientPortalLinkInfo = z.object({
  id: uuid,
  created_at: isoDateTime,
  expires_at: isoDateTime.nullable(),
  show_payments: z.boolean(),
  show_team: z.boolean(),
  allow_feedback: z.boolean(),
  last_viewed_at: isoDateTime.nullable(),
  view_count: z.number().int(),
})
export type ClientPortalLinkInfo = z.infer<typeof clientPortalLinkInfo>

export const clientPortalStatus = z.object({
  link: clientPortalLinkInfo.nullable(),
  recent_feedback: z.array(clientPortalFeedbackItem),
})
export type ClientPortalStatus = z.infer<typeof clientPortalStatus>

/** Returned once, when a link is made. */
export const clientPortalIssued = z.object({
  link: clientPortalLinkInfo,
  /** Absolute when the API knows the app's address; else the path `/p/<token>`. */
  url: z.string().min(1),
})
export type ClientPortalIssued = z.infer<typeof clientPortalIssued>

// ── what the client sees ─────────────────────────────────────────
export const clientPortalDeliverableStatus = z.enum(['not_started', 'in_progress', 'ready'])
export type ClientPortalDeliverableStatus = z.infer<typeof clientPortalDeliverableStatus>

export const publicClientPortal = z.object({
  studio: z.object({
    name: z.string().nullable(),
    logo_url: z.string().nullable(),
    phone: z.string().nullable(),
    email: z.string().nullable(),
    website: z.string().nullable(),
    city: z.string().nullable(),
    /** The studio's own colour (#rrggbb) when it set one; else see theme_preset. */
    brand_color: z.string().nullable(),
    theme_preset: z.string().nullable(),
  }),
  project: z.object({
    name: z.string(),
    client_name: z.string().nullable(),
    status: z.string(),
  }),
  options: z.object({
    show_payments: z.boolean(),
    allow_feedback: z.boolean(),
    expires_at: isoDateTime.nullable(),
  }),
  shoots: z.array(
    z.object({
      id: uuid,
      name: z.string(),
      shoot_date: isoDate.nullable(),
      start_at: isoDateTime.nullable(),
      end_at: isoDateTime.nullable(),
      location: z.string().nullable(),
      map_link: z.string().nullable(),
      status: z.string(),
      team: z.array(z.object({ first_name: z.string(), role: z.string().nullable() })),
    }),
  ),
  deliverables: z.array(
    z.object({
      id: uuid,
      title: z.string(),
      description: z.string().nullable(),
      status: clientPortalDeliverableStatus,
      expected_date: isoDate.nullable(),
      delivered_at: isoDateTime.nullable(),
      delivery_link: z.string().nullable(),
      shoot_name: z.string().nullable(),
      feedback: z
        .object({ kind: clientPortalFeedbackKind, message: z.string().nullable(), created_at: isoDateTime })
        .nullable(),
    }),
  ),
  money: z
    .object({
      total: z.number(),
      received: z.number(),
      balance: z.number(),
      invoices: z.array(
        z.object({
          id: uuid,
          invoice_number: z.string().nullable(),
          invoice_date: isoDate.nullable(),
          due_date: isoDate.nullable(),
          status: z.string(),
          total: z.number(),
          balance_due: z.number(),
        }),
      ),
    })
    .nullable(),
  terms: z.array(
    z.object({
      id: uuid,
      title: z.string(),
      sent_at: isoDateTime,
      agreed_at: isoDateTime.nullable(),
      agreed_by: z.string().nullable(),
    }),
  ),
})
export type PublicClientPortal = z.infer<typeof publicClientPortal>

export const clientPortalFeedbackRequest = z
  .object({
    deliverable_id: uuid,
    kind: clientPortalFeedbackKind,
    message: z.string().trim().max(2000).optional(),
  })
  .refine((v) => v.kind === 'approved' || (v.message ?? '').length > 0, {
    message: 'Please tell the studio what you would like changed.',
    path: ['message'],
  })
export type ClientPortalFeedbackRequest = z.infer<typeof clientPortalFeedbackRequest>
