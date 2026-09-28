import type { Env } from '../context'
import { isDevLike } from './env'

/**
 * Encrypts a secret a studio gives us (its WhatsApp access token) before it
 * is stored, with AES-256-GCM under WHATSAPP_TOKEN_KEY. The database alone is
 * not enough to use a stolen row: the key lives only in the API's
 * environment. Stored as "v1:<base64 iv|ciphertext>".
 *
 * Without the key a production API refuses to store one (secretBoxReady);
 * a dev or CI one derives a stand-in from JWT_SECRET so tests can run.
 */
type KeyEnv = Pick<Env, 'ENVIRONMENT' | 'JWT_SECRET'> & { WHATSAPP_TOKEN_KEY?: string | undefined }

export const secretBoxReady = (env: KeyEnv): boolean => !!env.WHATSAPP_TOKEN_KEY || isDevLike(env)

async function key(env: KeyEnv): Promise<CryptoKey> {
  const material = env.WHATSAPP_TOKEN_KEY || (isDevLike(env) ? `dev-only:${env.JWT_SECRET}` : '')
  if (!material) throw new Error('WHATSAPP_TOKEN_KEY is not set')
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(material))
  return crypto.subtle.importKey('raw', digest, 'AES-GCM', false, ['encrypt', 'decrypt'])
}

const b64 = (u: Uint8Array) => Buffer.from(u).toString('base64')
const unb64 = (s: string) => new Uint8Array(Buffer.from(s, 'base64'))

export async function seal(env: KeyEnv, plain: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await key(env), new TextEncoder().encode(plain)))
  const out = new Uint8Array(iv.length + ct.length)
  out.set(iv)
  out.set(ct, iv.length)
  return `v1:${b64(out)}`
}

export async function open(env: KeyEnv, sealed: string): Promise<string> {
  if (!sealed.startsWith('v1:')) throw new Error('unknown secret format')
  const raw = unb64(sealed.slice(3))
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: raw.slice(0, 12) }, await key(env), raw.slice(12))
  return new TextDecoder().decode(plain)
}
