import { useState } from 'react'
import { AlertTriangle, Facebook, Link2, Plug, RefreshCw, Unplug } from 'lucide-react'
import { Button } from '@/shared/ui/button'
import { Card, CardContent } from '@/shared/ui/card'
import { Input, Label } from '@/shared/ui/input'
import { SkeletonCards } from '@/shared/ui/skeleton'
import { StatusBadge } from '@/shared/ui/status-badge'
import { EmptyState } from '@/shared/ui/states'
import { useConfirm } from '@/shared/ui/confirm'
import { useAccess } from '@/shared/auth/useAccess'
import {
  useConnectPage,
  useDisconnectPage,
  useMetaConnectUrl,
  useMetaPages,
  useMetaStatus,
  useVerifyMetaToken,
} from './api'

const dayFormat = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
const when = (iso: string | null) => (iso ? dayFormat.format(new Date(iso)) : 'never')

/**
 * Connect Meta pages so lead ads land in the CRM.
 *
 * Two routes in, because a studio may not control the Meta app: the OAuth
 * dialog when META_APP_ID and APP_URL are configured, and a pasted long-lived
 * token otherwise. Either way the token is verified server-side and never
 * stored — what persists is the list of pages it could see.
 */
export function MetaConnectionCard() {
  const status = useMetaStatus()
  const connectUrl = useMetaConnectUrl()
  const pages = useMetaPages()
  const connect = useConnectPage()
  const disconnect = useDisconnectPage()
  const verify = useVerifyMetaToken()
  const confirm = useConfirm()
  const access = useAccess()
  const canEdit = access.hasAction('crm', 'edit')

  const [token, setToken] = useState('')
  const [showToken, setShowToken] = useState(false)

  const missing = connectUrl.data?.missing_config ?? []
  const oauthReady = !!connectUrl.data?.connect_url

  async function onDisconnect(id: string, name: string) {
    const yes = await confirm({
      title: `Disconnect ${name}?`,
      description: 'New lead ads from this page stop arriving. Leads already imported are untouched.',
      confirmLabel: 'Disconnect',
      destructive: true,
    })
    if (yes) disconnect.mutate(id)
  }

  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex flex-wrap items-start gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Facebook className="size-5" />
          </span>
          <div className="min-w-0 flex-1">
            <h3 className="font-semibold tracking-tight">Meta lead ads</h3>
            <p className="mt-0.5 text-sm text-muted-foreground">
              Connect the Facebook or Instagram pages that run lead forms.
            </p>
          </div>
          {status.data && (
            <StatusBadge tone={status.data.connected ? 'success' : 'neutral'}>
              {status.data.connected ? 'Connected' : 'Not connected'}
            </StatusBadge>
          )}
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              void status.refetch()
              void pages.refetch()
            }}
            disabled={status.isFetching || pages.isFetching}
            title="Refresh"
          >
            <RefreshCw />
          </Button>
        </div>

        {status.data && status.data.page_count > 0 && (
          <p className="mt-3 text-sm text-muted-foreground">
            {status.data.connected_page_count} of {status.data.page_count} page
            {status.data.page_count === 1 ? '' : 's'} connected · {status.data.webhook_subscribed_count} subscribed to
            the webhook · last synced {when(status.data.last_synced_at)}
          </p>
        )}

        {status.data?.last_error && (
          <p className="mt-3 flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            <span>{status.data.last_error}</span>
          </p>
        )}

        {missing.length > 0 && (
          <p className="mt-3 rounded-lg border border-border bg-muted/40 p-3 text-sm text-muted-foreground">
            Meta is only part-configured — {missing.join(', ')} {missing.length === 1 ? 'is' : 'are'} not set on the
            server. You can still paste a token below; the OAuth button needs the config.
          </p>
        )}

        {canEdit && (
          <div className="mt-4 flex flex-wrap gap-2">
            {oauthReady ? (
              <Button asChild size="sm">
                <a href={connectUrl.data!.connect_url!} rel="noreferrer">
                  <Plug /> Connect with Facebook
                </a>
              </Button>
            ) : null}
            <Button size="sm" variant="outline" onClick={() => setShowToken((v) => !v)}>
              <Link2 /> {showToken ? 'Hide token box' : 'Paste a token instead'}
            </Button>
          </div>
        )}

        {showToken && canEdit && (
          <div className="mt-3 rounded-lg border border-border p-3">
            <Label htmlFor="meta-token">Long-lived access token</Label>
            <Input
              id="meta-token"
              className="mt-1"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="EAAG…"
              autoComplete="off"
            />
            <p className="mt-1 text-xs text-muted-foreground">
              Verified against Meta, then discarded. Only the pages it can see are saved.
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
                {verify.isPending ? 'Checking…' : 'Verify and import pages'}
              </Button>
            </div>
          </div>
        )}

        <div className="mt-4">
          <h4 className="text-sm font-medium">Pages</h4>
          {pages.isLoading ? (
            <div className="mt-2">
              <SkeletonCards count={2} />
            </div>
          ) : !pages.data || pages.data.length === 0 ? (
            <div className="mt-2 rounded-lg border border-dashed border-border py-4">
              <EmptyState
                title="No pages yet"
                description="Connect with Facebook or paste a token, and the pages you manage appear here."
              />
            </div>
          ) : (
            <ul className="mt-2 divide-y divide-border">
              {pages.data.map((p) => (
                <li key={p.id} className="flex flex-wrap items-center gap-3 py-2.5 text-sm">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{p.page_name}</p>
                    <p className="text-xs text-muted-foreground">
                      {p.category ?? 'Page'} · synced {when(p.last_synced_at)}
                    </p>
                    {p.last_error && <p className="text-xs text-destructive">{p.last_error}</p>}
                  </div>
                  <StatusBadge tone={p.is_connected ? 'success' : 'neutral'}>
                    {p.is_connected ? 'Connected' : 'Available'}
                  </StatusBadge>
                  {p.webhook_subscribed && <StatusBadge tone="info">Webhook on</StatusBadge>}
                  {canEdit &&
                    (p.is_connected ? (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={disconnect.isPending}
                        onClick={() => void onDisconnect(p.id, p.page_name)}
                      >
                        <Unplug /> Disconnect
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        disabled={connect.isPending}
                        onClick={() => connect.mutate({ page_id: p.page_id, page_name: p.page_name })}
                      >
                        <Plug /> Connect
                      </Button>
                    ))}
                </li>
              ))}
            </ul>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
