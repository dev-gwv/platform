import { useEffect, useState } from 'react'
import { CheckCircle2, ChevronDown, Clock, Eye, FileSignature, Hourglass, PencilLine, Send, XCircle } from 'lucide-react'
import { Button } from '@/shared/ui/button'
import { Card, CardContent } from '@/shared/ui/card'
import { Dialog, DialogContent, DialogFooter } from '@/shared/ui/dialog'
import { RowMenu } from '@/shared/ui/row-menu'
import { StatusBadge } from '@/shared/ui/status-badge'
import { SkeletonList } from '@/shared/ui/skeleton'
import { ErrorState } from '@/shared/ui/states'
import { cn } from '@/shared/ui/cn'
import { useConfirm } from '@/shared/ui/confirm'
import {
  useCancelTerms,
  useProjectTerms,
  useSendTermsAgain,
  type ProjectTermsVersion,
  type SentLink,
} from '@/features/terms/api'
import { TermsComposer, type TermsProject, type TermsStart } from '@/features/terms/TermsComposer'
import { useTermsDocumentPayload } from '@/features/terms/document'
import { TermsDocumentSheet } from '@/features/terms/TermsDocumentSheet'
import { ShareTermsPanel } from '@/features/terms/ShareTermsPanel'
import { useCompanyProfile } from '@/features/settings/api'
import { TermsDocumentViewer } from '@/features/terms/TermsDocumentViewer'

const day = (iso: string) => new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })

type State = 'agreed' | 'waiting' | 'expired' | 'cancelled'

function stateOf(v: ProjectTermsVersion): State {
  if (v.acknowledged_at) return 'agreed'
  if (v.revoked_at) return 'cancelled'
  return v.link_live ? 'waiting' : 'expired'
}

const LOOK: Record<State, { label: string; tone: 'success' | 'warning' | 'neutral' | 'danger'; card: string; icon: typeof CheckCircle2 }> = {
  agreed: { label: 'Agreed', tone: 'success', card: 'border-tone-green/40 bg-tone-green-soft/40', icon: CheckCircle2 },
  waiting: { label: 'Waiting for the client', tone: 'warning', card: 'border-tone-amber/40 bg-tone-amber-soft/40', icon: Hourglass },
  expired: { label: 'Link expired', tone: 'neutral', card: 'border-border', icon: Clock },
  cancelled: { label: 'Link cancelled', tone: 'neutral', card: 'border-border', icon: XCircle },
}

/**
 * This project's terms & conditions.
 *
 * Nothing sent yet: the tab IS the place to write them -- pick your usual
 * terms, check the payment plan, read the words, with the client's view
 * beside you -- and one button sends them.
 *
 * Sent: the answer is the headline ("Agreed by Priya Sharma on 12 Oct", or
 * "Waiting for the client · opened 3 times"), with the terms that were sent
 * right underneath. Older versions fold away below.
 */
export function TermsTab({ project, canEdit }: { project: TermsProject; canEdit: boolean }) {
  const { data, isLoading, isError, refetch } = useProjectTerms(project.id)
  const cancel = useCancelTerms()
  const confirm = useConfirm()
  const [composing, setComposing] = useState(false)
  const [viewing, setViewing] = useState<string | null>(null)
  const [resending, setResending] = useState<string | null>(null)
  const [justSent, setJustSent] = useState<SentLink | null>(null)
  const [showOld, setShowOld] = useState(false)

  const versions = data ?? []
  const current = versions[0]
  const sentDoc = useTermsDocumentPayload(current?.id ?? null)

  if (isLoading) return <SkeletonList rows={2} columns={3} />
  if (isError) return <ErrorState onRetry={() => void refetch()} />

  const older = versions.slice(1)
  const client = project.client_name ?? 'the client'

  // A new version starts from the words and plan that were sent last.
  const start: TermsStart | undefined =
    current && sentDoc.data
      ? {
          title: sentDoc.data.title ?? `Terms & conditions — ${project.name}`,
          body: sentDoc.data.body ?? '',
          plan: (sentDoc.data.payment_terms ?? []).map((p) => ({
            label: p.label ?? '',
            mode: p.mode === 'amount' ? ('amount' as const) : ('percent' as const),
            value: Number(p.value) || 0,
            due_trigger: p.due_trigger ?? '',
          })),
        }
      : undefined

  const share = justSent && (
    <ShareDialog
      link={justSent}
      project={project}
      title="Terms are ready to send"
      description={`${client} opens the link, reads the terms and taps “I agree”. You will see it here, and get a notification.`}
      onClose={() => setJustSent(null)}
    />
  )

  const onSent = (link: SentLink) => {
    setComposing(false)
    setJustSent(link)
  }

  if (!current || composing) {
    if (!canEdit) {
      return (
        <Card className="mt-4">
          <CardContent className="flex flex-col items-center gap-2 p-8 text-center">
            <FileSignature className="size-6 text-muted-foreground" aria-hidden />
            <p className="text-sm text-muted-foreground">No terms have been sent to {client} yet.</p>
          </CardContent>
        </Card>
      )
    }
    return (
      <div className="mt-4">
        <TermsComposer
          key={composing ? `v-${current?.id}` : 'first'}
          project={project}
          start={composing ? start : undefined}
          onSent={onSent}
          onCancel={composing ? () => setComposing(false) : undefined}
        />
        {share}
      </div>
    )
  }

  return (
    <div className="mt-4 flex flex-col gap-4">
      <CurrentCard
        v={current}
        client={client}
        canEdit={canEdit}
        onView={() => setViewing(current.id)}
        onResend={() => setResending(current.id)}
        onNewVersion={() => setComposing(true)}
        onCancel={async () => {
          if (await confirm({ title: 'Cancel this link?', description: `${client} will no longer be able to open it or agree.`, confirmLabel: 'Cancel link', destructive: true })) {
            cancel.mutate(current.id)
          }
        }}
      />

      {/* What was sent, right here -- not behind a button. */}
      {sentDoc.data && (
        <Card>
          <CardContent className="p-4">
            <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">The terms {client} received</p>
            <TermsDocumentSheet doc={sentDoc.data} bodyClassName="max-h-[60vh] overflow-auto" />
          </CardContent>
        </Card>
      )}

      {older.length > 0 && (
        <div>
          <button
            type="button"
            onClick={() => setShowOld((v) => !v)}
            aria-expanded={showOld}
            className="flex items-center gap-1 text-sm font-medium text-muted-foreground hover:text-foreground"
          >
            <ChevronDown className={cn('size-4 transition-transform', showOld && 'rotate-180')} aria-hidden />
            Earlier versions ({older.length})
          </button>
          {showOld && (
            <ul className="mt-2 flex flex-col gap-1.5">
              {older.map((v) => {
                const s = stateOf(v)
                return (
                  <li key={v.id} className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-card px-3 py-2 text-sm">
                    <span className="min-w-0 flex-1 truncate">{v.title ?? 'Terms & conditions'}</span>
                    <span className="text-xs text-muted-foreground">Sent {day(v.created_at)}</span>
                    <StatusBadge tone={LOOK[s].tone}>{s === 'cancelled' ? 'Replaced' : LOOK[s].label}</StatusBadge>
                    <Button size="sm" variant="ghost" onClick={() => setViewing(v.id)}>
                      <Eye /> View
                    </Button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      )}

      <TermsDocumentViewer documentId={viewing} onClose={() => setViewing(null)} />
      {resending && <SendAgainDialog documentId={resending} project={project} onClose={() => setResending(null)} />}
      {share}
    </div>
  )
}

function CurrentCard({
  v,
  client,
  canEdit,
  onView,
  onResend,
  onNewVersion,
  onCancel,
}: {
  v: ProjectTermsVersion
  client: string
  canEdit: boolean
  onView: () => void
  onResend: () => void
  onNewVersion: () => void
  onCancel: () => void
}) {
  const s = stateOf(v)
  const look = LOOK[s]
  const Icon = look.icon

  const headline =
    s === 'agreed'
      ? `Agreed by ${v.acknowledged_by_name ?? client} on ${day(v.acknowledged_at!)}`
      : s === 'waiting'
        ? `Waiting for ${client} to agree`
        : s === 'expired'
          ? `The link expired before ${client} agreed`
          : 'This link was cancelled'

  const facts = [
    `Sent ${day(v.created_at)}`,
    v.access_count > 0 ? `opened ${v.access_count} ${v.access_count === 1 ? 'time' : 'times'}` : s === 'waiting' ? 'not opened yet' : null,
    s === 'waiting' && v.expires_at ? `link works till ${day(v.expires_at)}` : null,
    v.emailed_to ? `emailed to ${v.emailed_to}` : null,
    s === 'agreed' && v.acknowledged_by_email ? v.acknowledged_by_email : null,
  ].filter(Boolean)

  return (
    <Card className={cn('border', look.card)}>
      <CardContent className="flex flex-col gap-3 p-4">
        <div className="flex items-start gap-3">
          <Icon className={cn('mt-0.5 size-6 shrink-0', s === 'agreed' ? 'text-tone-green' : s === 'waiting' ? 'text-tone-amber' : 'text-muted-foreground')} aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="text-base font-semibold">{headline}</p>
            <p className="text-sm text-muted-foreground">{v.title ?? 'Terms & conditions'}</p>
            <p className="mt-1 text-xs text-muted-foreground">{facts.join(' · ')}</p>
          </div>
          <StatusBadge tone={look.tone}>{look.label}</StatusBadge>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/* Changing the terms is the common need, so it is a button, not a
              menu item: it opens the terms as sent, to edit and send as a new
              version -- the old link then stops working. */}
          {canEdit && (
            <Button onClick={onNewVersion}>
              <PencilLine /> Edit &amp; resend
            </Button>
          )}
          {canEdit && (s === 'waiting' || s === 'expired') && (
            <Button variant="outline" onClick={onResend}>
              <Send /> Share the link again
            </Button>
          )}
          <Button variant="outline" onClick={onView}>
            <Eye /> View what was sent
          </Button>
          {canEdit && s === 'waiting' && <RowMenu label="More" items={[{ label: 'Cancel this link', onSelect: onCancel }]} />}
        </div>
      </CardContent>
    </Card>
  )
}

/** A fresh link for the same terms, then the same three ways to send it. */
function SendAgainDialog({ documentId, project, onClose }: { documentId: string; project: TermsProject; onClose: () => void }) {
  const again = useSendTermsAgain()
  const [link, setLink] = useState<SentLink | null>(null)
  const { mutate } = again

  useEffect(() => {
    mutate({ documentId }, { onSuccess: setLink, onError: () => onClose() })
  }, [documentId, mutate, onClose])

  return (
    <ShareDialog
      link={link}
      project={project}
      title="Send the terms again"
      description="A fresh link — the old one stops working, so only this one can be agreed to."
      onClose={onClose}
    />
  )
}

function ShareDialog({
  link,
  project,
  title,
  description,
  onClose,
}: {
  link: SentLink | null
  project: TermsProject
  title: string
  description: string
  onClose: () => void
}) {
  const company = useCompanyProfile()
  const studioName = company.data?.display_name || company.data?.name || undefined
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent title={title} description={description}>
        {link ? (
          <ShareTermsPanel
            documentId={link.document_id}
            token={link.token}
            url={link.url}
            clientName={project.client_name}
            clientPhone={project.client_phone}
            clientEmail={project.client_email}
            projectName={project.name}
            studioName={studioName}
          />
        ) : (
          <p className="py-6 text-center text-sm text-muted-foreground">Making a fresh link…</p>
        )}
        <DialogFooter>
          <Button onClick={onClose}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
