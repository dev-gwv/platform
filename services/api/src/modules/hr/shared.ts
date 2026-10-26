import { fail } from '../../middleware/errors'

/**
 * The database's own words for a refused request ("you already have leave on
 * some of these days") as a sentence -- they are written for people.
 */
export function explain(code: string, err: unknown): undefined {
  const msg = String((err as { message?: string })?.message ?? '')
  const sentence = msg ? `${msg[0]!.toUpperCase()}${msg.slice(1)}.` : ''
  if (code === 'P0002') fail(404, sentence || 'Not found.')
  if (code === '22023' && msg) fail(422, sentence)
  if (code === '42501' && msg && msg !== 'not allowed') fail(403, sentence)
  return undefined
}
