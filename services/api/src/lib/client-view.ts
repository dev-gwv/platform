import type { Context } from 'hono'
import type { AppEnv } from '../context'
import { withService } from './db'
import { verifyToken } from './auth-token'
import { describeError, log } from './log'

type ClientViewKind = 'quotation' | 'invoice' | 'terms'

/**
 * Note that the client opened a document link (0235), for the project's
 * Overview. Called after the public read has its answer and never allowed to
 * break it: any failure is logged and swallowed. A signed-in studio member
 * opening their own link is passed along so the database can leave them out.
 */
export async function noteClientView(c: Context<AppEnv>, kind: ClientViewKind, token: string): Promise<void> {
  try {
    const h = c.req.header('Authorization') ?? ''
    const bearer = h.startsWith('Bearer ') ? h.slice(7) : ''
    const viewer = bearer ? ((await verifyToken(c.env, bearer))?.uid ?? null) : null
    await withService(c.env, (sql) => sql`select record_client_view(${kind}, ${token}, ${viewer}::uuid)`)
  } catch (err) {
    log.warn({ kind, ...describeError(err) }, 'client view not recorded')
  }
}
