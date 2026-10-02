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
    for (const f of ['shared/layout/DueChip.tsx', 'features/billing/TrialChip.tsx', 'shared/layout/QuickLinks.tsx', 'features/feedback/SuggestFeature.tsx']) {
      expect(src(f), f).toMatch(/whitespace-nowrap/)
    }
  })
})
