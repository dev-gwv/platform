import { token } from './gauth.mjs'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, writeFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
const HERE = new URL('.', import.meta.url).pathname
const CACHE = join(HERE, 'clips'); mkdirSync(CACHE, { recursive: true })
export const VOICE = { en: 'en-IN-Chirp3-HD-Aoede', hi: 'hi-IN-Chirp3-HD-Aoede' }
let tok = null
/** Text -> a cached 24 kHz mono WAV; returns { file, secs }. */
export async function say(text, lang) {
  const name = VOICE[lang]
  const file = join(CACHE, createHash('sha1').update(name + '|' + text).digest('hex').slice(0, 16) + '.wav')
  if (!existsSync(file)) {
    tok ??= await token()
    const r = await fetch('https://texttospeech.googleapis.com/v1/text:synthesize', {
      method: 'POST', headers: { authorization: `Bearer ${tok}`, 'content-type': 'application/json' },
      body: JSON.stringify({ input: { text }, voice: { languageCode: name.slice(0, 5), name }, audioConfig: { audioEncoding: 'LINEAR16', sampleRateHertz: 24000 } }),
    })
    const j = await r.json()
    if (!r.ok) throw new Error('tts ' + r.status + ' ' + (j.error?.message ?? ''))
    writeFileSync(file, Buffer.from(j.audioContent, 'base64'))
  }
  return { file, secs: (statSync(file).size - 44) / 48000 }
}
