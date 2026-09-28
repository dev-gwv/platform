import { describe, expect, it } from 'vitest'
import { deliverableKind, eventKind, roleKind } from './kinds'

describe('eventKind', () => {
  it.each([
    ['Wedding', 'wedding'],
    ['Pheras', 'wedding'],
    ['Pre-wedding shoot', 'prewedding'],
    ['Engagement', 'engagement'],
    ['Ring ceremony', 'engagement'],
    ['Haldi', 'haldi'],
    ['Mehndi', 'mehendi'],
    ['Sangeet & Cocktail', 'sangeet'],
    ['Reception', 'reception'],
    ['Maternity', 'baby'],
    ['1st Birthday', 'birthday'],
    ['Corporate event', 'corporate'],
    ['Product shoot', 'product'],
    ['Something else', 'other'],
    [null, 'other'],
  ] as const)('%s -> %s', (name, kind) => expect(eventKind(name)).toBe(kind))
})

describe('roleKind', () => {
  it.each([
    ['Candid Photographer', 'photo'],
    ['Traditional Videographer', 'video'],
    ['Cinematographer', 'video'],
    ['Drone Operator', 'drone'],
    ['Album Designer', 'album'],
    ['Video Editor', 'editor'],
    ['Creative Director', 'director'],
    ['Assistant Photographer', 'assistant'],
    ['BTS Shooter', 'video'],
    ['Makeup', 'other'],
  ] as const)('%s -> %s', (name, kind) => expect(roleKind(name)).toBe(kind))
})

describe('deliverableKind still works from its new home', () => {
  it('reads a teaser as a reel', () => expect(deliverableKind('Wedding Teaser')).toBe('reel'))
})
