import { Link } from '@tanstack/react-router'
import { ArrowRight, FileImage, Gift, Instagram, ListChecks, MessageSquareText, Sparkles, type LucideIcon } from 'lucide-react'
import { AuthedPage } from '@/shared/layout/AuthedPage'
import { NewBadge, type NewFeature } from '@/shared/ui/new-badge'
import { cn } from '@/shared/ui/cn'

export function AiPage() {
  return (
    <AuthedPage module="projects" studioWork="/dashboard">
      <AiHub />
    </AuthedPage>
  )
}

interface Tool {
  title: string
  line: string
  icon: LucideIcon
  to: '/ai/designer' | '/ai/sequences' | '/ai/captions' | '/leads' | '/referrals'
  /** Where it is used, when the tool lives on another page. */
  how?: string
  /** The icon tile's colours. */
  tint: string
  fresh?: NewFeature
}

/**
 * Studio AutoPilot's AI tools (owner, 9 Nov: "make the platform an AI
 * platform"; audit 10 Nov: no empty right side, no "Coming soon" for a tool
 * that already works inside another one). Every card opens something.
 */
const TOOLS: Tool[] = [
  {
    title: 'Quotation Designer',
    line: 'A premium quotation in your own photos, filled from the project. Write it for me writes the words.',
    icon: FileImage,
    to: '/ai/designer',
    tint: 'from-violet-600 to-indigo-600',
  },
  {
    title: 'Social media captions',
    line: 'Three Instagram, Facebook or WhatsApp status captions for any post, with hashtags.',
    icon: Instagram,
    to: '/ai/captions',
    tint: 'from-pink-500 to-orange-400',
    fresh: 'aiCaptions',
  },
  {
    title: 'Follow-up sequences',
    line: 'A whole series of WhatsApp messages and call reminders, written for what happened with the lead.',
    icon: ListChecks,
    to: '/ai/sequences',
    tint: 'from-sky-500 to-blue-600',
    fresh: 'aiSequences',
  },
  {
    title: 'Reply to a lead',
    line: 'A WhatsApp reply to an enquiry in English, हिन्दी or Hinglish, ready to send.',
    icon: MessageSquareText,
    to: '/leads',
    how: 'Open any lead → Reply with AI',
    tint: 'from-emerald-500 to-teal-600',
    fresh: 'aiReply',
  },
  {
    title: 'Referral cards',
    line: 'A WhatsApp card each client sends friends: the friend gets an offer, your client a reward.',
    icon: Gift,
    to: '/referrals',
    tint: 'from-amber-500 to-rose-500',
    fresh: 'referralCards',
  },
]

function AiHub() {
  return (
    <div className="flex flex-col gap-5">
      <header className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-violet-700 via-indigo-700 to-slate-900 p-6 text-white shadow-md sm:p-8">
        <div className="pointer-events-none absolute -right-16 -top-16 size-64 rounded-full bg-white/10 blur-2xl" aria-hidden />
        <div className="pointer-events-none absolute -bottom-24 right-32 size-56 rounded-full bg-amber-400/20 blur-3xl" aria-hidden />
        <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-widest text-white/70">
          <Sparkles className="size-3.5" aria-hidden /> AI
        </p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight sm:text-3xl">Your studio's writing team</h1>
        <p className="mt-1 max-w-xl text-sm text-white/80">
          Quotations, captions, replies and follow-ups in your words. You read every one before it goes out.
        </p>
      </header>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {TOOLS.map((t) => (
          <Link
            key={t.title}
            to={t.to}
            className="group flex h-full flex-col gap-3 rounded-2xl border border-border bg-card p-5 shadow-sm transition hover:-translate-y-0.5 hover:border-violet-300 hover:shadow-md"
          >
            <div className="flex items-start justify-between gap-2">
              <span className={cn('flex size-12 items-center justify-center rounded-xl bg-gradient-to-br text-white shadow-sm', t.tint)}>
                <t.icon className="size-6" aria-hidden />
              </span>
              <NewBadge feature={t.fresh} />
            </div>
            <div className="flex-1">
              <p className="text-base font-semibold">{t.title}</p>
              <p className="mt-0.5 text-sm text-muted-foreground">{t.line}</p>
            </div>
            <span className="flex items-center justify-between gap-2 border-t border-border pt-3 text-sm font-medium text-violet-700 dark:text-violet-300">
              {t.how ?? 'Open'}
              <ArrowRight className="size-4 transition group-hover:translate-x-0.5" aria-hidden />
            </span>
          </Link>
        ))}
      </div>
    </div>
  )
}
