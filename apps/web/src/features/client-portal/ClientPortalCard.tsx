import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { Copy, ExternalLink, Eye, Globe, Link2Off, MessageCircle, RefreshCw, ThumbsUp, PencilLine } from 'lucide-react'
import { toast } from 'sonner'
import { buildWhatsAppUrl, type ClientPortalLinkInfo } from '@ipc/contracts'
import { Button } from '@/shared/ui/button'
import { Card, CardContent } from '@/shared/ui/card'
import { Input, Select } from '@/shared/ui/input'
import { StatusBadge } from '@/shared/ui/status-badge'
import { Switch } from '@/shared/ui/switch'
import { Skeleton } from '@/shared/ui/skeleton'
import { useConfirm } from '@/shared/ui/confirm'
import { useAccess } from '@/shared/auth/useAccess'
import {
  useClientPortal,
  useCreateClientPortalLink,
  useRevokeClientPortalLink,
  useUpdateClientPortalLink,
} from './api'
import { absolutePortalUrl, openedAgo } from './format'

/**
 * "Client portal" -- one private page per project for the couple: shoots,
 * deliverables and their links, what is paid and what is left, the terms.
 *
 * The server keeps the live link (0252), so anyone who can see the project can
 * copy it again -- "New link" is only for when the old one should stop. A link
 * made before 0252 is remembered only by the browser that made it.
 */
const remembered = (linkId: string) => `ipc-portal-link:${linkId}`

function recall(linkId: string): string | null {
  try {
    return localStorage.getItem(remembered(linkId))
  } catch {
    return null
  }
}
function remember(linkId: string, url: string) {
  try {
    localStorage.setItem(remembered(linkId), url)
  } catch {
    /* private window: the link is still on screen for now */
  }
}

const EXPIRY_OPTIONS = [
  { value: '', label: 'Never expires' },
  { value: '30', label: 'Expires in 30 days' },
  { value: '90', label: 'Expires in 90 days' },
  { value: '365', label: 'Expires in a year' },
]

const shortDate = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' })

export function ClientPortalCard({
  projectId,
  projectName,
  clientName,
  clientPhone,
}: {
  projectId: string
  projectName: string
  clientName: string | null
  clientPhone: string | null
}) {
  const access = useAccess()
  const canEdit = access.hasAction('projects', 'edit')
  const { data, isLoading } = useClientPortal(projectId)
  const create = useCreateClientPortalLink(projectId)
  const update = useUpdateClientPortalLink(projectId)
  const revoke = useRevokeClientPortalLink(projectId)
  const confirm = useConfirm()
  const [fresh, setFresh] = useState<{ id: string; url: string } | null>(null)
  // Payments show by default; the switch appears once the link exists.
  const showPayments = true

  const link = data?.link ?? null
  // The server keeps the live link since 0252; older links only this browser remembers.
  const kept = data?.url ? absolutePortalUrl(data.url, window.location.origin) : null
  const url = link ? (fresh?.id === link.id ? fresh.url : (kept ?? recall(link.id))) : null

  async function makeLink(replacing: boolean) {
    if (replacing) {
      const yes = await confirm({
        title: 'Make a new client link?',
        description: 'The link you shared before stops working. Send the new one to the client.',
        confirmLabel: 'Make new link',
      })
      if (!yes) return
    }
    const issued = await create.mutateAsync({
      show_payments: link?.show_payments ?? showPayments,
      show_team: link?.show_team ?? false,
      allow_feedback: link?.allow_feedback ?? true,
    })
    const full = absolutePortalUrl(issued.url, window.location.origin)
    remember(issued.link.id, full)
    setFresh({ id: issued.link.id, url: full })
    toast.success('Client link ready. Copy it or send it on WhatsApp.')
  }

  async function onRevoke() {
    const yes = await confirm({
      title: 'Stop this client link?',
      description: 'The client will see “this link is not working any more”. You can make a new one at any time.',
      confirmLabel: 'Stop link',
      destructive: true,
    })
    if (yes) revoke.mutate()
  }

  function copy(text: string) {
    void navigator.clipboard
      ?.writeText(text)
      .then(() => toast.success('Link copied'))
      .catch(() => toast.error('Could not copy — select it by hand'))
  }

  const message = (u: string) =>
    `Hi ${clientName ?? 'there'}! Track ${projectName} here, like an order: your shoot days, your photos and films as they get ready, and payments, all on one private page. No login needed: ${u}`

  return (
    <Card>
      <CardContent className="flex flex-col gap-3 p-4">
        <div className="flex items-center justify-between gap-2">
          <p className="flex items-center gap-2 text-sm font-semibold">
            <Globe className="size-4 text-primary" aria-hidden /> Share with client
          </p>
          {link && <StatusBadge tone="success">Live</StatusBadge>}
        </div>

        {isLoading ? (
          <Skeleton className="h-16 w-full" />
        ) : !link ? (
          <>
            <p className="text-sm text-muted-foreground">
              One private link for {clientName ?? 'your client'}: shoots, deliverables, payments and terms. No login needed.
            </p>
            {canEdit ? (
              <Button size="sm" disabled={create.isPending} onClick={() => void makeLink(false)}>
                <Globe /> {create.isPending ? 'Making link…' : 'Make client link'}
              </Button>
            ) : (
              <p className="text-xs text-muted-foreground">No link has been shared yet.</p>
            )}
          </>
        ) : (
          <>
            <LastOpened link={link} />

            {url ? (
              <>
                <Input readOnly value={url} aria-label="Client link" onFocus={(e) => e.currentTarget.select()} className="text-xs" />
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" onClick={() => copy(url)}>
                    <Copy /> Copy link
                  </Button>
                  <Button size="sm" variant="outline" asChild>
                    <a href={url} target="_blank" rel="noreferrer noopener">
                      <ExternalLink /> Open
                    </a>
                  </Button>
                  <Button size="sm" variant="outline" asChild>
                    <a href={buildWhatsAppUrl(clientPhone, message(url))} target="_blank" rel="noreferrer noopener">
                      <MessageCircle /> Send on WhatsApp
                    </a>
                  </Button>
                  {kept && (
                    <Button size="sm" variant="ghost" asChild>
                      <Link to="/projects/$id/client-view" params={{ id: projectId }}>
                        <Eye /> See it as the client
                      </Link>
                    </Button>
                  )}
                </div>
              </>
            ) : (
              <p className="rounded-md bg-muted/60 p-2 text-xs text-muted-foreground">
                For safety we keep only a fingerprint of this link, so it can’t be shown again here.
                {canEdit ? ' To share it again, make a new link — the old one stops working.' : ''}
              </p>
            )}

            {canEdit && (
              <div className="flex flex-col gap-2 border-t border-border/60 pt-3">
                <Switch
                  checked={link.show_payments}
                  disabled={update.isPending}
                  onChange={(v) => update.mutate({ show_payments: v })}
                  label="Show payments"
                  description="Total, paid, balance and the next payment."
                />
                <Switch
                  checked={link.show_team}
                  disabled={update.isPending}
                  onChange={(v) => update.mutate({ show_team: v })}
                  label="Show who is coming"
                  description="First name and role only."
                />
                <Switch
                  checked={link.allow_feedback}
                  disabled={update.isPending}
                  onChange={(v) => update.mutate({ allow_feedback: v })}
                  label="Let the client leave notes"
                  description="“Looks great” or “Request a change” on each deliverable."
                />
                <Select
                  aria-label="Link expiry"
                  value=""
                  disabled={update.isPending}
                  onChange={(e) => update.mutate({ expires_in_days: e.target.value ? Number(e.target.value) : null })}
                >
                  <option value="" disabled hidden>
                    {link.expires_at ? `Expires ${shortDate.format(new Date(link.expires_at))}` : 'Never expires'}
                  </option>
                  {EXPIRY_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </Select>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="ghost" disabled={create.isPending} onClick={() => void makeLink(true)}>
                    <RefreshCw /> New link
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-destructive hover:bg-destructive/10"
                    disabled={revoke.isPending}
                    onClick={() => void onRevoke()}
                  >
                    <Link2Off /> Revoke
                  </Button>
                </div>
              </div>
            )}
          </>
        )}

        {(data?.recent_feedback.length ?? 0) > 0 && (
          <div className="flex flex-col gap-2 border-t border-border/60 pt-3">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">From the client</p>
            {data!.recent_feedback.map((f) => (
              <div key={f.id} className="flex items-start gap-2 text-sm">
                {f.kind === 'approved' ? (
                  <ThumbsUp className="mt-0.5 size-3.5 shrink-0 text-success" aria-hidden />
                ) : (
                  <PencilLine className="mt-0.5 size-3.5 shrink-0 text-warning" aria-hidden />
                )}
                <div className="min-w-0">
                  <p className="font-medium">
                    {f.deliverable_title ?? 'A deliverable'}{' '}
                    <span className="font-normal text-muted-foreground">· {openedAgo(f.created_at)}</span>
                  </p>
                  <p className="break-words text-muted-foreground">
                    {f.kind === 'approved' ? 'Looks great!' : f.message}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function LastOpened({ link }: { link: ClientPortalLinkInfo }) {
  return (
    <p className="text-sm text-muted-foreground">
      {link.last_viewed_at ? (
        <>
          Client last opened: <span className="font-medium text-foreground">{openedAgo(link.last_viewed_at)}</span>
          {link.view_count > 1 && ` · ${link.view_count} visits`}
        </>
      ) : (
        'The client has not opened it yet.'
      )}
    </p>
  )
}
