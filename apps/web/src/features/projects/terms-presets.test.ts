import { describe, expect, it } from 'vitest'
import { defaultTermsBody, readLocalPresets } from './terms-presets'

describe('terms presets', () => {
  it('reads the presets a browser saved before they were shared', () => {
    const raw = JSON.stringify([{ id: '1', title: ' Wedding ', body: '50% advance' }, { id: '2', title: '', body: 'x' }, { title: 'No body' }])
    expect(readLocalPresets(raw)).toEqual([{ title: 'Wedding', body: '50% advance' }])
    expect(readLocalPresets('not json')).toEqual([])
    expect(readLocalPresets(null)).toEqual([])
  })

  it('finds the default', () => {
    const id = '00000000-0000-4000-8000-000000000001'
    expect(defaultTermsBody([{ id, title: 'A', body: 'a', is_default: false }])).toBeNull()
    expect(defaultTermsBody([{ id, title: 'B', body: 'b', is_default: true }])).toBe('b')
  })
})
