import { describe, expect, it } from 'vitest'
import {
  chatHistory,
  escalateWhy,
  escalationPost,
  isOptWord,
  langOf,
  last10,
  plainForWhatsapp,
  silenceDue,
  soundsFixed,
  soundsUnfixed,
  windowOpen,
} from './support-chat'

const at = (iso: string) => Date.parse(iso)

describe('what the studio wrote in', () => {
  it('tells Hindi, Hinglish and English apart', () => {
    expect(langOf('प्रोजेक्ट कैसे बनाएं?')).toBe('hi')
    expect(langOf('invoice kaise banana hai?')).toBe('hinglish')
    expect(langOf('How do I add my team?')).toBe('en')
  })
})

describe('what the assistant hands to the owner', () => {
  it('a person, money, a plan, lost data, a bug, anger', () => {
    expect(escalateWhy('Please call me, I want to talk to someone')).toBe('person')
    expect(escalateWhy('mujhe kisi se baat karni hai')).toBe('person')
    expect(escalateWhy('payment deducted but plan not active')).toBe('money')
    expect(escalateWhy('paisa kat gaya par plan nahi aaya')).toBe('money')
    expect(escalateWhy('I want to upgrade my plan to Pro')).toBe('plan')
    expect(escalateWhy('my trial expired, please extend')).toBe('plan')
    expect(escalateWhy('all my leads are gone')).toBe('data')
    expect(escalateWhy('the invoice page is not loading')).toBe('bug')
    expect(escalateWhy('app nahi chal raha')).toBe('bug')
    expect(escalateWhy('worst software, fraud')).toBe('upset')
  })

  it('lets a how-to question through', () => {
    expect(escalateWhy('How do I add my team?')).toBeNull()
    expect(escalateWhy('quotation kaise bhejte hain client ko?')).toBeNull()
    expect(escalateWhy('where is the payments page')).toBeNull()
    expect(escalateWhy('how do I delete a lead')).toBeNull()
  })
})

describe('after an answer', () => {
  it('a short thanks closes it, a longer question does not', () => {
    expect(soundsFixed('Thanks, ho gaya 🙏')).toBe(true)
    expect(soundsFixed('ok thanks')).toBe(true)
    expect(soundsFixed('thanks, but how do I also send the invoice to the client after the shoot is over?')).toBe(false)
    expect(soundsFixed('thanks but still not working')).toBe(false)
  })

  it('"still not working" counts as a miss', () => {
    expect(soundsUnfixed('still not working')).toBe(true)
    expect(soundsUnfixed('nahi hua')).toBe(true)
    expect(soundsUnfixed('that did not help')).toBe(true)
    expect(soundsUnfixed('great, found it')).toBe(false)
  })
})

describe('timing', () => {
  it('replies freely only inside the 24-hour window', () => {
    expect(windowOpen('2026-11-12T10:00:00Z', at('2026-11-13T09:00:00Z'))).toBe(true)
    expect(windowOpen('2026-11-12T10:00:00Z', at('2026-11-13T10:00:00Z'))).toBe(false)
    expect(windowOpen(null)).toBe(false)
  })

  it('closes after two quiet days, never when they wrote since', () => {
    expect(silenceDue('2026-11-10T10:00:00Z', '2026-11-10T09:00:00Z', at('2026-11-12T10:01:00Z'))).toBe(true)
    expect(silenceDue('2026-11-10T10:00:00Z', '2026-11-10T09:00:00Z', at('2026-11-11T10:00:00Z'))).toBe(false)
    expect(silenceDue('2026-11-10T10:00:00Z', '2026-11-11T09:00:00Z', at('2026-11-13T10:00:00Z'))).toBe(false)
  })
})

describe('small helpers', () => {
  it('never makes a ticket of STOP', () => {
    expect(isOptWord(' STOP ')).toBe(true)
    expect(isOptWord('stop sending the quotation')).toBe(false)
  })

  it('matches a number by its last ten digits', () => {
    expect(last10('+91 98765-43210')).toBe('9876543210')
  })

  it('makes markdown plain for WhatsApp', () => {
    expect(plainForWhatsapp('## Steps\n- Open **Leads**\n- See [Add lead](/leads)')).toBe('Steps\n• Open *Leads*\n• See Add lead')
  })

  it('puts the conversation in turns, joining messages side by side', () => {
    const h = chatHistory([
      { dir: 'in', author: 'studio', body: 'hi' },
      { dir: 'in', author: 'studio', body: 'how to add team' },
      { dir: 'out', author: 'ai', body: 'Go to Team' },
    ])
    expect(h).toEqual([
      { role: 'user', content: 'hi\nhow to add team' },
      { role: 'assistant', content: 'Go to Team' },
    ])
  })

  it('tells the owner who, why and where to reply', () => {
    const p = escalationPost({ name: 'Asha', studioName: 'Mehta Studio', why: 'money', said: 'paisa kat gaya', link: 'https://x/t/1' })
    expect(p).toContain('Asha · Mehta Studio needs you (Money or a payment)')
    expect(p).toContain('Reply here: https://x/t/1')
  })
})
