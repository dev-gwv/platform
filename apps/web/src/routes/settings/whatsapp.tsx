import { useState, type FormEvent } from 'react'
import { Link } from '@tanstack/react-router'
import { CheckCircle2, Copy, Lock, MessageCircle, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import type { WhatsappStatus } from '@ipc/contracts'
import { AuthedPage } from '@/shared/layout/AuthedPage'
import { PageHeader } from '@/shared/layout/page-header'
import { useAuth } from '@/shared/auth/AuthProvider'
import { Button } from '@/shared/ui/button'
import { Card, CardContent } from '@/shared/ui/card'
import { Input, Label } from '@/shared/ui/input'
import { SkeletonCards } from '@/shared/ui/skeleton'
import { ErrorState } from '@/shared/ui/states'
import { useConfirm } from '@/shared/ui/confirm'
import {
  useConnectWhatsapp,
  useDisconnectWhatsapp,
  useEmbeddedWhatsapp,
  useSyncTemplates,
  useWhatsapp,
  useWhatsappTemplates,
} from '@/features/studio-whatsapp/api'
import { facebookSignup } from '@/features/studio-whatsapp/facebook-signup'

export function WhatsappSettingsPage() {
  return (
    <AuthedPage module="settings">
      <PageHeader title="WhatsApp" />
      <Whatsapp />
    </AuthedPage>
  )
}

const MANAGERS = new Set(['super_admin', 'admin'])
const when = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })

/**
 * Connect the studio's WhatsApp Business number, so follow-ups go out from
 * the studio's own name and number, and clients' replies land on the lead.
 */
function Whatsapp() {
  const q = useWhatsapp()
  const { session } = useAuth()
  const canManage = MANAGERS.has(session?.role ?? '')
  if (q.isPending) return <SkeletonCards count={1} />
  if (q.isError) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />
  const s = q.data

  return (
    <div className="flex max-w-3xl flex-col gap-4">
      <div>
        <h2 className="flex items-center gap-2 text-lg font-semibold tracking-tight">
          <MessageCircle className="size-5 text-emerald-600" /> Your WhatsApp number
        </h2>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Follow-ups go out from your studio's own number and name, by themselves. Clients' replies land on the lead, and a new number becomes a new
          enquiry.{' '}
          <Link to="/help/whatsapp" className="font-medium text-primary hover:underline">
            How to connect your number
          </Link>
        </p>
      </div>
      {!s.entitled ? (
        <Card>
          <CardContent className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
            <Lock className="size-4 shrink-0" /> Your own WhatsApp number comes with the higher plan. Until then, WhatsApp follow-ups wait in{' '}
            <Link to="/follow-ups/send" className="font-medium text-primary hover:underline">
              Send now
            </Link>{' '}
            for one tap from your phone.
          </CardContent>
        </Card>
      ) : s.connection ? (
        <Connected s={s} canManage={canManage} />
      ) : !s.ready ? (
        <Card>
          <CardContent className="p-4 text-sm text-muted-foreground">
            WhatsApp connections are not switched on for this server yet. Please ask Studio AutoPilot support.
          </CardContent>
        </Card>
      ) : canManage ? (
        <Connect embedded={s.embedded} />
      ) : (
        <Card>
          <CardContent className="p-4 text-sm text-muted-foreground">Ask the studio owner or an admin to connect WhatsApp.</CardContent>
        </Card>
      )}
    </div>
  )
}

function Connect({ embedded }: { embedded: WhatsappStatus['embedded'] }) {
  const connect = useConnectWhatsapp()
  const viaFacebook = useEmbeddedWhatsapp()
  const [manual, setManual] = useState(!embedded)
  const [f, setF] = useState({ phone_number_id: '', waba_id: '', access_token: '', app_secret: '' })
  const [busy, setBusy] = useState(false)

  async function onFacebook() {
    if (!embedded) return
    setBusy(true)
    try {
      viaFacebook.mutate(await facebookSignup(embedded.app_id, embedded.config_id))
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    connect.mutate({ ...f, app_secret: f.app_secret.trim() || null })
  }

  return (
    <Card>
      <CardContent className="flex flex-col gap-4 p-4">
        {embedded && (
          <div className="flex flex-col items-start gap-2">
            <Button onClick={() => void onFacebook()} disabled={busy || viaFacebook.isPending}>
              <MessageCircle /> {viaFacebook.isPending ? 'Connecting…' : 'Connect with Facebook'}
            </Button>
            <p className="text-xs text-muted-foreground">Log in with the Facebook account that owns your business, then pick your WhatsApp number.</p>
            {!manual && (
              <button type="button" onClick={() => setManual(true)} className="text-xs text-muted-foreground underline">
                I have my number's details instead
              </button>
            )}
          </div>
        )}
        {manual && (
          <form onSubmit={onSubmit} className="grid gap-3 sm:grid-cols-2">
            <p className="text-sm text-muted-foreground sm:col-span-2">
              From Meta's WhatsApp Manager (API Setup): your number's <b>Phone number ID</b>, the <b>WhatsApp Business Account ID</b>, and a{' '}
              <b>permanent token</b> from a system user.
            </p>
            <div>
              <Label htmlFor="wa-phone">Phone number ID</Label>
              <Input id="wa-phone" inputMode="numeric" value={f.phone_number_id} onChange={(e) => setF({ ...f, phone_number_id: e.target.value })} />
            </div>
            <div>
              <Label htmlFor="wa-waba">WhatsApp Business Account ID</Label>
              <Input id="wa-waba" inputMode="numeric" value={f.waba_id} onChange={(e) => setF({ ...f, waba_id: e.target.value })} />
            </div>
            <div className="sm:col-span-2">
              <Label htmlFor="wa-token">Permanent access token</Label>
              <Input id="wa-token" type="password" autoComplete="off" value={f.access_token} onChange={(e) => setF({ ...f, access_token: e.target.value })} />
            </div>
            <div className="sm:col-span-2">
              <Label htmlFor="wa-secret">App secret (optional, checks that messages really come from Meta)</Label>
              <Input id="wa-secret" type="password" autoComplete="off" value={f.app_secret} onChange={(e) => setF({ ...f, app_secret: e.target.value })} />
            </div>
            <div className="sm:col-span-2">
              <Button type="submit" disabled={connect.isPending}>
                {connect.isPending ? 'Checking with WhatsApp…' : 'Connect'}
              </Button>
            </div>
          </form>
        )}
      </CardContent>
    </Card>
  )
}

function Connected({ s, canManage }: { s: WhatsappStatus; canManage: boolean }) {
  const c = s.connection!
  const sync = useSyncTemplates()
  const disconnect = useDisconnectWhatsapp()
  const templates = useWhatsappTemplates()
  const confirm = useConfirm()
  const approved = (templates.data?.items ?? []).filter((t) => t.status === 'APPROVED')

  const copy = (text: string) => void navigator.clipboard?.writeText(text).then(() => toast.success('Copied'))

  return (
    <>
      <Card>
        <CardContent className="flex flex-wrap items-start gap-3 p-4">
          <CheckCircle2 className={c.status === 'connected' ? 'size-6 text-emerald-600' : 'size-6 text-destructive'} />
          <div className="min-w-0 flex-1">
            <p className="font-medium">{c.verified_name ?? 'Your WhatsApp number'}</p>
            <p className="text-sm text-muted-foreground">
              {c.display_phone ?? c.phone_number_id} · {c.status === 'connected' ? 'Connected' : 'Needs attention'} since {when.format(new Date(c.connected_at))}
            </p>
            {c.last_error && <p className="mt-1 text-sm text-destructive">{c.last_error}</p>}
          </div>
          {canManage && (
            <Button
              variant="ghost"
              className="text-destructive"
              disabled={disconnect.isPending}
              onClick={() =>
                void confirm({
                  title: 'Disconnect WhatsApp?',
                  description: 'Follow-ups will wait in Send now again, and replies will stop coming in.',
                  confirmLabel: 'Disconnect',
                  destructive: true,
                }).then((yes) => yes && disconnect.mutate())
              }
            >
              Disconnect
            </Button>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="font-semibold tracking-tight">Approved templates</h3>
              <p className="mt-0.5 text-sm text-muted-foreground">
                WhatsApp lets a business write first only with an approved template. Pick one on a sequence step and it sends by itself.
              </p>
            </div>
            {canManage && (
              <Button variant="outline" disabled={sync.isPending} onClick={() => sync.mutate()}>
                <RefreshCw className={sync.isPending ? 'animate-spin' : ''} /> Sync from WhatsApp
              </Button>
            )}
          </div>
          {approved.length === 0 ? (
            <p className="mt-3 text-sm text-muted-foreground">
              None yet. Create templates in Meta's WhatsApp Manager; once approved, sync them here.
            </p>
          ) : (
            <ul className="mt-3 divide-y divide-border rounded-md border border-border">
              {approved.map((t) => (
                <li key={`${t.name}:${t.language}`} className="px-3 py-2 text-sm">
                  <span className="font-medium">{t.name}</span>
                  <span className="ml-2 text-xs text-muted-foreground">
                    {t.language} · {t.category?.toLowerCase()}
                  </span>
                  {t.body && <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{t.body}</p>}
                </li>
              ))}
            </ul>
          )}
          {c.templates_synced_at && <p className="mt-2 text-xs text-muted-foreground">Last synced {when.format(new Date(c.templates_synced_at))}</p>}
        </CardContent>
      </Card>

      {c.via === 'manual' && (
        <Card>
          <CardContent className="p-4 text-sm">
            <h3 className="font-semibold tracking-tight">So that replies come in</h3>
            <p className="mt-0.5 text-muted-foreground">
              In your Meta app, under WhatsApp → Configuration, set the webhook to these two, and subscribe to <b>messages</b>.
            </p>
            {[
              ['Callback URL', c.webhook_url],
              ['Verify token', c.verify_token],
            ].map(([label, value]) => (
              <div key={label} className="mt-2 flex items-center gap-2">
                <span className="w-28 shrink-0 text-muted-foreground">{label}</span>
                <code className="min-w-0 flex-1 truncate rounded bg-muted px-2 py-1 text-xs">{value}</code>
                <Button size="icon" variant="ghost" aria-label={`Copy ${label}`} onClick={() => copy(value!)}>
                  <Copy />
                </Button>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </>
  )
}
