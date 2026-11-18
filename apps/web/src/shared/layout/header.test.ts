import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const src = (p: string) => readFileSync(resolve(import.meta.dirname, '..', '..', p), 'utf8')

/**
 * At about 1250px the top bar ran past the right edge and pushed the account
 * menu off screen. Its items now shrink to compact forms instead; these keep
 * the two things that made that work from being undone by accident.
 */
describe('top bar', () => {
  it('never clips: the account menu panel is not portalled', () => {
    const header = src('shared/layout/AppShell.tsx').match(/<header className="([^"]+)"/)?.[1] ?? ''
    expect(header).not.toMatch(/overflow-hidden/)
  })
  it('keeps every chip on one line', () => {
    for (const f of ['shared/layout/DueChip.tsx', 'features/billing/TrialChip.tsx', 'shared/layout/QuickLinks.tsx', 'features/feedback/SuggestFeature.tsx', 'shared/layout/NewMenu.tsx']) {
      expect(src(f), f).toMatch(/whitespace-nowrap/)
    }
  })
  it('fits a phone: what has no room rides in the account menu', () => {
    // Audit, 17 Nov: from 375px to about 1000px the bell and the account menu
    // were pushed off the right edge. These keep the narrow forms in place.
    const shell = src('shared/layout/AppShell.tsx')
    expect(shell).toMatch(/<SuggestFeatureButton className="hidden md:inline-flex" \/>/)
    expect(shell).toMatch(/<HideAmountsButton className="hidden lg:inline-flex" \/>/)
    expect(shell).toMatch(/<RefreshButton className="hidden sm:inline-flex" \/>/)
    expect(shell).not.toMatch(/sm:w-64/)
    const menu = src('shared/layout/AccountMenu.tsx')
    for (const line of ['Refresh this page', 'Hide amounts', 'Suggest a feature']) expect(menu).toContain(line)
  })
  it('keeps the help bubble off a sticky Save / Next bar at every width', () => {
    const css = src('styles.css')
    // The lane outside any media query, so a phone has it too.
    expect(css).toMatch(/\n\[data-sticky-actions\] \{\r?\n {2}padding-right: 4\.75rem !important;/)
    expect(css).toMatch(/\.ipc-reminders/)
  })
  it('gives staff their Attendance tab before Calls on a phone', () => {
    const bar = src('shared/layout/MobileTabBar.tsx')
    expect(bar.indexOf("'/attendance/my'")).toBeLessThan(bar.indexOf("'/follow-ups/queue'"))
  })
})
