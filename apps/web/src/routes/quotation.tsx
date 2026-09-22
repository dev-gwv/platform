import { useEffect, useState } from 'react'
import { publicQuotation, z, parseQuotationTerms, buildMailtoUrl, buildWhatsAppUrl, type PublicQuotation } from '@ipc/contracts'
import { CheckCircle2, FileText, Printer, Mail, MessageCircle, Copy } from 'lucide-react'
import { toast } from 'sonner'
import { callApi, ApiError } from '@/shared/api/client'
import { CameraBackdrop } from '@/shared/brand/CameraBackdrop'
import { Button } from '@/shared/ui/button'
import { DownloadDocumentButton } from '@/shared/ui/download-document'
import { Card, CardContent } from '@/shared/ui/card'
import { Input, Label } from '@/shared/ui/input'
import { Skeleton } from '@/shared/ui/skeleton'
import { StatusBadge } from '@/shared/ui/status-badge'
import { formatINR } from '@/shared/ui/format'

const okResponse = z.object({ ok: z.boolean() })
const emailResult = z.object({ status: z.string(), error: z.string().nullable(), url: z.string() })

const dayFormat = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
const day = (v: unknown): string => {
  if (!v) return '—'
  const d = new Date(String(v))
  return Number.isNaN(d.getTime()) ? String(v) : dayFormat.format(d)
}

interface DeliverableRow {
  id?: string
  title?: string
  description?: string | null
  estimated_date?: string | null
  is_additional_charge?: boolean
  additional_charge_amount?: number
}

const asRows = (v: unknown): DeliverableRow[] =>
  Array.isArray(v) ? (v as DeliverableRow[]) : []

/**
 * PUBLIC page — no auth, no app shell.
 *
 * What the couple sees when the studio sends "here's the quote". The numbers
 * come from the snapshot taken when it was issued, so the page cannot quietly
 * disagree with the paper they were shown.
 *
 * Laid out as a document rather than an app screen: letterhead, who it is for,
 * what is included, what it costs, terms, footer. It is a thing a client saves
 * and prints, and the eight display prefs decide which blocks the studio shows.
 */
export function QuotationPage() {
  const token = new URLSearchParams(window.location.search).get('token') ?? ''
  const [quote, setQuote] = useState<PublicQuotation | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [answered, setAnswered] = useState<'accepted' | 'declined' | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!token) {
      setLoadError('This link is missing its token.')
      return
    }
    callApi(`/public/quotation/${token}`, { responseSchema: publicQuotation })
      .then((q) => {
        if (q.show_quotation === false) {
          setLoadError('This quotation is currently hidden by the studio. Please ask them for an updated link.')
          return
        }
        if (q.revoked) {
          setLoadError('This link has been revoked. Please ask the studio for a fresh one.')
          return
        }
        if (q.expires_at && new Date(q.expires_at).getTime() < Date.now()) {
          setLoadError('This quotation has expired. Please ask the studio for a fresh one.')
          return
        }
        setQuote(q)
        setName(q.accepted_by_name ?? q.client_name ?? '')
        if (q.accepted_at) setAnswered('accepted')
        else if (q.declined_at) setAnswered('declined')
      })
      .catch((e) =>
        setLoadError(e instanceof Error ? e.message : 'This link is invalid or has expired.'),
      )
  }, [token])

  async function respond(accept: boolean) {
    setError(null)
    setBusy(true)
    try {
      await callApi(`/public/quotation/${token}/respond`, {
        method: 'POST',
        body: { accept, name: accept ? name.trim() : null },
        responseSchema: okResponse,
      })
      setAnswered(accept ? 'accepted' : 'declined')
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not record your answer.')
    } finally {
      setBusy(false)
    }
  }

  const prefs = (quote?.display_prefs ?? {}) as Record<string, boolean>
  // Lovable parity: 8 display prefs (camelCase) with legacy snake_case fallback.
  const showPref = (camel: string, snake: string, fallback = true) => {
    if (typeof prefs[camel] === 'boolean') return prefs[camel]
    return show(snake, fallback)
  }
  const show = (key: string, fallback = true) => (typeof prefs[key] === 'boolean' ? prefs[key] : fallback)

  // Fixed received/balance: server-provided totals win; otherwise derive from
  // the snapshot so the page can never claim received == total - total (0).
  const total = quote?.snapshot.total ?? 0
  const received = Math.max(0, quote?.total_received ?? 0)
  const balance = Math.max(0, quote?.balance_due ?? total - received)
  const terms = parseQuotationTerms(quote?.terms_text ?? null)
  const shoots = Array.isArray(quote?.shoots_schedule) ? (quote?.shoots_schedule as Record<string, unknown>[]) : []
  const deliverables = asRows(quote?.deliverables)
  const deliverables2 = asRows(quote?.deliverables_2)
  const showEstimated = showPref('showDeliverablesEstimated', 'deliverables_estimated')
  const url = typeof window !== 'undefined' ? window.location.href : ''
  const shareText = quote ? `Hi, here is your quotation for ${quote.snapshot.project_name} (${formatINR(total)}): ${url}` : url

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(url)
      toast.success('Quotation link copied.')
    } catch {
      toast.error('Could not copy the link.')
    }
  }

  /** Lovable parity: server send — emails the quotation from the studio. */
  async function serverSend() {
    const qid = quote?.quotation_id
    if (!qid) {
      toast.message('Email provider not configured — use Email app below.')
      window.location.href = buildMailtoUrl(null, `Quotation — ${quote?.snapshot.project_name ?? ''}`, shareText)
      return
    }
    setBusy(true)
    try {
      const r = await callApi(`/documents/quotations/${qid}/send-email`, {
        method: 'POST',
        body: {},
        responseSchema: emailResult,
      })
      if (r.status === 'sent') toast.success('Quotation emailed successfully.')
      else if (r.status === 'provider_missing') {
        window.location.href = buildMailtoUrl(null, `Quotation — ${quote?.snapshot.project_name ?? ''}`, shareText)
        toast.message('Email provider not configured — opened your email client.')
      } else toast.error(r.error ?? 'Email failed to send.')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Email failed to send.')
    } finally {
      setBusy(false)
    }
  }

  const studioName = quote?.company_name ?? 'Quotation'

  return (
    <div className="relative overflow-hidden">
      <CameraBackdrop />
      <div className="paper relative mx-auto flex min-h-screen max-w-3xl flex-col justify-center gap-4 p-4">
        {loadError ? (
          <Card>
            <CardContent className="p-4 text-center text-sm text-destructive">{loadError}</CardContent>
          </Card>
        ) : !quote ? (
          <Card>
            <CardContent className="flex flex-col gap-2 p-4">
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-1/2" />
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardContent className="p-4 sm:p-8">
              {/* ── Letterhead ────────────────────────────────── */}
              <header className="paper-block flex flex-wrap items-start justify-between gap-4 border-b border-border pb-6">
                <div className="flex min-w-0 items-start gap-4">
                  {quote.logo_url ? (
                    <img
                      src={quote.logo_url}
                      alt=""
                      className="size-14 shrink-0 rounded-md border border-border bg-white object-contain p-1"
                    />
                  ) : (
                    <span className="flex size-14 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground">
                      <FileText className="size-6" />
                    </span>
                  )}
                  <div className="min-w-0">
                    <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
                      Project Quotation
                    </p>
                    <h1 className="mt-1.5 text-xl font-semibold leading-tight sm:text-2xl">{studioName}</h1>
                    {quote.company_legal_name && quote.company_legal_name !== studioName && (
                      <p className="mt-0.5 text-xs text-muted-foreground">{quote.company_legal_name}</p>
                    )}
                    <p className="mt-1 text-sm text-muted-foreground">
                      Prepared for {quote.client_name ?? 'you'}
                    </p>
                  </div>
                </div>
                <div className="text-left sm:text-right">
                  {quote.quotation_number && (
                    <>
                      <p className="text-[11px] uppercase tracking-wider text-muted-foreground">Quotation no.</p>
                      <p className="font-mono text-sm font-semibold">{quote.quotation_number}</p>
                    </>
                  )}
                  {quote.issued_at && (
                    <>
                      <p className="mt-2 text-[11px] uppercase tracking-wider text-muted-foreground">Issued</p>
                      <p className="text-sm">{day(quote.issued_at)}</p>
                    </>
                  )}
                  <div className="mt-3 space-y-0.5 text-[11px] text-muted-foreground">
                    {quote.gstin && (
                      <div>
                        GSTIN: <span className="text-foreground">{quote.gstin}</span>
                      </div>
                    )}
                    {quote.company_phone && <div>{quote.company_phone}</div>}
                    {quote.company_email && <div className="break-all">{quote.company_email}</div>}
                    {quote.company_website && <div className="break-all">{quote.company_website}</div>}
                    {quote.company_address && <div className="whitespace-pre-line">{quote.company_address}</div>}
                  </div>
                </div>
              </header>

              {/* ── Bill to / Project ─────────────────────────── */}
              {(showPref('showBillTo', 'bill_to') || showPref('showProject', 'project')) && (
                <section className="paper-block grid gap-4 py-4 sm:grid-cols-2">
                  {showPref('showBillTo', 'bill_to') && (
                    <SummaryCard title="Bill to">
                      {quote.client_name ? (
                        <div className="space-y-1 text-sm">
                          <p className="text-base font-semibold">{quote.client_name}</p>
                          {quote.client_phone && <SummaryRow label="Phone" value={quote.client_phone} />}
                          {quote.client_email && <SummaryRow label="Email" value={quote.client_email} />}
                          {quote.client_address && (
                            <SummaryRow label="Address" value={quote.client_address} multiline />
                          )}
                        </div>
                      ) : (
                        <p className="text-sm text-muted-foreground">No client details on file.</p>
                      )}
                    </SummaryCard>
                  )}
                  {showPref('showProject', 'project') && (
                    <SummaryCard title="Project">
                      <div className="space-y-1 text-sm">
                        <p className="text-base font-semibold">{quote.snapshot.project_name}</p>
                        {quote.project_status && <SummaryRow label="Status" value={quote.project_status} />}
                        {quote.issued_at && <SummaryRow label="Quoted" value={day(quote.issued_at)} />}
                      </div>
                    </SummaryCard>
                  )}
                </section>
              )}

              {/* ── What is included ──────────────────────────── */}
              {showPref('showDeliverables', 'deliverables') &&
                (deliverables.length === 0 && deliverables2.length === 0 ? (
                  <section className="paper-block mt-2 rounded-lg border border-dashed border-border bg-muted/30 px-4 py-4 text-center text-sm text-muted-foreground">
                    Deliverables will be shared separately.
                  </section>
                ) : (
                  <>
                    <DeliverablesBlock title="Deliverables" rows={deliverables} showEstimated={showEstimated} />
                    <DeliverablesBlock
                      title="Additional services"
                      rows={deliverables2}
                      showEstimated={showEstimated}
                    />
                  </>
                ))}

              {/* The issued snapshot's own line items, when the studio quoted
                  line by line rather than from the deliverables list. */}
              {quote.snapshot.items.length > 0 && (
                <section className="paper-block mt-6">
                  <h3 className="mb-3 text-sm font-semibold">Quoted items</h3>
                  <div className="overflow-x-auto rounded-lg border border-border">
                    <table className="w-full text-sm">
                      <thead className="bg-muted/50 text-left text-xs uppercase tracking-wider text-muted-foreground">
                        <tr>
                          <th className="px-3 py-2">Item</th>
                          <th className="px-3 py-2 text-right">Charge</th>
                        </tr>
                      </thead>
                      <tbody>
                        {quote.snapshot.items.map((item, i) => (
                          <tr key={i} className="border-t border-border">
                            <td className="px-3 py-2">{item.title}</td>
                            <td className="px-3 py-2 text-right font-medium tabular-nums">
                              {item.chargeable ? formatINR(item.amount) : 'Included'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
              )}

              {/* ── Event schedule ────────────────────────────── */}
              {(showPref('showEventSchedule', 'shoots') || show('shoots')) && shoots.length > 0 && (
                <ShootsBlock shoots={shoots} showServices={showPref('showShootServices', 'services')} />
              )}

              {/* ── Cost summary ──────────────────────────────── */}
              {(showPref('showCostSummary', 'cost') || received > 0 || balance !== total) && (
                <section className="paper-block mt-8 grid gap-4 sm:grid-cols-[1fr_auto]">
                  <div className="hidden sm:block" />
                  <div className="ml-auto w-full max-w-sm rounded-xl border border-border bg-muted/30 p-4">
                    <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Summary
                    </h3>
                    <dl className="flex flex-col gap-1.5 text-sm">
                      <Row label="Package cost" value={formatINR(quote.snapshot.package_cost)} />
                      {quote.snapshot.add_ons > 0 && (
                        <Row label="Additional deliverables" value={formatINR(quote.snapshot.add_ons)} />
                      )}
                      <div className="my-2 border-t border-border" />
                      <Row label="Total quotation value" value={formatINR(total)} strong />
                      {received > 0 && (
                        <>
                          <div className="my-2 border-t border-dashed border-border" />
                          <Row label="Amount received" value={formatINR(received)} />
                          <Row label="Balance pending" value={formatINR(balance)} strong />
                        </>
                      )}
                    </dl>
                  </div>
                </section>
              )}

              {/* ── Terms ─────────────────────────────────────── */}
              {(showPref('showTerms', 'terms') || show('terms')) && terms.length > 0 && (
                <section className="paper-block mt-8 border-t border-border pt-5">
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Terms &amp; notes
                  </h3>
                  <ol className="mt-3 list-decimal space-y-1.5 pl-5 text-xs leading-relaxed text-muted-foreground">
                    {terms.map((t, i) => (
                      <li key={i}>{t}</li>
                    ))}
                  </ol>
                </section>
              )}

              {quote.notes && show('notes') && (
                <p className="paper-block mt-4 whitespace-pre-line rounded-lg border border-border bg-muted/30 p-3 text-sm">
                  {quote.notes}
                </p>
              )}

              {/* ── Footer ────────────────────────────────────── */}
              <footer className="paper-block mt-8 space-y-2 border-t border-border pt-4 text-[11px] text-muted-foreground">
                {quote.document_footer_note && (
                  <p className="whitespace-pre-line text-foreground/80">{quote.document_footer_note}</p>
                )}
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span>{studioName} · Project Quotation</span>
                  {quote.quotation_number && <span>{quote.quotation_number}</span>}
                </div>
              </footer>

              {/* ── Actions (never printed) ───────────────────── */}
              <div className="no-print mt-6 flex flex-wrap gap-2 border-t border-border pt-5">
                <DownloadDocumentButton
                  name={`Quotation${quote.client_name ? ` ${quote.client_name}` : ''}`}
                  label="Download PDF"
                />
                <Button variant="outline" size="sm" onClick={() => window.print()}>
                  <Printer className="mr-1 size-4" /> Print
                </Button>
                <Button size="sm" variant="outline" asChild>
                  <a href={buildWhatsAppUrl(null, shareText)} target="_blank" rel="noreferrer noopener">
                    <MessageCircle className="mr-1 size-4" /> WhatsApp
                  </a>
                </Button>
                <Button size="sm" variant="outline" asChild>
                  <a href={buildMailtoUrl(null, `Quotation — ${formatINR(total)}`, shareText)}>
                    <Mail className="mr-1 size-4" /> Email
                  </a>
                </Button>
                <Button size="sm" variant="outline" onClick={() => void copyLink()}>
                  <Copy className="mr-1 size-4" /> Copy link
                </Button>
                <Button size="sm" variant="outline" onClick={() => void serverSend()} disabled={busy}>
                  Send via studio
                </Button>
              </div>

              {answered === 'accepted' ? (
                <div className="mt-4 rounded-lg bg-success/10 p-3 text-sm">
                  <p className="flex items-center gap-2 font-medium text-success">
                    <CheckCircle2 className="size-4 shrink-0" />
                    Accepted{name ? ` by ${name}` : ''} — the studio has been told.
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Acknowledgement receipt
                    {quote.accepted_at ? ` · recorded ${new Date(quote.accepted_at).toLocaleString('en-IN')}` : ''}.
                    Keep this link as your receipt.
                  </p>
                </div>
              ) : (
                <div className="no-print mt-4 flex flex-col gap-3">
                  {answered === 'declined' && (
                    <p className="rounded-lg border border-border p-3 text-sm text-muted-foreground">
                      You declined this quotation. You can still accept it below if you change your mind.
                    </p>
                  )}
                  <div className="flex flex-col gap-1.5">
                    <Label>Your name</Label>
                    <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Rahul Sharma" />
                    <p className="text-xs text-muted-foreground">
                      Typing your name and accepting records your approval of the prices above.
                    </p>
                  </div>
                  {error && <p className="text-sm text-destructive">{error}</p>}
                  <div className="flex flex-wrap gap-2">
                    <Button onClick={() => void respond(true)} disabled={busy || name.trim().length < 2}>
                      Accept quotation
                    </Button>
                    <Button variant="outline" onClick={() => void respond(false)} disabled={busy}>
                      Not right now
                    </Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {answered && (
          <div className="no-print flex justify-center">
            <StatusBadge tone={answered === 'accepted' ? 'success' : 'warning'}>
              {answered === 'accepted' ? 'Accepted' : 'Declined'}
            </StatusBadge>
          </div>
        )}
      </div>
    </div>
  )
}

function SummaryCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-border bg-muted/20 p-4">
      <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
        {title}
      </h3>
      {children}
    </div>
  )
}

function SummaryRow({ label, value, multiline }: { label: string; value: string; multiline?: boolean }) {
  return (
    <div className="flex gap-2">
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <span className={multiline ? 'whitespace-pre-line' : ''}>{value}</span>
    </div>
  )
}

/**
 * Deliverables as a table, not a bullet list: the estimated date and which
 * items carry an extra charge are the two things a client reads this block
 * for, and both need a column of their own to be comparable down the page.
 */
function DeliverablesBlock({
  title,
  rows,
  showEstimated,
}: {
  title: string
  rows: DeliverableRow[]
  showEstimated: boolean
}) {
  if (rows.length === 0) return null
  return (
    <section className="paper-block mt-6">
      <h3 className="mb-3 text-sm font-semibold">{title}</h3>
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full min-w-[28rem] text-sm">
          <thead className="bg-muted/50 text-left text-xs uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="px-3 py-2">Item</th>
              {showEstimated && <th className="px-3 py-2">Estimated</th>}
              <th className="px-3 py-2 text-right">Charge</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((d, i) => (
              <tr key={d.id ?? i} className="border-t border-border align-top">
                <td className="px-3 py-2">
                  <div className="font-medium">{d.title ?? `Item ${i + 1}`}</div>
                  {d.description && <div className="text-xs text-muted-foreground">{d.description}</div>}
                  {d.is_additional_charge && (
                    <span className="mt-1 inline-block rounded-full border border-border bg-muted px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider">
                      Additional charge
                    </span>
                  )}
                </td>
                {showEstimated && (
                  <td className="px-3 py-2 text-muted-foreground">{day(d.estimated_date)}</td>
                )}
                <td className="px-3 py-2 text-right font-medium tabular-nums">
                  {d.is_additional_charge ? formatINR(Number(d.additional_charge_amount ?? 0)) : 'Included'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

/** The shoot dates, with city, time and what is covered on each. */
function ShootsBlock({
  shoots,
  showServices,
}: {
  shoots: Record<string, unknown>[]
  showServices: boolean
}) {
  return (
    <section className="paper-block mt-6">
      <h3 className="mb-3 text-sm font-semibold">Event schedule</h3>
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full min-w-[30rem] text-sm">
          <thead className="bg-muted/50 text-left text-xs uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="px-3 py-2">Shoot</th>
              <th className="px-3 py-2">Date</th>
              <th className="px-3 py-2">City</th>
              {showServices && <th className="px-3 py-2">Services</th>}
            </tr>
          </thead>
          <tbody>
            {shoots.map((s, i) => {
              const services = Array.isArray(s['services']) ? (s['services'] as Record<string, unknown>[]) : []
              const time = s['time'] ? String(s['time']).slice(0, 5) : ''
              return (
                <tr key={i} className="border-t border-border align-top">
                  <td className="px-3 py-2 font-medium">
                    {String(s['title'] ?? s['name'] ?? `Shoot ${i + 1}`)}
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {day(s['date'] ?? s['shoot_date'])}
                    {time ? ` · ${time}` : ''}
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {String(s['city'] ?? s['location'] ?? '—')}
                  </td>
                  {showServices && (
                    <td className="px-3 py-2 text-muted-foreground">
                      {services.length === 0
                        ? '—'
                        : services
                            .map(
                              (sv) =>
                                `${String(sv['name'] ?? 'Service')}${
                                  Number(sv['quantity'] ?? 1) > 1 ? ` ×${Number(sv['quantity'])}` : ''
                                }`,
                            )
                            .join(', ')}
                    </td>
                  )}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </section>
  )
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <dt className={strong ? 'font-medium' : 'text-muted-foreground'}>{label}</dt>
      <dd className={strong ? 'text-base font-semibold tabular-nums' : 'tabular-nums'}>{value}</dd>
    </div>
  )
}
