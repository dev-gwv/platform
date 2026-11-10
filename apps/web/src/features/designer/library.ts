/**
 * The photo library (owner, 10 Nov): edited photos from the front of the
 * owner's Drive folder "DIAMOND MEMBERS PORTFOLIO PHOTOS", which any studio
 * may use freely in its designs. They ship with the app under
 * /designer/library (at most 1800 px, a 400 px thumb beside each), so they
 * are a list here, never rows in a studio's Uploads.
 */
export type LibraryMood = 'couple' | 'rituals' | 'candid' | 'portrait' | 'details'

export interface LibraryPhoto {
  id: string
  url: string
  thumb: string
  w: number
  h: number
  mood: LibraryMood
}

/** The chips over the library, in the studio's words. */
export const LIBRARY_MOODS: readonly { key: LibraryMood | 'all'; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'couple', label: 'Couples' },
  { key: 'rituals', label: 'Rituals' },
  { key: 'candid', label: 'Candid' },
  { key: 'portrait', label: 'Portraits' },
  { key: 'details', label: 'Details' },
]

const p = (id: string, mood: LibraryMood, w: number, h: number): LibraryPhoto => ({
  id,
  url: `/designer/library/${id}.jpg`,
  thumb: `/designer/library/thumbs/${id}.jpg`,
  w,
  h,
  mood,
})

export const LIBRARY: readonly LibraryPhoto[] = [
  p('01', 'couple', 1249, 1800),
  p('02', 'couple', 1260, 1800),
  p('03', 'couple', 1200, 1800),
  p('04', 'couple', 1800, 1200),
  p('05', 'couple', 1200, 1800),
  p('06', 'couple', 1800, 1200),
  p('07', 'couple', 1800, 1200),
  p('08', 'couple', 1168, 1800),
  p('09', 'couple', 1747, 1800),
  p('10', 'couple', 1800, 1200),
  p('11', 'couple', 1200, 1800),
  p('12', 'portrait', 1250, 1800),
  p('13', 'portrait', 1215, 1800),
  p('14', 'portrait', 1200, 1800),
  p('15', 'portrait', 1200, 1800),
  p('16', 'portrait', 1201, 1800),
  p('17', 'portrait', 1201, 1800),
  p('18', 'portrait', 1200, 1800),
  p('19', 'portrait', 1800, 1305),
  p('20', 'portrait', 1800, 1200),
  p('21', 'portrait', 1800, 1395),
  p('22', 'rituals', 1800, 1162),
  p('23', 'rituals', 1800, 1200),
  p('24', 'rituals', 1800, 1200),
  p('25', 'rituals', 1800, 1058),
  p('26', 'rituals', 1800, 1200),
  p('27', 'rituals', 1250, 1800),
  p('28', 'rituals', 1800, 1200),
  p('29', 'rituals', 1800, 1369),
  p('30', 'rituals', 1800, 1278),
  p('31', 'rituals', 1800, 1380),
  p('32', 'candid', 1298, 1800),
  p('33', 'candid', 1189, 1800),
  p('34', 'candid', 1800, 1311),
  p('35', 'candid', 1800, 1331),
  p('36', 'candid', 1800, 1279),
  p('37', 'candid', 1168, 1800),
  p('38', 'candid', 1200, 1800),
  p('39', 'candid', 1800, 1200),
  p('40', 'candid', 1800, 1200),
  p('41', 'details', 1200, 1800),
  p('42', 'details', 1800, 1200),
  p('43', 'details', 1800, 1205),
  p('44', 'details', 1800, 1200),
  p('45', 'details', 1800, 1200),
  p('46', 'details', 1800, 1094),
  p('47', 'details', 1200, 1800),
  p('48', 'details', 1200, 1800),
]

export const libraryFor = (mood: LibraryMood | 'all') =>
  mood === 'all' ? LIBRARY : LIBRARY.filter((x) => x.mood === mood)
