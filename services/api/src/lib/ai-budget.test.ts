import { describe, expect, it } from 'vitest'
import { budgetVerdict, DEFAULT_DAY_TOKENS, DEFAULT_MINUTE_TOKENS } from './ai-budget'

/**
 * The ceiling in the provider's own units.
 *
 * What this guards is the gap 0247 left: two ceilings that counted questions,
 * against a provider that meters tokens and shares them across every studio at
 * once. The numbers below are Groq's actual free tier, so a change that makes
 * these pass by relaxing them is a change that puts the old bug back.
 */

const limits = { minute: DEFAULT_MINUTE_TOKENS, day: DEFAULT_DAY_TOKENS }
const none = { minute: 0, day: 0 }

describe('the day', () => {
  it('lets a question through on a quiet day', () => {
    expect(budgetVerdict(none, limits, 3_200).ok).toBe(true)
  })

  it('refuses the question that would go over, not the one after it', () => {
    // The point of counting the cost in: we would rather say it in our own
    // words than hand somebody the provider's 429.
    const v = budgetVerdict({ minute: 0, day: DEFAULT_DAY_TOKENS - 1_000 }, limits, 3_200)
    expect(v.ok).toBe(false)
    expect(v.ok === false && v.window).toBe('day')
  })

  it('says it is us, not them', () => {
    const v = budgetVerdict({ minute: 0, day: DEFAULT_DAY_TOKENS }, limits, 100)
    // Their own allowance may be untouched, so the sentence never blames them
    // and never mentions a limit they could have spent.
    expect(v.ok === false && v.why).toContain('tomorrow')
    expect(v.ok === false && v.why.toLowerCase()).not.toContain('you have asked')
  })
})

describe('the minute', () => {
  it('keeps a question back for the ones already in the air', () => {
    // 6,500 of 8,000 is under the limit and over the headroom: a question is
    // only logged once it is answered, so two that start together both see the
    // same figure and both think they fit.
    const v = budgetVerdict({ minute: 6_500, day: 0 }, limits, 1_700)
    expect(v.ok).toBe(false)
    expect(v.ok === false && v.window).toBe('minute')
  })

  it('asks for a minute rather than a day', () => {
    const v = budgetVerdict({ minute: 7_900, day: 0 }, limits, 1_700)
    expect(v.ok === false && v.why).toContain('a minute')
  })

  it('lets three cached questions through a minute, which is the whole design', () => {
    // ~1,700 counted tokens once the stable prefix is cached. 8,000 would hold
    // four of those; the headroom deliberately spends one of them on the race
    // described above, so three is the honest figure and four would mean the
    // reservation had been quietly dropped.
    //
    // If this starts failing low, something per-request has leaked into the
    // cached block and the feature is on its way back to fourteen questions a
    // day.
    let spent = 0
    let through = 0
    for (let i = 0; i < 5; i += 1) {
      if (budgetVerdict({ minute: spent, day: 0 }, limits, 1_700).ok) {
        through += 1
        spent += 1_700
      }
    }
    expect(through).toBe(3)
  })

  it('lets only one uncached question through, which is why the prompt is split', () => {
    // 13,640 tokens -- the whole corpus, the way it used to be sent -- does not
    // fit in a minute at all.
    expect(budgetVerdict(none, limits, 13_640).ok).toBe(false)
  })
})

describe('a ceiling somebody typed', () => {
  it('is used instead of the default', () => {
    expect(budgetVerdict({ minute: 0, day: 50_000 }, { minute: 8_000, day: 40_000 }, 100).ok).toBe(false)
    expect(budgetVerdict({ minute: 0, day: 50_000 }, { minute: 8_000, day: 900_000 }, 100).ok).toBe(true)
  })
})
