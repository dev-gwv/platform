import { addDays } from './projects'

/**
 * One person's queue of work, across every project (owner, 18 Nov): "suppose
 * the salesperson uploads a quotation for the 28 December wedding, and 7 days
 * later one for 20 December. It was uploaded late, but their deliverable goes
 * first."
 *
 * An editor does one thing at a time. Each piece of work needs `workDays`, may
 * not start before its footage exists (`earliest`) and is promised by `due`.
 * The queue is planned as late as each promise allows (so nobody starts a
 * film months early), then pushed forward where two pieces would overlap or
 * one would start in the past -- which puts the earlier promise first,
 * whichever quotation came in first. Work already started stays where it is.
 *
 * Pure: the server reads the queues and writes back the dates that moved.
 */

export interface QueueJob {
  id: string
  /** The date it is promised by. */
  due: string
  workDays: number
  /** Not before this day (the day after its last event). */
  earliest: string
  /** Already being worked on: it stays first, from today. */
  started?: boolean
}

export interface PlacedJob {
  id: string
  start: string
  /** The last day of work (a 7-day edit started on the 1st ends on the 7th). */
  end: string
  /** Days past its promise, 0 when on time. */
  lateDays: number
}

const DAY = 86_400_000
const toMs = (iso: string) => Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)))
export const daysBetween = (from: string, to: string) => Math.round((toMs(to) - toMs(from)) / DAY)
const latest = (...d: string[]) => d.reduce((a, b) => (b > a ? b : a))

export function planQueue(jobs: ReadonlyArray<QueueJob>, today: string): PlacedJob[] {
  const work = (j: QueueJob) => Math.max(1, Math.round(j.workDays))
  // Backwards from the promises: the latest one ends on its date, each
  // earlier one ends by its own date and the day before the next one starts.
  const planned = new Map<string, string>()
  let nextStart: string | null = null
  for (const j of [...jobs].filter((j) => !j.started).sort((a, b) => b.due.localeCompare(a.due) || b.id.localeCompare(a.id))) {
    const dayBefore: string | null = nextStart ? addDays(nextStart, -1) : null
    const finish: string = dayBefore && dayBefore < j.due ? dayBefore : j.due
    const start = addDays(finish, -(work(j) - 1))
    planned.set(j.id, start)
    nextStart = start
  }
  // Forwards: started work first, then by planned start (earlier promise
  // first on a tie); nothing before today, its footage, or the last job's end.
  const order = [
    ...jobs.filter((j) => j.started).sort((a, b) => a.due.localeCompare(b.due)),
    ...jobs.filter((j) => !j.started).sort((a, b) => planned.get(a.id)!.localeCompare(planned.get(b.id)!) || a.due.localeCompare(b.due)),
  ]
  let free = today
  const out: PlacedJob[] = []
  for (const j of order) {
    const start = j.started ? free : latest(planned.get(j.id)!, free, j.earliest, today)
    const end = addDays(start, work(j) - 1)
    free = addDays(end, 1)
    out.push({ id: j.id, start, end, lateDays: Math.max(0, daysBetween(j.due, end)) })
  }
  return out
}

/** Total days late across a queue: what a new piece of work must not add to. */
export const queueLateness = (placed: ReadonlyArray<PlacedJob>) => placed.reduce((n, p) => n + p.lateDays, 0)

/**
 * Which of several people should take a new piece of work: the one whose
 * queue it makes least late, then the one who can start it closest to when
 * it should start, then the one with least on their plate.
 */
export function bestQueueFor<P extends string>(
  job: QueueJob,
  queues: ReadonlyMap<P, ReadonlyArray<QueueJob>>,
  today: string,
): P | null {
  let best: { who: P; cost: [number, number, number] } | null = null
  for (const [who, queue] of queues) {
    const before = queueLateness(planQueue(queue, today))
    const after = planQueue([...queue, job], today)
    const mine = after.find((p) => p.id === job.id)!
    const cost: [number, number, number] = [
      queueLateness(after) - before,
      Math.max(0, daysBetween(latest(addDays(job.due, -(Math.max(1, Math.round(job.workDays)) - 1)), job.earliest, today), mine.start)),
      queue.length,
    ]
    if (!best || cost[0] < best.cost[0] || (cost[0] === best.cost[0] && (cost[1] < best.cost[1] || (cost[1] === best.cost[1] && cost[2] < best.cost[2])))) {
      best = { who, cost }
    }
  }
  return best?.who ?? null
}

/** The data copy for a piece of work: the day before it starts, never before today or the last event. */
export const dataCopyDay = (start: string, lastShoot: string | null, today: string) =>
  latest(addDays(start, -1), lastShoot ?? today, today)
