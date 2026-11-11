import { describe, expect, it } from 'vitest'
import { adScriptReply, adScriptRequest } from '@ipc/contracts'
import { adScriptMessages, anglesFor, parseAdScripts, spokenSeconds, wordBudget, wordsIn } from './ad-script-writer'

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
