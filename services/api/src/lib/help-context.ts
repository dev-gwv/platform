import { TUTORIALS } from '@ipc/help'
import type { Env } from '../context'
import { withService } from './db'
import { DOCS, selectHelp } from './retrieve'

/**
 * The help that goes with one question.
 *
 * This file used to send the entire corpus with every message -- every article,
 * every guide chapter, every tutorial line -- about 13,640 tokens, and the long
 * comment that stood here argued the case for it: retrieval's worst failure is
 * fetching the wrong passage and answering confidently from it, and sending
 * everything cannot miss. On a paid tier that argument holds, and the prompt
 * stayed cheap because the provider caches an identical prefix at half price.
 *
 * It does not survive the actual limit. Groq allows gpt-oss-120b **8,000 tokens
 * a minute and 200,000 a day**: one question was larger than the whole
 * per-minute budget, and the daily cap came to roughly fourteen questions for
 * the entire platform. The old comment named 30,000 tokens as the point to
 * reconsider. The rate limit got there first.
 *
 * So the prompt is in two parts now, and the order is load-bearing:
 *
 *   1. STABLE -- the index of every article and chapter by title, the tutorial
 *      list and the FAQs. Byte-identical on every request, so the provider
 *      caches it, and **cached tokens count against neither the bill nor the
 *      rate limit**.
 *   2. SELECTED -- the four to six articles this question is actually about.
 *
 * The index is what makes the cut safe. The model always knows what exists, so
 * when retrieval misses it can say "there is an article on Delivery stages, ask
 * me about that" instead of inventing one. Retrieval fails silently; the index
 * is what makes it fail loudly.
 *
 * The rule the old comment got right still applies: **nothing per-request may
 * enter the stable block.** No studio name, no date, no counter. One
 * interpolated `new Date()` and every question pays full price and full rate
 * limit again, silently. `help-context.test.ts` asserts two builds are
 * byte-identical to keep that honest.
 *
 * English only. The guide is bilingual, but sending both doubles the prompt to
 * teach the model things it can already say in Hindi, and the app's buttons are
 * in English on a Hindi screen anyway.
 */

/** Rough and deliberately rough: ~4 characters a token is close enough to spot a trend. */
export const estimateTokens = (text: string): number => Math.ceil(text.length / 4)

/** What an answer costs on top of the prompt. See `varying` below. */
const ANSWER_TOKENS = 400

/** `**Book**` is how the guide marks a button name. The model does not need the stars. */
const plain = (step: string): string => step.replace(/\*\*/g, '')

/** What a studio can be pointed at, so an answer can end with somewhere to go. */
export interface HelpLink {
  title: string
  /**
   * Where the article lives, as the app's menus name it ("Team → People").
   *
   * Matched as well as the title, and that is what made the links appear at
   * all. An answer says "go to Post-Production → Work"; it does not say "see
   * Giving editing work to an editor", because nobody writes an article title
   * into a sentence. Matching only titles meant four good answers in a row
   * carried no link and no Watch button -- the whole row was dead.
   */
  menu: string | null
  to: string | null
  video: string | null
}

export interface HelpContext {
  /** Identical every request. Goes first, and the provider caches it. */
  stable: string
  /** The articles this question matched. Varies, so it goes last. */
  selected: string
  /** Everything the answer could name, because the index lists them all. */
  links: readonly HelpLink[]
  /** The help portion of the prompt, for the log and the tripwire. */
  tokens: number
  /**
   * Only the part that changes, which is what the provider actually counts
   * once the prefix is cached.
   *
   * `tokens` is the whole prompt and is the right number for the log and for
   * spotting the corpus creeping back in. It is the wrong number to spend a
   * rate limit against: charging every question for a stable block the
   * provider serves free would refuse two questions a minute where three fit,
   * which is a third of the free tier thrown away to a pessimistic estimate.
   *
   * It under-counts the first question after a two-hour quiet spell, when the
   * prefix has expired and is charged in full. That is what the headroom in
   * lib/ai-budget.ts is for.
   */
  varying: number
}

/**
 * One line per article and chapter: the title, its area and where it lives.
 * Built once -- it is pure, and it is the part that must not change.
 */
const INDEX = [
  '== WHAT HELP EXISTS ==',
  'Every article and chapter, by title. If the answer belongs to one of these but',
  'its text is not included below, say which one it is in and offer to answer from',
  'it. Never invent a screen that is not named here.',
  '',
  ...DOCS.map((d) => `- ${d.title} [${d.area}]${d.menu ? ` — ${d.menu}` : ''}`),
].join('\n')

/** Every link the model could name, since the index names them all. */
const ALL_LINKS: readonly HelpLink[] = DOCS.map((d) => ({
  title: d.title,
  menu: d.menu,
  to: d.to,
  video: d.video,
}))

/** The tutorials, as one short list. Small and stable, so it rides in the prefix. */
const VIDEOS = [
  '== TUTORIAL VIDEOS: what each recording shows ==',
  ...TUTORIALS.map((t) => `- "${t.title}" (${t.seconds}s, ${t.section}): ${t.blurb}`),
].join('\n')

/**
 * Builds the help for one question.
 *
 * `faqs` is passed in rather than read here so the caller can memo the read,
 * and so a test can build a context without a database.
 */
export function composeHelpContext(
  question: string,
  faqs: readonly { question: string; answer: string }[] = [],
): HelpContext {
  const parts = [
    'STUDIO AUTOPILOT HELP CONTENT',
    'Answer only from this. It is the whole manual.',
    '',
    INDEX,
    '',
    VIDEOS,
  ]
  if (faqs.length) {
    // Seven short answers to the questions studios ask first. They sit in the
    // stable block rather than being retrieved: they are small, they are the
    // most-asked things, and always having them beats sometimes finding them.
    // An edit on /platform/help changes the prefix and costs one cache miss --
    // a fair price for something that changes a few times a year.
    parts.push('', '== COMMON QUESTIONS ==')
    for (const f of faqs) parts.push('', `Q: ${plain(f.question)}`, `A: ${plain(f.answer)}`)
  }
  const stable = parts.join('\n')

  const picked = selectHelp(question)
  const selected = picked.empty
    ? [
        '== THE HELP FOR THIS QUESTION ==',
        'Nothing in the help matched this question. Do not answer from memory: say',
        'so plainly, name the closest thing from the index above if there is one,',
        'and offer the call.',
      ].join('\n')
    : [
        '== THE HELP FOR THIS QUESTION ==',
        ...picked.docs.flatMap((d) => [
          '',
          `### ${d.title}  [${d.area}]`,
          ...(d.menu ? [`Where: ${d.menu}`] : []),
          ...(d.to ? [`Screen: ${d.to}`] : []),
          ...d.body.map(plain),
        ]),
      ].join('\n')

  const varying = estimateTokens(selected)
  return {
    stable,
    selected,
    links: ALL_LINKS,
    tokens: estimateTokens(stable) + varying,
    // Plus what the answer itself will cost. The reply is capped at 800 tokens
    // and a help answer is usually a third of that, so 400 is the figure that
    // is wrong in both directions by about the same amount.
    varying: varying + ANSWER_TOKENS,
  }
}

/**
 * The editable FAQs, read at most once a minute.
 *
 * They were read from Postgres on every single question -- a round trip for
 * seven rows that change a few times a year. An edit on /platform/help now
 * takes up to a minute to appear, which nobody will notice, and which is worth
 * one fewer transaction on the path a studio is waiting on.
 */
const FAQ_TTL_MS = 60_000
let faqCache: { at: number; rows: readonly { question: string; answer: string }[] } | null = null

async function faqs(env: Env): Promise<readonly { question: string; answer: string }[]> {
  if (!env.DATABASE_URL) return []
  if (faqCache && Date.now() - faqCache.at < FAQ_TTL_MS) return faqCache.rows
  try {
    const rows = await withService(env, (sql) =>
      sql<{ question: string; answer: string }[]>`
        select question, answer from help_faqs order by sort_order, created_at`,
    )
    faqCache = { at: Date.now(), rows }
    return rows
  } catch (e) {
    // The shipped articles are the bulk of the corpus; losing the seven
    // editable answers is worth far less than refusing to answer at all. A
    // stale copy beats none, so the previous read is kept if there was one.
    console.error('[assistant] could not read help_faqs', e)
    return faqCache?.rows ?? []
  }
}

/** The same thing, with the editable FAQs read from the database. */
export async function buildHelpContext(env: Env, question: string): Promise<HelpContext> {
  return composeHelpContext(question, await faqs(env))
}

/** Tests only: forget the memo so a case can control what the FAQs are. */
export function forgetFaqCache(): void {
  faqCache = null
}

/** Specific enough that matching it means something. */
const citable = (title: string) => title.includes(' ') && title.length > 8

/** The title appears as a phrase, not as a fragment of a longer word. */
function mentions(said: string, title: string): boolean {
  let from = 0
  for (;;) {
    const i = said.indexOf(title, from)
    if (i === -1) return false
    const before = said[i - 1]
    const after = said[i + title.length]
    const isWord = (c: string | undefined) => !!c && /[a-z0-9]/.test(c)
    if (!isWord(before) && !isWord(after)) return true
    from = i + 1
  }
}

/**
 * Which articles an answer actually drew on, so the panel can offer a link.
 *
 * Matched on the answer text rather than asked of the model: a model told to
 * report its sources will invent a plausible-looking one, and a title it did
 * not mention is a worse link than no link.
 *
 * A title must be more than one word and reasonably long. Single words --
 * "Reports", "Clients", "Invoices", "Expenses", "Attendance" -- are all article
 * titles AND words that appear in half the answers this app will ever give, so
 * matching them offered a link to the wrong article constantly. Those articles
 * can no longer be cited at all, and that is the right trade: a wrong link
 * sends someone to the wrong screen, a missing one costs them nothing.
 *
 * The longest match wins, not the first, and destinations are deduped so a
 * chapter and an article covering the same ground do not both appear.
 */
export function linksMentioned(answer: string, links: readonly HelpLink[], limit = 3): HelpLink[] {
  const said = answer.toLowerCase()
  /**
   * The title, or the menu path the article lives at.
   *
   * A menu path is held to the same citable() bar and is specific by nature:
   * "Team → People" is two words and an arrow, and nothing says it by accident
   * the way an answer says "clients". The arrow is normalised because an
   * answer may write it as "->" or "/" and mean the same place.
   */
  const names = (l: HelpLink) => (l.menu ? [l.title, l.menu] : [l.title])
  const arrows = (s: string) => s.replace(/\s*(?:→|->|>|\/)\s*/g, ' → ')
  const asked = arrows(said)

  const hits = links
    .filter((l) => names(l).some((n) => citable(n) && mentions(asked, arrows(n.toLowerCase()))))
    .sort((a, b) => b.title.length - a.title.length)

  const seen = new Set<string>()
  const out: HelpLink[] = []
  for (const l of hits) {
    const where = l.to ?? l.title
    if (seen.has(where)) continue
    seen.add(where)
    out.push(l)
    if (out.length === limit) break
  }
  return out
}
