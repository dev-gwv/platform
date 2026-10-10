import { Card, CardContent } from '@/shared/ui/card'
import { SkeletonList } from '@/shared/ui/skeleton'
import { StatusBadge } from '@/shared/ui/status-badge'
import { cn } from '@/shared/ui/cn'
import { useAssistantHealth } from './api'

/**
 * How the assistant is actually doing, on the Help console.
 *
 * 0247 wrote a row for every question and nothing read it, which is the shape
 * that makes two opposite problems look identical from outside: an assistant
 * nobody opens, and one everybody opens and nobody is helped by. The first is a
 * placement problem, the second is a knowledge-base problem, and you cannot
 * tell them apart without this.
 *
 * So it leads with a sentence rather than a row of figures, and the figure that
 * matters most is the thumbs: status is not quality.
 */
export function AssistantHealthCard() {
  const q = useAssistantHealth()
  const d = q.data

  if (q.isLoading) return <SkeletonList rows={3} />
  if (!d) return null

  const marked = d.helpful + d.unhelpful
  const share = marked > 0 ? Math.round((d.helpful / marked) * 100) : null

  return (
    <Card>
      <CardContent className="flex flex-col gap-3 p-5">
        <p className="font-semibold">How the assistant is doing</p>

        {/* A sentence beats three bare figures. */}
        <p className="text-sm text-muted-foreground">
          {d.week === 0 ? (
            <>
              Nobody has asked the assistant anything in the last seven days. If it is switched on, that is a
              placement problem, not an answer problem.
            </>
          ) : (
            <>
              {d.week} question{d.week === 1 ? '' : 's'} in the last seven days, {d.today} today.{' '}
              {d.answered} answered from the help, {d.escalated} handed to a person
              {d.failed > 0 ? `, ${d.failed} failed` : ''}
              {d.skipped > 0 ? `, ${d.skipped} skipped for want of a key` : ''}.
              {share === null
                ? ' Nobody has said yet whether an answer helped.'
                : ` Of the ${marked} answers someone marked, ${share}% helped.`}
            </>
          )}
        </p>

        <div className="flex flex-wrap gap-2 text-sm">
          <StatusBadge tone="success">{d.helpful} helped</StatusBadge>
          <StatusBadge tone={d.unhelpful > 0 ? 'warning' : 'neutral'}>{d.unhelpful} did not</StatusBadge>
          {d.failed > 0 && <StatusBadge tone="danger">{d.failed} failed</StatusBadge>}
          {d.avg_prompt_tokens !== null && (
            // Groq's free tier allows 8,000 tokens a minute for gpt-oss-120b,
            // so this is the headroom figure, not a curiosity.
            <StatusBadge tone={d.avg_prompt_tokens > 4_000 ? 'warning' : 'neutral'}>
              {d.avg_prompt_tokens.toLocaleString('en-IN')} tokens a question
            </StatusBadge>
          )}
          {d.cached_share !== null && (
            // Cached tokens count against neither the bill nor the rate limit,
            // so a high share here is what keeps questions inside the limit.
            <StatusBadge tone={d.cached_share >= 50 ? 'success' : 'warning'}>
              {d.cached_share}% served from cache
            </StatusBadge>
          )}
        </div>

        {d.avg_prompt_tokens !== null && d.avg_prompt_tokens > 4_000 && (
          <p className="text-xs text-warning">
            A question is costing more than 4,000 tokens. Groq allows 8,000 a minute on the free tier, so the
            selection in help-context.ts has probably stopped selecting — check what is being sent.
          </p>
        )}

        {d.recent.length > 0 && (
          <>
            <p className="mt-1 text-sm font-medium">What studios asked</p>
            <div className="table-wrap rounded-lg border border-border">
              <table className="table-sticky w-full text-xs">
                <thead className="bg-muted/50 text-left text-muted-foreground">
                  <tr>
                    <th className="px-2 py-1.5 font-medium">Question</th>
                    <th className="px-2 py-1.5 font-medium">What happened</th>
                    <th className="px-2 py-1.5 font-medium">Helped?</th>
                  </tr>
                </thead>
                <tbody>
                  {d.recent.map((r) => (
                    <tr
                      key={r.id}
                      className={cn(
                        'border-t border-border align-top',
                        r.status === 'failed' && 'bg-destructive/5',
                        r.helpful === false && 'bg-warning/5',
                      )}
                    >
                      <td className="px-2 py-1.5">
                        {r.question}
                        {/*
                          The answer, for the rows that went wrong. It was
                          already being fetched and thrown away -- and "what did
                          it actually say?" is the only thing that tells you
                          which article to rewrite.
                        */}
                        {(r.helpful === false || r.status === 'failed') && r.answer && (
                          <span className="mt-1 block whitespace-pre-wrap text-muted-foreground">{r.answer}</span>
                        )}
                      </td>
                      <td className="px-2 py-1.5">
                        {r.status === 'answered'
                          ? r.model ?? 'Answered'
                          : r.status === 'escalated'
                            ? 'Offered a call'
                            : r.status === 'skipped'
                              ? 'Not sent (no key)'
                              : (r.error ?? 'Failed')}
                      </td>
                      <td className="px-2 py-1.5">
                        {r.helpful === true ? (
                          <span className="text-success">Yes</span>
                        ) : r.helpful === false ? (
                          <span className="text-warning">No</span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  )
}
