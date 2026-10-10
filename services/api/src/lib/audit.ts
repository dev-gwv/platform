import type { Context } from 'hono'
import type { AppEnv } from '../context'
import { withUser } from './db'
import { resolveClientIp } from './client-ip'
import { currentRequestId } from '../middleware/request-id'
import { describeError, log } from './log'

interface AuditEntry {
  /** Dotted verb: 'company.update', 'member.remove', 'lead.merge'. */
  action: string
  entityType: string
  entityId?: string | null | undefined
  before?: unknown
  after?: unknown
}

/**
 * Record who did what to which row, tied to the request id in the logs.
 * Writes through audit_log_write() as the caller, so the studio is always the
 * caller's own. Auditing must never break the action it records: a failure
 * here is logged and swallowed on purpose.
 */
export async function audit(c: Context<AppEnv>, entry: AuditEntry): Promise<void> {
  const auth = c.get('auth')
  if (!auth) return
  const requestId = currentRequestId(c)
  const ip = resolveClientIp(c.req.raw.headers, c.env.CLIENT_IP_HEADER)
  try {
    await withUser(
      c.env,
      auth.userId,
      (sql) => sql`
        select audit_log_write(
          p_action => ${entry.action},
          p_entity_type => ${entry.entityType},
          p_entity_id => ${entry.entityId ?? null},
          p_before => ${entry.before === undefined ? null : sql.json(entry.before as never)},
          p_after => ${entry.after === undefined ? null : sql.json(entry.after as never)},
          p_ip => ${ip},
          p_correlation_id => ${requestId}
        )`,
    )
  } catch (err) {
    log.error({ requestId, action: entry.action, ...describeError(err) }, 'audit write failed')
  }
}
