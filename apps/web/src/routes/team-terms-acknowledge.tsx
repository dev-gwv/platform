import { useEffect, useState, type FormEvent } from 'react'
import { z, publicTeamTerms, type PublicTeamTerms } from '@ipc/contracts'
import { CalendarDays, CheckCircle2, Printer, ShieldCheck } from 'lucide-react'
import { callApi, ApiError } from '@/shared/api/client'
import { CameraBackdrop } from '@/shared/brand/CameraBackdrop'
import { Button } from '@/shared/ui/button'
import { DownloadDocumentButton } from '@/shared/ui/download-document'
import { Card, CardContent } from '@/shared/ui/card'
import { Input, Label } from '@/shared/ui/input'
import { Skeleton } from '@/shared/ui/skeleton'
import { StatusBadge } from '@/shared/ui/status-badge'

const okResponse = z.object({ ok: z.boolean() })

/**
 * PUBLIC page — no auth, no app shell.
 *
 * A photographer opens this from a WhatsApp message on a phone, between jobs.
 * It shows the studio's name first (they know the studio, not us), the shoot
 * it is about, the terms in full, and — only when the terms ask for it — a
 * name field and one button.
 */
export function TeamTermsAcknowledgePage() {
  const token = new URLSearchParams(window.location.search).get('token') ?? ''
  const [terms, setTerms] = useState<PublicTeamTerms | null>(null)
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
    callApi(`/public/team-terms/${token}`, { responseSchema: publicTeamTerms })
      .then((r) => {
        setTerms(r)
        setName(r.acknowledged_by_name ?? r.recipient_name)
      })
      .catch((e) =>
        setLoadError(
          e instanceof Error ? e.message : 'This link is invalid, expired or has been withdrawn.',
        ),
      )
  }, [token])

  async function onAgree(e: FormEvent) {
    e.preventDefault()
    setError(null)
    if (email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setError('Email format is invalid.')
      return
    }
    setBusy(true)
    try {
      await callApi(`/public/team-terms/${token}/ack`, {
        method: 'POST',
        body: { name: name.trim(), ...(email.trim() ? { email: email.trim() } : {}) },
        responseSchema: okResponse,
      })
      setDone(true)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not record your agreement.')
    } finally {
      setBusy(false)
    }
  }

  const signed = done || terms?.status === 'acknowledged'
  const mustSign = terms?.mode === 'acknowledgement_required'

  return (
    <div className="relative overflow-hidden">
      <CameraBackdrop />
      <div className="paper relative mx-auto flex min-h-screen max-w-2xl flex-col justify-center gap-4 p-4">
        <div className="flex items-center gap-2">
          {terms?.logo_url ? (
            <img src={terms.logo_url} alt={terms.company_name ?? 'Studio logo'} className="size-9 rounded-lg border border-border bg-card object-contain" />
          ) : (
            <span className="flex size-9 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <ShieldCheck className="size-5" />
            </span>
          )}
          <div className="min-w-0 flex-1">
            <p className="font-semibold leading-tight">{terms?.company_name ?? 'Team terms'}</p>
            {terms?.shoot_name && (
              <p className="flex items-center gap-1 text-sm text-muted-foreground">
                <CalendarDays className="size-3.5" aria-hidden />
                {terms.shoot_name}
                {terms.shoot_date ? ` · ${terms.shoot_date}` : ''}
              </p>
            )}
            {terms?.project_name && (
              <p className="text-xs text-muted-foreground">Project: {terms.project_name}</p>
            )}
          </div>
          {terms && <StatusPill status={terms.status} requireAck={mustSign} />}
        </div>

        <Card>
          <CardContent className="p-4 sm:p-4">
            {loadError ? (
              <p className="text-sm text-destructive">{loadError}</p>
            ) : !terms ? (
              <div className="flex flex-col gap-2">
                <Skeleton className="h-4 w-2/3" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-5/6" />
              </div>
            ) : (
              <>
                <p className="text-sm text-muted-foreground">
                  For {terms.recipient_name}
                  {terms.role_name ? ` · ${terms.role_name}` : ''}
                </p>
                <pre className="mt-3 max-h-[50vh] overflow-y-auto whitespace-pre-wrap rounded-lg border border-border bg-muted/30 p-3 text-sm">
                  {terms.rendered_body}
                </pre>

                {signed ? (
                  <div>
                    <p className="mt-4 flex items-center gap-2 rounded-lg bg-success/10 p-3 text-sm font-medium text-success">
                      <CheckCircle2 className="size-4 shrink-0" />
                      Agreed by {name || terms.acknowledged_by_name} — nothing else to do.
                    </p>
                    <Button variant="outline" size="sm" className="no-print mt-2" onClick={() => window.print()}>
                      <Printer className="mr-1 size-4" /> Print
                    </Button>
                  </div>
                ) : mustSign ? (
                  <form onSubmit={onAgree} className="mt-4 flex flex-col gap-3">
                    <div className="flex flex-col gap-1.5">
                      <Label>Your full name</Label>
                      <Input
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        placeholder="Rahul Sharma"
                      />
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <Label>Email (optional)</Label>
                      <Input
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="rahul@example.com"
                        inputMode="email"
                      />
                      <p className="text-xs text-muted-foreground">
                        Typing your name here is your agreement to the terms above. The time and
                        your device are recorded with it.
                      </p>
                    </div>
                    {error && <p className="text-sm text-destructive">{error}</p>}
                    <div className="flex flex-wrap gap-2">
                      <Button type="submit" disabled={busy || name.trim().length < 1}>
                        {busy ? 'Recording…' : 'I agree'}
                      </Button>
                      <DownloadDocumentButton
                        name={`Team terms ${terms.recipient_name}${terms.shoot_name ? ` ${terms.shoot_name}` : ''}`}
                        size="default"
                      />
                      <Button type="button" variant="outline" onClick={() => window.print()}>
                        <Printer className="mr-1 size-4" /> Print
                      </Button>
                    </div>
                  </form>
                ) : (
                  // A briefing has nothing to sign; saying so beats leaving
                  // someone hunting for a button that was never there.
                  <p className="mt-4 rounded-lg border border-border p-3 text-sm text-muted-foreground">
                    This is for your information — there is nothing to sign.
                  </p>
                )}
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

function StatusPill({ status, requireAck }: { status: string; requireAck: boolean }) {
  const tone = status === 'acknowledged' ? 'success' : status === 'expired' || status === 'revoked' ? 'danger' : status === 'sent' || status === 'viewed' ? 'info' : 'neutral'
  const label =
    status === 'acknowledged' ? 'Acknowledged'
    : status === 'sent' || status === 'viewed' ? (requireAck ? 'Pending acknowledgement' : 'Shared for reference')
    : status === 'draft' ? 'Draft'
    : status === 'expired' ? 'Expired'
    : status === 'revoked' ? 'Revoked'
    : status
  return <StatusBadge tone={tone as 'success' | 'danger' | 'info' | 'neutral'}>{label}</StatusBadge>
}
