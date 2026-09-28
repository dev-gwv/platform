import { useEffect, useRef, useState } from 'react'
import { AlertTriangle, Facebook, Link2, Plug, Unplug } from 'lucide-react'
import type { FbPage } from '@ipc/contracts'
import { Button } from '@/shared/ui/button'
import { Card, CardContent } from '@/shared/ui/card'
import { IconTile } from '@/shared/ui/icon-tile'
import { Input, Label } from '@/shared/ui/input'
import { SkeletonCards } from '@/shared/ui/skeleton'
import { StatusBadge } from '@/shared/ui/status-badge'
import { useConfirm } from '@/shared/ui/confirm'
import { cn } from '@/shared/ui/cn'
import { useAccess } from '@/shared/auth/useAccess'
import {
  useConnectPage,
  useDisconnectPage,
  useExchangeMetaCode,
  useMetaConnectUrl,
  useMetaPages,
  useMetaStatus,
  useVerifyMetaToken,
} from './api'

const when = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })

/**
 * The studio's own Facebook pages, so its lead ads land in Leads (0204).
 *
 * Three moments, one screen each: not connected (one button), pages found
 * (pick the ones that run lead forms), connected (which pages, when the
 * last lead came). Facebook sends the browser back here with ?code=; the
 * server trades it for the pages and their tokens, which never come here.
 */
export function MetaConnectionCard() {
  const status = useMetaStatus()
  const connectUrl = useMetaConnectUrl()
  const pages = useMetaPages()
  const connect = useConnectPage()
  const disconnect = useDisconnectPage()
  const verify = useVerifyMetaToken()
  const exchange = useExchangeMetaCode()
  const confirm = useConfirm()
  const access = useAccess()
  const canEdit = access.hasAction('crm', 'edit')

  const [token, setToken] = useState('')
  const [showToken, setShowToken] = useState(false)
  const [exchanging, setExchanging] = useState(false)

  // Back from Facebook: trade the code once, and drop it from the address
  // so a refresh does not try again with a spent one.
  const spent = useRef(false)
  useEffect(() => {
    if (spent.current) return
    const url = new URL(window.location.href)
    const code = url.searchParams.get('code')
    const denied = url.searchParams.get('error')
    if (!code && !denied) return
    spent.current = true
    url.searchParams.delete('code')
    url.searchParams.delete('state')
    url.searchParams.delete('error')
    url.searchParams.delete('error_reason')
    url.searchParams.delete('error_description')
    window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`)
    if (!code) return
    setExchanging(true)
    // The promise, not mutate's callbacks: those are dropped when React
    // remounts the card (dev strict mode), and the spinner would never stop.
    void exchange
      .mutateAsync(code)
      .catch(() => undefined)
      .finally(() => setExchanging(false))
  }, [])

  const oauthReady = !!connectUrl.data?.connect_url
  const ready = status.data?.ready ?? true
  const list = pages.data ?? []
  const live = list.filter((p) => p.webhook_subscribed)
  const found = list.filter((p) => !p.webhook_subscribed && p.has_token)

  async function onDisconnect(p: FbPage) {
    const yes = await confirm({
      title: `Disconnect ${p.page_name}?`,
      description: 'New leads from this page stop arriving. Leads already in the list stay.',
      confirmLabel: 'Disconnect',
      destructive: true,
    })
    if (yes) disconnect.mutate(p.id)
  }

  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex flex-wrap items-center gap-3">
          <IconTile icon={Facebook} tone="blue" />
          <div className="min-w-0 flex-1">
            <h3 className="font-semibold tracking-tight">Facebook lead ads</h3>
            <p className="text-sm text-muted-foreground">
              {live.length > 0
                ? `Connected · ${live.length} page${live.length === 1 ? '' : 's'} · last lead ${status.data?.last_lead_at ? when.format(new Date(status.data.last_lead_at)) : 'not yet'}`
                : 'Leads from your lead forms land in Leads by themselves, assigned by your rota.'}
            </p>
          </div>
          {live.length > 0 && <StatusBadge tone="success">Connected</StatusBadge>}
        </div>

        {!ready && (
          <p className="mt-3 flex items-start gap-2 rounded-lg border border-warning/50 bg-warning/10 p-3 text-sm">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" />
            <span>Facebook connections are not set up on this server yet. Ask IPC Studios to finish the setup.</span>
          </p>
        )}
        {status.data?.last_error && (
          <p className="mt-3 flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            <span>{status.data.last_error}</span>
          </p>
        )}

        {pages.isLoading || exchanging ? (
          <div className="mt-4">
            <SkeletonCards count={1} />
            {exchanging && <p className="mt-2 text-sm text-muted-foreground">Talking to Facebook…</p>}
          </div>
        ) : (
          <>
            {live.length > 0 && (
              <ul className="mt-4 divide-y divide-border rounded-lg border border-border">
                {live.map((p) => (
                  <PageRow key={p.id} page={p}>
                    {canEdit && (
                      <Button size="sm" variant="outline" disabled={disconnect.isPending} onClick={() => void onDisconnect(p)}>
                        <Unplug /> Disconnect
                      </Button>
                    )}
                  </PageRow>
                ))}
              </ul>
            )}

            {found.length > 0 && canEdit && (
              <div className="mt-4">
                <p className="text-sm font-medium">Pick the pages that run lead forms</p>
                <ul className="mt-2 divide-y divide-border rounded-lg border border-primary/40 bg-primary/5">
                  {found.map((p) => (
                    <PageRow key={p.id} page={p}>
                      <Button size="sm" disabled={connect.isPending} onClick={() => connect.mutate({ page_id: p.page_id, page_name: p.page_name })}>
                        <Plug /> Connect
                      </Button>
                    </PageRow>
                  ))}
                </ul>
              </div>
            )}

            {canEdit && ready && (
              <div className="mt-4 flex flex-wrap items-center gap-2">
                {oauthReady && (
                  <Button asChild size="sm" variant={live.length > 0 || found.length > 0 ? 'outline' : 'default'}>
                    <a href={connectUrl.data!.connect_url!} rel="noreferrer">
                      <Facebook /> {live.length > 0 || found.length > 0 ? 'Add another page' : 'Connect with Facebook'}
                    </a>
                  </Button>
                )}
                <Button size="sm" variant={oauthReady ? 'ghost' : 'default'} onClick={() => setShowToken((v) => !v)}>
                  <Link2 /> {showToken ? 'Hide' : oauthReady ? 'Paste a token instead' : 'Paste a token'}
                </Button>
              </div>
            )}

            {showToken && canEdit && ready && (
              <div className="mt-3 rounded-lg border border-border p-3">
                <Label htmlFor="meta-token">Long-lived access token</Label>
                <Input
                  id="meta-token"
                  className={cn('mt-1', token.trim() ? 'border-success/50 bg-success/10' : 'border-warning/60 bg-warning/10')}
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  placeholder="Paste the token from Meta's Graph API Explorer"
                  autoComplete="off"
                />
                <p className="mt-1 text-xs text-muted-foreground">
                  Checked with Facebook. The pages it manages are kept, each with its own permission; the pasted token is not.
                </p>
                <div className="mt-2 flex justify-end">
                  <Button
                    size="sm"
                    disabled={token.trim().length < 10 || verify.isPending}
                    onClick={() =>
                      verify.mutateAsync(token.trim()).then(
                        () => {
                          setToken('')
                          setShowToken(false)
                        },
                        () => undefined,
                      )
                    }
                  >
                    {verify.isPending ? 'Checking…' : 'Find my pages'}
                  </Button>
                </div>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  )
}

function PageRow({ page: p, children }: { page: FbPage; children?: React.ReactNode }) {
  return (
    <li className="flex flex-wrap items-center gap-3 px-3 py-2.5 text-sm">
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium">{p.page_name}</p>
        <p className="text-xs text-muted-foreground">
          {p.category ?? 'Page'}
          {p.subscribed_at && ` · connected ${when.format(new Date(p.subscribed_at))}`}
        </p>
        {p.last_error && <p className="text-xs text-destructive">{p.last_error}</p>}
      </div>
      {children}
    </li>
  )
}
