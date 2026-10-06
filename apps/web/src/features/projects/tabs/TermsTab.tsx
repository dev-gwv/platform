import { useState } from 'react'
import { AlertTriangle, CheckCircle2, ChevronDown, Clock, Eye, FileSignature, Hourglass, Link2, PenLine, PencilLine, Printer, Send, XCircle } from 'lucide-react'
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
import { ShareTermsPanel, type EmailOutcome } from '@/features/terms/ShareTermsPanel'
import { useCompanyProfile } from '@/features/settings/api'
import { TermsDocumentViewer } from '@/features/terms/TermsDocumentViewer'
import { SignHereDialog } from '@/features/terms/SignHereDialog'

const day = (iso: string) => new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
const time = (iso: string) => new Date(iso).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })
const dayTime = (iso: string) => `${day(iso)}, ${time(iso)}`

/** One share dialog: the link to hand out, and what happened to the email that went with it. */
interface Sharing {
  link: { document_id: string; token?: string | null; url: string }
  emailed?: EmailOutcome | null
  title: string
  description: string
}

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
  const [sharing, setSharing] = useState<Sharing | null>(null)
  const [showOld, setShowOld] = useState(false)
  /** The document the client is signing on this device ("Sign now with Priya"). */
  const [signing, setSigning] = useState<string | null>(null)
  const again = useSendTermsAgain()

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

  const share = sharing && (
    <ShareDialog
      sharing={sharing}
      project={project}
      onClose={() => setSharing(null)}
      onSignHere={
        canEdit
          ? () => {
              setSigning(sharing.link.document_id)
              setSharing(null)
            }
          : undefined
      }
    />
  )
  const signHere = signing && (
    <SignHereDialog key={signing} documentId={signing} clientName={project.client_name ?? null} onClose={() => setSigning(null)} />
  )

  const onSent = (link: SentLink) => {
    setComposing(false)
    setSharing({
      link,
      emailed:
        link.email_status === 'not_requested'
          ? null
          : { status: link.email_status, error: link.email_error, to: project.client_email ?? null },
      title: 'Terms are ready to send',
      description: `${client} opens the link, reads the terms and taps “I agree”. You will see it here, and get a notification.`,
    })
  }

  /**
   * Share the link again. A live link is handed out as it is -- the one the
   * client already has, so nothing they hold stops working. Only a link that
   * has run out (or one made before links were kept) needs a new one, and
   * that is one press, never a loop.
   */
  const shareAgain = (v: ProjectTermsVersion) => {
    if (v.share_url) {
      setSharing({
        link: { document_id: v.id, token: null, url: v.share_url },
        title: 'Share the link again',
        description: `The same link ${client} already has — send it on WhatsApp or by email.`,
      })
      return
    }
    again.mutate(
      { documentId: v.id },
      {
        onSuccess: (link) =>
          setSharing({
            link,
            title: stateOf(v) === 'expired' ? 'A new link' : 'Share the link again',
            description: `A fresh link for the same terms — it works for 14 days. Any older link stops working.`,
          }),
      },
    )
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
      <div className="mt-4 flex flex-col gap-4">
        <TermsComposer
          key={composing ? `v-${current?.id}` : 'first'}
          project={project}
          start={composing ? start : undefined}
          onSent={onSent}
          onCancel={composing ? () => setComposing(false) : undefined}
        />
        {share}
        {signHere}
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
        onResend={() => shareAgain(current)}
        resending={again.isPending}
        onNewVersion={() => setComposing(true)}
        onSignHere={() => setSigning(current.id)}
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
      {share}
      {signHere}
    </div>
  )
}

function CurrentCard({
  v,
  client,
  canEdit,
  onView,
  onResend,
  resending,
  onNewVersion,
  onSignHere,
  onCancel,
}: {
  v: ProjectTermsVersion
  client: string
  canEdit: boolean
  onView: () => void
  onResend: () => void
  resending: boolean
  onNewVersion: () => void
  onSignHere: () => void
  onCancel: () => void
}) {
  const s = stateOf(v)
  const look = LOOK[s]
  const Icon = look.icon

  const headline =
    s === 'agreed'
      ? `Agreed by ${v.acknowledged_by_name ?? client} on ${dayTime(v.acknowledged_at!)}${v.signed_in_person ? ' · signed in person' : ''}`
      : s === 'waiting'
        ? `Waiting for ${client} to agree`
        : s === 'expired'
          ? `The link expired before ${client} agreed`
          : 'This link was cancelled'

  // The last email, as it actually went: sent (with when), or why it did not.
  const mail = v.last_email
  const mailFailed = !!mail && mail.status !== 'sent' && s === 'waiting'
  const facts = [
    `Sent ${day(v.created_at)}`,
    v.access_count > 0 ? `opened ${v.access_count} ${v.access_count === 1 ? 'time' : 'times'}` : s === 'waiting' ? 'not opened yet' : null,
    s === 'waiting' && v.expires_at ? `link works till ${day(v.expires_at)}` : null,
    mail?.status === 'sent'
      ? `emailed ${day(mail.at) === day(new Date().toISOString()) ? `today ${time(mail.at)}` : dayTime(mail.at)} to ${mail.to ?? v.emailed_to}`
      : v.emailed_to
        ? `emailed to ${v.emailed_to}`
        : !mail && s === 'waiting'
          ? 'not emailed'
          : null,
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
            {mailFailed && (
              <p className="mt-1.5 flex items-start gap-1.5 text-xs text-destructive">
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                <span>
                  {mail.status === 'provider_missing'
                    ? `The email to ${mail.to ?? client} did not go: email is not set up for this app yet.`
                    : `The email to ${mail.to ?? client} did not go: ${mail.error ?? 'no reason given'}`}{' '}
                  Share the link on WhatsApp instead.
                </span>
              </p>
            )}
          </div>
          <StatusBadge tone={look.tone}>{look.label}</StatusBadge>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/* Changing the terms is the common need, so it is a button, not a
              menu item: it opens the terms as sent, to edit and send as a new
              version -- the old link then stops working. */}
          {/* The client is in the studio: they sign right here, on this device. */}
          {canEdit && (s === 'waiting' || s === 'expired') && (
            <Button onClick={onSignHere}>
              <PenLine /> Sign now with {client.split(/\s+/)[0]}
            </Button>
          )}
          {canEdit && (
            <Button variant={s === 'waiting' || s === 'expired' ? 'outline' : 'default'} onClick={onNewVersion}>
              <PencilLine /> Edit &amp; resend
            </Button>
          )}
          {canEdit && s === 'waiting' && (
            <Button variant="outline" onClick={onResend} disabled={resending}>
              <Send /> {resending ? 'Getting the link…' : 'Share the link again'}
            </Button>
          )}
          {canEdit && s === 'expired' && (
            <Button variant="outline" onClick={onResend} disabled={resending}>
              <Link2 /> {resending ? 'Making a new link…' : 'Make a new link'}
            </Button>
          )}
          <Button variant="outline" onClick={onView}>
            <Eye /> View what was sent
          </Button>
          {s === 'agreed' && (
            <Button variant="outline" onClick={onView}>
              <Printer /> Print receipt
            </Button>
          )}
          {canEdit && s === 'waiting' && <RowMenu label="More" items={[{ label: 'Cancel this link', onSelect: onCancel }]} />}
        </div>
      </CardContent>
    </Card>
  )
}

function ShareDialog({
  sharing,
  project,
  onClose,
  onSignHere,
}: {
  sharing: Sharing
  project: TermsProject
  onClose: () => void
  /** The client is with you: they sign on this device instead. */
  onSignHere?: (() => void) | undefined
}) {
  const { link, emailed, title, description } = sharing
  const company = useCompanyProfile()
  const studioName = company.data?.display_name || company.data?.name || undefined
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent title={title} description={description}>
        <ShareTermsPanel
          documentId={link.document_id}
          token={link.token ?? null}
          url={link.url}
          clientName={project.client_name}
          clientPhone={project.client_phone}
          clientEmail={project.client_email}
          projectName={project.name}
          studioName={studioName}
          emailed={emailed ?? null}
        />
        {onSignHere && (
          <p className="text-sm text-muted-foreground">
            {project.client_name?.trim().split(/\s+/)[0] ?? 'The client'} with you?{' '}
            <button type="button" className="font-medium text-primary underline-offset-2 hover:underline" onClick={onSignHere}>
              Let them sign here
            </button>
          </p>
        )}
        <DialogFooter>
          <Button onClick={onClose}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
