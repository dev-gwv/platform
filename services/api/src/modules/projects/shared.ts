import { fail } from '../../middleware/errors'

/** postgres.js writes `undefined` as a column; leave those out instead. */
export function withoutUndefined<T extends Record<string, unknown>>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>
}

/** The deliverable trigger's own refusals (0161), said plainly. */
export function deliverableRuleBroken(code: string, err: unknown): never | undefined {
  if (code !== '23514') return undefined
  const msg = err instanceof Error ? err.message : ''
  if (msg.includes('shoot')) fail(422, 'That shoot is not part of this project.')
  if (msg.includes('team')) fail(422, 'That person is not on your team.')
  if (msg.includes('stage')) fail(422, 'That stage does not belong to this step. Pick one from the list.')
  return undefined
}
