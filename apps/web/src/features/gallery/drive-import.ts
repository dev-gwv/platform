import type { DriveImport, DriveImportRequest, DriveItem } from '@ipc/contracts'

/**
 * Import from Google Drive on the Gallery tab, the parts with no screen: what
 * was picked becomes albums, and an import reads as one sentence.
 */

/** Photos picked one by one (not inside a picked folder) go to one album. */
export const LOOSE = ''
export const LOOSE_ALBUM = 'From Google Drive'

export interface AlbumGroup {
  /** The folder path, or LOOSE. */
  key: string
  /** What the studio picked: "Haldi/Candids", or "Photos you picked". */
  label: string
  /** The album it goes into: the studio's word, else the folder's. */
  album: string
  count: number
}

/** "Haldi/Candids" → "Haldi – Candids", so two Candids folders stay apart. */
const albumOf = (key: string) => (key === LOOSE ? LOOSE_ALBUM : key.split('/').join(' – ').slice(0, 120))

/** One album per picked folder (and subfolder), in the order Drive gave them; renamed where the studio typed a name. */
export function albumGroups(items: DriveItem[], names: Record<string, string> = {}): AlbumGroup[] {
  const map = new Map<string, AlbumGroup>()
  for (const it of items) {
    if (!it.importable) continue
    const key = it.folder_path ?? LOOSE
    const g = map.get(key) ?? { key, label: key === LOOSE ? 'Photos you picked' : key, album: albumOf(key), count: 0 }
    g.count++
    map.set(key, g)
  }
  return [...map.values()].map((g) => ({ ...g, album: (names[g.key] ?? '').trim().slice(0, 120) || g.album }))
}

/** "3 · RAW and other camera files aren’t imported yet; 1 · Videos aren’t imported", or null when nothing is left out. */
export function leftOut(items: DriveItem[]): string | null {
  const why = new Map<string, number>()
  for (const it of items) if (!it.importable) why.set(it.reason ?? 'Not a photo', (why.get(it.reason ?? 'Not a photo') ?? 0) + 1)
  return why.size ? [...why].map(([reason, n]) => `${n} · ${reason}`).join('; ') : null
}

/** What goes to Frameline: every photo it can take, each with its album. */
export function importRequest(items: DriveItem[], groups: AlbumGroup[], quality: DriveImportRequest['quality']): DriveImportRequest {
  const albumFor = new Map(groups.map((g) => [g.key, g.album]))
  const first = groups[0]?.label ?? 'Google Drive'
  return {
    name: (groups.length > 1 ? `${first} and ${groups.length - 1} more` : first).slice(0, 200),
    quality,
    items: items
      .filter((i) => i.importable)
      .map((i) => ({ file_id: i.id, name: i.name, size: i.size, mime_type: i.mime_type, album_name: albumFor.get(i.folder_path ?? LOOSE) ?? LOOSE_ALBUM })),
  }
}

export const photosLabel = (n: number) => `${n.toLocaleString('en-IN')} ${n === 1 ? 'photo' : 'photos'}`

/** "40 of 120 photos in · 2 skipped"; the running import's line on the Gallery tab. */
export function importLine(i: DriveImport): string {
  const parts = [`${i.done.toLocaleString('en-IN')} of ${photosLabel(i.total)} in`]
  if (i.skipped) parts.push(`${i.skipped.toLocaleString('en-IN')} skipped`)
  if (i.failed) parts.push(`${i.failed.toLocaleString('en-IN')} failed`)
  return parts.join(' · ')
}

/** How far it has got, 0 to 1 (skipped and failed count as handled). */
export const importShare = (i: DriveImport) => (i.total ? Math.min(1, (i.done + i.skipped + i.failed) / i.total) : 1)

/** What a finished import says once, as a toast. */
export function finishedLine(i: DriveImport): string {
  if (i.status === 'failed') return `The Google Drive import stopped: ${i.error ?? 'Google did not let it finish'}. ${photosLabel(i.done)} came in.`
  if (i.status === 'cancelled') return `Import stopped. ${photosLabel(i.done)} came in.`
  const extra = [i.skipped ? `${i.skipped} skipped (already in the gallery, or not a photo)` : null, i.failed ? `${i.failed} failed` : null].filter(Boolean)
  return `${photosLabel(i.done)} imported from Google Drive${extra.length ? ` · ${extra.join(' · ')}` : ''}.`
}
