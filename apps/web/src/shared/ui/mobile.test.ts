import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { keepScrollInside } from './scroll-inside'

const src = (p: string) => readFileSync(resolve(import.meta.dirname, '..', '..', p), 'utf8')

/**
 * Mobile audit, 18 Nov (docs/audit-mobile-2026-11-18.md): what a phone could
 * not reach. These keep the shared fixes from being undone by accident.
 */
describe('phones', () => {
  it('stops a swipe on a floating list before a dialog lock sees it', () => {
    const seen: string[] = []
    const listeners = new Map<string, (e: Event) => void>()
    const el = {
      addEventListener: (t: string, f: (e: Event) => void) => listeners.set(t, f),
      removeEventListener: (t: string) => listeners.delete(t),
    } as unknown as HTMLElement
    const undo = keepScrollInside(el)
    for (const t of ['wheel', 'touchmove']) {
      listeners.get(t)?.({ stopPropagation: () => seen.push(t) } as unknown as Event)
    }
    expect(seen).toEqual(['wheel', 'touchmove'])
    undo()
    expect(listeners.size).toBe(0)
  })

  it('lets every portalled list scroll inside a dialog', () => {
    // The plan list in Assign plan could not be swiped on Android.
    expect(src('shared/ui/select.tsx')).toMatch(/keepScrollInside\(panel\.current\)/)
    expect(src('shared/ui/popover.tsx')).toMatch(/scrollInsideRef\(ref\)/)
    expect(src('shared/ui/row-menu.tsx')).toMatch(/keepScrollInside\(el\)/)
  })

  it('types in 16px boxes on a touch screen, so an iPhone does not zoom', () => {
    expect(src('styles.css')).toMatch(/@media \(pointer: coarse\) \{\r?\n {2}input:not\(\[type='checkbox'\]\)[^{]*\{\r?\n {4}font-size: 16px;/)
    expect(readFileSync(resolve(import.meta.dirname, '..', '..', '..', 'index.html'), 'utf8')).toMatch(/interactive-widget=resizes-content/)
  })

  it('keeps a filter list on screen and the keyboard down on a phone', () => {
    const filter = src('shared/ui/multi-select-filter.tsx')
    expect(filter).not.toMatch(/absolute right-0 top-full/)
    expect(filter).toMatch(/autoFocus=\{!isTouchScreen\(\)\}/)
    for (const f of ['shared/ui/quick-select.tsx', 'features/projects/ProjectPicker.tsx', 'features/crm/LeadPicker.tsx', 'features/crm/LabelMenu.tsx']) {
      expect(src(f), f).toMatch(/if \(!isTouchScreen\(\)\) input\.current\?\.focus\(\)/)
    }
  })
})
