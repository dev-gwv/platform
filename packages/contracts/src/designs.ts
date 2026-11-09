import { z } from 'zod'
import { isoDateTime, uuid } from './shared/primitives'

/**
 * Quotation Designer (0295, owner 9 Nov): a premium multi-page quotation made
 * from a project and edited in place. The document is kept as one JSON value;
 * every page is a kind with its own fields, so a template only decides how a
 * kind looks, never what it holds.
 */

export const DESIGN_PAGE_KINDS = ['cover', 'about', 'event', 'deliverables', 'addons', 'thanks'] as const
export const designPageKind = z.enum(DESIGN_PAGE_KINDS)
export type DesignPageKind = z.infer<typeof designPageKind>

const text = (max: number) => z.string().max(max).default('')

/** A photo placed in a frame: where it is, how far it is zoomed and which part shows. */
export const designPhoto = z.object({
  url: z.string().max(2000).default(''),
  /** 0-100: the point of the photo kept in view. */
  x: z.number().min(0).max(100).default(50),
  y: z.number().min(0).max(100).default(50),
  /** 1 = fills the frame; up to 3 zooms in. */
  zoom: z.number().min(1).max(3).default(1),
})
export type DesignPhoto = z.infer<typeof designPhoto>

export const designStat = z.object({ value: text(20), label: text(60) })
export const designAddon = z.object({ name: text(80), lines: z.array(text(200)).max(12).default([]) })

/** Every field a page can carry; a kind uses the ones it needs. */
export const designPageData = z.object({
  title: text(120),
  subtitle: text(300),
  body: text(3000),
  studio: text(120),
  tagline: text(200),
  event: text(120),
  location: text(160),
  date: text(80),
  team: text(160),
  lines: z.array(text(400)).max(30).default([]),
  total: text(200),
  payments: text(600),
  stats: z.array(designStat).max(4).default([]),
  addons: z.array(designAddon).max(12).default([]),
  photo: designPhoto.default({}),
  photos: z.array(designPhoto).max(6).default([]),
})
export type DesignPageData = z.infer<typeof designPageData>

export const designPage = z.object({
  id: z.string().min(1).max(40),
  kind: designPageKind,
  hidden: z.boolean().default(false),
  data: designPageData.default({}),
})
export type DesignPage = z.infer<typeof designPage>

/** The look a design wears; a template sets it and the studio can change it. */
export const designTheme = z.object({
  background: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  ink: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  accent: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  panel: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  heading: z.string().min(1).max(40),
  body: z.string().min(1).max(40),
})
export type DesignTheme = z.infer<typeof designTheme>

export const designDoc = z.object({
  version: z.literal(1).default(1),
  theme: designTheme,
  pages: z.array(designPage).min(1).max(30),
})
export type DesignDoc = z.infer<typeof designDoc>

const templateKey = z.string().regex(/^[a-z][a-z0-9_]{0,39}$/)

export const designSummary = z.object({
  id: uuid,
  title: z.string(),
  template: z.string(),
  project_id: uuid.nullable(),
  project_name: z.string().nullable(),
  cover_url: z.string().nullable().default(null),
  pages: z.number().int().default(0),
  created_at: isoDateTime,
  updated_at: isoDateTime,
})
export type DesignSummary = z.infer<typeof designSummary>

export const designDetail = designSummary.extend({ doc: designDoc })
export type DesignDetail = z.infer<typeof designDetail>

export const createDesignRequest = z.object({
  title: z.string().trim().min(1).max(160),
  template: templateKey,
  project_id: uuid.nullable().optional(),
  doc: designDoc,
})
export type CreateDesignRequest = z.infer<typeof createDesignRequest>

export const updateDesignRequest = z
  .object({
    title: z.string().trim().min(1).max(160).optional(),
    template: templateKey.optional(),
    project_id: uuid.nullable().optional(),
    doc: designDoc.optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'Nothing to change.' })
export type UpdateDesignRequest = z.infer<typeof updateDesignRequest>

export const designCreated = z.object({ id: uuid })
export const designSaved = z.object({ ok: z.boolean(), updated_at: z.string() })
export const designDeleted = z.object({ ok: z.boolean() })
