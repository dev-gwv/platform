import { useEffect, useState } from 'react'
import { publicQuotation, z, buildMailtoUrl, buildWhatsAppUrl, type PublicQuotation } from '@ipc/contracts'
import { CheckCircle2, Printer, Mail, MessageCircle, Copy } from 'lucide-react'
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
import {
  QuotationDocument,
  resolveQuotationPrefs,
  type QuotationDocRow,
  type QuotationDocShoot,
  type QuotationDocumentData,
} from '@/features/projects/QuotationDocument'

const okResponse = z.object({ ok: z.boolean() })
const emailResult = z.object({ status: z.string(), error: z.string().nullable(), url: z.string() })

type Json = Record<string, unknown>
const list = (v: unknown): Json[] => (Array.isArray(v) ? (v as Json[]) : [])
const text = (v: unknown): string | null => (v == null || v === '' ? null : String(v))

/** The deliverable rows the link returns, read defensively: they are jsonb. */
const asRows = (v: unknown): QuotationDocRow[] =>
  list(v).map((d, i) => ({
    id: text(d['id']) ?? undefined,
    title: text(d['title']) ?? `Item ${i + 1}`,
    estimated_date: text(d['estimated_date']),
    is_additional_charge: d['is_additional_charge'] === true,
    additional_charge_amount: Number(d['additional_charge_amount'] ?? 0),
  }))

/** The shoot schedule sent with the link; older links used other key names. */
const asShoots = (v: unknown): QuotationDocShoot[] =>
  list(v).map((s, i) => ({
    title: text(s['title'] ?? s['name']) ?? `Shoot ${i + 1}`,
    date: text(s['date'] ?? s['shoot_date']),
    time: text(s['time']),
    city: text(s['city'] ?? s['location']),
    services: list(s['services']).map((sv) => ({
      name: text(sv['name']) ?? 'Service',
      quantity: Number(sv['quantity'] ?? 1),
    })),
  }))

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

  // Received/balance: server-provided totals win; otherwise derive from the
  // snapshot so the page can never claim received == total - total (0).
  const total = quote?.snapshot.total ?? 0
  const received = Math.max(0, quote?.total_received ?? 0)
  const balance = Math.max(0, quote?.balance_due ?? total - received)
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

  const doc: QuotationDocumentData | null = quote
    ? {
        studio: {
          name: quote.company_name ?? 'Quotation',
          legalName: quote.company_legal_name,
          logoUrl: quote.logo_url,
          gstin: quote.gstin,
          phone: quote.company_phone,
          email: quote.company_email,
          website: quote.company_website,
          address: quote.company_address,
          footerNote: quote.document_footer_note,
        },
        brandColor: quote.brand_color,
        number: quote.quotation_number ?? 'Q',
        issuedAt: quote.issued_at,
        client: {
          name: quote.client_name,
          phone: quote.client_phone,
          email: quote.client_email,
          address: quote.client_address,
        },
        project: { name: quote.snapshot.project_name, status: quote.project_status, createdAt: quote.issued_at },
        deliverables: asRows(quote.deliverables),
        additional: asRows(quote.deliverables_2),
        shoots: asShoots(quote.shoots_schedule),
        summary: {
          packageCost: quote.snapshot.package_cost,
          additional: quote.snapshot.add_ons,
          total,
          received,
          balance,
        },
        terms: quote.terms_text ?? null,
        notes: quote.notes,
      }
    : null

  return (
    <div className="relative overflow-hidden">
      <CameraBackdrop />
      <div className="relative mx-auto flex min-h-screen max-w-3xl flex-col justify-center gap-4 p-4">
        {loadError ? (
          <Card>
            <CardContent className="p-4 text-center text-sm text-destructive">{loadError}</CardContent>
          </Card>
        ) : !quote || !doc ? (
          <Card>
            <CardContent className="flex flex-col gap-2 p-4">
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-1/2" />
            </CardContent>
          </Card>
        ) : (
          <>
          <QuotationDocument data={doc} prefs={resolveQuotationPrefs(quote.display_prefs)} />
          <Card className="no-print">
            <CardContent className="p-4 sm:p-6">
              <div className="flex flex-wrap gap-2">
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
          </>
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
