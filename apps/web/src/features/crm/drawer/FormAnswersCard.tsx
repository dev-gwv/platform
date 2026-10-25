import { MessageSquareText } from 'lucide-react'
import type { CrmLead } from '@ipc/contracts'

/**
 * What they answered on a partner QR's own questions (0281), with each
 * question in the words it was asked. Hidden when there is nothing.
 */
export function FormAnswersCard({ lead }: { lead: Pick<CrmLead, 'enquiry_answers' | 'enquiry_occasion' | 'partner_name'> }) {
  const answers = lead.enquiry_answers ?? []
  if (!answers.length) return null
  return (
    <section aria-label="Answers from the form" className="flex flex-col gap-2 rounded-xl border border-border bg-muted/30 p-3">
      <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        <MessageSquareText className="size-3.5" aria-hidden />
        Answers from {lead.partner_name ? `${lead.partner_name}'s QR` : 'the form'}
      </p>
      <dl className="flex flex-col gap-2">
        {answers.map((a, i) => (
          <div key={i}>
            <dt className="text-xs text-muted-foreground">{a.question}</dt>
            <dd className="whitespace-pre-line text-sm font-medium">{a.answer}</dd>
          </div>
        ))}
      </dl>
    </section>
  )
}
