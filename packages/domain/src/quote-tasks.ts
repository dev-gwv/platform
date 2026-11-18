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

export type QuoteWork = 'video' | 'e_invite' | 'none'

/** What kind of work a deliverable's title is, for the tasks it brings. */
export function quoteWorkOf(title: string): QuoteWork {
  const t = title.toLowerCase()
  if (/\be[\s-]?invite|invitation\b/.test(t)) return 'e_invite'
  if (/\b(film|films|reels?|video|teaser|trailer|highlights?|cinematic|cinematography|monologue|same[\s-]?day edit)\b/.test(t)) return 'video'
  return 'none'
}

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
    if (quoteWorkOf(d.title) !== 'video') continue
    const start = d.due ? later(floor, addDays(d.due, -Math.max(0, d.workDays))) : lastShoot ? floor : null
    tasks.push({
      kind: 'edit',
      title: `Edit ${d.title}`,
      due: start,
      deliverableId: d.id,
      description: [
        start ? `Start editing on ${quoteDay(start)}.` : 'Start once the event dates are set.',
        d.due ? `It is promised to the client by ${quoteDay(d.due)}.` : null,
        start ? 'The admin copies the data the day before, so it is ready for you.' : null,
      ]
        .filter(Boolean)
        .join(' '),
    })
    if (start) {
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
      title: `Data copy for ${listTitles(titles)}`,
      due: on,
      deliverableId: null,
      description: `Copy the footage onto the editor's drive today. Editing starts the next day: ${listTitles(titles)}.`,
    })
  }

  if (input.deliverables.some((d) => quoteWorkOf(d.title) === 'e_invite')) {
    const f = input.forms?.e_invite
    tasks.push({
      kind: 'e_invite',
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
