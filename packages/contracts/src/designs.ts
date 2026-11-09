import { z } from 'zod'
import { isoDateTime, uuid } from './shared/primitives'

/**
 * Quotation Designer (0295, owner 9 Nov): a premium multi-page quotation made
 * from a project and edited in place. The document is kept as one JSON value;
 * every page is a kind with its own fields, so a template only decides how a
 * kind looks, never what it holds.
 */

export const DESIGN_PAGE_KINDS = ['cover', 'about', 'event', 'deliverables', 'addons', 'thanks', 'packages', 'team', 'testimonial'] as const
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
/** One package to choose from (0296): Silver / Gold / Platinum side by side. */
export const designPackage = z.object({ name: text(60), price: text(60), lines: z.array(text(200)).max(10).default([]) })
/** One person on the Our team page. */
export const designPerson = z.object({
  name: text(80),
  role: text(80),
  photo: designPhoto.default({}),
})

/**
 * How one piece of text on a page is set (0297, Canva's text bar): bigger or
 * smaller than the layout's size, its alignment, its own colour, bold and
 * italic. Keyed by the text's place on the page ("title", "body",
 * "lines.2", "packages.1.price").
 */
export const designTextStyle = z.object({
  scale: z.number().min(0.4).max(2.5).optional(),
  align: z.enum(['left', 'center', 'right']).optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  bold: z.boolean().optional(),
  italic: z.boolean().optional(),
})
export type DesignTextStyle = z.infer<typeof designTextStyle>

/** A moved or resized item: offset from its place in page pixels, and its size against the layout's. */
export const designBox = z.object({
  dx: z.number().min(-1200).max(1200).default(0),
  dy: z.number().min(-1600).max(1600).default(0),
  s: z.number().min(0.2).max(4).default(1),
})
export type DesignBox = z.infer<typeof designBox>

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
  packages: z.array(designPackage).max(3).default([]),
  people: z.array(designPerson).max(8).default([]),
  /** 0297: per-text settings, and this page's own background ('' = the look's). */
  styles: z
    .record(z.string().max(60), designTextStyle)
    .refine((v) => Object.keys(v).length <= 120, { message: 'Too many text settings on one page.' })
    .default({}),
  background: z.union([z.literal(''), z.string().regex(/^#[0-9a-fA-F]{6}$/)]).default(''),
  /**
   * Step 4 (Canva's move and resize): where the studio dragged a photo or a
   * text away from its place in the layout, in page pixels, and how much it
   * was grown or shrunk. Keyed like `styles` ("photo", "photos.2", "title").
   */
  layout: z
    .record(z.string().max(60), designBox)
    .refine((v) => Object.keys(v).length <= 120, { message: 'Too many moved items on one page.' })
    .default({}),
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
  /** 0297: a saved template starts new designs and is not counted as a design. */
  is_template: z.boolean().default(false),
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
  is_template: z.boolean().optional(),
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

// ── step 2 (0296): the client's link, and "Write it for me" ─────────

/** The design's live link for the client, and whether they opened it. */
export const designLink = z.object({
  token: z.string().nullable(),
  views: z.number().int().default(0),
  first_viewed_at: z.string().nullable().default(null),
  last_viewed_at: z.string().nullable().default(null),
})
export type DesignLink = z.infer<typeof designLink>

/** What the client's page reads: the design, never the studio's other data. */
export const publicDesign = z.object({
  title: z.string(),
  studio: z.string().nullable(),
  doc: designDoc,
})
export type PublicDesign = z.infer<typeof publicDesign>

export const DESIGN_WRITE_KINDS = ['about', 'tagline', 'deliverables', 'addon', 'event', 'thanks', 'testimonial'] as const
export const DESIGN_TONES = ['warm', 'premium', 'fun', 'hinglish'] as const
export const designWriteRequest = z.object({
  kind: z.enum(DESIGN_WRITE_KINDS),
  tone: z.enum(DESIGN_TONES).default('warm'),
  studio: z.string().trim().max(120).default(''),
  project: z.string().trim().max(200).default(''),
  client: z.string().trim().max(200).default(''),
  /** What is on the page now: the model improves it rather than starting blank. */
  current: z.string().max(3000).default(''),
  lines: z.array(z.string().max(400)).max(30).default([]),
  /** A line from the studio: "we are known for candid", "mention drone". */
  hint: z.string().trim().max(300).default(''),
})
export type DesignWriteRequest = z.infer<typeof designWriteRequest>

export const designWriteReply = z.object({ text: z.string(), lines: z.array(z.string()) })
export type DesignWriteReply = z.infer<typeof designWriteReply>

// ── step 3 (0297): the studio's photo library ───────────────────────

export const designLibraryPhoto = z.object({
  id: uuid,
  url: z.string(),
  name: z.string(),
  width: z.number().int().nullable(),
  height: z.number().int().nullable(),
  size_bytes: z.number().int().nullable(),
  created_at: isoDateTime,
})
export type DesignLibraryPhoto = z.infer<typeof designLibraryPhoto>

export const addDesignPhotoRequest = z.object({
  url: z.string().url().max(2000),
  name: z.string().max(200).default(''),
  width: z.number().int().positive().nullable().optional(),
  height: z.number().int().positive().nullable().optional(),
  size_bytes: z.number().int().nonnegative().nullable().optional(),
})
export type AddDesignPhotoRequest = z.infer<typeof addDesignPhotoRequest>
