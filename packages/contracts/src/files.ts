import { z } from 'zod'
import { isoDateTime, uuid } from './shared/primitives'

/** 10 MB, matching the check constraint on `files.size_bytes`. */
export const MAX_FILE_BYTES = 10 * 1024 * 1024

/**
 * What a studio is allowed to store. Deliberately a short list: these are
 * bills, logos and exports, not a general file host, and every entry here is
 * something a browser can render or download without a plugin.
 */
export const ALLOWED_FILE_MIMES = [
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/svg+xml',
  'application/pdf',
  'text/csv',
  'text/plain',
  // Voice notes recorded in the browser: Chrome and Firefox record webm/ogg,
  // Safari mp4. mpeg covers an mp3 someone drops in.
  'audio/webm',
  'audio/ogg',
  'audio/mp4',
  'audio/mpeg',
] as const

/** Branding assets load without a session; everything else needs one. */
export const IMAGE_MIMES: readonly string[] = ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml']

export const storedFile = z.object({
  id: uuid,
  name: z.string(),
  mime: z.string(),
  size_bytes: z.number().int(),
  is_public: z.boolean().default(false),
  /** Absolute, so it works from an emailed document as well as the app. */
  url: z.string(),
  created_at: isoDateTime.nullable().default(null),
})
export type StoredFile = z.infer<typeof storedFile>

export const storedFileList = storedFile.array()
