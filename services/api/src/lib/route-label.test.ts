import { describe, expect, it } from 'vitest'
import { Hono } from 'hono'
import { maskPath, routeLabel } from './route-label'

describe('routeLabel', () => {
  it('names the matched route pattern, never the token in the path', async () => {
    const app = new Hono()
    let seen = ''
    app.use('/public/*', async (c, next) => {
      seen = routeLabel(c)
      await next()
    })
    app.get('/public/quote/:token', (c) => c.json({ ok: true }))
    await app.request('/public/quote/9f3c2a7b1e4d4c0a8b6e2f1d3c5a7b9e')
    expect(seen).toBe('/public/quote/:token')
  })

  it('masks id-like segments when no route is known', async () => {
    const app = new Hono()
    let seen = ''
    app.use('*', async (c, next) => {
      seen = routeLabel(c)
      await next()
    })
    await app.request('/nowhere/9f3c2a7b1e4d4c0a8b6e2f1d3c5a7b9e')
    expect(seen).toBe('/nowhere/:id')
  })
})

describe('maskPath', () => {
  it('keeps words and hides tokens and ids', () => {
    expect(maskPath('/work/reminder-settings')).toBe('/work/reminder-settings')
    expect(maskPath('/projects/0b7e9c1a-2f4d-4e8a-9c3b-5d6e7f8a9b0c/edit')).toBe('/projects/:id/edit')
    expect(maskPath('/public/terms/AbCdEfGhIjKlMnOpQrStUvWx')).toBe('/public/terms/:id')
  })
})
