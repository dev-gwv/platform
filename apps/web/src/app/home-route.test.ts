import { describe, expect, it } from 'vitest'
import router from './router.tsx?raw'

/** `/` is the public front door; the signed-in dashboard lives at /dashboard. */
describe('the front door', () => {
  it('serves / to signed-out visitors and keeps the dashboard at /dashboard', () => {
    expect(router).toContain("publicRoute('/', HomePage)")
    expect(router).toContain("route('/dashboard', DashboardPage)")
    expect(router).not.toContain("route('/', DashboardPage)")
  })
})
