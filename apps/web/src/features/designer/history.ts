/**
 * Undo and redo for the designer (0297): every change is one step, except
 * that changes within `mergeMs` of each other (typing a word, dragging a
 * photo) are one step, the way Canva undoes a word rather than a letter.
 */
export interface History<T> {
  past: T[]
  present: T
  future: T[]
  at: number
}

const LIMIT = 60

export const startHistory = <T>(present: T): History<T> => ({
  past: [],
  present,
  future: [],
  at: 0,
})

export function record<T>(h: History<T>, next: T, now: number, mergeMs = 800): History<T> {
  if (next === h.present) return h
  const merge = now - h.at < mergeMs && h.past.length > 0
  const past = merge ? h.past : [...h.past, h.present].slice(-LIMIT)
  return { past, present: next, future: [], at: now }
}

export function undo<T>(h: History<T>): History<T> {
  const prev = h.past[h.past.length - 1]
  if (prev === undefined) return h
  return { past: h.past.slice(0, -1), present: prev, future: [h.present, ...h.future], at: 0 }
}

export function redo<T>(h: History<T>): History<T> {
  const next = h.future[0]
  if (next === undefined) return h
  return { past: [...h.past, h.present], present: next, future: h.future.slice(1), at: 0 }
}
