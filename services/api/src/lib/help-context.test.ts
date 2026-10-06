import { describe, expect, it } from 'vitest'
import { CHAPTERS, TUTORIALS } from '@ipc/help'
import { composeHelpContext, estimateTokens, linksMentioned } from './help-context'

/**
 * The help corpus the assistant answers from (0247).
 *
 * The first test here is the one that matters: it is the tripwire under the
 * decision not to build retrieval. The whole corpus goes into every prompt
 * because it fits, and the day it stops fitting this test says so instead of
 * someone noticing that answers have gone vague.
 */

const ctx = composeHelpContext([{ question: 'Can I change a quotation?', answer: 'Yes, edit and resend.' }])

/**
 * The ceiling, not the current size. Today's corpus is about a quarter of this.
 * Crossing it means composeHelpContext() should start selecting chapters rather
 * than sending them all -- which is the point at which a search index earns its
 * keep, and not before.
 */
const TOKEN_CEILING = 30_000

describe('the corpus still fits in one prompt', () => {
  it(`is under ${TOKEN_CEILING} tokens`, () => {
    expect(ctx.tokens).toBeLessThan(TOKEN_CEILING)
  })

  it('is big enough to be the whole help, not a fragment', () => {
    // The other way this breaks: a refactor quietly drops most of the guide and
    // the assistant starts answering from almost nothing, which looks like a
    // model problem and is not.
    expect(ctx.tokens).toBeGreaterThan(1_500)
    expect(CHAPTERS.length).toBeGreaterThan(15)
  })
})

describe('composeHelpContext', () => {
  it('includes every chapter, with its steps', () => {
    for (const c of CHAPTERS) expect(ctx.text).toContain(c.title.en)
    expect(ctx.text).toContain('Press Add Team Member')
  })

  it('strips the guide\'s bold markers', () => {
    // `**Book**` is how the guide marks a button for the screen. The model only
    // needs the word, and the stars turn up verbatim in answers otherwise.
    expect(ctx.text).not.toContain('**')
  })

  it('says which screen a chapter is about, so an answer can point somewhere', () => {
    expect(ctx.text).toContain('Screen: /employees')
  })

  it('tells the owner\'s chapters from the team member\'s', () => {
    // Without this the assistant tells an owner to do something only a team
    // member sees on their own login.
    expect(ctx.text).toContain('[for the studio owner or manager]')
    expect(ctx.text).toContain('[for the team member]')
  })

  it('lists the tutorials', () => {
    for (const t of TUTORIALS.slice(0, 5)) expect(ctx.text).toContain(t.title)
  })

  it('includes the editable answers', () => {
    expect(ctx.text).toContain('Can I change a quotation?')
    expect(ctx.text).toContain('Yes, edit and resend.')
  })

  it('works with no answers at all', () => {
    // The FAQ read is allowed to fail; the shipped guide is the bulk of it.
    const bare = composeHelpContext()
    expect(bare.text).not.toContain('COMMON QUESTIONS')
    expect(bare.tokens).toBeGreaterThan(1_500)
  })

  it('offers a link for every chapter', () => {
    expect(ctx.links).toHaveLength(CHAPTERS.length)
  })
})

describe('linksMentioned', () => {
  const links = [
    { title: 'Add your team', to: '/employees', video: 'team-bulk' },
    { title: 'Send a quotation', to: '/projects', video: null },
    { title: 'Money', to: '/billing', video: null },
  ]

  it('returns only what the answer actually named', () => {
    const got = linksMentioned('Go and Add your team first.', links)
    expect(got.map((l) => l.title)).toEqual(['Add your team'])
  })

  it('ignores case', () => {
    expect(linksMentioned('add your team', links)).toHaveLength(1)
  })

  it('skips titles too short to match by accident', () => {
    // "Money" appears in half the answers this app will ever give; a link fired
    // by a common word is worse than no link.
    expect(linksMentioned('That is about money in general.', links)).toEqual([])
  })

  it('caps how many it offers', () => {
    const many = Array.from({ length: 9 }, (_, i) => ({ title: `Chapter number ${i}`, to: null, video: null }))
    const said = many.map((l) => l.title).join(' and ')
    expect(linksMentioned(said, many)).toHaveLength(3)
  })
})

describe('estimateTokens', () => {
  it('is in the right order of magnitude', () => {
    expect(estimateTokens('a'.repeat(400))).toBe(100)
    expect(estimateTokens('')).toBe(0)
  })
})
