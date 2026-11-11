import { describe, expect, it } from 'vitest'
import { adScriptReply, adScriptRequest } from '@ipc/contracts'
import { adScriptMessages, anglesFor, hookKindsFor, languageProblem, languageRetry, parseAdScripts, partTimes, spokenSeconds, wordBudget, wordsIn } from './ad-script-writer'

const ask = (over: Record<string, unknown> = {}) => adScriptRequest.parse({ studio: 'Mehta Studios', city: 'Pune', ...over })

describe('ad script writer', () => {
  it('lets the AI pick three different angles, or three takes on one', () => {
    expect(anglesFor(ask())).toEqual(['how_to_choose', 'invite', 'story'])
    expect(anglesFor(ask({ angle: 'myth' }))).toEqual(['myth', 'myth', 'myth'])
    expect(anglesFor(ask({ angle: 'story', count: 1 }))).toEqual(['story'])
  })

  it('carries only the numbers the studio gave', () => {
    const none = adScriptMessages(ask({ weddings: '', rating: '' }))[1]!.content
    expect(none).not.toMatch(/Weddings shot so far|Google rating|Years in business/)
    const some = adScriptMessages(ask({ weddings: 500, rating: 4.8, strengths: ['Cinematic films', 'Drone'] }))[1]!.content
    expect(some).toContain('Weddings shot so far: 500')
    expect(some).toContain('Google rating: 4.8 out of 5')
    expect(some).toContain('Cinematic films; Drone')
    expect(some).toContain('Studio name: Mehta Studios')
    // The owner's sample is a voice to learn, never copied with its studio.
    expect(some).not.toContain('The Wed Story')
  })

  it('fits the words to the length and language', () => {
    const sys = adScriptMessages(ask({ seconds: 30, language: 'en' }))[0]!.content
    expect(sys).toContain(`at most ${wordBudget(30, 'en')} spoken words`)
    expect(sys).toContain('Indian English')
    expect(wordBudget(60, 'hi')).toBeLessThan(wordBudget(60, 'en'))
    expect(spokenSeconds(132, 'hi')).toBe(60)
    expect(wordsIn('शादी की तैयारी — चल रही है?  ')).toBe(6)
  })

  it('reads the answer forgivingly', () => {
    const raw = `Here you go!
=== SCRIPT 1
**TITLE:** Don't judge by Instagram
HOOK: "शादी की तैयारी चल रही है?"
[3-15] सच बताऊँ, फोटोग्राफर चुनना आसान नहीं होता।
2-3 गलतियाँ सब करते हैं।
(15–45 s) Mehta Studios पूरी शादी कवर करता है।
45-60 sec: नीचे Get Quote दबाइए।
ON SCREEN: 500+ शादियाँ | Get Quote
FOR THE MODEL: Smile, slow down on the ask.
=== SCRIPT
TITLE: Invite
[0-3] Pune में शादी है?
[3-60] हम हैं Mehta Studios।
=== SCRIPT
`
    const out = parseAdScripts(raw, ask())
    expect(out).toHaveLength(2)
    expect(out[0]).toMatchObject({
      angle: 'how_to_choose',
      title: "Don't judge by Instagram",
      hook: 'शादी की तैयारी चल रही है?',
      on_screen: ['500+ शादियाँ', 'Get Quote'],
      model_notes: 'Smile, slow down on the ask.',
    })
    expect(out[0]!.parts.map((p) => p.at)).toEqual(['3–15 s', '15–45 s', '45–60 s'])
    // A line of speech that starts with "2-3" stays speech.
    expect(out[0]!.parts[0]!.text).toContain('2-3 गलतियाँ')
    expect(out[1]).toMatchObject({ angle: 'invite', hook: 'Pune में शादी है?' })
    expect(out[1]!.seconds).toBe(spokenSeconds(out[1]!.words, 'hi'))
    expect(() => adScriptReply.parse({ scripts: out })).not.toThrow()
  })

  it('takes an answer with no markers as one script, and drops an empty one', () => {
    const one = parseAdScripts('Shaadi ki planning chal rahi hai?\nHum hain Mehta Studios.', ask({ angle: 'invite', count: 1, language: 'hinglish' }))
    expect(one).toHaveLength(1)
    expect(one[0]).toMatchObject({ hook: 'Shaadi ki planning chal rahi hai?', parts: [{ at: '', text: 'Hum hain Mehta Studios.' }] })
    expect(parseAdScripts('=== SCRIPT\nTITLE: x\n=== SCRIPT', ask())).toEqual([])
  })

  it('refuses a studio with no name', () => {
    expect(adScriptRequest.safeParse({ studio: '' }).success).toBe(false)
    expect(adScriptRequest.safeParse({ studio: 'A', seconds: 90 }).success).toBe(false)
  })
})

describe('ad script writer, after the live test (11 Nov)', () => {
  const all = (m: ReturnType<typeof adScriptMessages>) => m.map((x) => x.content).join('\n')

  it('says the language hard, with examples in that language only', () => {
    const en = all(adScriptMessages(ask({ language: 'en' })))
    expect(en).toContain('English only')
    expect(en).not.toMatch(/\p{Script=Devanagari}/u)
    const hi = adScriptMessages(ask({ language: 'hi' }))
    expect(hi[0]!.content.trim().endsWith('Never write Hindi in Roman letters.')).toBe(true)
    expect(hi[1]!.content).toContain('इंस्टाग्राम की सुंदर फोटो')
    expect(hi[1]!.content.trim().endsWith('Never write Hindi in Roman letters.')).toBe(true)
  })

  it('gives each script its own way to open, and knows the hooks already written', () => {
    expect(hookKindsFor(['how_to_choose', 'invite', 'story'], true)).toEqual(['truth', 'callout', 'scene'])
    expect(new Set(hookKindsFor(['myth', 'myth', 'myth'], false)).size).toBe(3)
    expect(hookKindsFor(['myth', 'myth', 'myth', 'myth', 'myth'], false)).not.toContain('number')
    const m = adScriptMessages(ask({ angle: 'invite', count: 1, avoid_hooks: ['शादी की प्लानिंग चल रही है?'] }))[1]!.content
    expect(m).toContain('Open differently from these hooks already written:\n- शादी की प्लानिंग चल रही है?')
  })

  it('never invites a story or a rounded-up number', () => {
    const m = all(adScriptMessages(ask({ weddings: 300, years: 8 })))
    expect(m).not.toContain('her own wedding planning')
    expect(m).toContain('say exactly 300, never "300+"')
    expect(m).toContain('"8 years of experience"')
  })

  it('times the blocks to the length', () => {
    expect(partTimes(30)).toEqual([[3, 10], [10, 24], [24, 30]])
    expect(partTimes(45)).toEqual([[3, 13], [13, 36], [36, 45]])
    expect(partTimes(60)).toEqual([[3, 15], [15, 48], [48, 60]])
    expect(adScriptMessages(ask({ seconds: 30 }))[1]!.content).toContain('[24-30] at most')
  })

  it('reads the budget a model may echo out of a part', () => {
    const out = parseAdScripts('=== SCRIPT\nHOOK: Hi there\n[3-10] at most 15 words: The real line.', ask({ angle: 'invite', count: 1, language: 'en' }))
    expect(out[0]!.parts[0]!.text).toBe('The real line.')
  })

  it('catches the wrong language the live test found', () => {
    const e1 = {
      hook: 'Shaadi ka budget tight hai?',
      parts: [{ at: '3–15 s', text: '(She) "Sabse pehle log sirf price dekhte hain, aur phir regret hota hai." (He) "Humne Mehta Studios se poora portfolio poocha."' }],
    }
    expect(languageProblem(e1, 'en', 'Mehta Studios')).toMatch(/Hinglish/)
    const v2 = {
      hook: 'Shaadi ki planning chal rahi hai?',
      parts: [{ at: '3–15 s', text: 'Main Mehta Studios ki team se hoon, Pune mein 8 saal se 300 shaadiyon ko capture kar rahe hain.' }],
    }
    expect(languageProblem(v2, 'hi', 'Mehta Studios')).toMatch(/Devanagari/)
    const s3 = {
      hook: 'दुल्हन का पहला कदम, वो अनमोल पल।',
      parts: [{ at: '15–45 s', text: 'Mehta Studios ने 300 शादियों में हर भाव को कैंडिड कैमरे और ड्रोन से जिंदा किया है। Get Quote बटन पर टैप करें।' }],
    }
    expect(languageProblem(s3, 'hi', 'Mehta Studios')).toBeNull()
    const romanHook = { hook: 'Shaadi ki planning chal rahi hai?', parts: s3.parts }
    expect(languageProblem(romanHook, 'hi', 'Mehta Studios')).toBeTruthy()
    expect(languageProblem({ hook: 'Your day, filmed like a movie.', parts: [{ at: '', text: 'Mehta Studios covers the haldi, the pheras and the vidaai.' }] }, 'en')).toBeNull()
    expect(languageProblem({ hook: 'शादी है?', parts: [] }, 'hinglish')).toMatch(/Roman/)
  })

  it('asks once more naming each script that missed', () => {
    const m = languageRetry([{ n: 2, why: 'was not in Devanagari; write every line in Hindi script' }], 'hi')
    expect(m.content).toContain('Script 2 was not in Devanagari')
    expect(m.content).toContain('LANGUAGE: Hindi in Devanagari')
  })
})
