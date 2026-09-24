/**
 * What kind of thing a deliverable is, read from its title, so each card can
 * wear the right icon: an album looks like an album, a film like a film.
 *
 * Studios name these a hundred ways ("Wedding Album 40 sheets", "Cinematic
 * Film", "Insta reel x3"), so this matches words, first match wins, and falls
 * back to a plain package. Order matters: "Teaser film" is a reel-length cut,
 * not the full film, and "Photo album" is an album, not loose photos.
 */
export type DeliverableKind = 'album' | 'reel' | 'film' | 'photos' | 'print' | 'data' | 'other'

const RULES: ReadonlyArray<[DeliverableKind, RegExp]> = [
  ['album', /\b(album|photobook|photo book|coffee ?table)\b/i],
  ['reel', /\b(reels?|teaser|trailer|short|shorts|insta(gram)?|story|stories)\b/i],
  ['film', /\b(film|video|cinematic|highlights?|documentary|movie|footage edit)\b/i],
  ['print', /\b(prints?|frames?|canvas|calendar|invites?)\b/i],
  ['data', /\b(raw|data|drive|backup|sorting|archive|footage)\b/i],
  ['photos', /\b(photos?|pictures?|pics|images|edits?|edited|retouch(ed|ing)?|selects?)\b/i],
]

export function deliverableKind(title: string): DeliverableKind {
  for (const [kind, re] of RULES) if (re.test(title)) return kind
  return 'other'
}
