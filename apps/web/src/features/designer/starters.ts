import type { DesignDoc, DesignPage, DesignPageKind } from '@ipc/contracts'
import { blankPage, page, templateFor } from './templates'

/**
 * Ready-made designs a studio starts from (0297, owner: "there should be
 * preloaded templates"), Canva's template gallery for a photography
 * quotation. Each is a look and a set of pages in order; a project's own
 * events, deliverables and price are filled in when one is chosen, so a
 * template only decides how the quotation is laid out and what it says
 * around the project.
 */
export interface Starter {
  key: string
  name: string
  blurb: string
  look: string
  pages: (studio: string) => DesignPage[]
}

const kinds = (studio: string, list: DesignPageKind[]) => list.map((k) => blankPage(k, studio))

const event = (name: string, team: string, lines: string[]) =>
  page('event', {
    title: 'Event Details',
    event: name,
    location: 'Venue',
    date: 'Date',
    team,
    lines,
  })

export const STARTERS: readonly Starter[] = [
  {
    key: 'classic',
    name: 'Classic Wedding',
    blurb: 'The full story: cover, about, each event, deliverables, add-ons and thanks.',
    look: 'ivory',
    pages: (s) =>
      kinds(s, ['cover', 'about', 'event', 'deliverables', 'addons', 'testimonial', 'thanks']),
  },
  {
    key: 'royal',
    name: 'Royal Indian Wedding',
    blurb: 'Maroon and gold, with Haldi, Sangeet and Wedding pages and three packages.',
    look: 'royal',
    pages: (s) => [
      blankPage('cover', s),
      blankPage('about', s),
      event('Haldi', '2 Shooters with Assistants', ['1 Candid Photographer', '1 Cinematographer']),
      event('Sangeet', '3 Shooters with Assistants', [
        '1 Candid Photographer',
        '1 Traditional Photographer',
        '1 Cinematographer',
      ]),
      event('Wedding', '4 Shooters with Assistants', [
        '2 Candid Photographers',
        '1 Traditional Photographer',
        '1 Cinematographer',
      ]),
      blankPage('packages', s),
      blankPage('deliverables', s),
      blankPage('team', s),
      blankPage('thanks', s),
    ],
  },
  {
    key: 'menu',
    name: 'Packages Menu',
    blurb: 'A short price list to send to a new enquiry: packages, add-ons, thanks.',
    look: 'midnight',
    pages: (s) => kinds(s, ['cover', 'packages', 'addons', 'thanks']),
  },
  {
    key: 'prewedding',
    name: 'Pre-Wedding Shoot',
    blurb: 'Soft blush for a one-day couple shoot.',
    look: 'blush',
    pages: (s) => [
      blankPage('cover', s),
      blankPage('about', s),
      event('Pre-Wedding Shoot', '2 Shooters with Assistants', [
        '1 Candid Photographer',
        '1 Cinematographer',
        '2 locations, 1 day',
      ]),
      page('deliverables', {
        title: 'What you receive',
        lines: [
          '60+ edited photographs',
          'A 2-3 minute cinematic film',
          'A 30-second reel for Instagram',
        ],
        total: 'Total Investment: INR 0/-',
        payments: 'Half at booking, the rest on the shoot day.',
      }),
      blankPage('thanks', s),
    ],
  },
  {
    key: 'minimal',
    name: 'Modern Minimal',
    blurb: 'Clean black and white for a modern couple.',
    look: 'mono',
    pages: (s) => kinds(s, ['cover', 'about', 'deliverables', 'packages', 'team', 'thanks']),
  },
  {
    key: 'destination',
    name: 'Destination Wedding',
    blurb: 'Sage and cream: travel days, deliverables, kind words.',
    look: 'sage',
    pages: (s) => [
      blankPage('cover', s),
      blankPage('about', s),
      event('Day 1 · Welcome & Mehendi', '3 Shooters with Assistants', [
        '1 Candid Photographer',
        '1 Cinematographer',
        '1 Drone Operator',
      ]),
      event('Day 2 · Wedding', '4 Shooters with Assistants', [
        '2 Candid Photographers',
        '1 Cinematographer',
        '1 Drone Operator',
      ]),
      blankPage('deliverables', s),
      blankPage('addons', s),
      blankPage('testimonial', s),
      blankPage('thanks', s),
    ],
  },
]

export const starterFor = (key: string) => STARTERS.find((s) => s.key === key) ?? STARTERS[0]!

export function starterDoc(key: string, studio: string): DesignDoc {
  const s = starterFor(key)
  return { version: 1, theme: { ...templateFor(s.look).theme }, pages: s.pages(studio) }
}

/**
 * A layout (a starter or a saved template) with the project poured in: the
 * layout's cover, about, packages, team, testimonial and thanks pages stay,
 * its event, deliverables and add-ons pages give way to the project's own,
 * in the layout's order (the project's events where its first event page was).
 */
export function pourProject(layout: DesignDoc, filled: DesignDoc): DesignDoc {
  const fromProject = (k: DesignPageKind) => filled.pages.filter((p) => p.kind === k)
  const out: DesignPage[] = []
  const done = new Set<DesignPageKind>()
  for (const p of layout.pages) {
    if (p.kind === 'event' || p.kind === 'deliverables' || p.kind === 'addons') {
      if (done.has(p.kind)) continue
      done.add(p.kind)
      const mine = fromProject(p.kind)
      out.push(...(mine.length ? mine : [p]))
    } else if (p.kind === 'cover') {
      const sub = filled.pages.find((x) => x.kind === 'cover')?.data.subtitle
      out.push(sub ? { ...p, data: { ...p.data, subtitle: sub } } : p)
    } else {
      out.push(p)
    }
  }
  return { ...layout, pages: out.slice(0, 30) }
}

/** The pages a studio writes once about itself: carried from its last design into a new one. */
const ABOUT_THE_STUDIO: readonly DesignPageKind[] = [
  'cover',
  'about',
  'team',
  'testimonial',
  'thanks',
]

/**
 * A ready-made layout with the studio's own story kept: its last design's
 * cover, About us, team, kind words and thank-you (words, photos and text
 * settings) go into the layout's pages of the same kind, in the layout's look.
 */
export function keepStudioPages(
  layout: DesignDoc,
  previous: DesignDoc | null | undefined,
): DesignDoc {
  if (!previous) return layout
  return {
    ...layout,
    pages: layout.pages.map((p) => {
      if (!ABOUT_THE_STUDIO.includes(p.kind)) return p
      const mine = previous.pages.find((x) => x.kind === p.kind)
      return mine ? { ...p, data: structuredClone(mine.data) } : p
    }),
  }
}
