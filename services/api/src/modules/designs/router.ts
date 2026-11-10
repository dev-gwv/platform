import { Hono, type Context } from 'hono'
import {
  createDesignRequest,
  designCreated,
  designDeleted,
  designDetail,
  designLink,
  designSaved,
  designSummary,
  designWriteReply,
  designWriteRequest,
  publicDesign,
  addDesignPhotoRequest,
  designLibraryPhoto,
  updateDesignRequest,
  captionReply,
  captionRequest,
  type DesignDoc,
} from '@ipc/contracts'
import type { AppEnv } from '../../context'
import { requireAuth } from '../../middleware/auth'
import { requireAction } from '../../middleware/permissions'
import { fail } from '../../middleware/errors'
import { uuidParam } from '../../lib/params'
import { withUser } from '../../lib/db'
import { attempt } from '../../lib/attempt'
import { audit } from '../../lib/audit'
import { requireStudioWork } from '../../lib/scope'
import { withService } from '../../lib/db'
import { newRawToken, verifyToken } from '../../lib/auth-token'
import { cleanDesignWriting, designWriterMessages } from '../../lib/design-writer'
import { writeWithAi } from '../../lib/ai-write'
import { captionMessages, parseCaptions } from '../../lib/caption-writer'

/**
 * Quotation Designer (0295): the studio's premium quotation designs, each a
 * JSON document of pages made from a project and edited in place. Starter
 * makes 30 a plan year (enforce_plan_limit -> 54000 -> 402 by attempt()).
 */

const iso = (col: string) => `to_char(${col} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')`

interface Row {
  is_template: boolean
  id: string
  title: string
  template: string
  project_id: string | null
  project_name: string | null
  doc: DesignDoc
  created_at: string
  updated_at: string
}

/** The first photo with a picture on the first page shown: the card's thumbnail. */
function coverOf(doc: DesignDoc | null | undefined): string | null {
  const page = doc?.pages?.find((p) => !p.hidden)
  const url = page?.data?.photo?.url || page?.data?.photos?.find((p) => p.url)?.url
  return url || null
}

const summary = (r: Row) =>
  designSummary.parse({
    id: r.id,
    title: r.title,
    template: r.template,
    project_id: r.project_id,
    project_name: r.project_name,
    cover_url: coverOf(r.doc),
    pages: r.doc?.pages?.length ?? 0,
    is_template: r.is_template,
    created_at: r.created_at,
    updated_at: r.updated_at,
  })

const SELECT = `d.id, d.is_template, d.title, d.template, d.project_id, p.name as project_name, d.doc,
  ${iso('d.created_at')} as created_at, ${iso('d.updated_at')} as updated_at`

export const designsRouter = new Hono<AppEnv>()
  .use('*', requireAuth)
  .use('*', requireStudioWork)

  /**
   * "Write it for me": one part of a design in the studio's chosen tone,
   * through the assistant's own engine and budget (lib/ai.ts). Counted in
   * the studio's daily AI allowance like a question to the assistant.
   */
  .post('/write', requireAction('projects', 'edit'), async (c) => {
    const parsed = designWriteRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Please check what to write.')
    const text = await writeWithAi(c, {
      kind: `designer:${parsed.data.kind}`,
      messages: designWriterMessages(parsed.data),
      maxTokens: 700,
      temperature: 0.7,
    })
    const out = cleanDesignWriting(parsed.data.kind, text)
    if (!out.text && out.lines.length === 0) fail(503, 'The AI came back empty. Try again.')
    return c.json(designWriteReply.parse(out))
  })

  /**
   * Social media captions (owner, 10 Nov): three captions for one post, on
   * the same engine, allowance and log as every AI writer.
   */
  .post('/captions', requireAction('projects', 'view'), async (c) => {
    const parsed = captionRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Please say what the post is about.')
    if (parsed.data.kind === 'custom' && !parsed.data.details) fail(422, 'Say what the post is about.')
    const text = await writeWithAi(c, {
      kind: `captions:${parsed.data.kind}`,
      messages: captionMessages(parsed.data),
      maxTokens: 900,
      temperature: 0.85,
    })
    const captions = parseCaptions(text)
    if (captions.length === 0) fail(503, 'The AI came back empty. Try again.')
    return c.json(captionReply.parse({ captions }))
  })

  /** The studio's photo library: every photo put into a design, newest first. */
  .get('/photos', requireAction('projects', 'view'), async (c) => {
    const rows = await attempt(c, 'designs.photos', () =>
      withUser(c.env, c.get('auth').userId, (sql) => sql`
        select id, url, name, width, height, size_bytes, ${sql.unsafe(iso('created_at'))} as created_at
          from design_photos order by created_at desc limit 500`),
    )
    if (!rows) fail(400, 'We could not load your photos.')
    return c.json(designLibraryPhoto.array().parse(rows))
  })

  .post('/photos', requireAction('projects', 'edit'), async (c) => {
    const parsed = addDesignPhotoRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Please check the photo.')
    const v = parsed.data
    const rows = await attempt(c, 'designs.photo_add', () =>
      withUser(c.env, c.get('auth').userId, (sql) => sql`
        insert into design_photos (url, name, width, height, size_bytes)
        values (${v.url}, ${v.name}, ${v.width ?? null}, ${v.height ?? null}, ${v.size_bytes ?? null})
        returning id, url, name, width, height, size_bytes, ${sql.unsafe(iso('created_at'))} as created_at`),
    )
    if (!rows?.[0]) fail(400, 'We could not keep this photo.')
    return c.json(designLibraryPhoto.parse(rows[0]), 201)
  })

  /** Out of the library only: a design that shows it keeps it. */
  .delete('/photos/:id', requireAction('projects', 'edit'), async (c) => {
    const id = uuidParam(c)
    const rows = await attempt(c, 'designs.photo_remove', () =>
      withUser(c.env, c.get('auth').userId, (sql) => sql`delete from design_photos where id = ${id} returning id`),
    )
    if (!rows?.[0]) fail(404, 'This photo is not here any more.')
    return c.json(designDeleted.parse({ ok: true }))
  })

  .get('/', requireAction('projects', 'view'), async (c) => {
    const projectId = c.req.query('project_id') || null
    const templates = c.req.query('templates') === '1'
    const rows = await attempt(c, 'designs.list', () =>
      withUser(c.env, c.get('auth').userId, (sql) => sql<Row[]>`
        select ${sql.unsafe(SELECT)}
          from quotation_designs d
          left join projects p on p.id = d.project_id
         where (${projectId}::uuid is null or d.project_id = ${projectId}::uuid)
           and d.is_template = ${templates}
         order by d.updated_at desc
         limit 300`),
    )
    if (!rows) fail(400, 'We could not load the designs.')
    return c.json(rows.map(summary))
  })

  .get('/:id', requireAction('projects', 'view'), async (c) => {
    const id = uuidParam(c)
    const rows = await attempt(c, 'designs.get', () =>
      withUser(c.env, c.get('auth').userId, (sql) => sql<Row[]>`
        select ${sql.unsafe(SELECT)}
          from quotation_designs d
          left join projects p on p.id = d.project_id
         where d.id = ${id}`),
    )
    const r = rows?.[0]
    if (!r) fail(404, 'This design is not here any more.')
    return c.json(designDetail.parse({ ...summary(r), doc: r.doc }))
  })

  .post('/', requireAction('projects', 'edit'), async (c) => {
    const parsed = createDesignRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Please check the design.')
    const v = parsed.data
    const rows = await attempt(c, 'designs.create', () =>
      withUser(c.env, c.get('auth').userId, (sql) => sql<{ id: string }[]>`
        insert into quotation_designs (title, template, project_id, doc, is_template)
        values (${v.title}, ${v.template}, ${v.is_template ? null : (v.project_id ?? null)}, ${sql.json(v.doc as never)}, ${v.is_template ?? false})
        returning id`),
    )
    const id = rows?.[0]?.id
    if (!id) fail(400, 'We could not make this design.')
    await audit(c, { action: v.is_template ? 'design.save_template' : 'design.create', entityType: 'quotation_design', entityId: id, after: { title: v.title, template: v.template, project_id: v.project_id ?? null } })
    return c.json(designCreated.parse({ id }), 201)
  })

  /** Autosave: whatever changed, the document whole. */
  .patch('/:id', requireAction('projects', 'edit'), async (c) => {
    const id = uuidParam(c)
    const parsed = updateDesignRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Please check the design.')
    const v = parsed.data
    const rows = await attempt(c, 'designs.update', () =>
      withUser(c.env, c.get('auth').userId, (sql) => sql<{ updated_at: string }[]>`
        update quotation_designs set
          title = coalesce(${v.title ?? null}, title),
          template = coalesce(${v.template ?? null}, template),
          project_id = case when ${v.project_id !== undefined} then ${v.project_id ?? null}::uuid else project_id end,
          doc = coalesce(${v.doc ? sql.json(v.doc as never) : null}::jsonb, doc)
         where id = ${id}
        returning ${sql.unsafe(iso('updated_at'))} as updated_at`),
    )
    const r = rows?.[0]
    if (!r) fail(404, 'This design is not here any more.')
    return c.json(designSaved.parse({ ok: true, updated_at: r.updated_at }))
  })

  .post('/:id/duplicate', requireAction('projects', 'edit'), async (c) => {
    const id = uuidParam(c)
    const rows = await attempt(c, 'designs.duplicate', () =>
      withUser(c.env, c.get('auth').userId, (sql) => sql<{ id: string }[]>`
        insert into quotation_designs (title, template, project_id, doc, is_template)
        select left(title || ' (copy)', 160), template, project_id, doc, is_template from quotation_designs where id = ${id}
        returning id`),
    )
    const copy = rows?.[0]?.id
    if (!copy) fail(404, 'This design is not here any more.')
    await audit(c, { action: 'design.duplicate', entityType: 'quotation_design', entityId: copy, before: { from: id } })
    return c.json(designCreated.parse({ id: copy }), 201)
  })

  .delete('/:id', requireAction('projects', 'edit'), async (c) => {
    const id = uuidParam(c)
    const rows = await attempt(c, 'designs.delete', () =>
      withUser(c.env, c.get('auth').userId, (sql) => sql<{ title: string }[]>`
        delete from quotation_designs where id = ${id} returning title`),
    )
    if (!rows?.[0]) fail(404, 'This design is not here any more.')
    await audit(c, { action: 'design.delete', entityType: 'quotation_design', entityId: id, before: rows[0] })
    return c.json(designDeleted.parse({ ok: true }))
  })

  /** The client's link: whether there is one, and when they opened it. */
  .get('/:id/link', requireAction('projects', 'view'), async (c) => {
    const id = uuidParam(c)
    await mustSee(c, id)
    const row = await attempt(c, 'designs.link', () => readLink(c.env, id))
    return c.json(designLink.parse(row ?? { token: null }))
  })

  /** Make the link (or hand back the live one). */
  .post('/:id/link', requireAction('projects', 'edit'), async (c) => {
    const id = uuidParam(c)
    await mustSee(c, id)
    const row = await attempt(c, 'designs.link_make', () =>
      withService(c.env, async (sql) => {
        await sql`insert into quotation_design_links (design_id, token) values (${id}, ${newRawToken()}) on conflict (design_id) do nothing`
        return readLinkWith(sql, id)
      }),
    )
    if (!row) fail(400, 'We could not make the link.')
    await audit(c, { action: 'design.share', entityType: 'quotation_design', entityId: id })
    return c.json(designLink.parse(row))
  })

  /** Stop sharing: the old link stops at once. */
  .delete('/:id/link', requireAction('projects', 'edit'), async (c) => {
    const id = uuidParam(c)
    await mustSee(c, id)
    await attempt(c, 'designs.link_stop', () => withService(c.env, (sql) => sql`delete from quotation_design_links where design_id = ${id}`))
    await audit(c, { action: 'design.unshare', entityType: 'quotation_design', entityId: id })
    return c.json(designLink.parse({ token: null }))
  })

type Sql = Parameters<Parameters<typeof withService>[1]>[0]

interface LinkRow {
  token: string
  views: number
  first_viewed_at: string | null
  last_viewed_at: string | null
}

const readLinkWith = async (sql: Sql, id: string) => {
  const [row] = await sql<LinkRow[]>`
    select token, views,
           ${sql.unsafe(iso('first_viewed_at'))} as first_viewed_at,
           ${sql.unsafe(iso('last_viewed_at'))} as last_viewed_at
      from quotation_design_links where design_id = ${id}`
  return row ?? null
}
const readLink = (env: AppEnv['Bindings'], id: string) => withService(env, (sql) => readLinkWith(sql, id))

/** The link is read as the service, so the caller's own sight of the design is checked first (RLS). */
async function mustSee(c: Context<AppEnv>, id: string) {
  const rows = await attempt(c, 'designs.see', () =>
    withUser(c.env, c.get('auth').userId, (sql) => sql<{ id: string }[]>`select id from quotation_designs where id = ${id}`),
  )
  if (!rows?.[0]) fail(404, 'This design is not here any more.')
}

/**
 * The client's page (/d/<token>): the design and the studio's name, nothing
 * else. An open is counted once per ten minutes, never by the studio's own
 * people signed in on the same browser.
 */
export const publicDesignsRouter = new Hono<AppEnv>().get('/designs/:token', async (c) => {
  const token = c.req.param('token')
  if (!/^[0-9a-f-]{20,80}$/i.test(token)) fail(404, 'This link is not available.')
  const row = await attempt(c, 'designs.public', () =>
    withService(c.env, async (sql) => {
      const [r] = await sql<{ title: string; doc: DesignDoc; studio: string | null; company_id: string }[]>`
        select d.title, d.doc, coalesce(nullif(co.display_name, ''), co.name) as studio, d.company_id
          from quotation_design_links l
          join quotation_designs d on d.id = l.design_id
          join companies co on co.id = d.company_id
         where l.token = ${token}`
      return r ?? null
    }),
  )
  if (!row) fail(404, 'This link is not available. Ask the studio for a new one.')
  const out = publicDesign.parse({ title: row.title, studio: row.studio, doc: row.doc })
  try {
    const h = c.req.header('Authorization') ?? ''
    const uid = h.startsWith('Bearer ') ? ((await verifyToken(c.env, h.slice(7)))?.uid ?? null) : null
    await withService(c.env, async (sql) => {
      const own = uid ? (await sql`select 1 from users where user_id = ${uid} and company_id = ${row.company_id} limit 1`).length > 0 : false
      if (!own) await sql`select design_link_opened(${token})`
    })
  } catch {
    // Counting an open must never break the page.
  }
  return c.json(out)
})
