import type { Context } from 'hono'
import type { TransactionSql } from 'postgres'
import { ID_DOCUMENT_MAX_BYTES, ID_DOCUMENT_MIMES, idDocumentKind, memberDocument, type IdDocumentKind } from '@ipc/contracts'
import type { AppEnv } from '../context'
import { fail } from '../middleware/errors'

/**
 * ID proof: stored in member_documents, never in `files` (anyone in the studio
 * can read a file there by its id). RLS keeps these rows to the member and
 * the studio owner; these helpers are shared by the member's own routes and
 * the owner's.
 */

const allowed = new Set<string>(ID_DOCUMENT_MIMES)

export async function listMemberDocs(sql: TransactionSql, userId: string) {
  const rows = await sql`
    select id, kind, name, mime, size_bytes, created_at
      from member_documents
     where user_id = ${userId}
     order by created_at desc
     limit 20`
  return memberDocument.array().parse(rows)
}

/** A browser's filename is attacker-controlled: keep a printable leaf name. */
function safeName(raw: string): string {
  const leaf = raw.split(/[\\/]/).pop() ?? 'document'
  const cleaned = [...leaf]
    .filter((ch) => {
      const cp = ch.codePointAt(0) ?? 0
      return cp > 0x1f && cp !== 0x7f && ch !== '"'
    })
    .join('')
  return cleaned.slice(0, 200) || 'document'
}

/** The multipart upload, checked: a photo or PDF of an ID, 5 MB at most. */
export async function readDocumentUpload(
  c: Context<AppEnv>,
): Promise<{ kind: IdDocumentKind; name: string; mime: string; bytes: Buffer }> {
  const body = await c.req.parseBody().catch(() => null)
  const file = body?.['file']
  if (!(file instanceof File)) fail(422, 'Choose a photo or PDF of the ID.')
  if (file.size === 0) fail(422, 'That file is empty.')
  if (file.size > ID_DOCUMENT_MAX_BYTES) fail(422, 'That file is larger than 5 MB.')
  const mime = (file.type || '').split(';')[0]!.trim().toLowerCase()
  if (!allowed.has(mime)) fail(422, 'Use a JPG, PNG or WEBP photo, or a PDF.')
  const kind = idDocumentKind.safeParse(typeof body?.['kind'] === 'string' ? body['kind'] : 'other')
  if (!kind.success) fail(422, 'Pick which ID this is.')
  return { kind: kind.data, name: safeName(file.name), mime, bytes: Buffer.from(await file.arrayBuffer()) }
}

/** Served to the member or the owner only, and never cached anywhere. */
export function serveDocument(row: { name: string; mime: string; bytes: Buffer }): Response {
  const body = row.bytes instanceof Uint8Array ? row.bytes : Buffer.from(row.bytes)
  return new Response(new Uint8Array(body), {
    headers: {
      'Content-Type': row.mime,
      'Content-Length': String(body.length),
      'Cache-Control': 'private, no-store',
      'Content-Disposition': `inline; filename="${row.name.replace(/"/g, '')}"`,
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; img-src data:",
      'X-Content-Type-Options': 'nosniff',
    },
  })
}
