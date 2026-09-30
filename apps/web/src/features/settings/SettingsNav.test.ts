import { describe, expect, it } from 'vitest'
import router from '../../app/router.tsx?raw'
import { SETTINGS_GROUPS, settingsItemFor } from './SettingsNav'

/**
 * The settings rail replaced a sixteen-tab strip. Every page it used to reach
 * must still be reachable, once, and still be a real route.
 */
const items = SETTINGS_GROUPS.flatMap((g) => g.items)

describe('the settings rail', () => {
  it('keeps every settings page the tab strip had', () => {
    expect(items.map((i) => i.to).sort()).toEqual(
      [
        '/settings/company',
        '/settings/roles',
        '/settings/project-templates',
        '/project-documents',
        '/projects/stages',
        '/settings/task-bundles',
        '/settings/team-terms',
        '/settings/appearance',
        '/settings/lookups',
        '/settings/invoicing',
        '/settings/attendance-location',
        '/settings/subscription',
        '/settings/messaging',
        '/settings/whatsapp',
        '/settings/system',
        '/settings/advanced',
        // The old app's Studio Access, for platform admins only (0218).
        '/platform/studios',
      ].sort(),
    )
  })

  it('lists each page once, with at most four under a heading', () => {
    expect(new Set(items.map((i) => i.to)).size).toBe(items.length)
    for (const g of SETTINGS_GROUPS) expect(g.items.length).toBeLessThanOrEqual(4)
  })

  it('points only at routes the app really has', () => {
    for (const i of items) expect(router).toContain(`'${i.to}'`)
  })

  it('knows which page an address belongs to, including the focused System views', () => {
    expect(settingsItemFor('/settings/roles')?.label).toBe('Roles & access')
    expect(settingsItemFor('/settings/work-submissions')?.to).toBe('/settings/system')
    expect(settingsItemFor('/settings/roles/')?.to).toBe('/settings/roles')
    expect(settingsItemFor('/employees')).toBeNull()
  })
})

describe('studio access', () => {
  it('is the one platform-only line, so a studio never sees it', () => {
    expect(items.filter((i) => i.platformOnly).map((i) => i.to)).toEqual(['/platform/studios'])
  })
})
