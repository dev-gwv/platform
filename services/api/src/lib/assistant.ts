import type { AssistantSource, AssistantTurn } from '@ipc/contracts'
import type { ChatMessage, ChatProvider, ToolSpec } from './ai'
import type { Env } from '../context'
import { withService } from './db'
import type { HelpContext } from './help-context'
import { linksMentioned } from './help-context'

/**
 * The help assistant: a studio owner's question, answered from the help the
 * product ships.
 *
 * It is given the help content and nothing else -- no leads, no projects, no
 * figures. That is the point. A help answer needs the manual, not the studio's
 * books, and keeping the studio's own data out of the prompt keeps this whole
 * feature clear of the one bug that actually matters in a multi-tenant app.
 *
 * Never throws. A caller gets a status to decide from, the way lib/email.ts's
 * `deliver()` does.
 */

/** The prompt used when the platform has not written one on /platform/assistant. */
export const DEFAULT_PROMPT = `You are the help assistant inside Studio AutoPilot, software used by Indian photography and wedding studios to run their business: leads, quotations, shoots, crew, editing work, invoices and payments.

You are talking to the studio's owner or manager. Help them do the thing they are asking about, in the app.

How to answer:
- Answer ONLY from the help content given to you below. It is the whole manual.
- Be short. Two or three sentences, or a few numbered steps. They are busy.
- Plain English. No jargon, no "leverage", no "utilise". Say "press", not "click on the button labelled".
- Name buttons and menus exactly as the help content writes them, so what you say matches what is on their screen.
- Money is rupees.
- If the help content covers it, say the steps. If the help content names the screen, say where to go.
- Say where to go by the menu names (Team → People), never by a page address like /employees or screen/employees.

What NOT to do:
- Never invent a feature, a button, a screen or a setting that is not in the help content. If it is not there, the app does not do it, and saying otherwise sends someone hunting for a button that does not exist.
- Never guess about their money, their plan, their bill, their refund, or anything about their own data: you cannot see any of it.
- Do not apologise at length or repeat the question back.

When you cannot answer from the help content -- it is not covered, it is about their account or their bill, something is broken, or they are upset -- call the book_a_call tool instead of guessing. Offering a call is a good answer. Making one up is not.`

/** The one tool. Its only job is to say "a person should take this". */
export const BOOK_A_CALL: ToolSpec = {
  name: 'book_a_call',
  description:
    'Hand this question to a human. Use when the help content does not cover it, when it is about this studio\'s own account, bill, plan or data, when something appears to be broken, or when the person is frustrated.',
  parameters: {
    type: 'object',
    properties: {
      reason: {
        type: 'string',
        description: 'One short sentence, addressed to the studio, saying why a call is the right next step.',
      },
    },
    required: ['reason'],
    additionalProperties: false,
  },
}

/**
 * Questions that go to a person whatever the model thinks.
 *
 * The model gets a vote on escalation through the tool, but not the only vote.
 * Asked about a refund or a double charge it will compose something
 * reasonable-sounding from the general shape of such answers, and a confident
 * invented sentence about someone's money is the worst thing this feature could
 * produce. These go straight to a call and never reach the model at all.
 *
 * Deliberately narrow, and about OUR billing of them rather than their billing
 * of clients: "how do I send an invoice" is a help question and must stay one,
 * which is why 'invoice', 'payment' and 'gst' are not on this list.
 */
const HUMAN_ONLY: readonly { re: RegExp; why: string }[] = [
  { re: /\brefund|charge-?back|money back|charged (me )?(twice|two times|double)|double charge/i, why: 'This is about money we have charged you, so a person should look at it with you.' },
  { re: /\bcancel (my |the )?(plan|subscription|account)|downgrade my plan|stop (my )?(billing|subscription)/i, why: 'Changing or ending your plan is something we should do with you on a call.' },
  // Both word orders: "I lost my leads" and "all my leads are gone". Only the
  // first was matched at first, which let the commoner phrasing through.
  { re: /\b(lost|deleted|missing|gone) (all |my |our |the )?(data|leads|projects|clients|everything)\b|\b(data|leads|projects|clients|everything) (are|is|have|has|were) ?(all )?(gone|missing|disappeared|deleted|lost|vanished)\b|\bhacked\b|\bdata breach\b/i, why: 'Missing data needs a person to look at your studio directly.' },
]

/** Pure, so the rule can be tested without a provider. Null means "the model may try". */
export function needsHuman(question: string, history: readonly AssistantTurn[] = []): string | null {
  for (const r of HUMAN_ONLY) if (r.re.test(question)) return r.why
  // Asked the same thing twice: the first answer did not land, and a third
  // rephrasing of it will not either.
  const asked = history.filter((h) => h.role === 'user').map((h) => normalise(h.content))
  const now = normalise(question)
  if (now.length > 12 && asked.includes(now)) {
    return 'I have already given you my best answer on this, so let us put you with a person.'
  }
  return null
}

const normalise = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim()

type AssistantStatus = 'answered' | 'escalated' | 'skipped' | 'failed'

interface AssistantResult {
  status: AssistantStatus
  answer: string
  sources: AssistantSource[]
  callUrl: string | null
  /** For the log and the token tripwire; not shown to a studio. */
  model: string | null
  promptTokens: number | null
  completionTokens: number | null
  error: string | null
}

interface AskOptions {
  provider: ChatProvider
  help: HelpContext
  prompt?: string | null | undefined
  callUrl?: string | null | undefined
  question: string
  history?: readonly AssistantTurn[] | undefined
}

/** What a studio is told when a call is the answer but nobody has set a link. */
const NO_LINK = 'Please write to us and we will come back to you.'

export async function ask(opts: AskOptions): Promise<AssistantResult> {
  const callUrl = opts.callUrl || null
  const empty = { sources: [] as AssistantSource[], model: null, promptTokens: null, completionTokens: null, error: null }

  const forced = needsHuman(opts.question, opts.history ?? [])
  if (forced) {
    return {
      ...empty,
      status: 'escalated',
      answer: `${forced} ${callUrl ? 'Book a time that suits you.' : NO_LINK}`.trim(),
      callUrl,
    }
  }

  const messages: ChatMessage[] = [
    { role: 'system', content: `${opts.prompt?.trim() || DEFAULT_PROMPT}\n\n${opts.help.text}` },
    ...(opts.history ?? []).map((h) => ({ role: h.role, content: h.content }) as ChatMessage),
    { role: 'user', content: opts.question },
  ]

  const reply = await opts.provider.chat({ messages, tools: [BOOK_A_CALL] })

  if (!reply.ok) {
    return {
      ...empty,
      status: reply.kind === 'no_key' ? 'skipped' : 'failed',
      // A studio should not be shown the provider's words, but they should be
      // told it is us and not them, and offered the way through.
      answer:
        reply.kind === 'no_key'
          ? 'The assistant is not switched on yet.'
          : `I could not answer just now. ${callUrl ? 'You can book a call instead.' : NO_LINK}`,
      callUrl: reply.kind === 'no_key' ? null : callUrl,
      error: reply.error,
    }
  }

  const usage = { model: reply.model, promptTokens: reply.usage.promptTokens, completionTokens: reply.usage.completionTokens }
  const call = reply.calls.find((c) => c.name === BOOK_A_CALL.name)

  if (call) {
    const reason = typeof (call.args as { reason?: unknown })?.reason === 'string' ? String((call.args as { reason: string }).reason).trim() : ''
    return {
      ...empty,
      ...usage,
      status: 'escalated',
      answer: `${reason || 'This one is better answered by a person.'} ${callUrl ? 'Book a time that suits you.' : NO_LINK}`.trim(),
      callUrl,
    }
  }

  // The model answered nothing at all. Rare, and an empty bubble reads as a
  // broken app, so it is treated as a failure to answer rather than an answer.
  if (!reply.text) {
    return {
      ...empty,
      ...usage,
      status: 'escalated',
      answer: `I do not have an answer for that in the help. ${callUrl ? 'Book a call and we will go through it.' : NO_LINK}`,
      callUrl,
    }
  }

  return {
    ...usage,
    status: 'answered',
    answer: reply.truncated ? `${reply.text}…` : reply.text,
    sources: linksMentioned(reply.text, opts.help.links).map((l) => ({ title: l.title, to: l.to, video: l.video })),
    callUrl: null,
    error: null,
  }
}

/**
 * One row per question. A log that cannot be written never costs the answer.
 *
 * This is the feature's instrumentation and the reason the table exists: without
 * it, "the assistant is unhelpful" and "nobody opens the assistant" look exactly
 * alike from the outside, and they want opposite fixes. `prompt_tokens` is also
 * the tripwire for the no-retrieval decision in help-context.ts.
 */
export async function logAsk(
  env: Env,
  meta: { companyId: string | null; userId: string | null; question: string },
  r: AssistantResult,
): Promise<void> {
  if (!env.DATABASE_URL) return
  try {
    await withService(env, (sql) => sql`
      insert into assistant_log (company_id, user_id, question, answer, status, model, prompt_tokens, completion_tokens, error)
      values (${meta.companyId}, ${meta.userId}, ${meta.question.slice(0, 2000)}, ${r.answer.slice(0, 8000) || null},
              ${r.status}, ${r.model?.slice(0, 120) ?? null}, ${r.promptTokens}, ${r.completionTokens},
              ${r.error?.slice(0, 500) ?? null})`)
  } catch (e) {
    console.error('[assistant] could not write assistant_log', e)
  }
}
