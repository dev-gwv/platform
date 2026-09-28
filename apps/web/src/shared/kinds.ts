/**
 * What kind of thing a name is, so the screen can give it a picture: an album
 * looks like an album, a haldi like a haldi, a drone operator like a drone.
 * Studios type these a hundred ways ("Wedding Album 40 sheets", "Haldi &
 * Mehendi", "Candid photographer"), so each matches words, first match wins,
 * and falls back to a plain kind. Order matters: "Teaser film" is a reel-length
 * cut, "Photo album" an album, "Pre-wedding" is not the wedding.
 */
const firstMatch = <K extends string>(rules: ReadonlyArray<[K, RegExp]>, text: string | null | undefined, fallback: K): K => {
  const t = text ?? ''
  for (const [kind, re] of rules) if (re.test(t)) return kind
  return fallback
}

export type DeliverableKind = 'album' | 'reel' | 'film' | 'photos' | 'print' | 'data' | 'other'

const DELIVERABLE: ReadonlyArray<[DeliverableKind, RegExp]> = [
  ['album', /\b(album|photobook|photo book|coffee ?table)\b/i],
  ['reel', /\b(reels?|teaser|trailer|short|shorts|insta(gram)?|story|stories)\b/i],
  ['film', /\b(film|video|cinematic|highlights?|documentary|movie|footage edit)\b/i],
  ['print', /\b(prints?|frames?|canvas|calendar|invites?)\b/i],
  ['data', /\b(raw|data|drive|backup|sorting|archive|footage)\b/i],
  ['photos', /\b(photos?|pictures?|pics|images|edits?|edited|retouch(ed|ing)?|selects?)\b/i],
]

export const deliverableKind = (title: string | null | undefined): DeliverableKind => firstMatch(DELIVERABLE, title, 'other')

export type EventKind =
  | 'prewedding'
  | 'engagement'
  | 'haldi'
  | 'mehendi'
  | 'sangeet'
  | 'reception'
  | 'wedding'
  | 'baby'
  | 'birthday'
  | 'corporate'
  | 'portrait'
  | 'product'
  | 'other'

const EVENT: ReadonlyArray<[EventKind, RegExp]> = [
  ['prewedding', /\b(pre[- ]?wedding|pre[- ]?shoot|couple shoot|save the date)\b/i],
  ['engagement', /\b(engagement|ring ceremony|roka|sagai|tilak|mangni)\b/i],
  ['haldi', /\b(haldi|pithi|ubtan)\b/i],
  ['mehendi', /\b(mehe?ndi|henna)\b/i],
  ['sangeet', /\b(sangeet|cocktail|garba|dandiya|music night)\b/i],
  ['reception', /\b(reception|party|after ?party|celebration)\b/i],
  ['wedding', /\b(wedding|shaadi|pheras?|vivah|nikah|baraat|varmala|jaimala|marriage)\b/i],
  ['baby', /\b(maternity|baby|newborn|naming|kids?|cradle|annaprashan)\b/i],
  ['birthday', /\b(birthday|anniversary)\b/i],
  ['corporate', /\b(corporate|conference|event|launch|office|seminar)\b/i],
  ['portrait', /\b(portrait|portfolio|headshot|fashion|model)\b/i],
  ['product', /\b(product|catalogue|catalog|food|e-?commerce)\b/i],
]

export const eventKind = (name: string | null | undefined): EventKind => firstMatch(EVENT, name, 'other')

export type RoleKind = 'drone' | 'video' | 'photo' | 'album' | 'editor' | 'director' | 'assistant' | 'other'

const ROLE: ReadonlyArray<[RoleKind, RegExp]> = [
  ['drone', /\b(drone|aerial|fpv)\b/i],
  ['album', /\b(album)\b/i],
  ['director', /\b(director|creative|lead|head)\b/i],
  ['editor', /\b(editor|editing|colou?rist|retouch)/i],
  ['assistant', /\b(assistant|helper|intern|trainee|spot ?boy)\b/i],
  ['video', /\b(cinemat\w*|video\w*|film\w*|camera ?man|bts|reel)\b/i],
  ['photo', /\b(photo\w*|candid|traditional|shooter)\b/i],
]

export const roleKind = (name: string | null | undefined): RoleKind => firstMatch(ROLE, name, 'other')
