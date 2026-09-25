import { describe, expect, it } from 'vitest'
import { changesFirst, needChangesCount, needChangesLabel, revisionHint, submittedMessage } from './revisions'

const row = (id: string, changes_requested: boolean) => ({ id, changes_requested })

describe('sent-back work on the editor’s lists', () => {
  it('comes first, and everything else keeps its order', () => {
    const rows = [row('due-mon', false), row('sent-back-1', true), row('due-tue', false), row('sent-back-2', true)]
    expect(changesFirst(rows).map((r) => r.id)).toEqual(['sent-back-1', 'sent-back-2', 'due-mon', 'due-tue'])
    expect(rows[0]!.id).toBe('due-mon')
  })

  it('is counted, in words that read right for one or many', () => {
    expect(needChangesCount([row('a', true), row('b', false), row('c', true)])).toBe(2)
    expect(needChangesCount([])).toBe(0)
    expect(needChangesLabel(1)).toBe('1 needs changes')
    expect(needChangesLabel(3)).toBe('3 need changes')
  })
})

describe('the revision', () => {
  it('says which version it will be, when there was one before', () => {
    expect(revisionHint(1)).toBe('This is version 2. It goes back to your manager for review.')
    expect(revisionHint(null)).toBe('It goes back to your manager for review.')
  })

  it('is confirmed by its version once in', () => {
    expect(submittedMessage(2)).toBe('Version 2 sent for review')
    expect(submittedMessage(1)).toBe('Work submitted')
    expect(submittedMessage(undefined)).toBe('Work submitted')
  })
})
