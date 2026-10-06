import { CHAPTERS, PARTS, TUTORIALS } from '@ipc/help'
import type { Env } from '../context'
import { withService } from './db'

/**
 * The help the assistant answers from, as one block of text.
 *
 * There is no vector store and no search index here, and that is a measurement
 * rather than a shortcut: the whole user-facing corpus -- 21 guide chapters,
 * 20 tutorials and the FAQ list -- comes to roughly five thousand tokens, so it
 * all fits in one prompt with room to spare. Retrieval exists to squeeze a
 * corpus into a context window; ours already fits, and an embedding pipeline
 * would be a second thing to keep in step with the guide for no gain.
 *
 * The number to watch is `estimateTokens()` below, which the router records on
 * every answer. Past roughly 30,000 the prompt is getting crowded and this
 * function is the one place that would start selecting chapters instead of
 * sending them all. Nothing above it would change.
 *
 * English only. The guide is bilingual, but sending both languages doubles the
 * prompt to teach the model things it can already say in Hindi on its own.
 */

/** Rough and deliberately rough: ~4 characters a token is close enough to spot a trend. */
export const estimateTokens = (text: string): number => Math.ceil(text.length / 4)

/** `**Book**` is how the guide marks a button name. The model does not need the stars. */
const plain = (step: string): string => step.replace(/\*\*/g, '')

/** What a studio can be pointed at, so an answer can end with somewhere to go. */
export interface HelpLink {
  title: string
  to: string | null
  video: string | null
}

export interface HelpContext {
  text: string
  links: readonly HelpLink[]
  tokens: number
}

/**
 * Builds the context. `faqs` is passed in rather than read here so the router
 * can fetch it in the same transaction it reads the settings from, and so a
 * test can build a context without a database.
 */
export function composeHelpContext(faqs: readonly { question: string; answer: string }[] = []): HelpContext {
  const out: string[] = []
  const links: HelpLink[] = []

  out.push(
    'STUDIO AUTOPILOT HELP CONTENT',
    'Below is every help article, tutorial and answer the product ships. Answer only from this.',
    '',
  )

  out.push('== THE GUIDE: how to do each job in the app ==')
  for (const c of CHAPTERS) {
    const part = PARTS[c.part]
    const who = part?.track === 'team' ? 'team member' : 'studio owner or manager'
    out.push('', `### ${c.title.en}  [for the ${who}]`)
    if (c.to) out.push(`Screen: ${c.to}`)
    c.steps.en.forEach((s, i) => out.push(`${i + 1}. ${plain(s)}`))
    links.push({ title: c.title.en, to: c.to ?? null, video: c.video ?? null })
  }

  out.push('', '== TUTORIAL VIDEOS: what each recording shows ==')
  for (const t of TUTORIALS) {
    out.push(`- "${t.title}" (${t.seconds}s, ${t.section}): ${t.blurb}`)
  }

  if (faqs.length) {
    out.push('', '== COMMON QUESTIONS ==')
    for (const f of faqs) out.push('', `Q: ${f.question}`, `A: ${f.answer}`)
  }

  const text = out.join('\n')
  return { text, links, tokens: estimateTokens(text) }
}

/** The same thing, with the editable FAQs read from the database. */
export async function buildHelpContext(env: Env): Promise<HelpContext> {
  if (!env.DATABASE_URL) return composeHelpContext()
  try {
    const faqs = await withService(env, (sql) =>
      sql<{ question: string; answer: string }[]>`
        select question, answer from help_faqs order by sort_order, created_at`,
    )
    return composeHelpContext(faqs)
  } catch (e) {
    // The shipped guide is the bulk of the corpus; losing the seven editable
    // answers is worth far less than refusing to answer at all.
    console.error('[assistant] could not read help_faqs', e)
    return composeHelpContext()
  }
}

/**
 * Which chapters an answer actually drew on, so the panel can offer a link.
 *
 * Matched on the answer text rather than asked of the model: a model told to
 * report its sources will invent a plausible-looking one, and a chapter title
 * it did not mention is a worse link than no link.
 */
export function linksMentioned(answer: string, links: readonly HelpLink[], limit = 3): HelpLink[] {
  const said = answer.toLowerCase()
  return links.filter((l) => l.title.length > 6 && said.includes(l.title.toLowerCase())).slice(0, limit)
}
