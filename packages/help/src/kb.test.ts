import { describe, expect, it } from 'vitest'
import { KB, type KbArea } from './kb'
import { TUTORIALS } from './tutorials'

/**
 * The knowledge base is the assistant's whole reference, so what is checked
 * here is the shape a wrong article would have: a dead link, a video that does
 * not exist, an article so long it crowds the prompt, or a duplicate key that
 * silently shadows another answer.
 */

const keys = KB.map((a) => a.key)
const words = (a: { body: readonly string[] }) => a.body.join(' ').split(/\s+/).length

describe('every article is well formed', () => {
  it('has a unique key', () => {
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('uses keys that read as slugs', () => {
    for (const k of keys) expect(k).toMatch(/^[a-z][a-z0-9-]{2,39}$/)
  })

  it('has a title and something to say', () => {
    for (const a of KB) {
      expect(a.title.trim().length).toBeGreaterThan(3)
      expect(a.body.length).toBeGreaterThan(0)
      for (const line of a.body) expect(line.trim().length).toBeGreaterThan(0)
    }
  })

  it('points only at tutorials that exist', () => {
    // A video key that has been renamed would offer a chip that plays nothing.
    const shipped = new Set(TUTORIALS.map((t) => t.key))
    for (const a of KB) if (a.video) expect(shipped.has(a.video), `${a.key} → ${a.video}`).toBe(true)
  })

  it('points only at real-looking screens', () => {
    for (const a of KB) if (a.to) expect(a.to, a.key).toMatch(/^\/[a-z0-9/$:-]*$/)
  })

  it('says where it is by the menu, not by a path', () => {
    // The prompt tells the model to navigate by menu names, and it can only do
    // that if the articles are written that way.
    for (const a of KB) if (a.menu) expect(a.menu, a.key).not.toMatch(/^\//)
  })
})

describe('the articles stay short', () => {
  it('keeps every one under 250 words', () => {
    // These are read aloud by an assistant answering one question, not studied.
    // A long article also crowds every other answer out of the prompt.
    for (const a of KB) expect(words(a), `${a.key} is ${words(a)} words`).toBeLessThan(250)
  })

  it('stays within its share of the prompt', () => {
    const total = KB.reduce((n, a) => n + words(a), 0)
    // ~4 chars a token, ~5.5 chars a word: 9,000 words is about 12k tokens,
    // comfortably inside the 30k ceiling in help-context.test.ts with the
    // guide, the tutorials and the FAQs alongside it.
    expect(total).toBeLessThan(9_000)
  })
})

describe('the app is actually covered', () => {
  it('has articles in every area', () => {
    const areas: KbArea[] = [
      'Start', 'Leads', 'Clients', 'Projects', 'Shoots', 'Editing',
      'Data', 'Money', 'Team', 'Reports', 'Settings', 'Plans', 'Problems',
    ]
    for (const area of areas) {
      expect(KB.filter((a) => a.area === area).length, `no article for ${area}`).toBeGreaterThan(0)
    }
  })

  it('covers the things that had no help at all', () => {
    // The audit that prompted this file: these are the areas a studio could
    // open and the assistant could say nothing about. If one is dropped, the
    // assistant quietly goes back to inventing an answer for it.
    for (const k of [
      'tasks', 'reports', 'money-pnl', 'money-cost-sheet', 'roles-access',
      'delivery-stages', 'project-templates', 'invoicing-settings', 'vendors',
      'lists', 'messaging', 'whatsapp-own-number', 'client-portal', 'alerts',
      'editing-review', 'wishes', 'referrals-clients', 'activity',
      'enquiry-forms', 'lead-sources', 'leads-setup', 'leads-send', 'leads-reports',
    ]) {
      expect(keys, `${k} is missing`).toContain(k)
    }
  })

  it('answers what it costs, and only with the live prices', () => {
    const plans = KB.filter((a) => a.area === 'Plans')
    expect(plans.length).toBeGreaterThan(2)
    const said = plans.flatMap((a) => a.body).join(' ')
    // The live rows: the Diamond tiers and the one outsider plan.
    expect(said).toContain('₹1,999')
    expect(said).toContain('₹18,000')
    expect(said).toContain('₹33,000')
    expect(said).toContain('₹1,00,000')
    expect(said).toContain('18% GST')
    // Starter, Pro and Studio Max are is_active = false and shown to nobody.
    // Quoting them would price a studio out of a plan it cannot buy.
    for (const dead of ['17,988', '29,988', '47,988', 'Starter', 'Studio Max']) {
      expect(KB.flatMap((a) => a.body).join(' '), `${dead} is not a live plan`).not.toContain(dead)
    }
  })

  it('never promises anything about a studio\'s own bill', () => {
    // Those questions hard-escalate in needsHuman(); the KB must not undercut
    // that by appearing to answer them.
    const said = KB.flatMap((a) => a.body).join(' ').toLowerCase()
    expect(said).not.toMatch(/we will refund|you will be refunded|refunded within/)
  })
})
