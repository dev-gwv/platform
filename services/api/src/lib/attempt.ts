import type { Context } from 'hono'
import type { AppEnv } from '../context'
import { fail } from '../middleware/errors'
import { currentRequestId } from '../middleware/request-id'
import { describeError, log } from './log'
import { reportError } from './error-reporter'

/**
 * The one way a handler runs something that can fail.
 *
 * `.catch(() => null)` at 109 call sites meant every database failure — an
 * outage, a permission refusal, a constraint — collapsed into a 400 with no
 * log line and no id to search for. attempt() keeps the convenient "null on
 * failure" shape for the caller, but:
 *
 *   - logs a structured line with the request id, route, label and pg code
 *   - reports it to the error tracker when one is configured
 *   - sets X-Correlation-Id so the client can quote it back
 *   - turns the codes that MEAN something into the right status instead of 400:
 *       42501 (RLS / not allowed)  -> 403
 *       23505 (unique)             -> 409
 *       23503 (foreign key in use) -> 409
 *       22023 / P0001 (RPC checks) -> 422
 *       54000 (a plan limit)       -> 402
 *       connection failures        -> 503
 *
 * `onCode` lets a caller claim a code first (e.g. 23505 -> "that role code is
 * taken") by returning a value; returning undefined falls through.
 */
interface AttemptOptions<C> {
  /** Return a value to claim the code; return undefined to fall through. */
  onCode?: (code: string, err: unknown) => C | undefined
}

const CONNECTION_CODES = new Set(['08000', '08003', '08006', '57P01', '57P02', '57P03', 'ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'CONNECT_TIMEOUT'])

export async function attempt<T, C = never>(
  c: Context<AppEnv>,
  label: string,
  fn: () => Promise<T>,
  opts: AttemptOptions<C> = {},
): Promise<T | C | null> {
  try {
    return await fn()
  } catch (err) {
    const requestId = currentRequestId(c)
    const d = describeError(err)
    log.error(
      {
        requestId,
        method: c.req.method,
        path: c.req.path,
        label,
        code: d.code,
        message: d.message,
        stack: d.stack,
      },
      'operation failed',
    )
    reportError(c.env, err, { requestId, method: c.req.method, path: c.req.path, label })
    c.header('X-Correlation-Id', requestId)

    if (d.code && opts.onCode) {
      const claimed = opts.onCode(d.code, err)
      if (claimed !== undefined) return claimed
    }
    switch (d.code) {
      case '42501':
        fail(403, 'You do not have access to this action.')
      // falls through (fail throws)
      case '23505':
        fail(409, 'That already exists.')
      // falls through
      case '23503':
        fail(409, 'That record is still in use and cannot be changed.')
      // falls through
      case '22023':
      case 'P0001':
        fail(422, 'Please check the details and try again.')
      // falls through
      case '54000':
        // A plan limit (0241): the database's sentence says which and why.
        fail(402, d.message || 'Your plan does not allow more of these. Upgrade to add more.')
      // falls through
      default:
        if (d.code && CONNECTION_CODES.has(d.code)) {
          fail(503, 'The service is temporarily unavailable. Please try again in a moment.')
        }
        return null
    }
  }
}
