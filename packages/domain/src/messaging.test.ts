import { describe, expect, it } from 'vitest'
import {
  canAfford,
  emailChargePaise,
  emailQuote,
  fillTemplate,
  paymentReminderStage,
  formatPaise,
  freeEmailsLeft,
  messageMarginPaise,
  messagePricePaise,
  messagesLeft,
  templateParams,
  templatePlaceholderCount,
} from './messaging'

describe('messagePricePaise', () => {
  it('adds the percentage and the fixed markup to the cost', () => {
    expect(messagePricePaise({ meta_cost_paise: 12, markup_pct: 25, markup_fixed_paise: 5 })).toBe(12 + 3 + 5)
  })
  it('rounds the percentage part up to a whole paisa', () => {
    // 12 * 20% = 2.4 -> 3
    expect(messagePricePaise({ meta_cost_paise: 12, markup_pct: 20, markup_fixed_paise: 0 })).toBe(15)
    // 78 * 10% = 7.8 -> 8
    expect(messagePricePaise({ meta_cost_paise: 78, markup_pct: 10, markup_fixed_paise: 0 })).toBe(86)
  })
  it('does not add a paisa to an exact result through float error', () => {
    // 100 * 7% = 7 exactly, 30 * 10% = 3 exactly.
    expect(messagePricePaise({ meta_cost_paise: 100, markup_pct: 7, markup_fixed_paise: 0 })).toBe(107)
    expect(messagePricePaise({ meta_cost_paise: 30, markup_pct: 10, markup_fixed_paise: 0 })).toBe(33)
    expect(messagePricePaise({ meta_cost_paise: 10, markup_pct: 0.1, markup_fixed_paise: 0 })).toBe(11)
  })
  it('handles zero cost (email) and no markup', () => {
    expect(messagePricePaise({ meta_cost_paise: 0, markup_pct: 50, markup_fixed_paise: 20 })).toBe(20)
    expect(messagePricePaise({ meta_cost_paise: 12, markup_pct: 0, markup_fixed_paise: 0 })).toBe(12)
  })
  it('never goes negative on bad input', () => {
    expect(messagePricePaise({ meta_cost_paise: -5, markup_pct: -10, markup_fixed_paise: -1 })).toBe(0)
  })
  it('margin is price minus cost', () => {
    expect(messageMarginPaise({ meta_cost_paise: 12, markup_pct: 25, markup_fixed_paise: 5 })).toBe(8)
  })
})

describe('email allowance', () => {
  it('is free up to the monthly allowance, then charged', () => {
    expect(emailChargePaise(0, 500, 20)).toEqual({ free: true, cost: 0 })
    expect(emailChargePaise(499, 500, 20)).toEqual({ free: true, cost: 0 })
    expect(emailChargePaise(500, 500, 20)).toEqual({ free: false, cost: 20 })
    expect(emailChargePaise(0, 0, 20)).toEqual({ free: false, cost: 20 })
  })
  it('counts what is left', () => {
    expect(freeEmailsLeft(120, 500)).toBe(380)
    expect(freeEmailsLeft(900, 500)).toBe(0)
  })
})

describe('wallet', () => {
  it('never goes below zero without an overdraft', () => {
    expect(canAfford(20, 20)).toBe(true)
    expect(canAfford(19, 20)).toBe(false)
    expect(canAfford(0, 0)).toBe(true)
  })
  it('allows up to the overdraft', () => {
    expect(canAfford(0, 20, 50)).toBe(true)
    expect(canAfford(0, 60, 50)).toBe(false)
  })
  it('counts messages left', () => {
    expect(messagesLeft(1000, 20)).toBe(50)
    expect(messagesLeft(19, 20)).toBe(0)
    expect(messagesLeft(0, 0)).toBe(Number.POSITIVE_INFINITY)
  })
  it('formats paise as rupees', () => {
    expect(formatPaise(50000)).toBe('₹500')
    expect(formatPaise(123456)).toBe('₹1,234.56')
    expect(formatPaise(20)).toBe('₹0.20')
    expect(formatPaise(-500)).toBe('-₹5')
  })
})

describe('templates', () => {
  it('counts placeholders by the highest number', () => {
    expect(templatePlaceholderCount('Hi {{1}}, {{2}} at {{3}}')).toBe(3)
    expect(templatePlaceholderCount('No vars')).toBe(0)
    expect(templatePlaceholderCount('{{2}} then {{ 1 }}')).toBe(2)
  })
  it('fills values, blank ones as a dash', () => {
    expect(fillTemplate('Hi {{1}}, {{2}}', ['Priya', ''])).toBe('Hi Priya, -')
  })
  it('sends exactly as many params as the body uses, none blank, no newlines', () => {
    expect(templateParams('Hi {{1}} {{2}}', ['Priya', 'Line\nbreak', 'extra'])).toEqual(['Priya', 'Line break'])
    expect(templateParams('Hi {{1}} {{2}}', ['Priya'])).toEqual(['Priya', '-'])
  })
})

describe('emailQuote', () => {
  const base = { monthEmails: 0, cap: 10000, freeUsed: 0, freeMonthly: 100, pricePaise: 20, canAfford: false }
  it('is free inside the 100 a month, and says how many are left', () => {
    expect(emailQuote(base)).toEqual({ kind: 'free', freeLeft: 100 })
    expect(emailQuote({ ...base, freeUsed: 99, monthEmails: 99 })).toEqual({ kind: 'free', freeLeft: 1 })
  })
  it('costs the price after the allowance, or waits for a recharge', () => {
    expect(emailQuote({ ...base, freeUsed: 100, monthEmails: 100, canAfford: true })).toEqual({ kind: 'paid', cost: 20 })
    expect(emailQuote({ ...base, freeUsed: 100, monthEmails: 100 })).toEqual({ kind: 'no_balance', cost: 20 })
  })
  it('stops at the monthly cap before anything else', () => {
    expect(emailQuote({ ...base, monthEmails: 10000, canAfford: true })).toEqual({ kind: 'limit' })
    expect(emailQuote({ ...base, monthEmails: 5, cap: 5 })).toEqual({ kind: 'limit' })
  })
})

describe('paymentReminderStage', () => {
  it('fires 3 days before, on the day, and 3 and 10 days after', () => {
    expect(paymentReminderStage('2026-10-10', '2026-10-07')).toBe('before_3')
    expect(paymentReminderStage('2026-10-10', '2026-10-10')).toBe('due')
    expect(paymentReminderStage('2026-10-10', '2026-10-13')).toBe('after_3')
    expect(paymentReminderStage('2026-10-10', '2026-10-20')).toBe('after_10')
  })
  it('is quiet on every other day, across a month end too', () => {
    for (const d of ['2026-10-06', '2026-10-08', '2026-10-09', '2026-10-11', '2026-10-14', '2026-10-21']) {
      expect(paymentReminderStage('2026-10-10', d)).toBeNull()
    }
    expect(paymentReminderStage('2026-10-29', '2026-11-01')).toBe('after_3')
  })
})
