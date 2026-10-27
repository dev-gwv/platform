import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Hono } from 'hono'
import type { AppEnv } from '../context'
import { errorHandler } from '../middleware/errors'
import { requestId } from '../middleware/request-id'
import { attempt } from './attempt'
import * as reporter from './error-reporter'

class PgError extends Error {
  constructor(
    message: string,
    public code: string,
  ) {
    super(message)
  }
}

function build(thrower: () => Promise<unknown>, onCode?: (code: string) => unknown) {
  const app = new Hono<AppEnv>()
  app.use('*', requestId)
  app.onError(errorHandler)
  app.get('/x', async (c) => {
    const r = await attempt(c, 'test.op', thrower, onCode ? { onCode } : {})
    if (r === null) return c.json({ error: 'fallback' }, 400)
    return c.json({ r })
  })
  return app
}

const env = { ENVIRONMENT: 'test' } as AppEnv['Bindings']

describe('attempt()', () => {
  let errSpy: ReturnType<typeof vi.spyOn>
  beforeEach(() => {
    errSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
  })
  afterEach(() => errSpy.mockRestore())

  it('returns the value on success and logs nothing', async () => {
    const res = await build(async () => 42).request('/x', {}, env)
    expect(await res.json()).toEqual({ r: 42 })
    expect(errSpy).not.toHaveBeenCalled()
  })

  it('logs a structured line with the request id and returns null for an unknown failure', async () => {
    const res = await build(async () => {
      throw new Error('boom')
    }).request('/x', { headers: { 'X-Request-Id': 'req-abc-123' } }, env)
    expect(res.status).toBe(400)
    expect(res.headers.get('X-Correlation-Id')).toBe('req-abc-123')
    expect(res.headers.get('X-Request-Id')).toBe('req-abc-123')
    const line = JSON.parse(String(errSpy.mock.calls[0]![0])) as Record<string, unknown>
    expect(line).toMatchObject({ levelName: 'error', requestId: 'req-abc-123', label: 'test.op', message: 'boom', path: '/x' })
  })

  it('maps an RLS refusal to 403 instead of a generic 400', async () => {
    const res = await build(async () => {
      throw new PgError('not allowed', '42501')
    }).request('/x', {}, env)
    expect(res.status).toBe(403)
  })

  it('maps unique and foreign-key violations to 409', async () => {
    expect(
      (
        await build(async () => {
          throw new PgError('dup', '23505')
        }).request('/x', {}, env)
      ).status,
    ).toBe(409)
    expect(
      (
        await build(async () => {
          throw new PgError('fk', '23503')
        }).request('/x', {}, env)
      ).status,
    ).toBe(409)
  })

  it('maps RPC argument checks to 422 and connection loss to 503', async () => {
    expect(
      (
        await build(async () => {
          throw new PgError('radius', '22023')
        }).request('/x', {}, env)
      ).status,
    ).toBe(422)
    expect(
      (
        await build(async () => {
          throw new PgError('gone', '57P01')
        }).request('/x', {}, env)
      ).status,
    ).toBe(503)
  })

  it('lets the caller claim a code first', async () => {
    const res = await build(
      async () => {
        throw new PgError('dup', '23505')
      },
      (code) => (code === '23505' ? 'taken' : undefined),
    ).request('/x', {}, env)
    expect(await res.json()).toEqual({ r: 'taken' })
  })

  it('reports only faults to Sentry, never a refusal the studio is answered with', async () => {
    const report = vi.spyOn(reporter, 'reportError').mockImplementation(() => undefined)
    try {
      await build(async () => {
        throw new PgError('no_open_check_in: nothing to check out of', 'P0001')
      }).request('/x', {}, env)
      await build(
        async () => {
          throw new PgError('dup', '23505')
        },
        () => 'taken',
      ).request('/x', {}, env)
      expect(report).not.toHaveBeenCalled()
      const levels = errSpy.mock.calls.map((call) => (JSON.parse(String(call[0])) as { levelName: string }).levelName)
      expect(levels).toEqual(['warn', 'warn'])

      await build(async () => {
        throw new Error('boom')
      }).request('/x', {}, env)
      expect(report).toHaveBeenCalledTimes(1)
    } finally {
      report.mockRestore()
    }
  })
})
