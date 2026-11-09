import { describe, expect, it } from 'vitest'
import { sequenceInput } from '@ipc/contracts'
import { keepKnownVars, parseSequenceDraft, parseStepLine, sequenceWriterMessages, stepCount } from './sequence-writer'

const ask = {
  goal: 'quote_quiet' as const,
  length: 'two_weeks' as const,
  pace: 'normal' as const,
  channels: 'whatsapp_calls' as const,
  language: 'en' as const,
  tone: 'warm' as const,
  hint: '',
}

describe('sequence maker', () => {
  it('asks for the number of steps the pace and length want, in the chosen channels', () => {
    expect(stepCount({ pace: 'gentle', length: 'week' })).toBe(2)
    expect(stepCount({ pace: 'persistent', length: 'month' })).toBe(8)
    const [sys] = sequenceWriterMessages(ask)
    expect(sys!.content).toContain('exactly 5 steps over 14 days')
    expect(sys!.content).toContain('whatsapp, reminder')
    expect(sys!.content).not.toContain('Subject:')
  })

  it('reads a step however the model punctuates it', () => {
    expect(parseStepLine('Day 2 | 11 | whatsapp | Hi {{first_name}} / did you see it?')).toEqual({
      day_offset: 2, channel: 'whatsapp', send_hour: 11, body: 'Hi {{first_name}}\ndid you see it?', subject: null,
    })
    expect(parseStepLine('3. Day 5 - 6pm - Call - Ask about the quotation')).toMatchObject({
      day_offset: 5, channel: 'reminder', send_hour: 18, note: 'Ask about the quotation',
    })
    expect(parseStepLine('Day 7 | 11 | email | Subject: About {{event_type}} // Hi {{first_name}}')).toMatchObject({
      channel: 'email', subject: 'About {{event_type}}', body: 'Hi {{first_name}}',
    })
    expect(parseStepLine('Here is your sequence:')).toBeNull()
    expect(parseStepLine('Day 2 | 3 | whatsapp | early')!.send_hour).toBe(6)
  })

  it('keeps only the words the sender can fill', () => {
    expect(keepKnownVars('Hi {{first_name}}, {{discount}} off at {studio}')).toBe('Hi {{first_name}}, off at {{studio}}')
  })

  it('makes a sequence that saves: chosen channels only, days in order, capped', () => {
    const raw = [
      'Sure! Here it is:',
      'Day 6 | 11 | whatsapp | Third',
      'Day 0 | 10 | whatsapp | First',
      'Day 2 | 18 | reminder | Call them',
      'Day 3 | 11 | email | Subject: Hi // Not asked for',
      'Day 9 | 11 | whatsapp | Fourth',
      'Day 12 | 11 | whatsapp | Fifth',
      'Day 13 | 11 | whatsapp | Sixth, one too many',
    ].join('\n')
    const d = parseSequenceDraft(raw, ask)!
    expect(d.steps.map((s) => s.day_offset)).toEqual([0, 2, 6, 9, 12])
    expect(d.steps.some((s) => s.channel === 'email')).toBe(false)
    expect(d.auto_start).toBe(false)
    expect(d.stop_on_reply).toBe(true)
    expect(sequenceInput.safeParse(d).success).toBe(true)
  })

  it('gives up on an answer with fewer than two steps', () => {
    expect(parseSequenceDraft('I cannot help with that.', ask)).toBeNull()
  })
})
