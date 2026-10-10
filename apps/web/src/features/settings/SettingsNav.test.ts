import { describe, expect, it } from 'vitest'
import router from '../../app/router.tsx?raw'
import { SETTINGS_GROUPS, settingsItemFor } from './SettingsNav'

/**
 * The settings rail replaced a sixteen-tab strip. Every page it used to reach
 * must still be reachable, once, and still be a real route.
 */
const items = SETTINGS_GROUPS.flatMap((g) => g.items)
/** Every page the rail reaches: its lines and the tabs folded into them. */
const pages = items.flatMap((i) => (i.tabs ? i.tabs.map((t) => t.to) : [i.to]))

describe('the settings rail', () => {
  it('keeps every settings page the tab strip had (but Advanced tools, retired)', () => {
    expect([...pages].sort()).toEqual(
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
        // Pages that left the menu's "More" and the CRM group (audit, batch 4).
        '/activity',
        '/enquiry-forms',
        '/lead-sources',
        '/referrals',
        // The old app's Studio Access, for platform admins only (0218).
        '/platform/studios',
        // The people and shops the studio pays (parties).
        '/settings/vendors',
        // Refer a studio (0237).
        '/settings/refer-a-studio',
        // The details form a client fills, as a link and QR (0244).
        '/settings/client-form',
      ].sort(),
    )
  })

  it('lists each page once, with at most four under a heading', () => {
    expect(new Set(pages).size).toBe(pages.length)
    for (const g of SETTINGS_GROUPS) expect(g.items.length).toBeLessThanOrEqual(4)
  })

  it('is sixteen lines for a studio (the audit: twenty-two was too many)', () => {
    expect(items.filter((i) => !i.platformOnly)).toHaveLength(16)
  })

  it('opens a folded page on its own line, and that line names it in a tab and in also', () => {
    for (const i of items.filter((x) => x.tabs)) {
      expect(i.tabs![0]!.to).toBe(i.to)
      for (const t of i.tabs!.slice(1)) {
        expect(i.also).toContain(t.to)
        expect(settingsItemFor(t.to)?.to).toBe(i.to)
      }
    }
  })

  it('points only at routes the app really has', () => {
    for (const p of pages) expect(router).toContain(`'${p}'`)
  })

  it('knows which page an address belongs to, including the focused System views', () => {
    expect(settingsItemFor('/settings/roles')?.label).toBe('Roles & access')
    expect(settingsItemFor('/settings/work-submissions')?.to).toBe('/settings/lookups')
    expect(settingsItemFor('/settings/roles/')?.to).toBe('/settings/roles')
    expect(settingsItemFor('/employees')).toBeNull()
  })
})

describe('studio access', () => {
  it('is the one platform-only line, so a studio never sees it', () => {
    expect(items.filter((i) => i.platformOnly).map((i) => i.to)).toEqual(['/platform/studios'])
  })
})
