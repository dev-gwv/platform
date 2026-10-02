import { useEffect, useState, type FormEvent } from 'react'
import { CheckCircle2, FileText, XCircle } from 'lucide-react'
import { okResponse, publicQuote, type PublicQuote } from '@ipc/contracts'
import { callApi, ApiError } from '@/shared/api/client'
import { PageBackdrop } from '@/shared/brand/PageBackdrop'
import { Button } from '@/shared/ui/button'
import { DownloadDocumentButton } from '@/shared/ui/download-document'
import { Card, CardContent } from '@/shared/ui/card'
import { Input, Label } from '@/shared/ui/input'
import { Skeleton } from '@/shared/ui/skeleton'
import { formatINR } from '@/shared/ui/format'
import { QuotePaper, type QuotePaperData } from '@/features/crm/QuotePaper'

/**
 * PUBLIC page — no auth. The client opens the link (?token=…), reads the
 * quote, and accepts or declines. No app shell; this is all they see.
 */
export function QuoteAcceptPage() {
  const token = new URLSearchParams(window.location.search).get('token') ?? ''
  const [quote, setQuote] = useState<PublicQuote | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [reason, setReason] = useState('')
  const [declining, setDeclining] = useState(false)
  const [done, setDone] = useState<'accepted' | 'declined' | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!token) {
      setLoadError('This link is missing its token.')
      return
    }
    callApi(`/public/quote/${token}`, { responseSchema: publicQuote })
      .then(setQuote)
      .catch((e) => setLoadError(e instanceof Error ? e.message : 'This link is invalid or expired.'))
  }, [token])

  async function onAccept(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setBusy(true)
    try {
      await callApi(`/public/quote/${token}/accept`, { method: 'POST', body: { name: name.trim(), email: email.trim() || undefined }, responseSchema: okResponse })
      setDone('accepted')
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'We could not record your acceptance.')
    } finally {
      setBusy(false)
    }
  }

  async function onDecline() {
    setError(null)
    setBusy(true)
    try {
      await callApi(`/public/quote/${token}/decline`, { method: 'POST', body: { reason: reason.trim() || undefined }, responseSchema: okResponse })
      setDone('declined')
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'We could not record your answer.')
    } finally {
      setBusy(false)
    }
  }

  const closed = quote ? quote.status !== 'sent' || quote.expired : false

  return (
    <div className="relative flex min-h-screen items-center justify-center bg-background p-4 font-sans">
      <PageBackdrop />
      <Card className="relative z-10 w-full max-w-3xl">
        <CardContent className="flex flex-col gap-4 p-4">
          <div className="flex items-center gap-3">
            <span className="flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <FileText className="size-5" />
            </span>
            <div className="min-w-0">
              <p className="text-xs uppercase tracking-wider text-muted-foreground">{quote?.studio ?? 'Quote'}</p>
              <h1 className="truncate text-lg font-semibold">{quote ? `${quote.quote_number}${quote.title ? ` · ${quote.title}` : ''}` : 'Your quote'}</h1>
            </div>
            {/*
              * A client agreeing to a price should be able to keep a copy of
              * it. Shown whatever the quote's state — the copy matters most
              * after they have accepted, not before.
              */}
            {quote && (
              <DownloadDocumentButton
                name={`${quote.quote_number}${quote.title ? ` ${quote.title}` : ''}`}
                className="no-print shrink-0"
              />
            )}
          </div>

          {loadError ? (
            <p className="text-sm text-destructive">{loadError}</p>
          ) : !quote ? (
            <Skeleton className="h-40" />
          ) : done === 'accepted' || quote.status === 'accepted' ? (
            <div className="flex flex-col items-center gap-2 py-4 text-center">
              <CheckCircle2 className="size-10 text-success" />
              <p className="font-medium">Thank you — this quote is accepted.</p>
              <p className="text-sm text-muted-foreground">{quote.studio} will be in touch to confirm the dates.</p>
              <div className="mt-2 w-full text-left">
                <QuotePaper data={paperOf(quote)} />
              </div>
            </div>
          ) : done === 'declined' || quote.status === 'declined' ? (
            <div className="flex flex-col items-center gap-2 py-4 text-center">
              <XCircle className="size-10 text-muted-foreground" />
              <p className="font-medium">This quote was declined.</p>
              <p className="text-sm text-muted-foreground">Thanks for letting {quote.studio} know.</p>
            </div>
          ) : (
            <>
              <QuotePaper data={paperOf(quote)} />
              {quote.place_of_supply && (
                <p className="text-xs text-muted-foreground">
                  Priced for {quote.place_of_supply}, so tax is charged as {quote.intra_state ? 'CGST and SGST' : 'IGST'}.
                </p>
              )}
              {closed ? (
                <p className="text-sm text-destructive">{quote.expired ? 'This quote has expired. Ask the studio for a fresh one.' : 'This quote is no longer open.'}</p>
              ) : declining ? (
                <div className="flex flex-col gap-2 rounded-lg border border-border p-3">
                  <Label htmlFor="q-reason">Tell us why (optional)</Label>
                  <Input id="q-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Budget, dates, went elsewhere…" />
                  <div className="flex justify-end gap-2">
                    <Button variant="ghost" onClick={() => setDeclining(false)} disabled={busy}>
                      Back
                    </Button>
                    <Button variant="outline" onClick={() => void onDecline()} disabled={busy}>
                      {busy ? 'Sending…' : 'Decline the quote'}
                    </Button>
                  </div>
                </div>
              ) : (
                <form onSubmit={onAccept} className="flex flex-col gap-3 rounded-lg border border-border p-3">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="flex flex-col gap-1">
                      <Label htmlFor="q-name">Your name</Label>
                      <Input id="q-name" value={name} onChange={(e) => setName(e.target.value)} required autoFocus />
                    </div>
                    <div className="flex flex-col gap-1">
                      <Label htmlFor="q-email">Email (optional)</Label>
                      <Input id="q-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
                    </div>
                  </div>
                  {error && <p className="text-sm text-destructive">{error}</p>}
                  <div className="flex flex-wrap justify-end gap-2">
                    <Button type="button" variant="ghost" onClick={() => setDeclining(true)} disabled={busy}>
                      Decline
                    </Button>
                    <Button type="submit" disabled={busy || !name.trim()}>
                      {busy ? 'Accepting…' : `Accept ${formatINR(quote.total)}`}
                    </Button>
                  </div>
                </form>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

/** The client's copy on the studio's letterhead; the studio's name alone if the letterhead could not be read. */
function paperOf(q: PublicQuote): QuotePaperData {
  const h = q.letterhead
  return {
    studio: {
      name: h?.name ?? q.studio,
      legalName: h?.legal_name,
      logoUrl: h?.logo_url,
      gstin: h?.gstin,
      phone: h?.phone,
      email: h?.email,
      website: h?.website,
      address: h?.address,
      footerNote: h?.footer_note,
    },
    brandColor: h?.brand_color,
    number: q.quote_number,
    title: q.title,
    preparedFor: q.client_name,
    issuedAt: h?.issued_at,
    validUntil: q.valid_until,
    items: q.items,
    subtotal: q.subtotal,
    discount: q.discount,
    tax: q.tax,
    total: q.total,
    intraState: q.intra_state,
    notes: q.notes,
    terms: q.terms,
  }
}
