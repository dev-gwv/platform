import { CHAPTERS, KB, PARTS, type KbArticle } from '@ipc/help'

/**
 * Which bits of the help a question is about.
 *
 * The assistant used to send the whole manual with every message -- about
 * 13,640 tokens. That was a deliberate choice and a defensible one on a paid
 * tier: retrieval's worst failure is fetching the wrong passage and answering
 * confidently from it, and sending everything cannot miss. But Groq allows
 * 8,000 tokens a minute for gpt-oss-120b, so a single question was larger than
 * the whole per-minute budget, and the daily cap came to about fourteen
 * questions for the entire platform. Sending less is not an optimisation here;
 * it is the only way the feature runs.
 *
 * Hand-rolled rather than a search library, to match the service it lives in:
 * `services/api` has three third-party runtime dependencies and writes its own
 * JWT, AES-GCM, HMAC checks and rate limiter against Web Crypto. Ranking
 * eighty-odd short documents is not the kind of thing that earns a dependency.
 * `packages/help` settles it anyway -- it has no third-party dependencies and
 * the browser imports it too.
 *
 * It is a plain weighted term-frequency score with an inverse-document-frequency
 * term: a word that appears in half the articles tells you almost nothing, and
 * one that appears in two tells you a great deal. Title and keywords are
 * weighted over body because an article is usually about its title.
 *
 * If the eval in retrieve.test.ts ever shows this missing real questions,
 * MiniSearch drops in behind `selectHelp()` and brings proper stemming and
 * fuzzy matching with it. Nothing above would change.
 */

/** A thing the assistant can be given: an article, or a chapter of the guide. */
export interface HelpDoc {
  key: string
  title: string
  area: string
  menu: string | null
  to: string | null
  video: string | null
  /** What goes in the prompt when this one is chosen. */
  body: readonly string[]
  /** Scored, never shown: the words a studio types for this. */
  terms: readonly string[]
}

/**
 * Words too common to tell two articles apart. Kept short on purpose -- a long
 * stop list starts eating words that carry meaning in this domain ("set",
 * "add", "work" all matter here).
 */
const STOP = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'but', 'by', 'can', 'do', 'does', 'for', 'from',
  'how', 'i', 'if', 'in', 'is', 'it', 'me', 'my', 'of', 'on', 'or', 'our', 'that', 'the',
  'their', 'them', 'then', 'there', 'they', 'this', 'to', 'up', 'was', 'we', 'what', 'when',
  'where', 'which', 'who', 'why', 'will', 'with', 'you', 'your',
])

/**
 * Crude stemming: enough to tie "invoices" to "invoice" and "booking" to
 * "book", which is most of what English plurals and gerunds cost us here.
 * Deliberately not a real stemmer -- a wrong stem silently merges two words,
 * and the corpus is small enough that the tail does not matter.
 */
function stem(w: string): string {
  if (w.length > 4 && w.endsWith('ies')) return `${w.slice(0, -3)}y`
  // Plain trailing -s only. An -es rule looks tempting and is wrong far more
  // often here than it is right: "expenses" is "expense" + s, not "expens" + es,
  // and expenses, invoices, clients, leads, shoots and payments are most of the
  // plurals this corpus contains.
  if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss')) return w.slice(0, -1)
  if (w.length > 5 && w.endsWith('ing')) return w.slice(0, -3)
  if (w.length > 4 && w.endsWith('ed')) return w.slice(0, -2)
  return w
}

export function words(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 1 && !STOP.has(w))
    .map(stem)
}

/** Every article and every guide chapter, as one list. Built once. */
export const DOCS: readonly HelpDoc[] = [
  ...KB.map(
    (a: KbArticle): HelpDoc => ({
      key: `kb:${a.key}`,
      title: a.title,
      area: a.area,
      menu: a.menu ?? null,
      to: a.to ?? null,
      video: a.video ?? null,
      body: a.body,
      terms: [...words(a.title), ...words(a.menu ?? ''), ...(a.keywords ?? []).flatMap(words)],
    }),
  ),
  ...CHAPTERS.map((c): HelpDoc => {
    const part = PARTS[c.part]
    return {
      key: `guide:${c.key}`,
      title: c.title.en,
      area: part?.track === 'team' ? 'For the team' : 'Guide',
      menu: null,
      to: c.to ?? null,
      video: c.video ?? null,
      body: c.steps.en,
      terms: words(c.title.en),
    }
  }),
]

/** How often each word appears across the corpus, for the IDF term. Built once. */
const DOC_FREQ: ReadonlyMap<string, number> = (() => {
  const n = new Map<string, number>()
  for (const d of DOCS) {
    for (const w of new Set([...d.terms, ...d.body.flatMap(words)])) n.set(w, (n.get(w) ?? 0) + 1)
  }
  return n
})()

/** Title and keyword hits count for more than body hits. */
const TERM_WEIGHT = 3

export function scoreDoc(asked: readonly string[], doc: HelpDoc): number {
  if (asked.length === 0) return 0
  const terms = new Set(doc.terms)
  const body = new Set(doc.body.flatMap(words))

  let score = 0
  for (const w of new Set(asked)) {
    const hitsTerms = terms.has(w)
    const hitsBody = body.has(w)
    if (!hitsTerms && !hitsBody) continue
    // A word in two articles is worth far more than one in forty.
    const idf = Math.log(DOCS.length / (DOC_FREQ.get(w) ?? DOCS.length))
    score += (hitsTerms ? TERM_WEIGHT : 1) * Math.max(idf, 0.1)
  }
  return score
}

/** ~4 characters a token, the same rough measure help-context.ts uses. */
const tokensOf = (doc: HelpDoc): number => Math.ceil((doc.title.length + doc.body.join(' ').length) / 4)

export interface Selection {
  docs: readonly HelpDoc[]
  /** True when nothing scored at all: the prompt says so rather than guessing. */
  empty: boolean
}

/**
 * The articles this question is about, within a token budget.
 *
 * Returns nothing rather than something when nothing matches. An article picked
 * because it was the least bad of eighty-four is worse than none: the model
 * answers from it, confidently, and the studio is told about the wrong screen.
 * With nothing selected it still has the index of every title in the prompt and
 * can say what it does not have.
 */
export function selectHelp(question: string, budgetTokens = 1_400, max = 6): Selection {
  const asked = words(question)
  const ranked = DOCS.map((doc) => ({ doc, score: scoreDoc(asked, doc) }))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score || a.doc.key.localeCompare(b.doc.key))

  if (ranked.length === 0) return { docs: [], empty: true }

  // Only what is in the same league as the best match. A long question matches
  // a dozen articles weakly, and filling the budget with the weak ones pushes
  // out the one that was actually right.
  const best = ranked[0]!.score
  const worth = ranked.filter((r) => r.score >= best * 0.25)

  const docs: HelpDoc[] = []
  let spent = 0
  for (const { doc } of worth) {
    const cost = tokensOf(doc)
    if (docs.length >= max || spent + cost > budgetTokens) break
    docs.push(doc)
    spent += cost
  }
  // The budget must never silently return nothing when something matched.
  if (docs.length === 0) docs.push(worth[0]!.doc)
  return { docs, empty: false }
}
