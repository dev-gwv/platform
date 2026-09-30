import type { Context } from 'hono'
import { HTTPException } from 'hono/http-exception'
import type { AppEnv } from '../context'
import { describeError, log } from '../lib/log'
import { reportError } from '../lib/error-reporter'
import { currentRequestId } from './request-id'

/**
 * Central error handler. Error STRINGS are UI copy; diagnostics go to logs,
 * never to the client.
 *
 * Register this with `app.onError`, NEVER as `app.use` middleware. Hono's
 * compose() catches a throw at the depth of the handler that threw and calls
 * the app's error handler right there, so a try/catch in an enclosing
 * middleware never runs. Mounted as middleware this was unreachable, every
 * failure fell through to Hono's own handler, and clients got the bare message
 * with no JSON envelope -- which the web client reports as "Request failed."
 */
export function errorHandler(err: Error, c: Context<AppEnv>): Response {
  if (err instanceof HTTPException) {
    // `message` is the copy passed to fail(). A few HTTPExceptions raised
    // inside Hono itself carry none, so keep a readable fallback.
    return c.json({ error: err.message || 'Something went wrong. Please try again.' }, err.status)
  }
  // Unknown failure: log structured detail under the request id, return an
  // opaque message + the id (so support can find the log).
  const correlationId = currentRequestId(c)
  const d = describeError(err)
  log.error(
    {
      requestId: correlationId,
      method: c.req.method,
      path: c.req.path,
      code: d.code,
      message: d.message,
      stack: d.stack,
    },
    'unhandled error',
  )
  reportError(c.env, err, { requestId: correlationId, method: c.req.method, path: c.req.path })
  c.header('X-Correlation-Id', correlationId)
  return c.json({ error: 'Something went wrong. Please try again.', correlation_id: correlationId }, 500)
}

/** Unknown route, in the same envelope every other failure uses. */
export function notFoundHandler(c: Context<AppEnv>): Response {
  return c.json({ error: 'That page or endpoint does not exist.' }, 404)
}

/** Throw this from anywhere to return a clean status to the client. */
export function fail(status: 400 | 401 | 403 | 404 | 409 | 410 | 422 | 503, message: string): never {
  throw new HTTPException(status, { message })
}
