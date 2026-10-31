import { Hono } from 'hono'
import { driveExpand, driveExpandRequest, driveImport, driveImportRequest, driveImports, drivePicker } from '@ipc/contracts'
import type { AppEnv } from '../../context'
import { requireAction } from '../../middleware/permissions'
import { fail } from '../../middleware/errors'
import { uuidParam } from '../../lib/params'
import { audit } from '../../lib/audit'
import {
  driveImportOut,
  expandDriveItems,
  FRAMELINE_SAYS,
  framelineConnected,
  framelineTrouble,
  listDriveImports,
  readDrivePicker,
  startDriveImport,
  stopDriveImport,
  type FramelineResult,
} from '../../lib/frameline'
import { personOf } from './routes-gallery'

/**
 * Import from Google Drive on the project's Gallery tab. Google's own picker
 * opens on our page with a token Frameline gives for the studio's Drive; what
 * was picked is listed and copied into the project's gallery by Frameline, in
 * the background, with its own albums, limits and progress. Connecting Drive
 * stays in Frameline (Settings -> Gallery -> Google Drive), never rebuilt here.
 */

/** What a refused Drive call says, by why. */
export function driveFailure(r: Extract<FramelineResult<unknown>, { ok: false }>): { status: 402 | 404 | 409 | 502 | 503; message: string } {
  if (r.kind === 'drive_off') return { status: 409, message: 'Google Drive isn’t connected yet. The studio owner connects it in Settings → Gallery.' }
  if (r.kind === 'full') return { status: 402, message: r.detail ?? 'The gallery has no room for that many photos. Pick fewer.' }
  if (r.kind === 'missing') return { status: 404, message: 'This project has no gallery yet. Press Create gallery first.' }
  if (r.kind === 'no_name') return { status: 503, message: FRAMELINE_SAYS.no_name }
  if (framelineTrouble(r.kind) === 'misconfigured') return { status: 502, message: FRAMELINE_SAYS.misconfigured }
  return { status: 503, message: FRAMELINE_SAYS.no_answer }
}

function refused(r: Extract<FramelineResult<unknown>, { ok: false }>): never {
  const why = driveFailure(r)
  fail(why.status, why.message)
}

export const projectGalleryDriveRoutes = new Hono<AppEnv>()
  /** What Google's picker needs; asked for at the press, because the token lasts an hour at most. */
  .get('/:id/gallery/drive/picker', requireAction('projects', 'edit'), async (c) => {
    uuidParam(c)
    if (!framelineConnected(c.env)) fail(503, FRAMELINE_SAYS.not_connected)
    const r = await readDrivePicker(c.env, await personOf(c))
    if (!r.ok) refused(r)
    c.header('Cache-Control', 'no-store')
    return c.json(drivePicker.parse({ access_token: r.data.accessToken, expires_at: r.data.expiresAt, api_key: r.data.apiKey, app_id: r.data.appId ?? null }))
  })

  /** What was picked holds: each photo, and the photos in each folder with the folder's path. */
  .post('/:id/gallery/drive/expand', requireAction('projects', 'edit'), async (c) => {
    uuidParam(c)
    if (!framelineConnected(c.env)) fail(503, FRAMELINE_SAYS.not_connected)
    const asked = driveExpandRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!asked.success) fail(400, 'We could not read what was picked.')
    const r = await expandDriveItems(c.env, await personOf(c), asked.data.ids)
    if (!r.ok) refused(r)
    return c.json(
      driveExpand.parse({
        items: r.data.items.map((i) => ({
          id: i.id,
          name: i.name,
          mime_type: i.mimeType,
          size: i.size,
          folder_path: i.folderPath ?? null,
          importable: i.importable,
          reason: i.reason ?? null,
        })),
        closed_folders: r.data.closedFolders,
      }),
    )
  })

  /** The gallery's imports, newest first, for the progress line. */
  .get('/:id/gallery/drive/imports', requireAction('projects', 'edit'), async (c) => {
    const projectId = uuidParam(c)
    if (!framelineConnected(c.env)) fail(503, FRAMELINE_SAYS.not_connected)
    const r = await listDriveImports(c.env, await personOf(c), projectId)
    if (!r.ok) refused(r)
    return c.json(driveImports.parse({ items: r.data.items.map(driveImportOut) }))
  })

  /** Import: Frameline makes the albums, checks there is room and copies the photos. */
  .post('/:id/gallery/drive/imports', requireAction('projects', 'edit'), async (c) => {
    const projectId = uuidParam(c)
    if (!framelineConnected(c.env)) fail(503, FRAMELINE_SAYS.not_connected)
    const asked = driveImportRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!asked.success) fail(400, 'We could not read what to import.')
    const r = await startDriveImport(c.env, await personOf(c), projectId, {
      name: asked.data.name,
      quality: asked.data.quality,
      items: asked.data.items.map((i) => ({ fileId: i.file_id, name: i.name, size: i.size, mimeType: i.mime_type, albumName: i.album_name })),
    })
    if (!r.ok) refused(r)
    await audit(c, {
      action: 'project.gallery_drive_import',
      entityType: 'project',
      entityId: projectId,
      after: { import_id: r.data.id, files: asked.data.items.length, quality: asked.data.quality },
    })
    return c.json(driveImport.parse(driveImportOut(r.data)), 201)
  })

  /** Stop: what came in stays. */
  .delete('/:id/gallery/drive/imports/:importId', requireAction('projects', 'edit'), async (c) => {
    const projectId = uuidParam(c)
    const importId = c.req.param('importId') ?? ''
    if (!/^[\w-]{1,64}$/.test(importId)) fail(400, 'We could not find that import.')
    if (!framelineConnected(c.env)) fail(503, FRAMELINE_SAYS.not_connected)
    const r = await stopDriveImport(c.env, await personOf(c), projectId, importId)
    if (!r.ok) refused(r)
    return c.json(driveImport.parse(driveImportOut(r.data)))
  })
