import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, CheckCircle2, Loader2, Mail, Send } from 'lucide-react'
import { emailDelivery, emailHealth, emailTestResult, type EmailLogRow } from '@ipc/contracts'
import { PlatformPage } from '@/shared/layout/PlatformPage'
import { PageHeader } from '@/shared/layout/page-header'
import { Button } from '@/shared/ui/button'
import { Card, CardContent } from '@/shared/ui/card'
import { Input } from '@/shared/ui/input'
import { SkeletonList } from '@/shared/ui/skeleton'
import { ErrorState } from '@/shared/ui/states'
import { StatusBadge } from '@/shared/ui/status-badge'
import { cn } from '@/shared/ui/cn'
import { callApi } from '@/shared/api/client'
import { useAuth } from '@/shared/auth/AuthProvider'

const KIND: Record<string, string> = {
  verification: 'Sign-up link',
  password_reset: 'Password reset',
  invitation: 'Team invite',
  client_doc: 'To a client',
  terms_agreed: 'Terms agreed',
  team_terms: 'Team terms',
  onboarding: 'Onboarding',
  message: 'Message',
  sequence: 'Follow-up',
  test: 'Test',
}

export function PlatformEmailPage() {
  return (
    <PlatformPage>
      <EmailHealthPage />
    </PlatformPage>
  )
}

/**
 * Why did the email not arrive? Four answers in one place: is a key set, is
 * the sending domain verified, what the last emails did, and a test send.
 */
function EmailHealthPage() {
  const { session } = useAuth()
  const qc = useQueryClient()
  const health = useQuery({
    queryKey: ['platform', 'email'],
    queryFn: () => callApi('/platform/email', { responseSchema: emailHealth }),
    enabled: !!session,
  })
  const [to, setTo] = useState(session?.email ?? '')
  const test = useMutation({
    mutationFn: () => callApi('/platform/email/test', { method: 'POST', body: { to }, responseSchema: emailTestResult }),
    onSettled: () => void qc.invalidateQueries({ queryKey: ['platform', 'email'] }),
  })

  const h = health.data
  const verified = h?.domain?.status === 'verified'

  return (
    <>
      <PageHeader title="Email" />
      {health.isLoading ? (
        <SkeletonList rows={4} columns={3} />
      ) : health.isError || !h ? (
        <ErrorState onRetry={() => void health.refetch()} />
      ) : (
        <div className="flex flex-col gap-4">
          <div className="grid gap-3 md:grid-cols-3">
            <Check ok={h.key_set} label="Email key" value={h.key_set ? 'Set on the server' : 'Not set — nothing is sent'} />
            <Check
              ok={verified}
              warn={!h.domain && !!h.domain_note && h.key_set}
              label="Sending domain"
              value={h.domain ? `${h.domain.name} · ${h.domain.status}` : (h.from_domain ?? 'No sender address')}
              note={h.domain && !verified ? 'Resend only delivers once the domain is verified. Add its DNS records.' : h.domain_note}
            />
            <Check ok={!!h.app_url} label="Web address in links" value={h.app_url ?? 'APP_URL is not set'} />
          </div>

          <Card>
            <CardContent className="flex flex-col gap-3 p-4">
              <p className="text-sm font-semibold">Send a test</p>
              <form
                className="flex flex-wrap items-center gap-2"
                onSubmit={(e) => {
                  e.preventDefault()
                  test.mutate()
                }}
              >
                <Input type="email" value={to} onChange={(e) => setTo(e.target.value)} className="max-w-xs" aria-label="Send the test to" />
                <Button type="submit" disabled={!to || test.isPending}>
                  {test.isPending ? <Loader2 className="animate-spin" /> : <Send />} Send test email
                </Button>
              </form>
              {test.data && (
                <p className={cn('text-sm', test.data.status === 'sent' ? 'text-success' : 'text-destructive')}>
                  {test.data.status === 'sent'
                    ? `Resend took it. Check the inbox of ${to} (and spam) in a minute.`
                    : (test.data.error ?? 'Not sent.')}
                </p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-0">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
                <p className="text-sm font-semibold">Last emails</p>
                <p className="text-xs text-muted-foreground">
                  Last 7 days: {h.last_7_days.sent} sent · {h.last_7_days.failed} failed · {h.last_7_days.skipped} skipped
                </p>
              </div>
              {h.recent.length === 0 ? (
                <p className="px-4 py-6 text-center text-sm text-muted-foreground">Nothing sent yet since this log began.</p>
              ) : (
                <ul className="divide-y divide-border">
                  {h.recent.map((r) => (
                    <LogRow key={r.id} r={r} />
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </>
  )
}

function Check({ ok, warn = false, label, value, note }: { ok: boolean; warn?: boolean; label: string; value: string; note?: string | null }) {
  return (
    <Card className={cn(ok ? 'border-success/40' : warn ? 'border-warning/50' : 'border-destructive/40')}>
      <CardContent className="flex gap-3 p-4">
        {ok ? (
          <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-success" />
        ) : (
          <AlertTriangle className={cn('mt-0.5 size-5 shrink-0', warn ? 'text-warning' : 'text-destructive')} />
        )}
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground">{label}</p>
          <p className="break-words text-sm font-medium">{value}</p>
          {note && <p className="mt-1 text-xs text-muted-foreground">{note}</p>}
        </div>
      </CardContent>
    </Card>
  )
}

/** One email: who, what, when, and -- on demand -- what became of it. */
function LogRow({ r }: { r: EmailLogRow }) {
  const [asked, setAsked] = useState(false)
  const delivery = useQuery({
    queryKey: ['platform', 'email', r.id, 'delivery'],
    queryFn: () => callApi(`/platform/email/${r.id}/delivery`, { responseSchema: emailDelivery }),
    enabled: asked,
    staleTime: 60_000,
  })
  return (
    <li className="flex flex-wrap items-start gap-x-3 gap-y-1 px-4 py-2.5 text-sm">
      <Mail className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
      <div className="min-w-[14rem] flex-1">
        <p className="truncate">
          <span className="font-medium">{r.to_address}</span> <span className="text-muted-foreground">· {KIND[r.kind] ?? r.kind}</span>
        </p>
        <p className="truncate text-xs text-muted-foreground">
          {r.subject} · {new Date(r.created_at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}
        </p>
        {r.error && <p className="text-xs text-destructive">{r.error}</p>}
      </div>
      <StatusBadge tone={r.status === 'sent' ? 'success' : r.status === 'failed' ? 'danger' : 'warning'}>
        {r.status === 'sent' ? 'Taken by Resend' : r.status === 'failed' ? 'Refused' : 'Not sent (no key)'}
      </StatusBadge>
      {r.provider_message_id &&
        (asked ? (
          <span className="text-xs text-muted-foreground">
            {delivery.isLoading ? 'Checking…' : delivery.data?.last_event ? `Now: ${delivery.data.last_event}` : (delivery.data?.note ?? '')}
          </span>
        ) : (
          <button type="button" onClick={() => setAsked(true)} className="text-xs font-medium text-primary hover:underline">
            Did it arrive?
          </button>
        ))}
    </li>
  )
}
