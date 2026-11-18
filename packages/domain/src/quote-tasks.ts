import { addDays, findWeddingShoot, type NamedShootDate } from './projects'

/**
 * The team's tasks from an uploaded quotation (owner, 18 Nov; 0311).
 *
 * "Suppose you are asking any video editor to edit the film today. The data
 * copy should happen one day before." So each film or reel gets an edit task
 * on the day editing must start -- its promised date less the days of work it
 * needs -- and the admin gets a data copy the day before. An e-invite on the
 * quotation is the manager's form to send in the client's group, and the event
 * timeline form goes 8 days before the wedding ("she'll start sending the form
 * 7 or 8 days before").
 *
 * Pure: the server reads the project and the people, this says what to give.
 */

/**
 * The kind of work a deliverable is, which says who makes it (owner, 18 Nov:
 * "for all of them, photos, videos, save-the-dates, and everything").
 */
export type QuoteWork = 'video' | 'photo' | 'album' | 'design' | 'gallery' | 'print' | 'other'

/** Who makes each kind of work, by job role. */
export type QuoteRole = 'video_editor' | 'photo_editor' | 'album_designer' | 'designer' | 'admin' | 'manager'
export const WORK_ROLE: Record<QuoteWork, QuoteRole> = {
  video: 'video_editor',
  photo: 'photo_editor',
  gallery: 'photo_editor',
  album: 'album_designer',
  print: 'album_designer',
  design: 'designer',
  other: 'manager',
}

const VIDEO = /\b(film|films|reels?|video|videos|teaser|trailer|highlights?|cinematic|cinematography|monologue|same[\s-]?day edit)\b/
const DESIGN = /\be[\s-]?invites?\b|\binvitations?\b|save[\s-]?the[\s-]?dates?\b|\bcards?\b|\bwebsite\b|\bcaricature/

/** What kind of work a deliverable's title is, for the task it brings. */
export function quoteWorkOf(title: string): QuoteWork {
  const t = title.toLowerCase()
  // The studio's designers make countdowns, video or not (owner, 18 Nov).
  if (/count[\s-]?downs?/.test(t)) return 'design'
  // "Save the date video" is a video; "Save the date" alone is a design.
  if (VIDEO.test(t) && !/\be[\s-]?invite/.test(t)) return 'video'
  if (DESIGN.test(t)) return 'design'
  if (/\balbums?\b|photo\s*book|coffee[\s-]?table/.test(t)) return 'album'
  if (/\bframes?\b|\bprints?\b|\bcanvas\b|calendar/.test(t)) return 'print'
  if (/\bgallery\b|\bqr\b/.test(t)) return 'gallery'
  if (/\bphoto|\bpictures?\b|\bpics?\b|\bportraits?\b|\bimages?\b|\bstills?\b/.test(t)) return 'photo'
  return 'other'
}

/**
 * Which kind of video, for studios whose editors split the work (owner,
 * 18 Nov: Usman and Aman edit teasers, films and reels; Rayeen full-length
 * films and reels): a full-length film, a reel, or a short film (highlight,
 * teaser, trailer, save-the-date video).
 */
export type VideoCut = 'full' | 'reel' | 'short'
export function videoCutOf(title: string): VideoCut {
  const t = title.toLowerCase()
  if (/full[\s-]*length|full\s*(film|video|ceremony|wedding)|traditional\s*(film|video)|documentary|long\s*(film|video)/.test(t)) return 'full'
  if (/\breels?\b|instagram|short\s*video|\bstory\b|stories/.test(t)) return 'reel'
  return 'short'
}

/** Does a person's job role cover this kind of video? Null: they did not say, so any. */
export function jobCoversCut(job: string, cut: VideoCut): boolean | null {
  const j = job.toLowerCase()
  const full = /full[\s-]*length|full\s*film|long\s*(film|video)|traditional|documentary/.test(j)
  const reel = /\breels?\b/.test(j)
  const short = /teaser|highlight|trailer|cinematic/.test(j) || (/\bfilms?\b/.test(j) && !full)
  if (!full && !reel && !short) return null
  return cut === 'full' ? full : cut === 'reel' ? reel : short
}

/** Is this an e-invite, which also brings the manager's form task. */
export const isEInvite = (title: string) => /\be[\s-]?invites?\b|\binvitations?\b/i.test(title)

/** The verb a task starts with, by the kind of work. */
function taskTitle(work: QuoteWork, title: string): string {
  if (work === 'video') return `Edit ${title}`
  if (work === 'photo') return /\bun[\s-]?edited|\braw\b/i.test(title) ? `Prepare ${title}` : `Edit ${title}`
  if (work === 'album' || work === 'design') return `Design ${title}`
  if (work === 'gallery') return `Set up ${title}`
  return `Prepare ${title}`
}

/** Work that needs the footage or photos copied first. */
const NEEDS_DATA = new Set<QuoteWork>(['video', 'photo', 'album', 'gallery', 'print'])

export interface QuoteForm {
  form: string
  reference?: string
  message: string
}
export interface QuoteForms {
  e_invite?: QuoteForm
  event_timeline?: QuoteForm
}

export interface PlanDeliverable {
  id: string
  title: string
  /** The promised date (deliverables.estimated_date), when known. */
  due: string | null
  /** Days of editing it needs before that date. */
  workDays: number
}

export interface PlannedTask {
  kind: 'edit' | 'data_copy' | 'e_invite' | 'event_timeline'
  /** Who it goes to, by job role. */
  role: QuoteRole
  /** For a video, which kind, so a studio's editors can split the work. */
  cut?: VideoCut
  title: string
  due: string | null
  description: string
  /** The deliverable an edit is for (data copies name theirs in the title). */
  deliverableId: string | null
}

const later = (a: string, b: string) => (a > b ? a : b)

/** "21 Feb" for a task's words. */
export function quoteDay(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(Date.UTC(y!, m! - 1, d!)).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' })
}

/** A form's message with its links put in. */
export function fillFormMessage(f: QuoteForm): string {
  const msg = f.message.replaceAll('{form}', f.form).replaceAll('{reference}', f.reference ?? '')
  // A message written without the placeholders still carries the link.
  return msg.includes(f.form) ? msg : `${msg}\n\n${f.form}`
}

const listTitles = (titles: string[]) =>
  titles.length <= 2 ? titles.join(' and ') : `${titles.slice(0, -1).join(', ')} and ${titles[titles.length - 1]}`

export function planQuotationTasks(input: {
  deliverables: ReadonlyArray<PlanDeliverable>
  shoots: ReadonlyArray<NamedShootDate>
  today: string
  clientName?: string | null
  forms?: QuoteForms | null
}): PlannedTask[] {
  const { today } = input
  const dated = input.shoots.map((s) => s.shoot_date).filter((d): d is string => !!d)
  const lastShoot = dated.length ? dated.reduce(later) : null
  // Editing starts once the footage exists: the day after the last event.
  const floor = later(today, lastShoot ? addDays(lastShoot, 1) : today)
  const group = input.clientName?.trim() ? `${input.clientName.trim()}'s WhatsApp group` : "the client's WhatsApp group"
  const tasks: PlannedTask[] = []

  const copies = new Map<string, string[]>()
  for (const d of input.deliverables) {
    const work = quoteWorkOf(d.title)
    const needsData = NEEDS_DATA.has(work)
    // Designs (an e-invite, a save-the-date) are made before the wedding,
    // from the client's details, so they start now; everything else once
    // the events are shot.
    const start = !needsData
      ? today
      : d.due
        ? later(floor, addDays(d.due, -Math.max(0, d.workDays)))
        : lastShoot
          ? floor
          : null
    tasks.push({
      kind: 'edit',
      role: WORK_ROLE[work],
      ...(work === 'video' ? { cut: videoCutOf(d.title) } : {}),
      title: taskTitle(work, d.title),
      due: start,
      deliverableId: d.id,
      description: [
        start ? `Start on ${quoteDay(start)}.` : 'Start once the event dates are set.',
        d.due ? `It is promised to the client by ${quoteDay(d.due)}.` : null,
        start && needsData ? 'The admin copies the data the day before, so it is ready for you.' : null,
      ]
        .filter(Boolean)
        .join(' '),
    })
    if (start && needsData) {
      // The day before, but never before today or before the footage is shot.
      const copyOn = later(later(today, lastShoot ?? today), addDays(start, -1))
      const list = copies.get(copyOn) ?? []
      list.push(d.title)
      copies.set(copyOn, list)
    }
  }
  for (const [on, titles] of [...copies.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    tasks.push({
      kind: 'data_copy',
      role: 'admin',
      title: `Data copy for ${listTitles(titles)}`,
      due: on,
      deliverableId: null,
      description: `Copy the footage and photos onto the editors' drives today. Work starts the next day: ${listTitles(titles)}.`,
    })
  }

  if (input.deliverables.some((d) => isEInvite(d.title))) {
    const f = input.forms?.e_invite
    tasks.push({
      kind: 'e_invite',
      role: 'manager',
      title: `Send the e-invite form in ${group}`,
      due: today,
      deliverableId: null,
      description: f
        ? `Send this in ${group}:\n\n${fillFormMessage(f)}`
        : `Send the e-invite details form in ${group}, so the invitation can be designed.`,
    })
  }

  const wedding = findWeddingShoot(input.shoots)?.shoot_date ?? lastShoot
  if (wedding && wedding >= today) {
    const f = input.forms?.event_timeline
    tasks.push({
      kind: 'event_timeline',
      role: 'manager',
      title: `Send the event timeline form in ${group}`,
      due: later(today, addDays(wedding, -8)),
      deliverableId: null,
      description: [
        `The wedding is on ${quoteDay(wedding)}: the locations and timings are needed 7 days before.`,
        f ? `Send this in ${group}:\n\n${fillFormMessage(f)}` : `Send the event timeline form in ${group}.`,
      ].join('\n\n'),
    })
  }
  return tasks
}
