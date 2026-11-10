import { describe, expect, it } from 'vitest'
import { captionRequest } from '@ipc/contracts'
import { captionMessages, parseCaptions } from './caption-writer'

describe('caption writer', () => {
  it('asks for three captions in the chosen language, without hashtags on a status', () => {
    const m = captionMessages(captionRequest.parse({ kind: 'wedding_post', platform: 'whatsapp_status', language: 'hinglish', details: 'Priya & Rahul, Udaipur' }))
    expect(m[0]!.content).toContain('Hinglish')
    expect(m[1]!.content).toContain('Write 3 different captions')
    expect(m[1]!.content).toContain('Use no hashtags.')
    expect(m[1]!.content).toContain('Priya & Rahul, Udaipur')
  })

  it('splits the captions and lifts the hashtag line out', () => {
    const raw = `1. Forever starts here ✨\nPriya & Rahul in Udaipur.\n#WeddingPhotography #Udaipur #Udaipur\n---\nOption 2: Two hearts, one story.\n---\n\n---\nA third one with #love inside.`
    const out = parseCaptions(raw)
    expect(out).toHaveLength(3)
    expect(out[0]).toEqual({ text: 'Forever starts here ✨\nPriya & Rahul in Udaipur.', hashtags: ['#WeddingPhotography', '#Udaipur'] })
    expect(out[1]!.text).toBe('Two hearts, one story.')
    expect(out[2]).toEqual({ text: 'A third one with #love inside.', hashtags: ['#love'] })
  })
})
