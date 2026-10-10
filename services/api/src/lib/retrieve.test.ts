import { describe, expect, it } from 'vitest'
import { DOCS, scoreDoc, selectHelp, words } from './retrieve'

/**
 * The retrieval eval.
 *
 * This is the guard on the one thing cutting the corpus breaks. Retrieval fails
 * silently: hand the model the wrong articles and it answers from them,
 * confidently, in the same tone as a right answer. Nothing downstream notices,
 * and the studio is sent to the wrong screen.
 *
 * So these are questions a studio would actually type -- not the article titles
 * read back -- each asserting the right article is among what gets sent. It
 * fails when somebody renames an article, adds one that shadows another, or
 * drops a keyword, which is exactly when quality dies quietly.
 */

const picked = (q: string) => selectHelp(q).docs.map((d) => d.key)
const finds = (q: string, key: string) => expect(picked(q), `${q} -> ${picked(q).join(', ')}`).toContain(key)

describe('the questions studios actually ask', () => {
  it('finds the team articles from the words people use', () => {
    finds('how do I add my team', 'kb:team-add')
    finds('how to add staff', 'kb:team-add')
    finds('add a new employee', 'kb:team-add')
    finds('how do I add a photographer', 'kb:team-add')
    finds('give someone a login', 'kb:team-logins')
    finds('my team member forgot his password', 'kb:team-logins')
  })

  it('finds money from the studio\'s words, not ours', () => {
    finds('how do I make a bill', 'kb:money-invoices')
    finds('record a payment I received', 'kb:money-payments')
    finds('where do I add an expense', 'kb:money-expenses')
    finds('how much profit did we make', 'kb:money-pnl')
    finds('pay my crew', 'kb:money-payouts')
    finds('what is my upi for paying staff', 'kb:money-pay-to')
  })

  it('finds leads and clients', () => {
    finds('how do I track enquiries', 'kb:leads-what')
    finds('qr code for a venue', 'kb:enquiry-forms')
    finds('facebook leads are not coming', 'kb:problem-facebook-leads')
    finds('send a quote to a customer', 'kb:quotation')
  })

  it('finds shoots, editing and data', () => {
    finds('book crew for a shoot day', 'kb:shoots-what')
    finds('give editing work to someone', 'kb:editing-give-work')
    finds('record the memory cards after a shoot', 'kb:data-what')
    finds('where do I approve an edit', 'kb:editing-review')
  })

  it('finds the team-time articles', () => {
    finds('turn on attendance', 'kb:attendance')
    finds('approve leave', 'kb:leave')
    finds('run salaries for the month', 'kb:payroll')
  })

  it('finds the plans without being told their name', () => {
    finds('what does it cost', 'kb:plans-prices')
    finds('how much is the subscription', 'kb:plans-prices')
    finds('how long is the free trial', 'kb:plans-trial')
  })

  it('finds a problem from how it is described', () => {
    finds('the app says failed to fetch', 'kb:problem-failed-to-fetch')
    finds('my logo is not showing', 'kb:problem-logo')
    finds('all the amounts show as dots', 'kb:problem-amounts-hidden')
    finds('attendance is not marking', 'kb:problem-attendance')
  })

  it('finds who-can-see-what', () => {
    finds('stop staff seeing money', 'kb:roles-access')
    finds('permissions for a manager', 'kb:roles-access')
  })
})

describe('it returns nothing rather than the least bad thing', () => {
  it('finds nothing for a question the help does not cover', () => {
    // An article picked because it scored 0.2 is worse than none: the model
    // answers from it. With nothing selected it still has the index and can say
    // what it does not have.
    const r = selectHelp('what is the weather in mumbai tomorrow')
    expect(r.empty).toBe(true)
    expect(r.docs).toEqual([])
  })

  it('finds nothing for an empty question', () => {
    expect(selectHelp('').empty).toBe(true)
  })

  it('finds nothing when the question carries no usable word', () => {
    expect(selectHelp('how do I do it with the and for').empty).toBe(true)
  })
})

describe('the budget', () => {
  it('keeps the selection small', () => {
    for (const q of ['how do I add my team', 'money', 'how do I send an invoice to a client and record the payment']) {
      expect(selectHelp(q).docs.length, q).toBeLessThanOrEqual(6)
    }
  })

  it('never returns nothing when something matched', () => {
    // A tiny budget must still answer with the best match rather than silently
    // deciding the help has nothing.
    const r = selectHelp('how do I add my team', 1)
    expect(r.empty).toBe(false)
    expect(r.docs).toHaveLength(1)
  })

  it('puts the team help at the top, article or chapter', () => {
    // The article "Adding your team" and the chapter "Add your team" tie on
    // terms, and both answer the question -- one is the reference, one is the
    // steps. Which of the two leads is not worth pinning; that both beat
    // everything else is.
    const top = selectHelp('how do I add my team').docs.slice(0, 2).map((d) => d.key)
    expect(top).toContain('kb:team-add')
    expect(top.every((k) => k.includes('team'))).toBe(true)
  })

  it('is deterministic', () => {
    expect(picked('how do I send an invoice')).toEqual(picked('how do I send an invoice'))
  })
})

describe('words', () => {
  it('drops the words that tell you nothing', () => {
    expect(words('How do I add my team?')).toEqual(['add', 'team'])
  })

  it('ties plurals and gerunds to the same stem', () => {
    expect(words('invoices')).toEqual(words('invoice'))
    expect(words('booking')).toEqual(words('book'))
    expect(words('expenses')).toEqual(words('expense'))
  })

  it('keeps the short words that carry meaning here', () => {
    // A longer stop list starts eating the domain: "add", "pay", "set" all
    // matter in this app.
    expect(words('add pay')).toEqual(['add', 'pay'])
  })

  it('handles punctuation and other scripts without falling over', () => {
    expect(words('अवधि kya hai?')).toContain('kya')
    expect(words('₹1,00,000 plan!!')).toContain('plan')
  })
})

describe('scoring', () => {
  it('weighs a title or keyword hit above a body hit', () => {
    const team = DOCS.find((d) => d.key === 'kb:team-add')!
    const withTitle = scoreDoc(words('team'), team)
    const other = DOCS.find((d) => d.key === 'kb:money-pnl')!
    expect(withTitle).toBeGreaterThan(scoreDoc(words('team'), other))
  })

  it('scores nothing for a question with no usable words', () => {
    expect(scoreDoc([], DOCS[0]!)).toBe(0)
  })
})

describe('the corpus it searches', () => {
  it('holds every article and every chapter', () => {
    expect(DOCS.filter((d) => d.key.startsWith('kb:')).length).toBeGreaterThan(80)
    expect(DOCS.filter((d) => d.key.startsWith('guide:')).length).toBeGreaterThan(20)
  })

  it('gives every article something to match on', () => {
    for (const d of DOCS) expect(d.terms.length, d.key).toBeGreaterThan(0)
  })
})
