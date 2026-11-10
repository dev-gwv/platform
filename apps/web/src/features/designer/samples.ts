import type { DesignDoc, DesignPageData, DesignPhoto } from '@ipc/contracts'

/**
 * Sample photos (owner, 10 Nov). A ready-made template is shown full, with
 * The Mulberry Weddings' own photos in every frame so the studio sees the
 * look; each is marked `sample` and must be swapped for one from the library
 * or the studio's own before the design is sent to a client or printed.
 */
export const SAMPLE_WORDS =
  "These are The Mulberry Weddings' own photos, shown only so you can see the look. Choose one from the library or upload your own."

const SAMPLE_DIR = '/designer/samples'
export const SAMPLE = {
  cover: `${SAMPLE_DIR}/cover.jpg`,
  about: `${SAMPLE_DIR}/about.jpg`,
  sagan: `${SAMPLE_DIR}/sagan.jpg`,
  mehendi: `${SAMPLE_DIR}/mehendi.jpg`,
  bhaat: `${SAMPLE_DIR}/bhaat.jpg`,
  wedding: `${SAMPLE_DIR}/wedding.jpg`,
  thanks1: `${SAMPLE_DIR}/thanks-1.jpg`,
  thanks2: `${SAMPLE_DIR}/thanks-2.jpg`,
  thanks3: `${SAMPLE_DIR}/thanks-3.jpg`,
  thanks4: `${SAMPLE_DIR}/thanks-4.jpg`,
  thanks5: `${SAMPLE_DIR}/thanks-5.jpg`,
} as const

/** A sample photo in a frame, with the part of it kept in view. */
export const sample = (url: string, x = 50, y = 50): DesignPhoto => ({
  url,
  x,
  y,
  zoom: 1,
  sample: true,
})

export const isSample = (p: DesignPhoto | undefined | null) => !!p?.url && p.sample === true

export interface SampleSpot {
  pageId: string
  /** 1-based page number, for "page 3". */
  page: number
  /** Where on the page: "photo", "photos.2", "people.1", "el.<id>". */
  where: string
}

/** Every sample photo still in the design, on the pages the client sees. */
export function samplePhotos(doc: DesignDoc): SampleSpot[] {
  const out: SampleSpot[] = []
  doc.pages.forEach((pg, i) => {
    if (pg.hidden) return
    const at = (where: string) => out.push({ pageId: pg.id, page: i + 1, where })
    const d = pg.data
    if (isSample(d.photo)) at('photo')
    d.photos.forEach((p, j) => isSample(p) && at(`photos.${j}`))
    d.people.forEach((p, j) => isSample(p.photo) && at(`people.${j}`))
    d.elements.forEach((e) => e.kind === 'photo' && isSample(e.photo) && at(`el.${e.id}`))
  })
  return out
}

/** "3 sample photos to replace". */
export const samplesLine = (n: number) =>
  `${n} sample ${n === 1 ? 'photo' : 'photos'} to replace`

const EMPTY_PHOTO: DesignPhoto = { url: '', x: 50, y: 50, zoom: 1 }
const clean = (p: DesignPhoto): DesignPhoto => (p.sample ? { ...EMPTY_PHOTO } : p)

/** A page's data with every sample photo taken out (an empty frame instead). */
export function withoutSamples(d: DesignPageData): DesignPageData {
  return {
    ...d,
    photo: clean(d.photo),
    photos: d.photos.map(clean),
    people: d.people.map((p) => ({ ...p, photo: clean(p.photo) })),
    elements: d.elements.map((e) => (e.kind === 'photo' ? { ...e, photo: clean(e.photo) } : e)),
  }
}

/**
 * The studio's own words from an older page laid over a template's page of
 * the same kind: its real photos and the words it wrote win; where it had no
 * photo (or only a sample) or still says a fresh page's words, the
 * template's stay, so a new design is never half empty.
 */
export function overStudioPage(
  template: DesignPageData,
  mine: DesignPageData,
  /** The words a fresh page says: a field still saying them keeps the template's. */
  blank?: DesignPageData,
): DesignPageData {
  const own = withoutSamples(structuredClone(mine))
  const pick = (a: DesignPhoto, b: DesignPhoto | undefined) => (a.url ? a : (b ?? a))
  const words = (k: 'title' | 'subtitle' | 'body' | 'tagline') =>
    own[k].trim() && own[k] !== blank?.[k] ? own[k] : template[k]
  const sameStats = blank && JSON.stringify(own.stats) === JSON.stringify(blank.stats)
  return {
    ...own,
    title: words('title'),
    subtitle: words('subtitle'),
    body: words('body'),
    tagline: words('tagline'),
    stats: own.stats.length && !sameStats ? own.stats : template.stats,
    photo: pick(own.photo, template.photo),
    photos:
      own.photos.length || template.photos.length
        ? Array.from({ length: Math.max(own.photos.length, template.photos.length) }, (_, i) =>
            pick(own.photos[i] ?? { ...EMPTY_PHOTO }, template.photos[i]),
          )
        : [],
    people: own.people.map((p, i) => ({ ...p, photo: pick(p.photo, template.people[i]?.photo) })),
  }
}
