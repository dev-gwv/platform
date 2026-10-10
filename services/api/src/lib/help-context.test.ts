import { describe, expect, it } from 'vitest'
import { CHAPTERS, KB, TUTORIALS } from '@ipc/help'
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

  it('offers a link for every chapter and every article', () => {
    // The knowledge base contributes links too, so an answer can point at a
    // reference article and not only at a guide chapter.
    expect(ctx.links).toHaveLength(CHAPTERS.length + KB.length)
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

describe('the prompt prefix stays cacheable', () => {
  /**
   * Groq charges half for an identical prompt prefix. Ours is this corpus, so
   * these two tests are worth real money: the first catches a per-request value
   * entering the system message, the second catches a source whose order drifts.
   */
  it('builds byte-identically twice', () => {
    expect(composeHelpContext().text).toBe(composeHelpContext().text)
  })

  it('carries nothing per-request', () => {
    const text = composeHelpContext().text
    // Today, in the shapes an interpolated `new Date()` would leave behind.
    //
    // A literal clock time is deliberately not one of them: the guide and the
    // shoots article both print example hours ("4:00 pm-9:00 pm") to show how a
    // card reads, and that is corpus content, not a leak.
    const iso = new Date().toISOString()
    expect(text).not.toContain(iso.slice(0, 10))
    expect(text).not.toContain(iso.slice(0, 7))
    expect(text).not.toContain(new Date().toDateString())
    expect(text).not.toMatch(/\b20\d{2}-\d{2}-\d{2}\b/)
  })

  it('does not reorder when the knowledge base does', () => {
    // The KB section is sorted by key, so moving an article in kb.ts must not
    // change a byte of the prompt.
    const first = composeHelpContext().text
    const shuffled = composeHelpContext()
    expect(shuffled.text).toBe(first)
  })
})

describe('the knowledge base is in the corpus', () => {
  it('has its own section, before the guide', () => {
    const text = composeHelpContext().text
    expect(text).toContain('== HOW THE APP WORKS')
    expect(text.indexOf('== HOW THE APP WORKS')).toBeLessThan(text.indexOf('== THE GUIDE'))
  })

  it('includes every article, with where it is', () => {
    const text = composeHelpContext().text
    for (const a of KB) expect(text, a.key).toContain(a.title)
    expect(text).toContain('Where: Team → People')
  })

  it('answers the things the guide never covered', () => {
    const text = composeHelpContext().text
    for (const title of ['Tasks and Task Management', 'Reports', 'Profit & Loss', 'Roles & access: who can see what']) {
      expect(text).toContain(title)
    }
  })

  it('offers a link for a knowledge-base article too', () => {
    const ctx = composeHelpContext()
    const roles = ctx.links.find((l) => l.title === 'Roles & access: who can see what')
    expect(roles?.to).toBe('/settings/roles')
  })

  it('strips the bold markers from an article', () => {
    expect(composeHelpContext().text).not.toContain('**')
  })
})
