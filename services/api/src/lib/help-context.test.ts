import { describe, expect, it } from 'vitest'
import { KB } from '@ipc/help'
import { composeHelpContext, estimateTokens, linksMentioned } from './help-context'
import { DOCS } from './retrieve'

/**
 * The help that goes with one question.
 *
 * The ceiling here is the point of the file. The assistant used to send the
 * whole corpus -- about 13,640 tokens -- against Groq's 8,000 a minute for
 * gpt-oss-120b, so one question was larger than the whole per-minute budget.
 * These tests hold the new shape: a small stable block the provider caches
 * (and cached tokens cost neither money nor rate limit), plus only the articles
 * a question is actually about.
 */

const ask = (q: string) => composeHelpContext(q)

/**
 * The whole help portion of the prompt, for one question, in tokens.
 *
 * Not a target -- a ceiling with room in it. If a question ever needs more than
 * this, something is sending the corpus again by accident, and on the free tier
 * that is the difference between a question that works and one that is refused.
 */
const PROMPT_CEILING = 4_000

describe('one question fits in the rate limit', () => {
  it(`costs under ${PROMPT_CEILING} tokens, help and all`, () => {
    for (const q of [
      'How do I add my team?',
      'how do I send an invoice',
      'what does it cost',
      'attendance not marking',
    ]) {
      expect(ask(q).tokens, q).toBeLessThan(PROMPT_CEILING)
    }
  })

  it('is far smaller than sending everything', () => {
    // The whole corpus is ~13,640 tokens. If this creeps back up, the selection
    // has stopped selecting.
    expect(ask('How do I add my team?').tokens).toBeLessThan(5_000)
  })

  it('still carries enough to answer from', () => {
    // The other way it breaks: selection returns almost nothing and the model
    // answers from memory, which reads fine and is wrong.
    expect(estimateTokens(ask('How do I add my team?').selected)).toBeGreaterThan(80)
  })
})

describe('the stable block', () => {
  it('names every article and chapter, whatever was selected', () => {
    // This is what makes cutting the corpus safe: the model always knows what
    // exists, so a retrieval miss becomes "there is an article on X" rather
    // than an invention.
    const ctx = ask('something nobody has ever asked about')
    for (const d of DOCS) expect(ctx.stable, d.title).toContain(d.title)
  })

  it('lists the tutorials', () => {
    expect(ask('anything').stable).toContain('Add one person to your team')
  })

  it('includes the editable answers', () => {
    const ctx = composeHelpContext('anything', [{ question: 'Can I change a quotation?', answer: 'Yes.' }])
    expect(ctx.stable).toContain('Can I change a quotation?')
    expect(ctx.stable).toContain('COMMON QUESTIONS')
  })

  it('works with no editable answers at all', () => {
    expect(ask('anything').stable).not.toContain('COMMON QUESTIONS')
  })

  it('strips bold markers, from articles and from an edited answer alike', () => {
    // The FAQs were once the one source not run through plain(), so an admin
    // writing **bold** put literal stars in the prompt and the model copied
    // them into its answers.
    const ctx = composeHelpContext('How do I add my team?', [
      { question: 'Press **Book**?', answer: 'Yes, **Book**.' },
    ])
    expect(ctx.stable).toContain('Press Book?')
    expect(`${ctx.stable}\n${ctx.selected}`).not.toContain('**')
  })
})

describe('the stable block stays cacheable', () => {
  /**
   * Cached tokens count against neither the bill nor the rate limit, so this is
   * the test that keeps the feature inside 8,000 tokens a minute. It fails the
   * moment anything per-request leaks into the part that must not change.
   */
  it('is identical for two different questions', () => {
    expect(ask('How do I add my team?').stable).toBe(ask('how do I record a payment').stable)
  })

  it('carries nothing per-request', () => {
    const text = ask('anything').stable
    const iso = new Date().toISOString()
    // A literal clock time is deliberately not checked: the guide and the
    // shoots article both print example hours ("4:00 pm-9:00 pm"), which is
    // corpus content, not a leak.
    expect(text).not.toContain(iso.slice(0, 10))
    expect(text).not.toContain(iso.slice(0, 7))
    expect(text).not.toContain(new Date().toDateString())
    expect(text).not.toMatch(/\b20\d{2}-\d{2}-\d{2}\b/)
  })

  it('does not reorder between builds', () => {
    expect(ask('x').stable).toBe(ask('y').stable)
  })
})

describe('the selected block', () => {
  it('carries the article a question is about, with where it is', () => {
    const ctx = ask('How do I add my team?')
    expect(ctx.selected).toContain('Where: Team → People')
  })

  it('does not carry the whole knowledge base', () => {
    const ctx = ask('How do I add my team?')
    const carried = KB.filter((a) => ctx.selected.includes(`### ${a.title}`)).length
    expect(carried).toBeGreaterThan(0)
    expect(carried).toBeLessThan(10)
  })

  it('says so plainly when nothing matched', () => {
    // Better than handing over the least-bad article: the model answers from
    // whatever it is given, confidently, and the studio is sent to the wrong
    // screen.
    const ctx = ask('zzzz qqqq xyzzy')
    expect(ctx.selected).toContain('Nothing in the help matched')
    expect(ctx.selected).toContain('offer the call')
  })
})

describe('links', () => {
  it('offers every article and chapter as a possible link', () => {
    // The index names them all, so an answer may name any of them.
    expect(ask('anything').links).toHaveLength(DOCS.length)
  })

  it('offers a link for a knowledge-base article', () => {
    const roles = ask('anything').links.find((l) => l.title === 'Roles & access: who can see what')
    expect(roles?.to).toBe('/settings/roles')
  })
})

describe('linksMentioned does not offer the wrong screen', () => {
  const links = [
    { title: 'Salaries and payslips', to: '/payroll', video: 'salaries' },
    { title: 'Clients', to: '/clients', video: null },
    { title: 'Reports', to: '/reports', video: null },
    { title: 'Send the quotation', to: '/projects', video: 'quotation' },
    { title: 'The quotation', to: '/projects', video: null },
  ]

  it('ignores a one-word title, however often it appears', () => {
    // "Clients" and "Reports" are article titles AND words half of all answers
    // use. Matching them offered a link to the wrong article constantly.
    expect(linksMentioned('Open Reports to see your clients and their reports.', links)).toEqual([])
  })

  it('still offers a title said in full', () => {
    expect(linksMentioned('Run the month on Salaries and payslips.', links).map((l) => l.title)).toEqual([
      'Salaries and payslips',
    ])
  })

  it('prefers the most specific title, not the alphabetically first', () => {
    expect(linksMentioned('Press Send the quotation when you are happy.', links)[0]!.title).toBe('Send the quotation')
  })

  it('offers one screen once', () => {
    expect(linksMentioned('Use Send the quotation; The quotation is the document.', links)).toHaveLength(1)
  })

  it('does not match a title inside a longer word', () => {
    expect(linksMentioned('unsalaries and payslipsx', links)).toEqual([])
  })

  it('caps at three', () => {
    const many = Array.from({ length: 8 }, (_, i) => ({
      title: `Chapter number ${i} of the guide`,
      to: `/p${i}`,
      video: null,
    }))
    expect(linksMentioned(many.map((l) => l.title.toLowerCase()).join(' and '), many)).toHaveLength(3)
  })
})

describe('estimateTokens', () => {
  it('is in the right order of magnitude', () => {
    expect(estimateTokens('a'.repeat(400))).toBe(100)
    expect(estimateTokens('')).toBe(0)
  })
})
