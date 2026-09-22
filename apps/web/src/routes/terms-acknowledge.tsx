import { useEffect, useState, type FormEvent } from 'react'
import { z, buildMailtoUrl, buildWhatsAppUrl } from '@ipc/contracts'
import { CheckCircle2, Printer, MessageCircle, Mail, Copy } from 'lucide-react'
import { toast } from 'sonner'
import { callApi, ApiError } from '@/shared/api/client'
import { CameraBackdrop } from '@/shared/brand/CameraBackdrop'
import { Button } from '@/shared/ui/button'
import { DownloadDocumentButton } from '@/shared/ui/download-document'
import { Card, CardContent } from '@/shared/ui/card'
import { Input, Label } from '@/shared/ui/input'
import { Skeleton } from '@/shared/ui/skeleton'
// Shared with the in-app viewer: the studio and the client must read the
// same document, so the shape and the rendering live in one place.
import { termsPayload, type TermsPayload } from '@/features/terms/document'
import { TermsDocumentLetterhead, TermsDocumentSheet } from '@/features/terms/TermsDocumentSheet'
import { StatusBadge } from '@/shared/ui/status-badge'

const termsBody = z.object({ body: z.string() })


/**
 * PUBLIC page — no auth. A client opens the emailed link (?token=…), reads the
 * terms, and taps "I agree". No app shell; this is the only thing they see.
 *
 * Lovable parity: rich payload header (title/project/client/company/payment),
 * sections list, Print + acked view, email/WhatsApp share, expiry/revoke
 * states. Server logs email sends to project_terms_email_logs and notifies
 * the studio on ack (best-effort).
 */
export function TermsAcknowledgePage() {
  const token = new URLSearchParams(window.location.search).get('token') ?? ''
  const [doc, setDoc] = useState<TermsPayload | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [done, setDone] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!token) {
      setLoadError('This link is missing its token.')
      return
    }
    // Rich payload first; fall back to the legacy body-only reader.
    callApi(`/public/terms/${token}/payload`, { responseSchema: termsPayload })
      .then((r) => {
        if (r.revoked) {
          setLoadError('This link has been revoked. Please ask the studio for a fresh one.')
          return
        }
        if (r.expires_at && new Date(r.expires_at).getTime() < Date.now()) {
          setLoadError('This link has expired. Please ask the studio for a fresh one.')
          return
        }
        if (r.acknowledged_at || r.already_acknowledged) {
          setDoc(r)
          setName(r.acknowledged_by_name ?? '')
          setDone(true)
          return
        }
        setDoc(r)
      })
      .catch(() =>
        callApi(`/public/terms/${token}`, { responseSchema: termsBody })
          .then((r) => setDoc({
            title: 'Terms & agreement', body: r.body, project_name: null, client_name: null,
            client_phone: null, company_name: null, logo_url: null, company_phone: null,
            company_email: null, company_address: null, payment_summary: null, sections: [],
            expires_at: null, revoked: false, acknowledged_at: null, acknowledged_by_name: null, access_count: 0,
            payment_terms: null, total_cost: null, legal_note: null, document_footer_note: null, already_acknowledged: null,
          }))
          .catch((e) => setLoadError(e instanceof Error ? e.message : 'This link is invalid or expired.')),
      )
  }, [token])

  async function onAgree(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setBusy(true)
    try {
      await callApi(`/public/terms/${token}/ack`, {
        method: 'POST',
        body: { name: name.trim(), email: email.trim() || undefined },
        responseSchema: z.object({ ok: z.boolean() }),
      })
      setDone(true)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not record your agreement.')
    } finally {
      setBusy(false)
    }
  }

  const url = typeof window !== 'undefined' ? window.location.href : ''
  const shareText = doc ? `${doc.title ?? 'Terms & agreement'}${doc.project_name ? ` for ${doc.project_name}` : ''}: ${url}` : url

  async function copy() {
    try {
      await navigator.clipboard.writeText(url)
      toast.success('Link copied.')
    } catch {
      toast.error('Could not copy the link.')
    }
  }

  return (
    <div className="relative overflow-hidden">
      <CameraBackdrop />
      <div className="paper relative mx-auto flex min-h-screen max-w-lg flex-col justify-center gap-4 p-4">
      {doc && <TermsDocumentLetterhead doc={doc} trailing={done ? <StatusBadge tone="success">Agreed</StatusBadge> : null} />}

      {loadError ? (
        <Card>
          <CardContent className="p-4 text-center text-sm text-muted-foreground">{loadError}</CardContent>
        </Card>
      ) : done ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 p-8 text-center">
            <CheckCircle2 className="size-10 text-success" />
            <p className="font-medium">Thank you, {name}</p>
            <p className="text-sm text-muted-foreground">Your agreement has been recorded.{doc?.already_acknowledged ? ' (Already acknowledged — showing the existing receipt.)' : ''}</p>
            <Button variant="outline" size="sm" onClick={() => window.print()}>
              <Printer className="mr-1 size-4" /> Print receipt
            </Button>
          </CardContent>
        </Card>
      ) : doc === null ? (
        <div className="flex flex-col gap-2 rounded-lg border border-border bg-card p-4" role="status" aria-label="Loading your terms">
          {Array.from({ length: 8 }, (_, i) => (
            <Skeleton key={i} className={i % 3 === 2 ? 'h-3 w-3/4' : 'h-3 w-full'} />
          ))}
        </div>
      ) : (
        <>
          <TermsDocumentSheet doc={doc} />
          <div className="flex flex-wrap gap-2">
            <DownloadDocumentButton
              name={`${doc.document_number ?? 'Terms'}${doc.project_name ? ` ${doc.project_name}` : ''}`}
            />
            <Button variant="outline" size="sm" onClick={() => window.print()}>
              <Printer className="mr-1 size-4" /> Print
            </Button>
            <Button variant="outline" size="sm" asChild>
              <a href={buildWhatsAppUrl(doc.client_phone, shareText)} target="_blank" rel="noreferrer noopener">
                <MessageCircle className="mr-1 size-4" /> WhatsApp
              </a>
            </Button>
            <Button variant="outline" size="sm" asChild>
              <a href={buildMailtoUrl(null, doc.title ?? 'Terms & agreement', shareText)}>
                <Mail className="mr-1 size-4" /> Email
              </a>
            </Button>
            <Button variant="outline" size="sm" onClick={() => void copy()}>
              <Copy className="mr-1 size-4" /> Copy
            </Button>
          </div>
          <Card className="no-print">
            <CardContent className="p-4">
              <form onSubmit={onAgree} className="flex flex-col gap-3">
                <div className="flex flex-col gap-1.5">
                  <Label>Your full name</Label>
                  <Input value={name} onChange={(e) => setName(e.target.value)} required />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label>Email (optional)</Label>
                  <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
                </div>
                {error && <p className="text-sm text-destructive">{error}</p>}
                <Button type="submit" disabled={busy || !name.trim()}>
                  {busy ? 'Recording…' : 'I agree'}
                </Button>
                <p className="text-center text-xs text-muted-foreground">
                  Your name, time and IP address are recorded as evidence of agreement.
                </p>
              </form>
            </CardContent>
          </Card>
        </>
      )}
      </div>
    </div>
  )
}
