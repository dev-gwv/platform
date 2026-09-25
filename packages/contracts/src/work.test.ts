import { describe, expect, it } from 'vitest'
import { reviewWorkRequest } from './work'
import { myDeliverable } from './projects'

/**
 * Sending work back must say what to change: the editor gets those words with
 * the notification and on their list. The contract refuses it without them,
 * so the API answers 422 naming the field rather than sending back silence.
 */
describe('reviewWorkRequest', () => {
  it('approves with or without a note', () => {
    expect(reviewWorkRequest.safeParse({ approve: true }).success).toBe(true)
    expect(reviewWorkRequest.safeParse({ approve: true, review_notes: 'Lovely' }).success).toBe(true)
  })

  it('sends back only with a note, trimmed', () => {
    const ok = reviewWorkRequest.safeParse({ approve: false, review_notes: '  Shorter intro  ' })
    expect(ok.success && ok.data.review_notes).toBe('Shorter intro')
    for (const body of [{ approve: false }, { approve: false, review_notes: '   ' }]) {
      const r = reviewWorkRequest.safeParse(body)
      expect(r.success).toBe(false)
      expect(!r.success && r.error.issues[0]?.path).toEqual(['review_notes'])
    }
  })
})

describe('myDeliverable', () => {
  it('reads a row from before revisions as not sent back', () => {
    const r = myDeliverable.parse({
      id: '11111111-1111-4111-8111-111111111111',
      project_id: '22222222-2222-4222-8222-222222222222',
      project_name: 'Sharma Wedding',
      title: 'Wedding Film',
      status: 'in_progress',
      visibility_scope: 'client',
    })
    expect(r).toMatchObject({ changes_requested: false, review_note: null, last_version: null })
  })
})
