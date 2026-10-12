import { z } from 'zod'

/**
 * A project's photo gallery in Frameline, the gallery add-on (0261).
 *
 * Frameline holds the photos and its own billing; the studio sees here only
 * what it needs on the project: the guests' link and PIN, how many photos are
 * up, and a way in.
 */
export const projectGallery = z.object({
  /** FRAMELINE_API_URL and FRAMELINE_SECRET are both set on the server. */
  connected: z.boolean(),
  gallery: z
    .object({
      gallery_url: z.string(),
      short_id: z.string(),
      pin: z.string().nullable(),
      created_at: z.string(),
    })
    .nullable(),
  /**
   * What Frameline says right now. Null when it could not be asked (it is a
   * separate app, and its being slow must never stop the project page).
   */
  live: z.object({ photo_count: z.number().int(), status: z.string() }).nullable(),
})
export type ProjectGallery = z.infer<typeof projectGallery>

/** Where "Open gallery" goes: a single-use sign-in link, good for a minute. */
export const galleryOpenLink = z.object({ url: z.string() })
export type GalleryOpenLink = z.infer<typeof galleryOpenLink>
