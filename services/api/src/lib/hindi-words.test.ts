import { describe, expect, it } from 'vitest'
import { asEnglish, foldHindi } from './hindi-words'

describe('Hindi and Hinglish words, as the help writes them', () => {
  it('reads the app\'s English written in Devanagari', () => {
    expect(asEnglish('क्लाइंट')).toEqual(['client'])
    expect(asEnglish('कोटेशन')).toEqual(['quotation'])
    expect(asEnglish('इनवॉइस')).toEqual(['invoice'])
    expect(asEnglish('क्रू')).toEqual(['crew'])
  })

  it('reads the Hindi words for the same things', () => {
    expect(asEnglish('भुगतान')).toEqual(['payment'])
    expect(asEnglish('वेतन')).toEqual(['salary'])
    expect(asEnglish('छुट्टी')).toEqual(['leave'])
    expect(asEnglish('शादी')).toEqual(['wedding'])
  })

  it('does not care about a nukta or a chandrabindu', () => {
    // फ़ोटो and फोटो, करूँ and करूं: the same word typed on two keyboards.
    expect(foldHindi('फ़ोटो')).toBe(foldHindi('फोटो'))
    expect(asEnglish('फ़ोटो')).toEqual(['photo'])
    expect(asEnglish('जोड़ें')).toEqual(['add'])
    expect(asEnglish('जोडें')).toEqual(['add'])
    expect(asEnglish('करूँ')).toEqual([])
  })

  it('drops the words that only hold a sentence together', () => {
    for (const w of ['कैसे', 'करें', 'के', 'लिए', 'kaise', 'karu', 'ka', 'ko']) expect(asEnglish(w)).toEqual([])
  })

  it('reads the Hinglish that is not already English', () => {
    expect(asEnglish('kaam')).toEqual(['work'])
    expect(asEnglish('bhejna')).toEqual(['send'])
    expect(asEnglish('chutti')).toEqual(['leave'])
  })

  it('leaves English and unknown words to the caller', () => {
    // 'main' is English too -- the help says "main disk" -- so it is not a stop word.
    expect(asEnglish('main')).toBeNull()
    expect(asEnglish('payment')).toBeNull()
    expect(asEnglish('अनजानाशब्द')).toBeNull()
  })

  it('reads कर as "do", not "tax"', () => {
    // कैसे कर सकते हैं is a question about doing something, and reading it as
    // tax sent "how do I..." questions to the GST articles.
    expect(asEnglish('कर')).toEqual([])
  })
})
