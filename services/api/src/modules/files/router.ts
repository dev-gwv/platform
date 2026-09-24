import { Hono } from 'hono'
import { ALLOWED_FILE_MIMES, IMAGE_MIMES, MAX_FILE_BYTES, storedFile, storedFileList, z } from '@ipc/contracts'
import type { AppEnv } from '../../context'
import { requireAuth } from '../../middleware/auth'
import { fail } from '../../middleware/errors'
import { uuidParam } from '../../lib/params'
import { withService, withUser } from '../../lib/db'
import { attempt } from '../../lib/attempt'
import { audit } from '../../lib/audit'

const allowed = new Set<string>(ALLOWED_FILE_MIMES)

/**
 * The URL that goes into `avatar_url`, an attachment row, or an emailed
 * document. It has to be absolute and it has to be the API's own origin — a
 * client opening a quotation from their inbox has no app to resolve a relative
 * path against.
 */
function publicUrl(reqUrl: string, id: string): string {
  return `${new URL(reqUrl).origin}/public/files/${id}`
}
function privateUrl(reqUrl: string, id: string): string {
  return `${new URL(reqUrl).origin}/files/${id}`
}

/** A filename from a browser is attacker-controlled; keep it to a leaf name. */
function safeName(raw: string): string {
  const leaf = raw.split(/[\\/]/).pop() ?? 'file'
  // Drop control characters and the quote that would break Content-Disposition.
  // Filtered by code point rather than a regex class, which would need literal
  // control characters sitting in this source file.
  const cleaned = [...leaf]
    .filter((ch) => {
      const cp = ch.codePointAt(0) ?? 0
      return cp > 0x1f && cp !== 0x7f && ch !== '"'
    })
    .join('')
  return cleaned.slice(0, 200) || 'file'
}

const deleted = z.object({ ok: z.boolean() })

export const filesRouter = new Hono<AppEnv>()
  .use('*', requireAuth)

  /**
   * Upload. `public=1` marks a branding asset readable without a session; it is
   * only honoured for image types, so nobody can turn a bill into a public URL
   * by passing a query parameter.
   */
  .post('/', async (c) => {
    const body = await c.req.parseBody().catch(() => null)
    const file = body?.['file']
    if (!(file instanceof File)) fail(422, 'Please choose a file to upload.')
    if (file.size === 0) fail(422, 'That file is empty.')
    if (file.size > MAX_FILE_BYTES) fail(422, 'That file is larger than 10 MB.')

    // The runtime labels an upload by its file extension; Safari's voice
    // notes arrive as .m4a, which it calls audio/x-m4a -- the same thing as
    // audio/mp4, stored under the one name the player expects.
    const raw = (file.type || 'application/octet-stream').split(';')[0]!.trim().toLowerCase()
    const mime = raw === 'audio/x-m4a' ? 'audio/mp4' : raw
    if (!allowed.has(mime)) fail(422, 'That file type is not supported. Use PNG, JPG, WEBP, SVG, PDF, CSV, TXT or a voice recording.')

    const wantsPublic = c.req.query('public') === '1' && IMAGE_MIMES.includes(mime)
    const bytes = Buffer.from(await file.arrayBuffer())
    const name = safeName(file.name)
    const auth = c.get('auth')

    const rows = await attempt(c, 'files.upload', () =>
      withUser(
        c.env,
        auth.userId,
        (sql) => sql<{ id: string; created_at: string }[]>`
          insert into files (company_id, name, mime, size_bytes, bytes, is_public, created_by)
          values (${auth.companyId}, ${name}, ${mime}, ${bytes.length}, ${bytes}, ${wantsPublic}, ${auth.userId})
          returning id, created_at`,
      ),
    )
    if (!rows?.length) fail(400, 'We could not store that file.')
    const id = rows[0]!.id
    await audit(c, { action: 'file.upload', entityType: 'file', entityId: id, after: { name, mime, size_bytes: bytes.length, is_public: wantsPublic } })
    return c.json(
      storedFile.parse({
        id,
        name,
        mime,
        size_bytes: bytes.length,
        is_public: wantsPublic,
        url: wantsPublic ? publicUrl(c.req.url, id) : privateUrl(c.req.url, id),
        created_at: rows[0]!.created_at,
      }),
    )
  })

  /** Metadata for a set of ids — what an attachments list actually needs. */
  .get('/', async (c) => {
    const ids = (c.req.query('ids') ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
    if (!ids.length) return c.json(storedFileList.parse([]))
    const rows = await attempt(c, 'files.list', () =>
      withUser(
        c.env,
        c.get('auth').userId,
        (sql) => sql`select * from list_files(${ids}::uuid[])`,
      ),
    )
    if (!rows) fail(400, 'We could not load those files.')
    return c.json(
      storedFileList.parse(
        (rows as Array<Record<string, unknown>>).map((r) => ({
          ...r,
          url: r['is_public'] ? publicUrl(c.req.url, String(r['id'])) : privateUrl(c.req.url, String(r['id'])),
        })),
      ),
    )
  })

  .get('/:id', async (c) => {
    const id = uuidParam(c)
    const rows = await attempt(c, 'files.get', () =>
      withUser(
        c.env,
        c.get('auth').userId,
        (sql) => sql<{ name: string; mime: string; bytes: Buffer }[]>`
          select name, mime, bytes from files where id = ${id}`,
      ),
    )
    if (!rows) fail(400, 'We could not load that file.')
    if (!rows.length) fail(404, 'That file was not found.')
    return serve(rows[0]!)
  })

  .delete('/:id', async (c) => {
    const id = uuidParam(c)
    const rows = await attempt(c, 'files.delete', () =>
      withUser(
        c.env,
        c.get('auth').userId,
        (sql) => sql<{ id: string }[]>`delete from files where id = ${id} returning id`,
      ),
    )
    if (!rows) fail(400, 'We could not remove that file.')
    if (!rows.length) fail(404, 'That file was not found.')
    await audit(c, { action: 'file.delete', entityType: 'file', entityId: id })
    return c.json(deleted.parse({ ok: true }))
  })

/**
 * Sessionless read, for branding on a document a client opens from their email.
 * `is_public` is filtered in the query, not after it, so a private file cannot
 * be reached here even with a valid id.
 */
export const publicFilesRouter = new Hono<AppEnv>().get('/files/:id', async (c) => {
  const id = uuidParam(c)
  const rows = await attempt(c, 'files.public_get', () =>
    withService(
      c.env,
      (sql) => sql<{ name: string; mime: string; bytes: Buffer }[]>`
        select name, mime, bytes from files where id = ${id} and is_public`,
    ),
  )
  if (!rows) fail(503, 'The service is temporarily unavailable. Please try again in a moment.')
  if (!rows.length) fail(404, 'That file was not found.')
  return serve(rows[0]!, true)
})

export function serve(row: { name: string; mime: string; bytes: Buffer }, immutable = false): Response {
  const body = row.bytes instanceof Uint8Array ? row.bytes : Buffer.from(row.bytes)
  return new Response(new Uint8Array(body), {
    headers: {
      'Content-Type': row.mime,
      'Content-Length': String(body.length),
      // Ids are random and content never changes under one, so a long cache is
      // safe and keeps a logo off the database on every document view.
      'Cache-Control': immutable ? 'public, max-age=31536000, immutable' : 'private, max-age=300',
      'Content-Disposition': `inline; filename="${row.name.replace(/"/g, '')}"`,
      // An uploaded SVG is script-capable; served from the API origin it must
      // not be able to run anything.
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; img-src data:",
      'X-Content-Type-Options': 'nosniff',
    },
  })
}
