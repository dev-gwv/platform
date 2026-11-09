import type {
  DesignDoc,
  DesignPage,
  DesignPageData,
  DesignPageKind,
  DesignTheme,
} from '@ipc/contracts'

/**
 * The looks a quotation design can wear (Quotation Designer, 0295). A template
 * is only a theme -- colours and two typefaces -- over the same page kinds, so
 * switching one never loses a word or a photo.
 * "Ivory Classic" is the owner's Canva quotation (9 Nov): warm off-white, a
 * script for headings, a quiet italic for the words.
 */
export interface DesignTemplate {
  key: string
  name: string
  blurb: string
  theme: DesignTheme
}

export const TEMPLATES: readonly DesignTemplate[] = [
  {
    key: 'ivory',
    name: 'Ivory Classic',
    blurb: 'Warm ivory, a flowing script and quiet italic words.',
    theme: {
      background: '#EAE7E0',
      ink: '#3B3631',
      accent: '#8A7356',
      panel: '#F6F4EF',
      heading: 'Great Vibes',
      body: 'Cormorant Garamond',
    },
  },
  {
    key: 'midnight',
    name: 'Midnight Gold',
    blurb: 'Deep navy with gold: grand and cinematic.',
    theme: {
      background: '#141722',
      ink: '#EEE7D7',
      accent: '#C9A55C',
      panel: '#1F2332',
      heading: 'Playfair Display',
      body: 'Lato',
    },
  },
  {
    key: 'blush',
    name: 'Blush Rose',
    blurb: 'Soft blush and rose: romantic and light.',
    theme: {
      background: '#F7ECEA',
      ink: '#4A3A3B',
      accent: '#B5707B',
      panel: '#FFFFFF',
      heading: 'Allura',
      body: 'Raleway',
    },
  },
  {
    key: 'sage',
    name: 'Sage Editorial',
    blurb: 'Sage and cream with a magazine serif.',
    theme: {
      background: '#ECEFE6',
      ink: '#2E382E',
      accent: '#647A57',
      panel: '#F8F9F4',
      heading: 'Cormorant Garamond',
      body: 'Nunito Sans',
    },
  },
  {
    key: 'royal',
    name: 'Royal Maroon',
    blurb: 'Deep maroon and gold, made for Indian weddings.',
    theme: {
      background: '#5C1A24',
      ink: '#F6E9D2',
      accent: '#D9B26A',
      panel: '#6E2430',
      heading: 'Great Vibes',
      body: 'Cormorant Garamond',
    },
  },
  {
    key: 'mono',
    name: 'Modern Mono',
    blurb: 'Clean white and black, a modern magazine.',
    theme: {
      background: '#FFFFFF',
      ink: '#1A1A1A',
      accent: '#1A1A1A',
      panel: '#F3F3F3',
      heading: 'Playfair Display',
      body: 'Montserrat',
    },
  },
]

export const templateFor = (key: string): DesignTemplate =>
  TEMPLATES.find((t) => t.key === key) ?? TEMPLATES[0]!

/** Every family a template uses, for one Google Fonts request. */
export const DESIGN_FONTS = [
  'Great Vibes',
  'Cormorant Garamond',
  'Playfair Display',
  'Lato',
  'Allura',
  'Raleway',
  'Nunito Sans',
  'Montserrat',
] as const

/** The family lists a studio can pick from in the theme panel. */
export const HEADING_FONTS = [
  'Great Vibes',
  'Allura',
  'Playfair Display',
  'Cormorant Garamond',
] as const
export const BODY_FONTS = [
  'Cormorant Garamond',
  'Lato',
  'Raleway',
  'Nunito Sans',
  'Montserrat',
] as const

const SCRIPTS = new Set(['Great Vibes', 'Allura'])
/** A script face reads small; it gets a size bump wherever it is used. */
export const isScript = (family: string) => SCRIPTS.has(family)

export const PAGE_KIND_NAMES: Record<DesignPageKind, string> = {
  cover: 'Cover',
  about: 'About us',
  event: 'Event',
  deliverables: 'Deliverables',
  addons: 'Add-ons',
  thanks: 'Thank you',
  packages: 'Packages',
  team: 'Our team',
  testimonial: 'Kind words',
}

let seq = 0
/** A page id unique inside one document. */
export const pageId = () => `p${Date.now().toString(36)}${(seq++).toString(36)}`

const EMPTY: DesignPageData = {
  title: '',
  subtitle: '',
  body: '',
  studio: '',
  tagline: '',
  event: '',
  location: '',
  date: '',
  team: '',
  lines: [],
  total: '',
  payments: '',
  stats: [],
  addons: [],
  photo: { url: '', x: 50, y: 50, zoom: 1 },
  photos: [],
  packages: [],
  people: [],
  styles: {},
  background: '',
  layout: {},
}

export function page(kind: DesignPageKind, data: Partial<DesignPageData> = {}): DesignPage {
  return { id: pageId(), kind, hidden: false, data: { ...EMPTY, ...data } }
}

const blankPhotos = (n: number) =>
  Array.from({ length: n }, () => ({ url: '', x: 50, y: 50, zoom: 1 }))

/** What a fresh page of each kind says before the studio writes its own. */
export function blankPage(kind: DesignPageKind, studio = 'Your Studio'): DesignPage {
  switch (kind) {
    case 'cover':
      return page('cover', { studio, tagline: '“Stories that live forever”' })
    case 'about':
      return page('about', {
        title: 'About Us',
        body: `At ${studio}, we believe every wedding is a story worth telling beautifully. We capture the quiet glances, the loud laughter and every ritual in between, so you can live your day again and again.`,
        stats: [
          { value: '8+', label: 'Years of Experience' },
          { value: '300+', label: 'Weddings Curated' },
        ],
        subtitle: 'Capturing weddings across India.',
      })
    case 'event':
      return page('event', {
        title: 'Event Details',
        event: 'Wedding',
        location: 'Venue',
        date: 'Date',
        team: '3 Shooters with Assistants',
        lines: ['1 Candid Photographer', '1 Traditional Photographer', '1 Cinematographer'],
      })
    case 'deliverables':
      return page('deliverables', {
        title: 'Deliverables',
        lines: [
          'Edited high-resolution photographs',
          'Cinematic wedding film',
          'Wedding highlights teaser',
        ],
        total: 'Total Investment: INR 0/-',
        payments: 'Advance at booking, the rest before the wedding.',
      })
    case 'addons':
      return page('addons', {
        title: 'Add Ons',
        addons: [
          { name: 'Pre Wedding Shoot', lines: ['1 day, 2 locations'] },
          { name: 'Same Day Edit', lines: ['A short film shown at the reception'] },
        ],
      })
    case 'thanks':
      return page('thanks', {
        title: 'Thank You',
        subtitle: 'Looking Forward To Be A Part Of Your Wedding',
        photos: blankPhotos(5),
      })
    case 'packages':
      return page('packages', {
        title: 'Our Packages',
        packages: [
          {
            name: 'Silver',
            price: 'INR 1,25,000/-',
            lines: ['Candid & traditional photography', 'Highlights film', '1 album'],
          },
          {
            name: 'Gold',
            price: 'INR 1,85,000/-',
            lines: ['Everything in Silver', 'Cinematic wedding film', 'Drone coverage', '2 albums'],
          },
          {
            name: 'Platinum',
            price: 'INR 2,75,000/-',
            lines: [
              'Everything in Gold',
              'Pre-wedding shoot',
              'Same day edit',
              'Premium photobook',
            ],
          },
        ],
        subtitle: 'Every package can be changed to fit your wedding.',
      })
    case 'team':
      return page('team', {
        title: 'Our Team',
        body: 'The people who will be with you on your day.',
        people: [
          { name: 'Name', role: 'Lead Photographer', photo: { url: '', x: 50, y: 50, zoom: 1 } },
          { name: 'Name', role: 'Cinematographer', photo: { url: '', x: 50, y: 50, zoom: 1 } },
          { name: 'Name', role: 'Candid Photographer', photo: { url: '', x: 50, y: 50, zoom: 1 } },
        ],
      })
    case 'testimonial':
      return page('testimonial', {
        title: 'Kind Words',
        body: 'They captured every little moment we did not even know happened. Watching our film still makes our parents cry.',
        subtitle: 'Riya & Akshay, Udaipur',
      })
  }
}

/** A whole design before any project is read: the eight pages of the Canva reference. */
export function blankDoc(templateKey: string, studio?: string): DesignDoc {
  return {
    version: 1,
    theme: { ...templateFor(templateKey).theme },
    pages: (['cover', 'about', 'event', 'deliverables', 'addons', 'thanks'] as const).map((k) =>
      blankPage(k, studio),
    ),
  }
}
