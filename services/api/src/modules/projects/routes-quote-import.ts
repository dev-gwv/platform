import { Hono } from 'hono'
import type { Context } from 'hono'
import { quotationImportState, quotationReading, quotationTasksResult, type QuotationTasksResult } from '@ipc/contracts'
import { internalLeadDaysForTitle, jobCoversCut, planQuotationTasks, type PlannedTask, type QuoteForms, type QuoteRole } from '@ipc/domain'
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
        if (done) return { tasks: [] }

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
        // The least busy person in the role, counting what this quotation
        // just gave them.
        const load = new Map(people.map((p) => [p.user_id, p.load]))
        const assignees = (t: PlannedTask): Person[] => {
          let pool = who[t.role]
          // Editors who split the work: only those whose role covers this
          // kind of video, else anyone who did not say (else all of them).
          if (t.cut) {
            const cut = t.cut
            const covers = pool.filter((p) => jobCoversCut(p.job, cut) === true)
            const open = pool.filter((p) => jobCoversCut(p.job, cut) === null)
            pool = covers.length ? covers : open.length ? open : pool
          }
          if (pool.length <= 1) return pool
          const free = [...pool].sort((a, b) => (load.get(a.user_id) ?? 0) - (load.get(b.user_id) ?? 0))[0]!
          load.set(free.user_id, (load.get(free.user_id) ?? 0) + 1)
          return [free]
        }

        const made: QuotationTasksResult['tasks'] = []
        for (const t of plan) {
          const team = assignees(t)
          const [row] = await sql<{ id: string }[]>`
            select create_task_with_assignees(
              p_project_id => ${id},
              p_deliverable_id => ${t.deliverableId},
              p_title => ${t.title.slice(0, 200)},
              p_status => 'to_do',
              p_priority => ${t.kind === 'data_copy' || t.kind === 'event_timeline' ? 'high' : 'medium'},
              p_due_date => ${t.due},
              p_assignees => ${team.map((p) => p.user_id)}::uuid[]
            ) as id`
          if (!row?.id) continue
          await sql`update tasks set tag = 'From quotation', description = ${t.description} where id = ${row.id}`
          made.push({ id: row.id, kind: t.kind, role: t.role, title: t.title, due_date: t.due, who: team.map((p) => p.name) })
        }
        return { tasks: made }
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

