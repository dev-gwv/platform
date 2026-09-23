import { describe, expect, it } from 'vitest'
import { groupRequirementOptions, requirementOptions, stageOfRequirement } from './requirements'

const LIBRARY = [
  { type_name: 'Candid Photographer', stage: 'production' as const },
  { type_name: 'Album Designer', stage: 'post' as const },
  { type_name: 'Sales Executive', stage: 'pre' as const },
]

describe('requirementOptions', () => {
  it('merges the studio list and the library without duplicates, keeping the library stage', () => {
    const opts = requirementOptions([{ name: 'candid photographer' }, { name: 'Highlight Editor' }], LIBRARY)
    expect(opts.map((o) => o.name)).toEqual([
      'candid photographer',
      'Highlight Editor',
      'Album Designer',
      'Sales Executive',
    ])
    expect(opts[0]).toMatchObject({ stage: 'production', saved: true })
  })

  it('reads the stage off the name for something the library does not have', () => {
    const [opt] = requirementOptions([{ name: 'Highlight Editor' }], [])
    expect(opt).toMatchObject({ stage: 'post', saved: true })
  })
})

describe('groupRequirementOptions', () => {
  it('orders stages pre → on → post, drops empty ones, and puts the studio’s own first', () => {
    const groups = groupRequirementOptions(
      requirementOptions([{ name: 'Traditional Photographer' }], LIBRARY),
    )
    expect(groups.map((g) => g.stage)).toEqual(['pre', 'production', 'post'])
    expect(groups[1]!.options.map((o) => o.name)).toEqual(['Traditional Photographer', 'Candid Photographer'])
    expect(groups.map((g) => g.tone)).toEqual(['violet', 'blue', 'green'])
  })
})

describe('stageOfRequirement', () => {
  it('uses the option list when it knows the name, and the name otherwise', () => {
    const opts = requirementOptions([], LIBRARY)
    expect(stageOfRequirement('ALBUM DESIGNER', opts)).toBe('post')
    expect(stageOfRequirement('Drone Operator', opts)).toBe('production')
  })
})
