import { GalleryGuide } from '@/features/gallery/GalleryGuide'
import { NewBadge } from '@/shared/ui/new-badge'
import { Link } from '@tanstack/react-router'
import { ExternalLink, Images, Lock } from 'lucide-react'
import { AuthedPage } from '@/shared/layout/AuthedPage'
import { PageHeader } from '@/shared/layout/page-header'
import { useAuth } from '@/shared/auth/AuthProvider'
import { Button } from '@/shared/ui/button'
import { Card, CardContent } from '@/shared/ui/card'
import { SkeletonCards } from '@/shared/ui/skeleton'
import { ErrorState } from '@/shared/ui/states'
import { SupportButtons } from '@/features/help/HelpPanel'
import { BookCallButton } from '@/features/help/BookCall'
import { useFramelineAccount, useOpenFramelineHome } from '@/features/gallery/api'
import { framelinePlanLine } from '@/features/gallery/gallery-text'
import { useINR } from '@/shared/money/MoneyMask'
import { GoogleDriveIcon } from '@/features/gallery/GoogleDriveIcon'
import type { GalleryDrive } from '@ipc/contracts'

export function GallerySettingsPage() {
  return (
    <AuthedPage module="settings">
      <PageHeader title="Gallery" />
      <GallerySettings />
    </AuthedPage>
  )
}

/**
 * Frameline, the photo gallery add-on (0261, 0264): whether it is on, the
 * Frameline studio behind this company, and a way in. Frameline bills for
 * itself (its own plan and wallet), so this page shows them and never charges.
 * Google Drive is connected in Frameline; this page says whether it is and
 * opens Frameline's Drive settings to connect or manage it.
 */
function GallerySettings() {
  const { session } = useAuth()
  if (!session?.is_owner) {
    return (
      <Card className="max-w-3xl">
        <CardContent className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
          <Lock className="size-4 shrink-0" /> The gallery's plan and wallet are your studio owner's. Galleries themselves are on each project's Gallery tab.
        </CardContent>
      </Card>
    )
  }
  return <OwnerView />
}

function OwnerView() {
  const q = useFramelineAccount()
  const open = useOpenFramelineHome()
  const inr = useINR()
  if (q.isPending) return <SkeletonCards count={1} />
  if (q.isError) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />
  const a = q.data

  const heading = (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h2 className="flex items-center gap-2 text-lg font-semibold tracking-tight">
        <Images className="size-5 text-tone-violet" aria-hidden /> Photo gallery (Frameline)
      </h2>
      <GalleryGuide />
    </div>
  )

  if (!a.connected) {
    return (
      <div className="flex max-w-3xl flex-col gap-3">
        {heading}
        <Card>
          <CardContent className="flex flex-col gap-3 p-4">
            <p className="text-sm text-muted-foreground">The gallery add-on is not switched on for your studio yet.</p>
            <SupportButtons compact />
          </CardContent>
        </Card>
      </div>
    )
  }

  // Frameline sends no trial flag, only the plan and the day it runs till.
  const plan = a.linked ? framelinePlanLine(a.plan, a.valid_till) : null
  const openingHome = open.isPending && open.variables !== 'drive'
  const openButton = (
    <Button onClick={() => open.mutate('home')} disabled={openingHome} className={plan?.ended ? 'ipc-nudge' : undefined}>
      <ExternalLink /> {openingHome ? 'Opening…' : 'Open Frameline'}
    </Button>
  )

  return (
    <div className="flex max-w-3xl flex-col gap-3">
      {heading}
      <Card className={a.linked && !plan?.ended ? 'border-success/40' : 'border-warning/50'}>
        <CardContent className="flex flex-col gap-3 p-4">
          {!a.reachable && a.trouble === 'misconfigured' ? (
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-sm">The gallery add-on isn’t linked properly. Your galleries still open for guests.</p>
              <BookCallButton size="sm" />
            </div>
          ) : !a.reachable ? (
            <p className="text-sm text-muted-foreground">Frameline did not answer just now. Your galleries still work; try again in a minute.</p>
          ) : !a.linked ? (
            <p className="text-sm">
              Not set up yet. Press <b>Open Frameline</b> once and your Frameline studio is made, signed in as you. After that, anyone who runs projects can make galleries.
            </p>
          ) : (
            <>
              <p className="text-sm">
                Connected as <b>{a.studio_name}</b>
                {plan && !plan.ended && <> · {plan.text}</>}
              </p>
              {plan?.ended && <p className="text-sm font-medium text-warning">{plan.text}</p>}
              <p className="text-sm text-muted-foreground">
                {a.photos_used !== null && a.photos_limit !== null && (
                  <>
                    {a.photos_used.toLocaleString('en-IN')} of {a.photos_limit.toLocaleString('en-IN')} photos used ·{' '}
                  </>
                )}
                {a.wallet_rupees !== null && <>Wallet {inr(a.wallet_rupees)} · </>}
                <Link to="/galleries" className="font-medium text-primary hover:underline">
                  {a.galleries} {a.galleries === 1 ? 'gallery' : 'galleries'}
                </Link>
              </p>
            </>
          )}
          <div>{openButton}</div>
          <p className="text-xs text-muted-foreground">The gallery's plan, wallet and renewals are paid in Frameline.</p>
        </CardContent>
      </Card>
      {a.linked && a.drive?.available && (
        <DriveCard drive={a.drive} onOpen={() => open.mutate('drive')} opening={open.isPending && open.variables === 'drive'} />
      )}
    </div>
  )
}

/**
 * Google Drive in Frameline: the owner connects it there (Google's own page),
 * then projects import shoots from it and can keep full-size photos in it.
 */
function DriveCard({ drive, onOpen, opening }: { drive: GalleryDrive; onOpen: () => void; opening: boolean }) {
  const label = opening ? 'Opening…' : drive.connected ? 'Manage in Frameline' : drive.needs_reconnect ? 'Connect again' : 'Connect Google Drive'
  return (
    <Card className={drive.connected ? 'border-success/40' : drive.needs_reconnect ? 'border-warning/50' : undefined}>
      <CardContent className="flex flex-col gap-3 p-4">
        <p className="flex items-center gap-2 text-sm font-semibold">
          <GoogleDriveIcon /> Google Drive <NewBadge feature="galleryDrive" />
        </p>
        {drive.connected ? (
          <p className="text-sm">
            Connected as <b>{drive.email}</b> ·{' '}
            {drive.default_for_new ? 'new galleries keep full-size photos in Drive' : 'full-size photos stay in Frameline unless a gallery says otherwise'}
          </p>
        ) : drive.needs_reconnect ? (
          <p className="text-sm text-warning">Google no longer lets Frameline into {drive.email ?? 'your Drive'}. Connect it again so imports and Drive photos work.</p>
        ) : (
          <p className="text-sm text-muted-foreground">Import shoots from your Drive on each project’s Gallery tab, and keep full-size photos there. Frameline sees only the files you pick.</p>
        )}
        <div>
          <Button onClick={onOpen} disabled={opening} variant={drive.connected ? 'outline' : 'default'} className={drive.needs_reconnect ? 'ipc-nudge' : undefined}>
            <ExternalLink /> {label}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
