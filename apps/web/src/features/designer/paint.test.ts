import { describe, expect, it } from 'vitest'
import { designPaint } from '@ipc/contracts'
import { GRADIENTS, PALETTE, cssPaint, hexFrom, isPaint, makeGradient, parseGradient } from './paint'

describe('designer paints', () => {
  it('reads solid colours and gradients, and refuses anything else', () => {
    expect(isPaint('#C9A55C')).toBe(true)
    expect(isPaint('lg:135:#F6E3B4:#C9A55C:#8A6A2E')).toBe(true)
    expect(isPaint('rg:#FFFFFF:#000000')).toBe(true)
    expect(isPaint('lg:360:#FFFFFF:#000000')).toBe(false)
    expect(isPaint('lg:90:#FFFFFF')).toBe(false)
    expect(isPaint('url(javascript:x)')).toBe(false)
    expect(designPaint.safeParse('red; background: url(x)').success).toBe(false)
  })

  it('writes CSS for each kind, with a fallback', () => {
    expect(cssPaint('#112233', '#fff')).toBe('#112233')
    expect(cssPaint('lg:135:#AAAAAA:#BBBBBB', '#fff')).toBe('linear-gradient(135deg, #AAAAAA, #BBBBBB)')
    expect(cssPaint('rg:#AAAAAA:#BBBBBB:#CCCCCC', '#fff')).toBe('radial-gradient(circle at center, #AAAAAA, #BBBBBB, #CCCCCC)')
    expect(cssPaint('', '#fff')).toBe('#fff')
    expect(cssPaint('nonsense', '#fff')).toBe('#fff')
  })

  it('makes and parses a gradient the same way', () => {
    const p = makeGradient({ kind: 'linear', angle: 450, stops: ['#aaaaaa', '#bbbbbb'] })
    expect(p).toBe('lg:90:#AAAAAA:#BBBBBB')
    expect(parseGradient(p)).toEqual({ kind: 'linear', angle: 90, stops: ['#AAAAAA', '#BBBBBB'] })
    expect(parseGradient('#AAAAAA')).toBeNull()
  })

  it('ships only paints the contract accepts', () => {
    for (const g of GRADIENTS) expect(designPaint.safeParse(g.paint).success, g.name).toBe(true)
    for (const f of PALETTE) for (const c of f.colours) expect(isPaint(c), c).toBe(true)
    expect(PALETTE.flatMap((f) => f.colours).length).toBeGreaterThanOrEqual(80)
  })

  it('takes a typed hex code', () => {
    expect(hexFrom('c9a55c')).toBe('#C9A55C')
    expect(hexFrom('#fa0')).toBe('#FFAA00')
    expect(hexFrom('gold')).toBeNull()
  })
})
