import { AlarmClock, CheckCircle2, CircleDashed, FilePen, Send, XCircle } from 'lucide-react'
import { StatusBadge } from '@/shared/ui/status-badge'
import { cn } from '@/shared/ui/cn'
import { invoiceBadge } from './status'

const ICON = {
  Paid: CheckCircle2,
  Overdue: AlarmClock,
  'Part paid': CircleDashed,
  Sent: Send,
  Draft: FilePen,
  Cancelled: XCircle,
} as const

/** How an invoice stands, with an icon beside the word: a tick means paid, a clock means late. */
export function InvoiceBadge({ invoice, className }: { invoice: Parameters<typeof invoiceBadge>[0]; className?: string }) {
  const badge = invoiceBadge(invoice)
  const Icon = ICON[badge.label as keyof typeof ICON] ?? Send
  return (
    <StatusBadge tone={badge.tone} className={cn('gap-1 font-semibold', className)}>
      <Icon className="size-3.5" aria-hidden />
      {badge.label}
    </StatusBadge>
  )
}
