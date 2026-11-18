import { Hono } from 'hono'
import type { Context } from 'hono'
import { quotationImportState, quotationReading, quotationTasksResult, type QuotationTasksResult } from '@ipc/contracts'
import {
  addDays,
  bestQueueFor,
  dataCopyDay,
  editWords,
  internalLeadDaysForTitle,
  isQueuedWork,
  jobCoversCut,
  planQueue,
  planQuotationTasks,
  type PlannedTask,
  type QueueJob,
  type QuoteForms,
  type QuoteRole,
} from '@ipc/domain'
import type { AppEnv } from '../../context'
import { requireAction } from '../../middleware/permissions'
import { fail } from '../../middleware/errors'
import { uuidParam } from '../../lib/params'
import { withUser } from '../../lib/db'
import { attempt } from '../../lib/attempt'
import { audit } from '../../lib/audit'
import { todayInIndia } from '../../lib/dates'
import { QUOTE_MAX_BYTES, readQuotation } from '../../lib/quotation-reader'

/**
 * Upload a quotation, and the project makes itself (owner, 18 Nov; 0311).
 *
 * Projects → Upload quotation (only where `companies.quote_import` is on):
 *   1. POST /quotation/read reads the PDF or photo (`lib/quotation-reader.ts`);
 *   2. the app makes the client, project, days and deliverables through the
 *      same calls Create project uses, so the project is the same either way;
 *   3. POST /:id/quotation-tasks gives the team their tasks by role:
 *      each film or reel to the least busy video editor on the day editing
 *      must start, a data copy to the admin the day before, the e-invite form
 *      and the event timeline form to the manager (`planQuotationTasks`).
 */

async function switchedOn(c: Context<AppEnv>): Promise<{ on: boolean; forms: QuoteForms | null }> {
  const row = await attempt(c, 'projects.quote_import.state', () =>
    withUser(c.env, c.get('auth').userId, async (sql) => {
      const [r] = await sql<{ enabled: boolean; forms: QuoteForms | null }[]>`
        select coalesce(quote_import, false) as enabled, quote_import_forms as forms
          from companies where id = ${c.get('auth').companyId}`
      return r ?? null
    }),
  )
  return { on: !!row?.enabled, forms: row?.forms ?? null }
}

interface ExistingJob {
  id: string
  user_id: string
  is_task: boolean
  title: string
  project: string
  deliverable_id: string
  due_date: string | null
  deadline: string
  work: number
  last_shoot: string | null
  started: boolean
}

interface Person {
  user_id: string
  name: string
  role: string
  job: string
  load: number
}

const isVideoEditor = (p: Person) =>
  /video\s*edit|film\s*edit|reel\s*edit|cinematic\s*edit/i.test(p.job) || (/\beditor\b/i.test(p.job) && !/photo|album/i.test(p.job))
const isPhotoEditor = (p: Person) => /photo\s*edit|retouch|colou?r\s*(grad|correct)|photo\s*editor/i.test(p.job)
const isAlbumDesigner = (p: Person) => /album|print/i.test(p.job)
const isDesigner = (p: Person) => /graphic|design(er)?|invite|invitation/i.test(p.job) && !/album/i.test(p.job)

/**
 * Who does each kind of task, by job role (Team → Roles), owner's rule "by
 * role, no choice on screen". The makers (editors, designers) take turns by
 * load; the admin and the manager are one person each, falling back up the
 * studio. A role nobody holds leaves the task with nobody on it, said so on
 * screen, rather than handing it to the wrong person.
 */
export function pickPeople(people: Person[]): Record<QuoteRole, Person[]> {
  const by = (f: (p: Person) => boolean) => people.filter(f)
  const owners = by((p) => p.role === 'super_admin')
  const admins = by((p) => p.role === 'admin')
  const managers = by((p) => p.role === 'manager' || /project\s*manager|\bmanager\b/i.test(p.job))
  const adminJob = by((p) => /\badmin\b|data\s*(manager|handler|copy)|\bdit\b/i.test(p.job))
  return {
    video_editor: by(isVideoEditor),
    photo_editor: by(isPhotoEditor),
    // No album designer: the photo editor, who has the photos, does it.
    album_designer: by(isAlbumDesigner).length ? by(isAlbumDesigner) : by(isPhotoEditor),
    designer: by(isDesigner),
    admin: (adminJob.length ? adminJob : admins.length ? admins : owners).slice(0, 1),
    manager: (managers.length ? managers : admins.length ? admins : owners).slice(0, 1),
  }
}

export const quoteImportRoutes = new Hono<AppEnv>()
  .get('/quotation-import', requireAction('projects', 'create'), async (c) => {
    const { on } = await switchedOn(c)
    return c.json(quotationImportState.parse({ enabled: on }))
  })

  .post('/quotation/read', requireAction('projects', 'create'), async (c) => {
    const { on } = await switchedOn(c)
    if (!on) fail(404, 'Not found.')
    const body = await c.req.parseBody().catch(() => null)
    const file = body?.['file']
    if (!(file instanceof File)) fail(422, 'Please choose the quotation to upload.')
    if (file.size === 0) fail(422, 'That file is empty.')
    if (file.size > QUOTE_MAX_BYTES) fail(422, 'That file is larger than 20 MB. Export the PDF at a smaller size, or upload a photo.')
    const mime = (file.type || '').split(';')[0]!.trim().toLowerCase()
    const result = await readQuotation(c.env.ANTHROPIC_API_KEY, { mime, bytes: new Uint8Array(await file.arrayBuffer()) }, todayInIndia())
    if (!result.ok) fail(422, result.why)
    return c.json(quotationReading.parse(result.reading))
  })

  .post('/:id/quotation-tasks', requireAction('projects', 'create'), async (c) => {
    const id = uuidParam(c)
    const { on, forms } = await switchedOn(c)
    if (!on) fail(404, 'Not found.')
    const auth = c.get('auth')
    const today = todayInIndia()

    const out = await attempt(c, 'projects.quote_import.tasks', () =>
      withUser(c.env, auth.userId, async (sql): Promise<QuotationTasksResult | null> => {
        const [project] = await sql<{ id: string; client_name: string | null }[]>`
          select p.id, cl.name as client_name from projects p left join clients cl on cl.id = p.client_id
           where p.id = ${id}`
        if (!project) return null
        // Once per project: a second press must not hand everyone the work twice.
        const [done] = await sql`select 1 from tasks where project_id = ${id} and tag = 'From quotation' limit 1`
        if (done) return { tasks: [], moved: [] }

        const shoots = await sql<{ name: string; shoot_date: string | null }[]>`
          select name, shoot_date::text as shoot_date from shoots
           where project_id = ${id} and status <> 'cancelled'`
        const deliverables = await sql<{ id: string; title: string; due: string | null; work: number | null }[]>`
          select id, title, estimated_date::text as due, delivery_days_after_start as work
            from deliverables where project_id = ${id} order by created_at`
        // An editor's load: open edits, and open tasks with a date ahead.
        // The edit's editor stays on the task: giving the deliverable itself
        // would read as "Editing" now, months before the footage exists.
        const people = await sql<Person[]>`
          select u.user_id, u.name, u.role::text as role,
                 coalesce(string_agg(distinct er.type_name, ' / '), '') as job,
                 ((select count(*) from deliverables d
                    where d.assignee_id = u.user_id and d.status not in ('completed', 'cancelled'))
                + (select count(*) from task_assignees ta join tasks t on t.id = ta.task_id
                    where ta.user_id = u.user_id and t.status not in ('completed', 'cancelled')
                      and t.tag = 'From quotation'))::int as load
            from users u
            left join employee_role_assignments era on era.user_id = u.user_id
            left join employee_roles er on er.id = era.role_id
           where u.company_id = ${auth.companyId} and u.deleted_at is null and u.status = 'active'
           group by u.user_id, u.name, u.role`

        const plan = planQuotationTasks({
          today,
          shoots,
          clientName: project.client_name,
          forms,
          deliverables: deliverables.map((d) => ({
            id: d.id,
            title: d.title,
            due: d.due,
            workDays: d.work ?? internalLeadDaysForTitle(d.title),
          })),
        })
        const who = pickPeople(people)
        const load = new Map(people.map((p) => [p.user_id, p.load]))
        const dated = shoots.map((s) => s.shoot_date).filter((d): d is string => !!d)
        const lastShoot = dated.length ? dated.reduce((a, b) => (b > a ? b : a)) : null

        // Every maker's queue across the studio's other projects: the tasks an
        // upload gave them that are not done, and work given to them by hand
        // (Give work, which means they have started it). Owner, 18 Nov: a
        // quotation uploaded later whose wedding is earlier goes first.
        const existing = await sql<ExistingJob[]>`
          select t.id, ta.user_id, true as is_task, t.title, p.name as project, t.deliverable_id,
                 t.due_date::text as due_date, d.estimated_date::text as deadline,
                 coalesce(d.delivery_days_after_start, 7)::int as work,
                 (select max(s.shoot_date)::text from shoots s
                   where s.project_id = t.project_id and s.status <> 'cancelled') as last_shoot,
                 (t.status <> 'to_do') as started
            from tasks t
            join task_assignees ta on ta.task_id = t.id
            join deliverables d on d.id = t.deliverable_id
            join projects p on p.id = t.project_id
           where t.company_id = ${auth.companyId} and t.tag = 'From quotation'
             and t.title not like 'Data copy%' and t.status not in ('completed', 'cancelled')
             and d.estimated_date is not null and t.project_id <> ${id}
          union all
          select d.id, d.assignee_id, false, d.title, p.name, d.id, null, d.estimated_date::text,
                 coalesce(d.delivery_days_after_start, 7)::int, null, true
            from deliverables d join projects p on p.id = d.project_id
           where d.company_id = ${auth.companyId} and d.assignee_id is not null
             and d.status not in ('completed', 'cancelled') and d.estimated_date is not null
             and not exists (select 1 from tasks t where t.deliverable_id = d.id and t.tag = 'From quotation')`
        const queues = new Map<string, QueueJob[]>()
        const queueOf = (u: string) => queues.get(u) ?? (queues.set(u, []), queues.get(u)!)
        const known = new Map(existing.map((e) => [e.id, e]))
        for (const e of existing) {
          // Only work that holds its maker for days queues (not designs, the
          // gallery or frames).
          if (!isQueuedWork(e.title.replace(/^(Edit|Design|Prepare|Set up) /, ''))) continue
          queueOf(e.user_id).push({
            id: e.id,
            due: e.deadline,
            workDays: e.work,
            earliest: e.last_shoot ? addDays(e.last_shoot, 1) : today,
            started: e.started,
          })
        }

        // Who does each piece: for work made from the footage, the one in the
        // role who can finish it on time with least delay to everything else
        // they have (`bestQueueFor`), earliest promise first; for the rest,
        // the least busy in the role, counting what this quotation gave them.
        const poolFor = (t: PlannedTask): Person[] => {
          let pool = who[t.role]
          if (t.cut) {
            const cut = t.cut
            const covers = pool.filter((p) => jobCoversCut(p.job, cut) === true)
            const open = pool.filter((p) => jobCoversCut(p.job, cut) === null)
            pool = covers.length ? covers : open.length ? open : pool
          }
          return pool
        }
        const leastBusy = (pool: Person[]): Person[] => {
          if (pool.length === 0) return pool
          const free = [...pool].sort((a, b) => (load.get(a.user_id) ?? 0) - (load.get(b.user_id) ?? 0))[0]!
          load.set(free.user_id, (load.get(free.user_id) ?? 0) + 1)
          return [free]
        }
        const given = new Map<PlannedTask, Person[]>()
        const queued = plan
          .filter((t) => t.kind === 'edit' && t.deadline && t.deliverableId)
          .sort((a, b) => a.deadline!.localeCompare(b.deadline!))
        for (const t of queued) {
          const pool = poolFor(t)
          if (pool.length === 0) {
            given.set(t, [])
            continue
          }
          const job: QueueJob = { id: `new:${t.deliverableId}`, due: t.deadline!, workDays: t.workDays ?? 7, earliest: t.earliest ?? today }
          const pick = bestQueueFor(job, new Map(pool.map((p) => [p.user_id, queues.get(p.user_id) ?? []])), today) ?? pool[0]!.user_id
          queueOf(pick).push(job)
          load.set(pick, (load.get(pick) ?? 0) + 1)
          given.set(t, pool.filter((p) => p.user_id === pick))
        }

        // Plan each touched queue: the new work's start, and anything already
        // given that has to wait behind an earlier promise.
        const startOf = new Map<string, { start: string; late: number }>()
        const moved: QuotationTasksResult['moved'] = []
        for (const [userId, queue] of queues) {
          if (!queue.some((j) => j.id.startsWith('new:'))) continue
          for (const placed of planQueue(queue, today)) {
            if (placed.id.startsWith('new:')) {
              startOf.set(placed.id.slice(4), { start: placed.start, late: placed.lateDays })
              continue
            }
            const e = known.get(placed.id)
            if (!e?.is_task || e.started || e.due_date === placed.start) continue
            await sql`
              update tasks set due_date = ${placed.start},
                     priority = ${placed.lateDays > 0 ? 'urgent' : 'medium'},
                     description = ${editWords(placed.start, e.deadline, true)}
               where id = ${e.id}`
            await sql`
              update tasks set due_date = ${dataCopyDay(placed.start, e.last_shoot, today)}
               where deliverable_id = ${e.deliverable_id} and tag = 'From quotation'
                 and title like 'Data copy%' and status = 'to_do'`
            moved.push({
              title: e.title,
              project: e.project,
              who: people.find((p) => p.user_id === userId)?.name ?? '',
              from: e.due_date,
              to: placed.start,
              late_days: placed.lateDays,
            })
          }
        }

        const made: QuotationTasksResult['tasks'] = []
        // Designs last, so whoever shares them is weighed with all their other work here.
        for (const t of [...plan.filter((t) => t.role !== 'designer'), ...plan.filter((t) => t.role === 'designer')]) {
          const placed = t.deliverableId ? startOf.get(t.deliverableId) : undefined
          let due = t.due
          let description = t.description
          if (placed && t.kind === 'edit') {
            due = placed.start
            description = editWords(placed.start, t.deadline ?? null, true)
          } else if (placed && t.kind === 'data_copy') {
            due = dataCopyDay(placed.start, lastShoot, today)
          }
          const late = t.kind === 'edit' ? (placed?.late ?? 0) : 0
          const team = given.get(t) ?? leastBusy(poolFor(t))
          const [row] = await sql<{ id: string }[]>`
            select create_task_with_assignees(
              p_project_id => ${id},
              p_deliverable_id => ${t.deliverableId},
              p_title => ${t.title.slice(0, 200)},
              p_status => 'to_do',
              p_priority => ${late > 0 ? 'urgent' : t.kind === 'data_copy' || t.kind === 'event_timeline' ? 'high' : 'medium'},
              p_due_date => ${due},
              p_assignees => ${team.map((p) => p.user_id)}::uuid[]
            ) as id`
          if (!row?.id) continue
          await sql`update tasks set tag = 'From quotation', description = ${description} where id = ${row.id}`
          made.push({ id: row.id, kind: t.kind, role: t.role, title: t.title, due_date: due, who: team.map((p) => p.name), late_days: late })
        }
        return { tasks: made, moved }
      }),
    )
    if (out === null) fail(404, 'That project was not found.')
    if (!out) fail(400, 'The tasks could not be given out.')
    await audit(c, {
      action: 'project.quotation_tasks',
      entityType: 'project',
      entityId: id,
      after: { tasks: out.tasks.length },
    })
    return c.json(quotationTasksResult.parse(out))
  })

