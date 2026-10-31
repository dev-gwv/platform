import { z } from 'zod'

/**
 * A project's photo gallery in Frameline, the gallery add-on (0261, 0264).
 *
 * Frameline holds the photos and its own billing; the studio sees here only
 * what it needs on the project: the guests' link and PIN, how many photos are
 * up, and a way in. The figures are what Frameline last said (refreshed on
 * each read and on Frameline's gallery-changed notice).
 */
/**
 * Google Drive in Frameline, for this studio. The studio connects it, picks
 * folders and keeps originals there in Frameline itself (Open gallery takes
 * them there); this side only shows the state and the way in.
 */
export const galleryDrive = z.object({
  /** Frameline offers Google Drive at all. */
  available: z.boolean(),
  /** Importing from Drive works (it also needs Google's file picker). */
  import_available: z.boolean(),
  /** The studio's Drive is connected and Google still lets Frameline in. */
  connected: z.boolean(),
  /** Google no longer lets Frameline in: the owner has to connect it again. */
  needs_reconnect: z.boolean(),
  /** The Google account connected. */
  email: z.string().nullable(),
  /** New galleries keep their full-size photos in Drive. */
  default_for_new: z.boolean(),
})
export type GalleryDrive = z.infer<typeof galleryDrive>

/** Where a gallery's full-size photos go. */
export const originalsIn = z.enum(['frameline', 'drive'])

export const projectGallery = z.object({
  /** FRAMELINE_API_URL and FRAMELINE_SECRET are both set on the server. */
  connected: z.boolean(),
  gallery: z
    .object({
      gallery_url: z.string(),
      short_id: z.string(),
      pin: z.string().nullable(),
      /** The couple-and-family PIN (sees every photo), when the studio set one in Frameline. */
      full_access_pin: z.string().nullable().default(null),
      photo_count: z.number().int().default(0),
      visits: z.number().int().default(0),
      guests: z.number().int().nullable().default(null),
      expires_at: z.string().nullable().default(null),
      created_at: z.string(),
    })
    .nullable(),
  /**
   * What Frameline says right now. Null when it could not be asked (it is a
   * separate app, and its being slow must never stop the project page).
   */
  live: z
    .object({
      photo_count: z.number().int(),
      status: z.string(),
      /** Where this gallery's full-size photos go; null from a Frameline that does not say. */
      originals_in: originalsIn.nullable().default(null),
    })
    .nullable(),
  /** Google Drive for the studio, as Frameline said just now; null when it could not be asked. */
  drive: galleryDrive.nullable().default(null),
  /**
   * Why `live` is null: Frameline did not answer (a blip, try again) or
   * refused us in a way only we can fix (the add-on is not linked properly).
   */
  trouble: z.enum(['unreachable', 'misconfigured']).nullable().default(null),
  /** The day the studio's Frameline plan ended, while it has; null while it runs. */
  plan_ended_on: z.string().nullable().default(null),
  /** Who to tell the photos are ready: the project's client. */
  client: z.object({ name: z.string(), phone: z.string().nullable() }).nullable().default(null),
})
export type ProjectGallery = z.infer<typeof projectGallery>

/** Where "Open gallery" goes: a single-use sign-in link, good for a minute. */
export const galleryOpenLink = z.object({ url: z.string() })
export type GalleryOpenLink = z.infer<typeof galleryOpenLink>

/** Create gallery: keep its full-size photos in the studio's Google Drive (only once Drive is connected). */
export const createGalleryRequest = z.object({ originals_in: originalsIn.optional() })
/** Open gallery: at the gallery, or straight at its Import from Google Drive window. */
export const openGalleryRequest = z.object({ to: z.enum(['gallery', 'import']).default('gallery') })
/** Open Frameline (owner): its home, or its Google Drive settings to connect or manage Drive. */
export const openFramelineRequest = z.object({ to: z.enum(['home', 'drive']).default('home') })

/** Projects → Galleries: every project with a gallery. */
export const galleryListItem = z.object({
  project_id: z.string(),
  project_name: z.string(),
  client_name: z.string().nullable(),
  gallery_url: z.string(),
  pin: z.string().nullable(),
  full_access_pin: z.string().nullable(),
  photo_count: z.number().int(),
  visits: z.number().int(),
  expires_at: z.string().nullable(),
  status: z.string().nullable(),
})
export type GalleryListItem = z.infer<typeof galleryListItem>
export const galleryList = z.object({
  connected: z.boolean(),
  /** False when Frameline did not answer just now: the list is what was last known. */
  fresh: z.boolean(),
  items: z.array(galleryListItem),
})
export type GalleryList = z.infer<typeof galleryList>

/** Frameline's gallery-changed notice (POST /webhooks/frameline). Only which project; the server reads it back. */
export const framelineNotice = z.object({
  type: z.literal('gallery.changed'),
  companyId: z.string().uuid(),
  projectId: z.string().uuid(),
  reasons: z.array(z.string().max(32)).max(10).default([]),
})

/** Settings → Messaging → Gallery: the Frameline studio joined to this company. */
export const framelineAccount = z.object({
  connected: z.boolean(),
  /** Frameline answered. False: it is connected but did not answer just now. */
  reachable: z.boolean(),
  /** Why it did not: a blip, or a link only we can fix. Null when it answered. */
  trouble: z.enum(['unreachable', 'misconfigured']).nullable().default(null),
  /** The owner has opened a gallery once, which sets the Frameline studio up. */
  linked: z.boolean(),
  studio_name: z.string().nullable(),
  plan: z.string().nullable(),
  valid_till: z.string().nullable(),
  wallet_rupees: z.number().nullable(),
  photos_used: z.number().int().nullable(),
  photos_limit: z.number().int().nullable(),
  galleries: z.number().int(),
  /** Google Drive in Frameline; null when Frameline did not answer (or is too old to say). */
  drive: galleryDrive.nullable().default(null),
})
export type FramelineAccount = z.infer<typeof framelineAccount>

/**
 * Import from Google Drive on the Gallery tab: Google's own picker opens on
 * this page with a token Frameline gives for the studio's connected Drive,
 * and Frameline copies what was picked into the project's gallery. The Drive
 * connection, the copy and the photo limits stay Frameline's.
 */
export const drivePicker = z.object({
  access_token: z.string(),
  expires_at: z.string(),
  /** The Picker's browser key (it must allow this site's address). */
  api_key: z.string(),
  /** The Google Cloud project number; with it, picking a file lets Frameline read it. */
  app_id: z.string().nullable(),
})
export type DrivePicker = z.infer<typeof drivePicker>

const driveFileId = z.string().regex(/^[\w-]{10,200}$/)

export const driveExpandRequest = z.object({ ids: z.array(driveFileId).min(1).max(500) })

export const driveItem = z.object({
  id: z.string(),
  name: z.string(),
  mime_type: z.string(),
  size: z.number(),
  /** The picked folder it sits in ("Haldi/Candids"); null for a photo picked by itself. */
  folder_path: z.string().nullable(),
  importable: z.boolean(),
  /** Why it is left out (a RAW file, a video, over 200 MB). */
  reason: z.string().nullable(),
})
export type DriveItem = z.infer<typeof driveItem>

/** What the picked files and folders hold. `closed_folders`: Google would not let Frameline look inside. */
export const driveExpand = z.object({
  items: z.array(driveItem),
  closed_folders: z.array(z.object({ id: z.string(), name: z.string() })),
})
export type DriveExpand = z.infer<typeof driveExpand>

export const driveQuality = z.enum(['web', 'original'])

export const driveImportRequest = z.object({
  name: z.string().trim().min(1).max(200),
  /** web: Standard (counts 1 photo each in Frameline); original: full quality (counts 2). */
  quality: driveQuality.default('web'),
  items: z
    .array(
      z.object({
        file_id: driveFileId,
        name: z.string().trim().min(1).max(255),
        size: z.number().int().min(0),
        mime_type: z.string().max(200),
        /** The album it goes into; one of that name is reused. */
        album_name: z.string().trim().min(1).max(120),
      }),
    )
    .min(1)
    .max(5000),
})
export type DriveImportRequest = z.infer<typeof driveImportRequest>

export const driveImport = z.object({
  id: z.string(),
  name: z.string(),
  status: z.enum(['running', 'done', 'failed', 'cancelled']),
  total: z.number().int(),
  done: z.number().int(),
  skipped: z.number().int(),
  failed: z.number().int(),
  albums_created: z.number().int(),
  quality: driveQuality,
  created_at: z.string(),
  finished_at: z.string().nullable(),
  error: z.string().nullable(),
})
export type DriveImport = z.infer<typeof driveImport>
export const driveImports = z.object({ items: z.array(driveImport) })
export type DriveImports = z.infer<typeof driveImports>
