import { token } from './gauth.mjs'
const t = await token()
for (const lang of ['en-IN', 'hi-IN']) {
  const r = await fetch(`https://texttospeech.googleapis.com/v1/voices?languageCode=${lang}`, { headers: { authorization: `Bearer ${t}` } })
  const j = await r.json()
  if (!r.ok) { console.log(lang, r.status, j.error?.message?.slice(0, 300)); continue }
  console.log(lang, j.voices.filter((v) => v.ssmlGender === 'FEMALE').map((v) => v.name).join(' '))
}
