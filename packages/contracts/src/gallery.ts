import { z } from 'zod'

/**
 * A project's photo gallery in Frameline, the gallery add-on (0261, 0264).
 *
 * Frameline holds the photos and its own billing; the studio sees here only
 * what it needs on the project: the guests' link and PIN, how many photos are
 * up, and a way in. The figures are what Frameline last said (refreshed on
 * each read and on Frameline's gallery-changed notice).
 */
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
  live: z.object({ photo_count: z.number().int(), status: z.string() }).nullable(),
  /** Who to tell the photos are ready: the project's client. */
  client: z.object({ name: z.string(), phone: z.string().nullable() }).nullable().default(null),
})
export type ProjectGallery = z.infer<typeof projectGallery>

/** Where "Open gallery" goes: a single-use sign-in link, good for a minute. */
export const galleryOpenLink = z.object({ url: z.string() })
export type GalleryOpenLink = z.infer<typeof galleryOpenLink>

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
  /** The owner has opened a gallery once, which sets the Frameline studio up. */
  linked: z.boolean(),
  studio_name: z.string().nullable(),
  plan: z.string().nullable(),
  valid_till: z.string().nullable(),
  wallet_rupees: z.number().nullable(),
  photos_used: z.number().int().nullable(),
  photos_limit: z.number().int().nullable(),
  galleries: z.number().int(),
})
export type FramelineAccount = z.infer<typeof framelineAccount>
