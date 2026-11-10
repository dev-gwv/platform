import type { DesignDoc, DesignPage, DesignPageData, DesignPageKind, DesignPhoto } from '@ipc/contracts'
import { blankPage, page, templateFor } from './templates'
import { overStudioPage, SAMPLE, sample } from './samples'
import type { FilledDesign } from './fill'

/**
 * Ready-made designs a studio starts from (0297, owner: "there should be
 * preloaded templates"), Canva's template gallery for a photography
 * quotation. Since 10 Nov every one is **complete** (owner: "give one
 * template which is fully designed with all the deliverables ... do not take
 * off anything"): every page carries its words, and every frame a sample
 * photo of The Mulberry Weddings that the studio is asked to replace. The
 * first, Complete Wedding Package, is the owner's own quotation page for
 * page; the rest are variations in the same voice. A project's events,
 * deliverables and price are poured in when one is chosen (`pourProject`).
 */
export interface Starter {
  key: string
  name: string
  blurb: string
  look: string
  pages: (studio: string) => DesignPage[]
}

// ── page makers ──────────────────────────────────────────────────────

const cover = (studio: string, tagline: string, photo: DesignPhoto, subtitle = '') =>
  page('cover', { studio, tagline, subtitle, photo })

const about = (
  body: string,
  stats: [string, string][],
  subtitle: string,
  photo: DesignPhoto,
) =>
  page('about', {
    title: 'About Us',
    body,
    stats: stats.map(([value, label]) => ({ value, label })),
    subtitle,
    photo,
  })

const event = (
  name: string,
  location: string,
  date: string,
  team: string,
  lines: string[],
  photo: DesignPhoto,
) => page('event', { title: 'Event Details', event: name, location, date, team, lines, photo })

const deliverables = (
  title: string,
  lines: string[],
  total: string,
  payments: string,
  extra: Partial<DesignPageData> = {},
) => page('deliverables', { title, lines, total, payments, ...extra })

const addons = (list: [string, ...string[]][], photo: DesignPhoto, title = 'Add Ons') =>
  page('addons', {
    title,
    addons: list.map(([name, ...lines]) => ({ name, lines })),
    photo,
  })

const thanks = (subtitle: string, photos: DesignPhoto[] = THANKS) =>
  page('thanks', { title: 'Thank You', subtitle, photos })

const kindWords = (body: string, who: string, photo: DesignPhoto) =>
  page('testimonial', { title: 'Kind Words', body, subtitle: who, photo })

const teamPage = (body: string, people: [string, string, DesignPhoto][]) =>
  page('team', {
    title: 'Our Team',
    body,
    people: people.map(([name, role, photo]) => ({ name, role, photo })),
  })

const packagesPage = (
  title: string,
  list: [string, string, string[]][],
  subtitle: string,
) =>
  page('packages', {
    title,
    packages: list.map(([name, price, lines]) => ({ name, price, lines })),
    subtitle,
  })

// The owner's thank-you collage (the tall one first).
const THANKS = [
  sample(SAMPLE.thanks1, 50, 35),
  sample(SAMPLE.thanks2),
  sample(SAMPLE.thanks3),
  sample(SAMPLE.thanks4),
  sample(SAMPLE.thanks5),
]

const ASSISTANTS = 'With Assistants'

// ── the starters ────────────────────────────────────────────────────

export const STARTERS: readonly Starter[] = [
  {
    key: 'complete',
    name: 'Complete Wedding Package',
    blurb: 'Every page filled: cover, about, four events, ten deliverables and thanks.',
    look: 'ivory',
    pages: (s) => [
      cover(s, 'Timeless Memories For Lifetime Events', sample(SAMPLE.cover, 50, 40)),
      about(
        `${s} is a wedding photography and filmmaking studio built on one belief: every wedding deserves to be remembered exactly as it felt. Our team travels across India to capture weddings of every size, from the quiet rituals at home to the grandest celebrations.\n\nFamilies trust us for our calm on the busiest days, our eye for the moments nobody planned, and films that bring the whole family together, again and again.`,
        [
          ['8+', 'Years of Experience'],
          ['400+', 'Weddings Curated'],
          ['15', 'Cities All Over India'],
        ],
        'Capturing weddings across India.',
        sample(SAMPLE.about),
      ),
      event(
        'Sagan',
        'Delhi',
        '18th January 2027',
        '3 Shooters',
        ['1 Candid Photographer', '1 Traditional Videographer', '1 Cinematographer', ASSISTANTS],
        sample(SAMPLE.sagan),
      ),
      event(
        'Mehendi and Cocktail (groom side)',
        'Delhi',
        '21st January 2027',
        '2 Shooters',
        ['1 Candid Photographer', '1 Traditional Videographer', 'With assistants'],
        sample(SAMPLE.mehendi, 50, 30),
      ),
      event(
        'Bhaat and Rituals (bride side)',
        'Delhi',
        '21st January 2027',
        '2 Shooters',
        ['1 Candid Photographer', '1 Traditional Videographer', 'With assistants'],
        sample(SAMPLE.bhaat, 50, 40),
      ),
      event(
        'Wedding Ceremony',
        'Delhi',
        '22nd January 2027',
        '6 Shooters',
        [
          '1 Candid Photographer',
          '2 Traditional Videographers',
          '1 Cinematographer',
          '1 Traditional Photographer',
          '1 Drone',
          ASSISTANTS,
        ],
        sample(SAMPLE.wedding, 50, 35),
      ),
      deliverables(
        'Wedding Deliverables',
        [
          'All the ULTRA Super Resolution Raw Photos will be delivered.',
          'Best Selected Edited Pictures handpicked by our Team which will Sparkle your Eyes.',
          '3 to 4 Instagram Reels capturing key moments from the events.',
          'QR Code for guests access to pictures.',
          'Cinematic + Traditional Full Length Movie of each separate event.',
          'Jaw-dropping Cinematic Wedding Teaser (Combined of all events) will be delivered.',
          'Two Royal Combo Wedding Albums of 30 Sheets.',
          '2 E-invites for your Big day. (Without caricature)',
          'Monologue Shoot to make the story uniquely yours.',
          'Two Large Photo frames 20X30 Inches.',
        ],
        'Total Investment: INR 2,10,000/-',
        '(Team Food to be managed by the client)',
        { styles: { lines: { scale: 0.9 } } },
      ),
      thanks('Looking Forward To Be A Part Of Your Wedding'),
    ],
  },
  {
    key: 'rajasthani',
    name: 'Royal Rajasthani Wedding',
    blurb: 'Maroon and gold for a palace wedding: five functions, add-ons and kind words.',
    look: 'royal',
    pages: (s) => [
      cover(s, '“Where every ritual becomes a royal memory”', sample(SAMPLE.thanks1, 50, 30)),
      about(
        `At ${s}, we photograph weddings the way they are lived in Rajasthan: grand, colourful and full of family. From the first turmeric at the Haldi to the last dance at the Reception, our team stays close, quietly catching the glances, the tears and the laughter that make your wedding yours.\n\nWe plan every function with you, walk your venue before the day and deliver photographs and films your family will open again and again for years.`,
        [
          ['10+', 'Years Behind the Lens'],
          ['350+', 'Weddings Captured'],
          ['40+', 'Palace & Heritage Venues'],
        ],
        'Udaipur · Jaipur · Jodhpur · Across India',
        sample(SAMPLE.about),
      ),
      event(
        'Haldi',
        'Lake-facing Lawns, Udaipur',
        '12th February 2027',
        '3 Shooters',
        ['1 Candid Photographer', '1 Traditional Photographer', '1 Cinematographer', ASSISTANTS],
        sample(SAMPLE.bhaat, 50, 40),
      ),
      event(
        'Mehendi',
        'The Courtyard, Udaipur',
        '12th February 2027',
        '3 Shooters',
        ['1 Candid Photographer', '1 Traditional Videographer', '1 Cinematographer', ASSISTANTS],
        sample(SAMPLE.mehendi, 50, 30),
      ),
      event(
        'Sangeet',
        'The Durbar Hall, Udaipur',
        '13th February 2027',
        '4 Shooters',
        [
          '1 Candid Photographer',
          '1 Traditional Photographer',
          '1 Traditional Videographer',
          '1 Cinematographer',
          ASSISTANTS,
        ],
        sample(SAMPLE.about),
      ),
      event(
        'Baraat & Pheras',
        'The Palace Gardens, Udaipur',
        '14th February 2027',
        '6 Shooters',
        [
          '2 Candid Photographers',
          '1 Traditional Photographer',
          '1 Traditional Videographer',
          '1 Cinematographer',
          '1 Drone',
          ASSISTANTS,
        ],
        sample(SAMPLE.wedding, 50, 35),
      ),
      event(
        'Reception',
        'The Grand Ballroom, Udaipur',
        '15th February 2027',
        '4 Shooters',
        [
          '1 Candid Photographer',
          '1 Traditional Photographer',
          '1 Traditional Videographer',
          '1 Cinematographer',
          ASSISTANTS,
        ],
        sample(SAMPLE.thanks1, 50, 30),
      ),
      deliverables(
        'Royal Wedding Deliverables',
        [
          'Every raw photograph from all five functions, in full resolution.',
          '500+ hand-picked photographs, colour graded in our royal tones.',
          'A 20 to 25 minute cinematic wedding film, told as one story.',
          'A 3 to 4 minute teaser of all five functions.',
          'Full-length traditional videos of every function.',
          '4 Instagram reels from the Haldi, the Sangeet and the Pheras.',
          'Drone coverage of the Baraat and the palace.',
          'Two premium albums of 40 sheets each, in a matching box.',
          'A private online gallery with a QR code for your guests.',
          'Photographs in 45 days, films in 75 days.',
        ],
        'Total Investment: INR 4,75,000/-',
        '30% to block your dates, 40% on the Haldi, the balance on delivery. Team travel and stay in Udaipur to be arranged by the client.',
        { styles: { lines: { scale: 0.9 } } },
      ),
      addons(
        [
          ['Pre-Wedding Shoot', '1 day, 2 heritage locations in Udaipur', 'INR 75,000/-'],
          ['Same Day Edit', 'A 3-minute film of the day, shown at the Reception', 'INR 45,000/-'],
          ['Parents’ Album', 'One 30-sheet album for each family', 'INR 25,000/-'],
        ],
        sample(SAMPLE.thanks3),
      ),
      kindWords(
        'From the first call to the last frame they felt like family. Our Pheras film made both our grandmothers cry, and we have watched it more times than we can count.',
        'Aditi & Karan, Udaipur',
        sample(SAMPLE.thanks5),
      ),
      thanks('We look forward to being a part of your royal celebration'),
    ],
  },
  {
    key: 'destination3',
    name: 'Destination Wedding · 3 Days',
    blurb: 'Navy and gold for three days by the sea, with a same-day edit and drone.',
    look: 'midnight',
    pages: (s) => [
      cover(s, '“Three days, one unforgettable story”', sample(SAMPLE.thanks4, 50, 40)),
      about(
        `${s} travels with you. For a destination wedding we arrive a day early, walk the venue at the hour of each function and plan every frame around the light, so the days themselves stay easy for you and your guests.\n\nOur team blends into the celebration, and our films carry the sea breeze, the music and the people who flew in to be with you.`,
        [
          ['60+', 'Destination Weddings'],
          ['12', 'States & 3 Countries'],
          ['9+', 'Years Together'],
        ],
        'Goa · Udaipur · Jim Corbett · Bali',
        sample(SAMPLE.about),
      ),
      event(
        'Day 1 · Welcome Dinner',
        'Beachside Lawn, Goa',
        '5th December 2027',
        '3 Shooters',
        ['1 Candid Photographer', '1 Traditional Videographer', '1 Cinematographer', ASSISTANTS],
        sample(SAMPLE.sagan),
      ),
      event(
        'Day 2 · Mehendi & Sangeet',
        'Poolside Deck, Goa',
        '6th December 2027',
        '4 Shooters',
        [
          '1 Candid Photographer',
          '1 Traditional Photographer',
          '1 Traditional Videographer',
          '1 Cinematographer',
          ASSISTANTS,
        ],
        sample(SAMPLE.mehendi, 50, 30),
      ),
      event(
        'Day 3 · Wedding & Reception',
        'Sunset Lawn, Goa',
        '7th December 2027',
        '6 Shooters',
        [
          '2 Candid Photographers',
          '1 Traditional Photographer',
          '1 Traditional Videographer',
          '1 Cinematographer',
          '1 Drone',
          ASSISTANTS,
        ],
        sample(SAMPLE.wedding, 50, 35),
      ),
      deliverables(
        'Your Destination Deliverables',
        [
          'Every raw photograph from all three days, in full resolution.',
          '600+ edited photographs that carry the colours of the coast.',
          'A Same Day Edit film, shown to your guests at the Reception.',
          'A 20-minute cinematic film of all three days.',
          'A 3 to 4 minute destination teaser for social media.',
          'Full-length traditional videos of each day.',
          'Drone films of the venue and the wedding.',
          '5 Instagram reels, delivered in the first week.',
          'Two 35-sheet albums with a travel-themed cover.',
          'An online gallery and a QR code for every guest.',
        ],
        'Total Investment: INR 5,50,000/-',
        '40% to block your dates, 40% a month before the wedding, the balance on delivery. Flights and stay for the team to be arranged by the client.',
        { styles: { lines: { scale: 0.9 } } },
      ),
      addons(
        [
          ['Getting-Ready Shoot', 'Hair, make-up and the first look', 'INR 35,000/-'],
          ['Post-Wedding Couple Shoot', 'Day 4 on the beach at sunrise', 'INR 60,000/-'],
          ['Guest Photo Booth', 'Instant prints for every guest', 'INR 40,000/-'],
        ],
        sample(SAMPLE.thanks4),
      ),
      kindWords(
        'We flew 180 guests to Goa and still enjoyed every moment, because they handled everything. The Same Day Edit had the whole Reception on its feet.',
        'Meera & Arjun, Goa',
        sample(SAMPLE.thanks5),
      ),
      thanks('See you by the sea. Thank you for thinking of us for your wedding.'),
    ],
  },
  {
    key: 'intimate',
    name: 'Intimate Wedding',
    blurb: 'Sage and cream for one close day: Haldi and the wedding, a small team.',
    look: 'sage',
    pages: (s) => [
      cover(s, '“Small wedding, big feelings”', sample(SAMPLE.wedding, 50, 40)),
      about(
        `Some of the most beautiful weddings we shoot have fifty guests, not five hundred. At ${s} we keep the team small and the moments close, so your family feels at ease and every face in the room is remembered.\n\nWe plan the day with you hour by hour, so nothing important is missed and nobody feels watched.`,
        [
          ['8+', 'Years of Experience'],
          ['150+', 'Intimate Weddings'],
          ['48 hrs', 'Sneak Peek Delivery'],
        ],
        'Homes, farmhouses and small venues across India.',
        sample(SAMPLE.about),
      ),
      event(
        'Haldi',
        'Family Home, New Delhi',
        '20th November 2027',
        '2 Shooters',
        ['1 Candid Photographer', '1 Cinematographer', 'With Assistant'],
        sample(SAMPLE.bhaat, 50, 40),
      ),
      event(
        'Wedding Ceremony',
        'Farmhouse, Chhatarpur, New Delhi',
        '20th November 2027',
        '3 Shooters',
        ['1 Candid Photographer', '1 Traditional Photographer', '1 Cinematographer', ASSISTANTS],
        sample(SAMPLE.wedding, 50, 35),
      ),
      deliverables(
        'What You Receive',
        [
          'Every raw photograph of the day, in full resolution.',
          '250+ edited photographs, each one finished by hand.',
          'A 10-minute wedding film, cut like a short movie.',
          'A 60-second teaser to share with family.',
          '2 Instagram reels from the Haldi and the Pheras.',
          'One 30-sheet premium album.',
          'A sneak peek of 20 photographs within 48 hours.',
          'A private online gallery to share with your family.',
        ],
        'Total Investment: INR 1,10,000/-',
        '50% to block your date, the balance on the wedding day. Photographs in 30 days, the film in 45 days.',
      ),
      addons(
        [
          ['Family Portrait Session', 'A relaxed hour with both families', 'INR 15,000/-'],
          ['Parents’ Album', 'One 20-sheet album for the parents', 'INR 18,000/-'],
        ],
        sample(SAMPLE.thanks3),
      ),
      thanks('Thank you for letting us be a part of your day'),
    ],
  },
  {
    key: 'combo',
    name: 'Pre-Wedding + Wedding Combo',
    blurb: 'Blush for one story in two parts: the pre-wedding shoot and the wedding.',
    look: 'blush',
    pages: (s) => [
      cover(s, '“From the first frame to forever”', sample(SAMPLE.mehendi, 50, 30)),
      about(
        `Your story did not start at the mandap, and neither should your photographs. ${s} begins with a pre-wedding shoot, so you know us, we know you, and by the wedding day the camera feels like an old friend.\n\nThe result is one story told in two parts: the two of you before the wedding, and the celebration your families throw for you.`,
        [
          ['9+', 'Years of Experience'],
          ['300+', 'Couples Photographed'],
          ['20+', 'Pre-Wedding Locations'],
        ],
        'Pre-weddings in Jaipur, Udaipur, Rishikesh and the hills.',
        sample(SAMPLE.about),
      ),
      event(
        'Pre-Wedding Shoot',
        'Amer Fort & Nahargarh, Jaipur',
        '10th October 2027',
        '2 Shooters',
        ['1 Candid Photographer', '1 Cinematographer', '2 locations, 1 day', 'With Assistant'],
        sample(SAMPLE.sagan),
      ),
      event(
        'Engagement & Cocktail',
        'Hotel Ballroom, Jaipur',
        '12th January 2028',
        '3 Shooters',
        ['1 Candid Photographer', '1 Traditional Videographer', '1 Cinematographer', ASSISTANTS],
        sample(SAMPLE.mehendi, 50, 30),
      ),
      event(
        'Wedding Ceremony',
        'Jaipur',
        '14th January 2028',
        '5 Shooters',
        [
          '1 Candid Photographer',
          '1 Traditional Photographer',
          '1 Traditional Videographer',
          '1 Cinematographer',
          '1 Drone',
          ASSISTANTS,
        ],
        sample(SAMPLE.wedding, 50, 35),
      ),
      deliverables(
        'The Complete Story',
        [
          '60+ edited pre-wedding photographs from two locations.',
          'A 3-minute pre-wedding film, ready to play at your Sangeet.',
          'A save-the-date reel for WhatsApp and Instagram.',
          'Every raw photograph of the wedding, in full resolution.',
          '400+ hand-picked, edited wedding photographs.',
          'A cinematic wedding film and a 3-minute teaser.',
          'Full-length traditional videos of each function.',
          'One 40-sheet album telling both stories together.',
          'A QR code gallery for your guests.',
        ],
        'Total Investment: INR 2,85,000/-',
        '25% at booking, 25% on the pre-wedding shoot, 40% on the wedding day, the balance on delivery.',
        { styles: { lines: { scale: 0.92 } } },
      ),
      addons(
        [
          ['Outfit Styling', 'Our stylist plans two looks for the shoot', 'INR 20,000/-'],
          ['Pre-Wedding Album', 'A 20-sheet album of the shoot', 'INR 22,000/-'],
          ['Drone at the Pre-Wedding', 'Aerial frames at both locations', 'INR 15,000/-'],
        ],
        sample(SAMPLE.thanks4),
      ),
      kindWords(
        'Our pre-wedding shoot made us so comfortable that we forgot the cameras at the wedding. Every photo looks like us.',
        'Sanya & Rohan, Jaipur',
        sample(SAMPLE.thanks5),
      ),
      thanks('We can’t wait to tell your story, from the first frame to forever.'),
    ],
  },
  {
    key: 'classic',
    name: 'Classic Wedding',
    blurb: 'The full story: cover, about, the wedding, deliverables, add-ons and thanks.',
    look: 'ivory',
    pages: (s) => [
      cover(s, '“Stories that live forever”', sample(SAMPLE.wedding, 50, 40)),
      about(
        `At ${s}, we believe every wedding is a story worth telling beautifully. We capture the quiet glances, the loud laughter and every ritual in between, so you can live your day again and again.\n\nOur team plans each function with you and stays close without getting in the way.`,
        [
          ['8+', 'Years of Experience'],
          ['300+', 'Weddings Curated'],
        ],
        'Capturing weddings across India.',
        sample(SAMPLE.about),
      ),
      event(
        'Wedding',
        'Venue, City',
        '22nd January 2027',
        '4 Shooters',
        [
          '1 Candid Photographer',
          '1 Traditional Photographer',
          '1 Traditional Videographer',
          '1 Cinematographer',
          ASSISTANTS,
        ],
        sample(SAMPLE.wedding, 50, 35),
      ),
      deliverables(
        'Deliverables',
        [
          'Every raw photograph, in full resolution.',
          '400+ edited photographs, hand-picked by our team.',
          'A cinematic wedding film of 10 to 15 minutes.',
          'A 2 to 3 minute wedding teaser.',
          'A full-length traditional video of the wedding.',
          '3 Instagram reels from the day.',
          'One 30-sheet premium album.',
          'A QR code gallery for your guests.',
        ],
        'Total Investment: INR 1,50,000/-',
        '30% at booking, 50% on the wedding day, the balance on delivery.',
      ),
      addons(
        [
          ['Pre Wedding Shoot', '1 day, 2 locations', 'INR 50,000/-'],
          ['Same Day Edit', 'A short film shown at the reception', 'INR 35,000/-'],
        ],
        sample(SAMPLE.thanks3),
      ),
      kindWords(
        'They captured every little moment we did not even know happened. Watching our film still makes our parents cry.',
        'Riya & Akshay, Udaipur',
        sample(SAMPLE.thanks5),
      ),
      thanks('Looking Forward To Be A Part Of Your Wedding'),
    ],
  },
  {
    key: 'royal',
    name: 'Royal Indian Wedding',
    blurb: 'Maroon and gold, with Haldi, Sangeet and Wedding pages and three packages.',
    look: 'royal',
    pages: (s) => [
      cover(s, '“A celebration worthy of a palace”', sample(SAMPLE.bhaat, 40, 50)),
      about(
        `${s} photographs Indian weddings in all their colour: the families, the music and the rituals that have been passed down for generations. We are with you from the first haldi to the final vidaai, and we never miss a moment that matters.`,
        [
          ['10+', 'Years of Experience'],
          ['350+', 'Weddings Curated'],
          ['20+', 'Cities Covered'],
        ],
        'Weddings across India and abroad.',
        sample(SAMPLE.about),
      ),
      event(
        'Haldi',
        'Venue, City',
        '12th February 2027',
        '2 Shooters',
        ['1 Candid Photographer', '1 Cinematographer', ASSISTANTS],
        sample(SAMPLE.bhaat, 50, 40),
      ),
      event(
        'Sangeet',
        'Venue, City',
        '13th February 2027',
        '3 Shooters',
        ['1 Candid Photographer', '1 Traditional Photographer', '1 Cinematographer', ASSISTANTS],
        sample(SAMPLE.about),
      ),
      event(
        'Wedding',
        'Venue, City',
        '14th February 2027',
        '4 Shooters',
        [
          '2 Candid Photographers',
          '1 Traditional Photographer',
          '1 Cinematographer',
          ASSISTANTS,
        ],
        sample(SAMPLE.wedding, 50, 35),
      ),
      packagesPage(
        'Our Packages',
        [
          ['Silver', 'INR 1,25,000/-', ['Candid & traditional photography', 'Highlights film', '1 album']],
          ['Gold', 'INR 1,85,000/-', ['Everything in Silver', 'Cinematic wedding film', 'Drone coverage', '2 albums']],
          ['Platinum', 'INR 2,75,000/-', ['Everything in Gold', 'Pre-wedding shoot', 'Same day edit', 'Premium photobook']],
        ],
        'Every package can be changed to fit your wedding.',
      ),
      deliverables(
        'Deliverables',
        [
          'Every raw photograph from all three functions, in full resolution.',
          '450+ edited photographs, colour graded in our royal tones.',
          'A cinematic wedding film and a 3-minute teaser.',
          'Full-length traditional videos of each function.',
          '3 Instagram reels from the Haldi, Sangeet and Wedding.',
          'Two 35-sheet albums in a matching box.',
          'A QR code gallery for your guests.',
        ],
        'Total Investment: INR 1,85,000/-',
        '30% to block your dates, 50% on the Haldi, the balance on delivery.',
      ),
      teamPage('The people who will be with you on your day.', [
        ['Your Name', 'Lead Photographer', sample(SAMPLE.thanks1, 50, 30)],
        ['Your Name', 'Cinematographer', sample(SAMPLE.thanks5, 50, 30)],
        ['Your Name', 'Candid Photographer', sample(SAMPLE.cover, 50, 30)],
      ]),
      thanks('Looking Forward To Be A Part Of Your Wedding'),
    ],
  },
  {
    key: 'menu',
    name: 'Packages Menu',
    blurb: 'A short price list to send to a new enquiry: packages, add-ons, thanks.',
    look: 'midnight',
    pages: (s) => [
      cover(s, '“Choose the story you want to keep”', sample(SAMPLE.thanks3, 50, 50)),
      packagesPage(
        'Our Packages',
        [
          ['Essential', 'INR 95,000/-', ['1 day of coverage', 'Candid photography', 'Traditional video', '300+ edited photographs', '1 album']],
          ['Signature', 'INR 1,65,000/-', ['2 days of coverage', 'Everything in Essential', 'Cinematic film & teaser', '3 Instagram reels', '2 albums']],
          ['Luxury', 'INR 2,60,000/-', ['3 days of coverage', 'Everything in Signature', 'Drone coverage', 'Pre-wedding shoot', 'Same day edit']],
        ],
        'Every package can be changed to fit your wedding. Prices are for one city.',
      ),
      addons(
        [
          ['Pre Wedding Shoot', '1 day, 2 locations', 'INR 50,000/-'],
          ['Same Day Edit', 'A short film shown at the reception', 'INR 35,000/-'],
          ['Drone', 'Aerial coverage for one function', 'INR 15,000/-'],
          ['Extra Album', 'One 30-sheet album', 'INR 20,000/-'],
        ],
        sample(SAMPLE.thanks3),
      ),
      thanks('Tell us your dates and we will hold them for you'),
    ],
  },
  {
    key: 'prewedding',
    name: 'Pre-Wedding Shoot',
    blurb: 'Soft blush for a one-day couple shoot.',
    look: 'blush',
    pages: (s) => [
      cover(s, '“Just the two of you”', sample(SAMPLE.sagan)),
      about(
        `A pre-wedding shoot with ${s} is a day to slow down and be yourselves. We plan the places, the light and the looks with you, then let the moments happen.`,
        [
          ['300+', 'Couples Photographed'],
          ['20+', 'Locations'],
        ],
        'Jaipur · Udaipur · Rishikesh · The hills',
        sample(SAMPLE.about),
      ),
      event(
        'Pre-Wedding Shoot',
        'Two locations of your choice',
        '10th October 2027',
        '2 Shooters',
        ['1 Candid Photographer', '1 Cinematographer', '2 locations, 1 day', 'With Assistant'],
        sample(SAMPLE.sagan),
      ),
      deliverables(
        'What you receive',
        [
          '60+ edited photographs',
          'A 2 to 3 minute cinematic film',
          'A 30-second reel for Instagram',
          'A save-the-date picture for WhatsApp',
          'Every raw photograph, in full resolution',
        ],
        'Total Investment: INR 60,000/-',
        'Half at booking, the rest on the shoot day.',
      ),
      thanks('We can’t wait to meet you both'),
    ],
  },
  {
    key: 'minimal',
    name: 'Modern Minimal',
    blurb: 'Clean black and white for a modern couple.',
    look: 'mono',
    pages: (s) => [
      cover(s, 'Honest pictures of real days.', sample(SAMPLE.about, 50, 50)),
      about(
        `${s} is a small team with a simple idea: photograph what happens, the way it happens. No stiff poses, no fuss, just your day as you will want to remember it.`,
        [
          ['8+', 'Years'],
          ['300+', 'Weddings'],
        ],
        'Based in India, working everywhere.',
        sample(SAMPLE.about),
      ),
      deliverables(
        'Deliverables',
        [
          'Every raw photograph, in full resolution.',
          '400+ edited photographs.',
          'A 10-minute documentary-style film.',
          'A 2-minute teaser.',
          'One lay-flat album of 30 sheets.',
          'An online gallery for your guests.',
        ],
        'Total Investment: INR 1,40,000/-',
        '40% at booking, the balance on the wedding day.',
      ),
      packagesPage(
        'Packages',
        [
          ['One Day', 'INR 90,000/-', ['1 day', '2 photographers', 'Film & teaser']],
          ['Two Days', 'INR 1,40,000/-', ['2 days', '3 photographers', 'Film, teaser & album']],
          ['Three Days', 'INR 1,95,000/-', ['3 days', '4 photographers', 'Everything, plus drone']],
        ],
        'Pick one, or tell us what you need.',
      ),
      teamPage('The people who will be with you on your day.', [
        ['Your Name', 'Lead Photographer', sample(SAMPLE.thanks1, 50, 30)],
        ['Your Name', 'Cinematographer', sample(SAMPLE.thanks5, 50, 30)],
        ['Your Name', 'Candid Photographer', sample(SAMPLE.cover, 50, 30)],
      ]),
      thanks('Thank you.'),
    ],
  },
  {
    key: 'destination',
    name: 'Destination Wedding · 2 Days',
    blurb: 'Sage and cream: two travel days, deliverables, add-ons and kind words.',
    look: 'sage',
    pages: (s) => [
      cover(s, '“Wherever you say yes”', sample(SAMPLE.sagan)),
      about(
        `${s} travels for weddings across India and abroad. We plan the days with your planner, scout the venue ahead and keep the team light, so your guests enjoy the trip and you enjoy your wedding.`,
        [
          ['60+', 'Destination Weddings'],
          ['12', 'States'],
        ],
        'Goa · Udaipur · Jim Corbett · Bali',
        sample(SAMPLE.about),
      ),
      event(
        'Day 1 · Welcome & Mehendi',
        'Venue, City',
        '5th December 2027',
        '3 Shooters',
        ['1 Candid Photographer', '1 Cinematographer', '1 Drone Operator', ASSISTANTS],
        sample(SAMPLE.mehendi, 50, 30),
      ),
      event(
        'Day 2 · Wedding',
        'Venue, City',
        '6th December 2027',
        '4 Shooters',
        ['2 Candid Photographers', '1 Cinematographer', '1 Drone Operator', ASSISTANTS],
        sample(SAMPLE.wedding, 50, 35),
      ),
      deliverables(
        'Deliverables',
        [
          'Every raw photograph from both days, in full resolution.',
          '450+ edited photographs.',
          'A 15-minute cinematic film of both days.',
          'A 3-minute destination teaser.',
          'Drone films of the venue.',
          '3 Instagram reels.',
          'One 35-sheet album.',
          'A QR code gallery for your guests.',
        ],
        'Total Investment: INR 3,20,000/-',
        '40% to block your dates, 40% a month before, the balance on delivery. Team travel and stay to be arranged by the client.',
      ),
      addons(
        [
          ['Same Day Edit', 'A short film shown at the reception', 'INR 40,000/-'],
          ['Post-Wedding Shoot', 'The morning after, at the venue', 'INR 45,000/-'],
        ],
        sample(SAMPLE.thanks4),
      ),
      kindWords(
        'They made a two-day wedding in the hills feel effortless, and the drone shots still give us goosebumps.',
        'Naina & Kabir, Mussoorie',
        sample(SAMPLE.thanks5),
      ),
      thanks('Thank you for thinking of us for your wedding'),
    ],
  },
]

export const starterFor = (key: string) => STARTERS.find((s) => s.key === key) ?? STARTERS[0]!

export function starterDoc(key: string, studio: string): DesignDoc {
  const s = starterFor(key)
  return { version: 1, theme: { ...templateFor(s.look).theme }, pages: s.pages(studio) }
}

/** Where a kind goes when the template has no page of it: after the last page of these. */
const AFTER: Record<'event' | 'deliverables' | 'addons', DesignPageKind[]> = {
  event: ['about', 'cover'],
  deliverables: ['event', 'packages', 'about', 'cover'],
  addons: ['deliverables', 'packages', 'event', 'about', 'cover'],
}

/**
 * A layout (a starter or a saved template) with the project poured in: the
 * layout's cover, about, packages, team, testimonial and thanks pages stay.
 * Its event, deliverables and add-ons pages give way to the project's own
 * where the project has them (its shoots, its quotation deliverables, its
 * extras), in the layout's place for that kind; where the project has none,
 * **all** of the layout's pages of that kind stay as they are (owner, 10 Nov:
 * a template must come out full), and the project's price still goes on the
 * layout's deliverables page. A kind the layout lacks but the project has
 * goes in after the nearest related page. The cover takes "For Priya".
 */
export function pourProject(layout: DesignDoc, filled: FilledDesign): DesignDoc {
  const mine = (k: DesignPageKind) => filled.pages.filter((p) => p.kind === k)
  const use: Partial<Record<DesignPageKind, DesignPage[]>> = {}
  if (filled.has.shoots) use.event = mine('event')
  if (filled.has.deliverables) use.deliverables = mine('deliverables')
  if (filled.has.extras) use.addons = mine('addons')
  const price = filled.has.price ? mine('deliverables')[0]?.data : undefined

  let out: DesignPage[] = []
  const done = new Set<DesignPageKind>()
  for (const p of layout.pages) {
    const repl = use[p.kind]
    if (repl?.length) {
      if (done.has(p.kind)) continue
      done.add(p.kind)
      out.push(...repl)
    } else if (p.kind === 'cover') {
      const sub = filled.pages.find((x) => x.kind === 'cover')?.data.subtitle
      out.push(sub ? { ...p, data: { ...p.data, subtitle: sub } } : p)
    } else if (p.kind === 'deliverables' && price) {
      out.push({
        ...p,
        data: { ...p.data, total: price.total, payments: price.payments || p.data.payments },
      })
    } else {
      out.push(p)
    }
  }
  // What the project brings that the layout has no page for: after the nearest related page.
  for (const k of ['event', 'deliverables', 'addons'] as const) {
    const repl = use[k]
    if (!repl?.length || done.has(k)) continue
    const kinds = out.map((p) => p.kind)
    const near = AFTER[k].find((n) => kinds.includes(n))
    const at = near ? kinds.lastIndexOf(near) : -1
    out = [...out.slice(0, at + 1), ...repl, ...out.slice(at + 1)]
  }
  return { ...layout, pages: out.slice(0, 30) }
}

/** A design already being edited, poured into another template: all of its events, deliverables and add-ons stay. */
export const asFilled = (doc: DesignDoc): FilledDesign => ({
  ...doc,
  has: {
    shoots: doc.pages.some((p) => p.kind === 'event'),
    deliverables: doc.pages.some((p) => p.kind === 'deliverables'),
    extras: doc.pages.some((p) => p.kind === 'addons'),
    price: false,
  },
})

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
 * settings) go into the layout's pages of the same kind, in the layout's
 * look. Sample photos never carry over; a frame the studio never filled
 * keeps the template's sample, so the new design is still full.
 */
export function keepStudioPages(
  layout: DesignDoc,
  previous: DesignDoc | null | undefined,
): DesignDoc {
  if (!previous) return layout
  // A fresh page's words name the studio as it was then: read them with the last design's name.
  const studio =
    previous.pages.find((p) => p.kind === 'cover')?.data.studio ||
    layout.pages.find((p) => p.kind === 'cover')?.data.studio ||
    undefined
  return {
    ...layout,
    pages: layout.pages.map((p) => {
      if (!ABOUT_THE_STUDIO.includes(p.kind)) return p
      const mine = previous.pages.find((x) => x.kind === p.kind)
      if (!mine) return p
      const data = overStudioPage(p.data, mine.data, blankPage(p.kind, studio).data)
      // "For Priya" belongs to the last client, never the next one.
      if (p.kind === 'cover') data.subtitle = p.data.subtitle
      return { ...p, data }
    }),
  }
}
