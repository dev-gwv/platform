import type { DesignWriteRequest } from '@ipc/contracts'
import type { ChatMessage } from './ai'

/**
 * "Write it for me" in the Quotation Designer (0296): the words on one part
 * of a quotation, written for an Indian wedding photography studio. The
 * prompt is built here and the answer cleaned here, both pure, so the tests
 * can read exactly what is asked and what comes back.
 */

const TONE: Record<DesignWriteRequest['tone'], string> = {
  warm: 'warm, personal and heartfelt',
  premium: 'premium, elegant and confident, like a luxury brand',
  fun: 'fun, young and full of energy',
  hinglish: 'warm and friendly, in Hinglish (Hindi written in English letters, mixed with English, the way Indian couples text)',
}

/** What each part is, and the shape of the answer. */
const TASK: Record<DesignWriteRequest['kind'], { what: string; list: number | null; words: string }> = {
  about: { what: 'the "About Us" paragraph of the studio', list: null, words: '60 to 90 words, one paragraph' },
  tagline: { what: 'a short tagline for the cover page', list: null, words: 'at most 8 words' },
  thanks: { what: 'a closing line for the Thank You page', list: null, words: 'at most 14 words' },
  testimonial: { what: 'a polished version of a client testimonial (keep its meaning, never invent facts)', list: null, words: '30 to 60 words' },
  deliverables: { what: 'the list of deliverables, each line one thing the couple receives, clear and attractive', list: 12, words: 'each line under 18 words' },
  addon: { what: 'the lines describing one add-on service, what it includes', list: 4, words: 'each line under 14 words' },
  event: { what: 'the team lines for one event (who will shoot it)', list: 6, words: 'each line under 10 words' },
}

export function designWriterMessages(r: DesignWriteRequest): ChatMessage[] {
  const t = TASK[r.kind]
  const facts = [
    r.studio && `Studio: ${r.studio}`,
    r.project && `Project: ${r.project}`,
    r.client && `Client: ${r.client}`,
    r.current && `What is written now (improve it, keep its facts):\n${r.current}`,
    r.lines.length > 0 && `The lines now (improve them, keep every fact, number and price exactly):\n${r.lines.map((l) => `- ${l}`).join('\n')}`,
    r.hint && `The studio asks: ${r.hint}`,
  ].filter(Boolean)
  const shape = t.list
    ? `Answer with at most ${t.list} lines, one per line, ${t.words}. No bullets, no numbering, no heading, nothing else.`
    : `Answer with the text only, ${t.words}. No quotes, no heading, no markdown, nothing else.`
  return [
    {
      role: 'system',
      content:
        'You write the words of premium wedding photography quotations for studios in India. ' +
        'Never invent prices, numbers, awards, years or names that you were not given. ' +
        'Keep every amount exactly as given (INR, lakh, /-). Write naturally for Indian couples and families.',
    },
    { role: 'user', content: `Write ${t.what}. Tone: ${TONE[r.tone]}.\n${facts.join('\n\n')}\n\n${shape}` },
  ]
}

/** The model's answer as the page holds it: plain text, or clean lines. */
export function cleanDesignWriting(kind: DesignWriteRequest['kind'], raw: string): { text: string; lines: string[] } {
  const stripped = raw
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/\*\*|__|`/g, '')
    .trim()
  const max = TASK[kind].list
  if (max) {
    const lines = stripped
      .split('\n')
      .map((l) => l.replace(/^\s*(?:[-*•·]|\d+[.)])\s*/, '').trim())
      .filter((l) => l && !/:$/.test(l))
      .slice(0, max)
      .map((l) => l.slice(0, 400))
    return { text: '', lines }
  }
  const text = stripped
    .replace(/^#+\s.*$/gm, '')
    .replace(/^["“”']+|["“”']+$/g, '')
    .trim()
    .slice(0, 3000)
  return { text, lines: [] }
}
