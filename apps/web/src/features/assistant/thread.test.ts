import { beforeEach, describe, expect, it } from 'vitest'
import { addSaid, clearThread, markHelpful, setDraft, snapshot, subscribe } from './thread'

/**
 * The conversation store. It exists because the thread used to be component
 * state inside the Sheet, so closing the panel -- which every navigation does --
 * destroyed it, and following the link in an answer destroyed the conversation
 * that produced the link.
 */
beforeEach(() => clearThread())

describe('the thread', () => {
  it('starts empty', () => {
    expect(snapshot().said).toEqual([])
    expect(snapshot().draft).toBe('')
  })

  it('keeps what was said, in order', () => {
    addSaid({ role: 'user', text: 'How do I add my team?' })
    addSaid({ role: 'assistant', text: 'Open Team then People.' })
    expect(snapshot().said.map((s) => s.role)).toEqual(['user', 'assistant'])
    expect(snapshot().said[1]!.text).toBe('Open Team then People.')
  })

  it('survives what unmounting the panel would do', () => {
    // There is nothing to simulate: the store is at module scope, so a React
    // unmount cannot reach it. This test states the property so that moving the
    // state back into a component fails here.
    addSaid({ role: 'user', text: 'How do I send a quotation?' })
    const after = snapshot()
    expect(after.said).toHaveLength(1)
    expect(snapshot()).toBe(after)
  })

  it('hands out the same object until something changes', () => {
    // useSyncExternalStore re-renders for ever if the snapshot is a new object
    // each call.
    const a = snapshot()
    expect(snapshot()).toBe(a)
    addSaid({ role: 'user', text: 'x' })
    expect(snapshot()).not.toBe(a)
  })

  it('ignores a draft that has not changed', () => {
    setDraft('hello')
    const a = snapshot()
    setDraft('hello')
    expect(snapshot()).toBe(a)
  })

  it('tells its listeners', () => {
    let calls = 0
    const stop = subscribe(() => { calls += 1 })
    addSaid({ role: 'user', text: 'x' })
    setDraft('y')
    expect(calls).toBe(2)
    stop()
    addSaid({ role: 'user', text: 'z' })
    expect(calls).toBe(2)
  })

  it('marks the right answer as helpful', () => {
    addSaid({ role: 'user', text: 'q' })
    addSaid({ role: 'assistant', text: 'a1', logId: 'one', helpful: null })
    addSaid({ role: 'assistant', text: 'a2', logId: 'two', helpful: null })
    markHelpful(1, true)
    expect(snapshot().said[1]!.helpful).toBe(true)
    expect(snapshot().said[2]!.helpful).toBeNull()
  })

  it('empties on Start again, and on sign-out', () => {
    // Two people share a laptop; one must not read the other's questions.
    addSaid({ role: 'user', text: 'what did I ask' })
    setDraft('half a question')
    clearThread()
    expect(snapshot().said).toEqual([])
    expect(snapshot().draft).toBe('')
  })
})
