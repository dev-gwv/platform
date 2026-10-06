import { createSign } from 'node:crypto'
export async function token() {
  const email = process.env.GOOGLE_SA_EMAIL, key = (process.env.GOOGLE_SA_PRIVATE_KEY || '').replace(/\\n/g, '\n')
  if (!email || !key) throw new Error('service account not set')
  const now = Math.floor(Date.now() / 1000)
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url')
  const unsigned = b64({ alg: 'RS256', typ: 'JWT' }) + '.' + b64({ iss: email, scope: 'https://www.googleapis.com/auth/cloud-platform', aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 })
  const sig = createSign('RSA-SHA256').update(unsigned).sign(key).toString('base64url')
  const r = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${unsigned}.${sig}` })
  const j = await r.json()
  if (!j.access_token) throw new Error('token failed: ' + r.status + ' ' + (j.error || '') + ' ' + (j.error_description || ''))
  return j.access_token
}
