import { existsSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { designDoc, type DesignDoc, type DesignPhoto } from '@ipc/contracts'
import { fillDesign, type FillInput } from './fill'
import { LIBRARY, LIBRARY_MOODS, libraryFor } from './library'
import { SAMPLE, isSample, samplePhotos, sample, withoutSamples } from './samples'
import { STARTERS, asFilled, keepStudioPages, pourProject, starterDoc } from './starters'
import { blankDoc } from './templates'

const PUBLIC = join(__dirname, '..', '..', '..', 'public')
const onDisk = (url: string) => existsSync(join(PUBLIC, url))

const film = {
  title: 'Film',
  description: null,
  list_key: 'primary',
  visibility_scope: 'client',
  show_on_quotation: true,
  status: 'pending',
  additional_charge_amount: 0,
}
const project = (over: Partial<FillInput> = {}) =>
  fillDesign({
    template: 'ivory',
    studio: 'Cine World',
    project: { name: 'Mehta Wedding', client_name: 'Priya', total_cost: 85000, deliverables: [] },
    shoots: [],
    instalments: [],
    ...over,
  })

const photosOf = (doc: DesignDoc): DesignPhoto[] =>
  doc.pages.flatMap((p) => {
    const d = p.data
    const out: DesignPhoto[] = []
    if (['cover', 'about', 'event', 'addons', 'testimonial'].includes(p.kind)) out.push(d.photo)
    if (p.kind === 'thanks') out.push(...d.photos)
    if (p.kind === 'team') out.push(...d.people.map((x) => x.photo))
    return out
  })

describe('complete templates (owner, 10 Nov)', () => {
  it('opens on the Complete Wedding Package, the owner’s quotation page for page', () => {
    expect(STARTERS[0]!.key).toBe('complete')
    const doc = starterDoc('complete', 'Cine World')
    expect(doc.pages.map((p) => p.kind)).toEqual([
      'cover',
      'about',
      'event',
      'event',
      'event',
      'event',
      'deliverables',
      'thanks',
    ])
    expect(doc.pages[0]!.data).toMatchObject({
      studio: 'Cine World',
      tagline: 'Timeless Memories For Lifetime Events',
    })
    expect(doc.pages[1]!.data.body).toContain('Cine World')
    expect(doc.pages[1]!.data.body).not.toMatch(/Mulberry|IIM|Anupam|Ashneer/)
    expect(doc.pages.slice(2, 6).map((p) => [p.data.event, p.data.date, p.data.team])).toEqual([
      ['Sagan', '18th January 2027', '3 Shooters'],
      ['Mehendi and Cocktail (groom side)', '21st January 2027', '2 Shooters'],
      ['Bhaat and Rituals (bride side)', '21st January 2027', '2 Shooters'],
      ['Wedding Ceremony', '22nd January 2027', '6 Shooters'],
    ])
    const deliv = doc.pages[6]!.data
    expect(deliv.lines).toHaveLength(10)
    expect(deliv.lines[0]).toBe('All the ULTRA Super Resolution Raw Photos will be delivered.')
    expect(deliv.total).toBe('Total Investment: INR 2,10,000/-')
    expect(deliv.payments).toBe('(Team Food to be managed by the client)')
    expect(doc.pages[7]!.data.subtitle).toBe('Looking Forward To Be A Part Of Your Wedding')
  })

  it('every starter is a valid, full design: words on every page, a sample in every frame', () => {
    expect(STARTERS.length).toBeGreaterThanOrEqual(11)
    expect(new Set(STARTERS.map((s) => s.key)).size).toBe(STARTERS.length)
    for (const s of STARTERS) {
      const doc = starterDoc(s.key, 'Cine World')
      expect(designDoc.safeParse(doc).success, s.key).toBe(true)
      for (const p of doc.pages) {
        const d = p.data
        if (p.kind === 'cover') expect(d.studio && d.tagline, s.key).toBeTruthy()
        if (p.kind === 'about') expect(d.body.length, s.key).toBeGreaterThan(120)
        if (p.kind === 'event') expect(d.event && d.date && d.team && d.lines.length, s.key).toBeTruthy()
        if (p.kind === 'deliverables') {
          expect(d.lines.length, s.key).toBeGreaterThanOrEqual(5)
          expect(d.total, s.key).toMatch(/^Total Investment: INR [\d,]+\/-$/)
          expect(d.payments, s.key).toBeTruthy()
        }
        if (p.kind === 'addons') expect(d.addons.length, s.key).toBeGreaterThan(0)
        if (p.kind === 'thanks') expect(d.subtitle, s.key).toBeTruthy()
      }
      const photos = photosOf(doc)
      expect(photos.length, s.key).toBeGreaterThan(0)
      for (const ph of photos) {
        expect(isSample(ph), `${s.key} ${ph.url}`).toBe(true)
        expect(onDisk(ph.url), ph.url).toBe(true)
      }
      expect(samplePhotos(doc)).toHaveLength(photos.length)
    }
  })

  it('the new variations are long-form: five events, three days, one day, two parts', () => {
    const events = (k: string) => starterDoc(k, 'X').pages.filter((p) => p.kind === 'event').length
    expect(events('rajasthani')).toBe(5)
    expect(events('destination3')).toBe(3)
    expect(events('intimate')).toBe(2)
    expect(events('combo')).toBe(3)
    expect(new Set(STARTERS.map((s) => s.look)).size).toBe(6)
  })
})

describe('photo library', () => {
  it('has every photo and thumb on disk, small enough to ship', () => {
    expect(LIBRARY.length).toBeGreaterThanOrEqual(40)
    expect(new Set(LIBRARY.map((p) => p.id)).size).toBe(LIBRARY.length)
    let total = 0
    for (const p of LIBRARY) {
      expect(onDisk(p.url), p.url).toBe(true)
      expect(onDisk(p.thumb), p.thumb).toBe(true)
      expect(Math.max(p.w, p.h)).toBeLessThanOrEqual(1800)
      total += statSync(join(PUBLIC, p.url)).size + statSync(join(PUBLIC, p.thumb)).size
    }
    expect(total).toBeLessThan(16 * 1024 * 1024)
    for (const url of Object.values(SAMPLE)) expect(onDisk(url), url).toBe(true)
  })

  it('every mood chip has photos', () => {
    for (const m of LIBRARY_MOODS) expect(libraryFor(m.key).length, m.key).toBeGreaterThan(0)
    expect(libraryFor('all')).toHaveLength(LIBRARY.length)
  })
})

describe('sample photos', () => {
  it('finds each one, page by page, leaving hidden pages out', () => {
    const doc = blankDoc('ivory', 'X')
    doc.pages[0]!.data.photo = sample(SAMPLE.cover)
    doc.pages[2]!.data.photo = { url: '/mine.jpg', x: 50, y: 50, zoom: 1 }
    doc.pages[5]!.data.photos = [sample(SAMPLE.thanks1), { url: '', x: 50, y: 50, zoom: 1 }, sample(SAMPLE.thanks3)]
    doc.pages[3]!.hidden = true
    doc.pages[3]!.data.photo = sample(SAMPLE.about)
    expect(samplePhotos(doc)).toEqual([
      { pageId: doc.pages[0]!.id, page: 1, where: 'photo' },
      { pageId: doc.pages[5]!.id, page: 6, where: 'photos.0' },
      { pageId: doc.pages[5]!.id, page: 6, where: 'photos.2' },
    ])
    // A replaced photo is no longer a sample; an empty frame is not one either.
    expect(isSample({ url: '', x: 50, y: 50, zoom: 1, sample: true })).toBe(false)
    expect(withoutSamples(doc.pages[5]!.data).photos.map((p) => p.url)).toEqual(['', '', ''])
  })

  it('survives the contract (the flag is kept, not stripped)', () => {
    const doc = designDoc.parse(starterDoc('complete', 'X'))
    expect(doc.pages[0]!.data.photo.sample).toBe(true)
  })

  it('never carries a sample from the last design; a real photo wins, an empty frame keeps the template’s', () => {
    const last = starterDoc('classic', 'Cine World')
    last.pages[0]!.data.photo = { url: '/our-cover.jpg', x: 50, y: 50, zoom: 1 }
    last.pages[1]!.data.body = 'Our own story.'
    last.pages[1]!.data.photo = { url: '', x: 50, y: 50, zoom: 1 }
    const doc = keepStudioPages(starterDoc('complete', 'Cine World'), last)
    expect(doc.pages[0]!.data.photo.url).toBe('/our-cover.jpg')
    expect(doc.pages[1]!.data.body).toBe('Our own story.')
    expect(doc.pages[1]!.data.photo).toMatchObject({ url: SAMPLE.about, sample: true })
    // The thank-you page's samples in the last design never come back as its own.
    const thanks = doc.pages.find((p) => p.kind === 'thanks')!
    expect(thanks.data.photos.every((p) => p.sample)).toBe(true)

    const filled = fillDesign({ template: 'ivory', studio: 'X', project: null, shoots: [], instalments: [], previous: last })
    expect(filled.pages[1]!.data.photo.url).toBe('')
    expect(filled.pages.find((p) => p.kind === 'thanks')!.data.photos.every((p) => p.url === '')).toBe(true)
  })
})

describe('the studio’s story over a full template', () => {
  it('keeps the template’s words where the last design still said a fresh page’s, and never the last client', () => {
    const last = blankDoc('ivory', 'Cine World')
    last.pages[0]!.data.subtitle = 'For Akshay & Riya'
    const doc = keepStudioPages(starterDoc('complete', 'Cine World'), last)
    expect(doc.pages[0]!.data.tagline).toBe('Timeless Memories For Lifetime Events')
    expect(doc.pages[0]!.data.subtitle).toBe('')
    expect(doc.pages[1]!.data.body).toBe(starterDoc('complete', 'Cine World').pages[1]!.data.body)
    expect(doc.pages[1]!.data.stats).toHaveLength(3)
  })
})

describe('pouring a project into a full template', () => {
  it('keeps every template event and its deliverables when the project has none, with the project’s price', () => {
    const doc = pourProject(starterDoc('complete', 'X'), project())
    expect(doc.pages.filter((p) => p.kind === 'event').map((p) => p.data.event)).toEqual([
      'Sagan',
      'Mehendi and Cocktail (groom side)',
      'Bhaat and Rituals (bride side)',
      'Wedding Ceremony',
    ])
    const deliv = doc.pages.find((p) => p.kind === 'deliverables')!.data
    expect(deliv.lines).toHaveLength(10)
    expect(deliv.total).toBe('Total Investment: INR 85,000/-')
    expect(doc.pages[0]!.data.subtitle).toBe('For Priya')
    expect(doc.pages.some((p) => p.kind === 'addons')).toBe(false)
  })

  it('a project without a price keeps the template’s', () => {
    const doc = pourProject(
      starterDoc('complete', 'X'),
      project({ project: { name: 'A', client_name: null, total_cost: 0, deliverables: [] } }),
    )
    expect(doc.pages.find((p) => p.kind === 'deliverables')!.data.total).toBe(
      'Total Investment: INR 2,10,000/-',
    )
  })

  it('puts the project’s shoots and deliverables in place of the template’s', () => {
    const doc = pourProject(
      starterDoc('complete', 'X'),
      project({
        project: { name: 'A', client_name: 'Priya', total_cost: 85000, deliverables: [film] },
        shoots: [
          { name: 'Haldi', shoot_date: '2026-12-04', location: 'Jaipur', requirements: [] },
          { name: 'Wedding', shoot_date: '2026-12-05', location: 'Jaipur', requirements: [] },
        ],
      }),
    )
    expect(doc.pages.map((p) => p.kind)).toEqual(['cover', 'about', 'event', 'event', 'deliverables', 'thanks'])
    expect(doc.pages.find((p) => p.kind === 'deliverables')!.data.lines).toEqual(['Film'])
  })

  it('adds a kind the template lacks after the nearest related page', () => {
    const extras = project({
      project: {
        name: 'A',
        client_name: null,
        total_cost: 85000,
        deliverables: [{ ...film, title: 'Drone', list_key: 'additional', additional_charge_amount: 15000 }],
      },
      shoots: [{ name: 'Haldi', shoot_date: '2026-12-04', location: 'Jaipur', requirements: [] }],
    })
    // Complete has no add-ons page: the project's go after the deliverables.
    const a = pourProject(starterDoc('complete', 'X'), extras)
    const kinds = a.pages.map((p) => p.kind)
    expect(kinds.indexOf('addons')).toBe(kinds.indexOf('deliverables') + 1)
    // Modern Minimal has no event page: the project's shoot goes after About us.
    const b = pourProject(starterDoc('minimal', 'X'), extras).pages.map((p) => p.kind)
    expect(b.slice(0, 3)).toEqual(['cover', 'about', 'event'])
    expect(designDoc.safeParse(a).success).toBe(true)
  })

  it('switching templates in the editor keeps the design’s own events, deliverables and add-ons', () => {
    const now = starterDoc('rajasthani', 'X')
    const doc = pourProject(starterDoc('intimate', 'X'), asFilled(now))
    expect(doc.pages.filter((p) => p.kind === 'event')).toHaveLength(5)
    expect(doc.pages.find((p) => p.kind === 'deliverables')!.data.total).toBe(
      'Total Investment: INR 4,75,000/-',
    )
  })
})
