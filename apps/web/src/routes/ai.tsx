import { Link } from '@tanstack/react-router'
import { FileImage, Gift, ListChecks, MessageSquareText, PenLine, Sparkles, type LucideIcon } from 'lucide-react'
import { AuthedPage } from '@/shared/layout/AuthedPage'
import { PageHeader } from '@/shared/layout/page-header'
import { Card, CardContent } from '@/shared/ui/card'
import { cn } from '@/shared/ui/cn'

export function AiPage() {
  return (
    <AuthedPage module="projects" studioWork="/dashboard">
      <PageHeader title="AI" />
      <AiHub />
    </AuthedPage>
  )
}

interface Tool {
  title: string
  line: string
  icon: LucideIcon
  to?: '/ai/designer' | '/ai/sequences' | '/leads' | '/referrals'
  /** A word under the button, when the tool opens somewhere else. */
  how?: string
}

/**
 * Studio AutoPilot's AI tools (owner, 9 Nov: "make the platform an AI
 * platform"). The Quotation Designer is first; the rest say "Coming soon"
 * until they are built, never a button that goes nowhere.
 */
const TOOLS: Tool[] = [
  { title: 'Quotation Designer', line: 'A premium quotation in your own photos, filled from the project.', icon: FileImage, to: '/ai/designer' },
  {
    title: 'Reply to a lead',
    line: 'A WhatsApp reply to an enquiry, ready to send.',
    icon: MessageSquareText,
    to: '/leads',
    how: 'Open any lead and press Reply with AI.',
  },
  {
    title: 'Follow-up sequences',
    line: 'A whole series of follow-ups, written for what happened with the lead.',
    icon: ListChecks,
    to: '/ai/sequences',
  },
  {
    title: 'Referral cards',
    line: 'A WhatsApp card for each client to send friends: their friend gets an offer, they get a reward.',
    icon: Gift,
    to: '/referrals',
  },
  { title: 'Write it for me', line: 'Your About Us and deliverables, written in your words.', icon: PenLine },
]

function AiHub() {
  return (
    <div className="grid max-w-5xl gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {TOOLS.map((t) => {
        const body = (
          <Card className={cn('h-full transition-colors', t.to ? 'border-primary/40 hover:bg-primary/5' : 'opacity-75')}>
            <CardContent className="flex h-full flex-col gap-3 p-4">
              <span className={cn('flex size-11 items-center justify-center rounded-xl', t.to ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground')}>
                <t.icon className="size-5" aria-hidden />
              </span>
              <div className="flex-1">
                <p className="font-semibold">{t.title}</p>
                <p className="text-sm text-muted-foreground">{t.line}</p>
                {t.how && <p className="mt-1 text-xs font-medium text-primary">{t.how}</p>}
              </div>
              {t.to ? (
                <span className="inline-flex w-fit items-center gap-1.5 rounded-full bg-primary px-3 py-1 text-sm font-medium text-primary-foreground">
                  <Sparkles className="size-4" aria-hidden /> Open
                </span>
              ) : (
                <span className="w-fit rounded-full border border-border px-3 py-1 text-xs text-muted-foreground">Coming soon</span>
              )}
            </CardContent>
          </Card>
        )
        return t.to ? (
          <Link key={t.title} to={t.to} className="block">
            {body}
          </Link>
        ) : (
          <div key={t.title}>{body}</div>
        )
      })}
    </div>
  )
}
