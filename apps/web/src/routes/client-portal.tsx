import { useState, type CSSProperties, type ReactNode } from 'react'
import { Link, useParams } from '@tanstack/react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ArrowLeft,
  CalendarDays,
  Camera,
  CheckCircle2,
  Clock,
  ExternalLink,
  FileText,
  Mail,
  MapPin,
  PencilLine,
  Phone,
  Printer,
  Receipt,
  Sparkles,
  ThumbsUp,
  Users,
  Wallet,
} from 'lucide-react'
import { toast } from 'sonner'
import { publicClientPortal, publicInvoice, z, type PublicClientPortal } from '@ipc/contracts'
import { ApiError, callApi } from '@/shared/api/client'
import { mapHref, mapSearchHref } from '@/features/shoots/map-link'
import { Button } from '@/shared/ui/button'
import { Card, CardContent } from '@/shared/ui/card'
import { Textarea } from '@/shared/ui/input'
import { Skeleton } from '@/shared/ui/skeleton'
import { StatusBadge } from '@/shared/ui/status-badge'
import { formatINR } from '@/shared/ui/format'
import { cn } from '@/shared/ui/cn'
import { foregroundForHex, presetFor } from '@/shared/theme/presets'
import { InvoicePaper } from '@/features/billing/InvoicePaper'
import { termsPayload } from '@/features/terms/document'
import { TermsDocumentLetterhead, TermsDocumentSheet } from '@/features/terms/TermsDocumentSheet'
import { DELIVERABLE_STATUS_LABEL, openedAgo } from '@/features/client-portal/format'

/**
 * PUBLIC page -- no login, no app shell. The one link a studio sends its
 * couple: their shoots, their photos and films as they get ready, what is
 * paid and what is left, and the terms they were sent. Most people open it on
 * a phone from WhatsApp, so it is built for a narrow screen first and wears
 * the studio's own colour.
 */

const IST = 'Asia/Kolkata'
const dayFmt = new Intl.DateTimeFormat('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: IST })
const shortFmt = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: IST })
const monthFmt = new Intl.DateTimeFormat('en-IN', { month: 'short', timeZone: IST })
const dayNumFmt = new Intl.DateTimeFormat('en-IN', { day: 'numeric', timeZone: IST })
const timeFmt = new Intl.DateTimeFormat('en-IN', { hour: 'numeric', minute: '2-digit', timeZone: IST })
const isoDayFmt = new Intl.DateTimeFormat('en-CA', { timeZone: IST })

/** A calendar date ("2026-12-01") as India reads it, without a timezone shift. */
const asDate = (d: string) => new Date(`${d}T12:00:00+05:30`)
const todayInIndia = () => isoDayFmt.format(new Date())

function daysUntil(d: string): number {
  return Math.round((asDate(d).getTime() - asDate(todayInIndia()).getTime()) / 86_400_000)
}

function whenLabel(d: string): string | null {
  const n = daysUntil(d)
  if (n === 0) return 'Today'
  if (n === 1) return 'Tomorrow'
  if (n > 1 && n <= 60) return `In ${n} days`
  return null
}

/** The studio's colour on this page: its own hex, else its theme's accent. */
function brandStyle(studio: PublicClientPortal['studio']): CSSProperties | undefined {
  const hex = studio.brand_color && /^#[0-9a-f]{6}$/i.test(studio.brand_color) ? studio.brand_color : null
  if (hex) return { '--primary': hex, '--ring': hex, '--primary-foreground': foregroundForHex(hex) } as CSSProperties
  if (!studio.theme_preset) return undefined
  const dark = typeof document !== 'undefined' && document.documentElement.classList.contains('dark')
  const t = presetFor(studio.theme_preset)[dark ? 'dark' : 'light']
  return { '--primary': t['--primary'], '--ring': t['--ring'], '--primary-foreground': t['--primary-foreground'] } as CSSProperties
}

const portalKey = (token: string) => ['public-portal', token] as const

function usePortal(token: string) {
  return useQuery({
    queryKey: portalKey(token),
    queryFn: () => callApi(`/public/portal/${encodeURIComponent(token)}`, { responseSchema: publicClientPortal }),
    retry: false,
    staleTime: 60_000,
  })
}

// ── the page ─────────────────────────────────────────────────────
export function ClientPortalPage() {
  const { token } = useParams({ from: '/p/$token' })
  const { data, error, isLoading } = usePortal(token)

  if (error) return <LinkDoesNotOpen message={error instanceof ApiError ? error.message : null} />
  if (isLoading || !data) return <PortalSkeleton />

  const { studio, project } = data
  const hello = project.client_name ? `Hello, ${project.client_name}` : 'Hello'
  const ready = data.deliverables.filter((d) => d.status === 'ready').length

  return (
    <div style={brandStyle(studio)} className="min-h-screen bg-background">
      <header className="bg-primary px-4 pb-14 pt-6 text-primary-foreground sm:pb-16">
        <div className="mx-auto flex max-w-2xl flex-col gap-5">
          <StudioMark studio={studio} />
          <div className="min-w-0">
            <p className="text-sm opacity-80">{hello} 👋</p>
            <h1 className="mt-1 break-words text-2xl font-semibold leading-tight tracking-tight sm:text-3xl">{project.name}</h1>
            <p className="mt-2 text-sm opacity-80">
              Your shoots, photos and payments in one place — kept up to date by {studio.name ?? 'your studio'}.
            </p>
          </div>
        </div>
      </header>

      <main className="mx-auto -mt-9 flex max-w-2xl flex-col gap-6 px-4 pb-12">
        <Card className="shadow-md">
          <CardContent className="grid grid-cols-3 divide-x divide-border/70 p-0 text-center">
            <Glance label={data.shoots.length === 1 ? 'Shoot' : 'Shoots'} value={String(data.shoots.length)} />
            <Glance label="Ready" value={`${ready}/${data.deliverables.length}`} />
            {data.money ? (
              <Glance label="Balance" value={formatINR(data.money.balance)} />
            ) : (
              <Glance label={data.terms.length === 1 ? 'Document' : 'Documents'} value={String(data.terms.length)} />
            )}
          </CardContent>
        </Card>

        <Section icon={CalendarDays} title="Your shoots" empty={data.shoots.length === 0 ? 'Your shoot dates will show here once they are fixed.' : null}>
          {data.shoots.map((s) => (
            <ShootCard key={s.id} shoot={s} />
          ))}
        </Section>

        <Section
          icon={Sparkles}
          title="Your photos & films"
          empty={data.deliverables.length === 0 ? 'What we are making for you will show here.' : null}
        >
          {data.deliverables.map((d) => (
            <DeliverableCard key={d.id} token={token} item={d} allowFeedback={data.options.allow_feedback} />
          ))}
        </Section>

        {data.money && <MoneySection token={token} money={data.money} />}

        {data.terms.length > 0 && (
          <Section icon={FileText} title="Your documents">
            {data.terms.map((t) => (
              <Card key={t.id}>
                <CardContent className="flex items-center gap-3 p-4">
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                    <FileText className="size-5" aria-hidden />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="break-words font-medium">{t.title}</p>
                    <p className="text-xs text-muted-foreground">
                      {t.agreed_at
                        ? `You agreed on ${shortFmt.format(new Date(t.agreed_at))}`
                        : `Sent on ${shortFmt.format(new Date(t.sent_at))}`}
                    </p>
                  </div>
                  <Button size="sm" variant="outline" asChild>
                    <Link to="/p/$token/terms/$docId" params={{ token, docId: t.id }}>
                      Read
                    </Link>
                  </Button>
                </CardContent>
              </Card>
            ))}
          </Section>
        )}

        <StudioContact studio={studio} />
      </main>
    </div>
  )
}

function StudioMark({ studio }: { studio: PublicClientPortal['studio'] }) {
  return (
    <div className="flex min-w-0 items-center gap-3">
      {studio.logo_url ? (
        <img
          src={studio.logo_url}
          alt=""
          className="size-11 shrink-0 rounded-full bg-white object-contain p-1 shadow-sm"
        />
      ) : (
        <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-primary-foreground/15">
          <Camera className="size-5" aria-hidden />
        </span>
      )}
      <div className="min-w-0">
        <p className="truncate font-semibold">{studio.name ?? 'Your studio'}</p>
        {studio.city && <p className="truncate text-xs opacity-75">{studio.city}</p>}
      </div>
    </div>
  )
}

function Glance({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 px-2 py-4">
      <p className="truncate text-lg font-semibold tabular-nums">{value}</p>
      <p className="truncate text-xs text-muted-foreground">{label}</p>
    </div>
  )
}

function Section({
  icon: Icon,
  title,
  empty,
  children,
}: {
  icon: typeof CalendarDays
  title: string
  empty?: string | null
  children?: ReactNode
}) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="flex items-center gap-2 text-base font-semibold">
        <Icon className="size-4 text-primary" aria-hidden />
        {title}
      </h2>
      {empty ? (
        <Card>
          <CardContent className="p-4 text-sm text-muted-foreground">{empty}</CardContent>
        </Card>
      ) : (
        children
      )}
    </section>
  )
}

// ── shoots ───────────────────────────────────────────────────────
function ShootCard({ shoot }: { shoot: PublicClientPortal['shoots'][number] }) {
  const past = shoot.shoot_date ? daysUntil(shoot.shoot_date) < 0 : false
  const soon = shoot.shoot_date ? whenLabel(shoot.shoot_date) : null
  const time =
    shoot.start_at && shoot.end_at
      ? `${timeFmt.format(new Date(shoot.start_at))} – ${timeFmt.format(new Date(shoot.end_at))}`
      : shoot.start_at
        ? `From ${timeFmt.format(new Date(shoot.start_at))}`
        : null
  const href = mapHref(shoot.map_link) ?? (shoot.location ? mapSearchHref(shoot.location) : null)

  return (
    <Card className={cn(past && 'opacity-80')}>
      <CardContent className="flex gap-3 p-4">
        <div
          className={cn(
            'flex w-14 shrink-0 flex-col items-center justify-center rounded-xl py-2',
            past ? 'bg-muted text-muted-foreground' : 'bg-primary/10 text-primary',
          )}
        >
          {shoot.shoot_date ? (
            <>
              <span className="text-xl font-semibold leading-none">{dayNumFmt.format(asDate(shoot.shoot_date))}</span>
              <span className="mt-1 text-xs font-medium uppercase">{monthFmt.format(asDate(shoot.shoot_date))}</span>
            </>
          ) : (
            <CalendarDays className="size-5" aria-hidden />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <p className="break-words font-semibold">{shoot.name}</p>
            {soon && <StatusBadge tone="info">{soon}</StatusBadge>}
            {past && <StatusBadge tone="neutral">Done</StatusBadge>}
          </div>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {shoot.shoot_date ? dayFmt.format(asDate(shoot.shoot_date)) : 'Date to be fixed'}
            {time ? ` · ${time}` : ''}
          </p>
          {shoot.location && (
            <p className="mt-1 flex items-start gap-1.5 text-sm">
              <MapPin className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" aria-hidden />
              {href ? (
                <a href={href} target="_blank" rel="noreferrer noopener" className="break-words underline-offset-2 hover:underline">
                  {shoot.location}
                </a>
              ) : (
                <span className="break-words">{shoot.location}</span>
              )}
            </p>
          )}
          {shoot.team.length > 0 && (
            <p className="mt-2 flex items-start gap-1.5 text-xs text-muted-foreground">
              <Users className="mt-0.5 size-3.5 shrink-0" aria-hidden />
              <span className="break-words">
                {shoot.team.map((m) => (m.role ? `${m.first_name} (${m.role})` : m.first_name)).join(', ')}
              </span>
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

// ── deliverables ─────────────────────────────────────────────────
const STATUS_TONE = { not_started: 'neutral', in_progress: 'warning', ready: 'success' } as const
const STATUS_ICON = { not_started: Clock, in_progress: Sparkles, ready: CheckCircle2 } as const
const ok = z.object({ ok: z.boolean() })

function DeliverableCard({
  token,
  item,
  allowFeedback,
}: {
  token: string
  item: PublicClientPortal['deliverables'][number]
  allowFeedback: boolean
}) {
  const qc = useQueryClient()
  const [asking, setAsking] = useState(false)
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const Icon = STATUS_ICON[item.status]

  async function send(kind: 'approved' | 'change_requested') {
    if (kind === 'change_requested' && !message.trim()) {
      toast.error('Please tell the studio what you would like changed.')
      return
    }
    setBusy(true)
    try {
      await callApi(`/public/portal/${encodeURIComponent(token)}/feedback`, {
        method: 'POST',
        body: { deliverable_id: item.id, kind, message: kind === 'change_requested' ? message.trim() : undefined },
        responseSchema: ok,
      })
      toast.success(kind === 'approved' ? 'Thank you! The studio will be so happy to hear it.' : 'Sent. The studio will get back to you.')
      setAsking(false)
      setMessage('')
      await qc.invalidateQueries({ queryKey: portalKey(token) })
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'We could not send that. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card>
      <CardContent className="flex flex-col gap-3 p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="break-words font-semibold">{item.title}</p>
            {item.shoot_name && <p className="text-xs text-muted-foreground">From {item.shoot_name}</p>}
          </div>
          <StatusBadge tone={STATUS_TONE[item.status]} className="shrink-0 gap-1">
            <Icon className="size-3" aria-hidden />
            {DELIVERABLE_STATUS_LABEL[item.status]}
          </StatusBadge>
        </div>
        {item.description && <p className="break-words text-sm text-muted-foreground">{item.description}</p>}

        <p className="text-sm text-muted-foreground">
          {item.status === 'ready' && item.delivered_at
            ? `Ready since ${shortFmt.format(new Date(item.delivered_at))}`
            : item.expected_date
              ? `Expected by ${shortFmt.format(asDate(item.expected_date))}`
              : item.status === 'ready'
                ? 'Ready for you'
                : 'We will share a date soon'}
        </p>

        {item.delivery_link && /^https?:\/\//i.test(item.delivery_link) && (
          <Button asChild className="w-full sm:w-auto">
            <a href={item.delivery_link} target="_blank" rel="noreferrer noopener">
              <ExternalLink /> Open {item.title}
            </a>
          </Button>
        )}

        {item.feedback && (
          <p className="flex items-start gap-1.5 rounded-lg bg-muted/60 p-2 text-xs text-muted-foreground">
            {item.feedback.kind === 'approved' ? (
              <ThumbsUp className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            ) : (
              <PencilLine className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            )}
            <span className="min-w-0 break-words">
              You said {openedAgo(item.feedback.created_at)}:{' '}
              {item.feedback.kind === 'approved' ? 'Looks great!' : `“${item.feedback.message ?? ''}”`}
            </span>
          </p>
        )}

        {allowFeedback && item.status === 'ready' && !asking && (
          <div className="grid grid-cols-2 gap-2">
            <Button size="sm" variant="outline" disabled={busy} onClick={() => void send('approved')}>
              <ThumbsUp /> Looks great
            </Button>
            <Button size="sm" variant="outline" disabled={busy} onClick={() => setAsking(true)}>
              <PencilLine /> Request change
            </Button>
          </div>
        )}
        {asking && (
          <div className="flex flex-col gap-2">
            <Textarea
              autoFocus
              rows={3}
              maxLength={2000}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="What would you like changed? For example: “Please brighten the photos on page 4.”"
              aria-label="What would you like changed?"
            />
            <div className="flex gap-2">
              <Button size="sm" disabled={busy} onClick={() => void send('change_requested')}>
                {busy ? 'Sending…' : 'Send to studio'}
              </Button>
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => setAsking(false)}>
                Cancel
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

// ── money ────────────────────────────────────────────────────────
function MoneySection({ token, money }: { token: string; money: NonNullable<PublicClientPortal['money']> }) {
  const pct = money.total > 0 ? Math.min(100, Math.round((money.received / money.total) * 100)) : 0
  return (
    <Section icon={Wallet} title="Payments">
      <Card>
        <CardContent className="flex flex-col gap-3 p-4">
          <div className="flex items-baseline justify-between gap-3">
            <p className="text-sm text-muted-foreground">Total package</p>
            <p className="font-semibold tabular-nums">{formatINR(money.total)}</p>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Paid so far">
            <div className="h-full rounded-full bg-primary transition-[width]" style={{ width: `${pct}%` }} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="min-w-0 rounded-xl bg-success/10 p-3">
              <p className="text-xs text-muted-foreground">Paid so far</p>
              <p className="truncate font-semibold tabular-nums text-success">{formatINR(money.received)}</p>
            </div>
            <div className={cn('min-w-0 rounded-xl p-3', money.balance > 0 ? 'bg-warning/10' : 'bg-success/10')}>
              <p className="text-xs text-muted-foreground">Balance due</p>
              <p className={cn('truncate font-semibold tabular-nums', money.balance > 0 ? 'text-warning' : 'text-success')}>
                {money.balance > 0 ? formatINR(money.balance) : 'All paid 🎉'}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
      {money.invoices.map((inv) => (
        <Card key={inv.id}>
          <CardContent className="flex items-center gap-3 p-4">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <Receipt className="size-5" aria-hidden />
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium">Invoice {inv.invoice_number ?? ''}</p>
              <p className="text-xs text-muted-foreground">
                {formatINR(inv.total)}
                {inv.balance_due > 0 ? ` · ${formatINR(inv.balance_due)} due` : ' · Paid'}
                {inv.balance_due > 0 && inv.due_date ? ` by ${shortFmt.format(asDate(inv.due_date))}` : ''}
              </p>
            </div>
            <Button size="sm" variant="outline" asChild>
              <Link to="/p/$token/invoice/$invoiceId" params={{ token, invoiceId: inv.id }}>
                View
              </Link>
            </Button>
          </CardContent>
        </Card>
      ))}
    </Section>
  )
}

function StudioContact({ studio }: { studio: PublicClientPortal['studio'] }) {
  if (!studio.phone && !studio.email && !studio.website) return null
  return (
    <Card className="bg-primary/5">
      <CardContent className="flex flex-col gap-3 p-4">
        <p className="text-sm">
          <span className="font-semibold">Questions?</span>{' '}
          <span className="text-muted-foreground">{studio.name ?? 'The studio'} is happy to help.</span>
        </p>
        <div className="flex flex-wrap gap-2">
          {studio.phone && (
            <Button size="sm" variant="outline" asChild>
              <a href={`tel:${studio.phone}`}>
                <Phone /> Call
              </a>
            </Button>
          )}
          {studio.email && (
            <Button size="sm" variant="outline" asChild>
              <a href={`mailto:${studio.email}`}>
                <Mail /> Email
              </a>
            </Button>
          )}
          {studio.website && /^https?:\/\//i.test(studio.website) && (
            <Button size="sm" variant="ghost" asChild>
              <a href={studio.website} target="_blank" rel="noreferrer noopener">
                <ExternalLink /> Website
              </a>
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

function PortalSkeleton() {
  return (
    <div className="min-h-screen bg-background">
      <div className="h-44 bg-muted" />
      <div className="mx-auto -mt-9 flex max-w-2xl flex-col gap-4 px-4">
        <Skeleton className="h-20 w-full rounded-xl" />
        <Skeleton className="h-28 w-full rounded-xl" />
        <Skeleton className="h-28 w-full rounded-xl" />
      </div>
    </div>
  )
}

function LinkDoesNotOpen({ message }: { message: string | null }) {
  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col justify-center p-4">
      <Card>
        <CardContent className="flex flex-col items-center gap-2 p-6 text-center">
          <span className="flex size-12 items-center justify-center rounded-full bg-muted">
            <Camera className="size-6 text-muted-foreground" aria-hidden />
          </span>
          <p className="font-semibold">This link does not open</p>
          <p className="text-sm text-muted-foreground">
            {message ?? 'This link is not working any more.'} Your studio can send you a fresh one.
          </p>
        </CardContent>
      </Card>
    </div>
  )
}

function BackToPortal({ token }: { token: string }) {
  return (
    <Button variant="ghost" size="sm" asChild className="self-start">
      <Link to="/p/$token" params={{ token }}>
        <ArrowLeft /> Back to your page
      </Link>
    </Button>
  )
}

// ── one invoice, read through the portal link ────────────────────
export function ClientPortalInvoicePage() {
  const { token, invoiceId } = useParams({ from: '/p/$token/invoice/$invoiceId' })
  const { data, error, isLoading } = useQuery({
    queryKey: ['public-portal', token, 'invoice', invoiceId],
    queryFn: () =>
      callApi(`/public/portal/${encodeURIComponent(token)}/invoices/${invoiceId}`, { responseSchema: publicInvoice }),
    retry: false,
  })
  if (error) return <LinkDoesNotOpen message={error instanceof ApiError ? error.message : null} />
  if (isLoading || !data) return <PortalSkeleton />
  const inv = data.invoice
  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-4 p-4">
      <div className="paper-toolbar flex flex-wrap items-center justify-between gap-2">
        <BackToPortal token={token} />
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-sm">
            {inv.balance_due > 0 ? (
              <>
                <span className="text-muted-foreground">Amount due </span>
                <span className="font-semibold tabular-nums">{formatINR(inv.balance_due)}</span>
              </>
            ) : (
              <span className="font-semibold text-tone-green">Paid in full. Thank you!</span>
            )}
          </p>
          <Button size="sm" variant="outline" onClick={() => window.print()}>
            <Printer /> Print
          </Button>
        </div>
      </div>
      <div className="overflow-x-auto">
        <InvoicePaper invoice={inv} company={data.company} />
      </div>
    </div>
  )
}

// ── one terms document, read through the portal link ─────────────
export function ClientPortalTermsPage() {
  const { token, docId } = useParams({ from: '/p/$token/terms/$docId' })
  const { data, error, isLoading } = useQuery({
    queryKey: ['public-portal', token, 'terms', docId],
    queryFn: () => callApi(`/public/portal/${encodeURIComponent(token)}/terms/${docId}`, { responseSchema: termsPayload }),
    retry: false,
  })
  if (error) return <LinkDoesNotOpen message={error instanceof ApiError ? error.message : null} />
  if (isLoading || !data) return <PortalSkeleton />
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4 p-4">
      <BackToPortal token={token} />
      <TermsDocumentLetterhead
        doc={data}
        trailing={data.acknowledged_at ? <StatusBadge tone="success">Agreed</StatusBadge> : null}
      />
      <TermsDocumentSheet doc={data} bodyClassName="" />
      {data.acknowledged_at && (
        <p className="text-center text-xs text-muted-foreground">
          Agreed by {data.acknowledged_by_name ?? 'you'} on {shortFmt.format(new Date(data.acknowledged_at))}.
        </p>
      )}
    </div>
  )
}
