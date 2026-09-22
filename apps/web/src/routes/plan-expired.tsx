import { useNavigate } from '@tanstack/react-router'
import { CreditCard } from 'lucide-react'
import { useAuth } from '@/shared/auth/AuthProvider'
import { Button } from '@/shared/ui/button'
import { Card, CardContent } from '@/shared/ui/card'
import { StatusBadge } from '@/shared/ui/status-badge'
import { CameraBackdrop } from '@/shared/brand/CameraBackdrop'
import { humanize } from '@/shared/ui/format'

/**
 * Lovable parity (/plan-expired): standalone expired-plan page with
 * Status/Role, owner Renew CTA, and sign out. Mounted behind
 * RequireAuth allowExpired so it stays reachable precisely when lapsed.
 */
export function PlanExpiredPage() {
  const { session, signOut } = useAuth()
  const navigate = useNavigate()
  const isOwner = session?.is_owner ?? false
  const gate = session?.plan_gate ?? 'expired'

  async function onSignOut() {
    await signOut()
    await navigate({ to: '/login' })
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-muted/40 p-4">
      <CameraBackdrop />
      <div className="relative w-full max-w-sm">
        <Card>
          <CardContent className="flex flex-col items-center gap-3 p-4 text-center">
            <span className="flex size-11 items-center justify-center rounded-lg bg-warning/10 text-warning">
              <CreditCard className="size-6" />
            </span>
            <h1 className="text-lg font-semibold">Plan expired</h1>
            <p className="text-sm text-muted-foreground">
              {isOwner
                ? "Your studio's plan is inactive. Renew to restore access for your team."
                : "Your studio's plan is inactive. Contact your admin to renew."}
            </p>
            <dl className="flex w-full flex-col gap-2 rounded-lg bg-muted/40 p-3 text-left text-sm">
              <div className="flex items-center justify-between gap-3">
                <dt className="text-muted-foreground">Status</dt>
                <dd>
                  <StatusBadge tone={gate === 'expired' ? 'danger' : 'warning'}>
                    {humanize(gate)}
                  </StatusBadge>
                </dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="text-muted-foreground">Role</dt>
                <dd>
                  <StatusBadge tone="info">{humanize(session?.role ?? 'none')}</StatusBadge>
                </dd>
              </div>
              {session?.plan_expiry && (
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-muted-foreground">Expired</dt>
                  <dd className="font-medium">
                    {new Date(session.plan_expiry).toLocaleDateString('en-IN')}
                  </dd>
                </div>
              )}
            </dl>
            {isOwner && (
              <Button
                className="w-full"
                onClick={() => void navigate({ to: '/settings/subscription' })}
              >
                Go to billing &amp; renew
              </Button>
            )}
            <Button variant="outline" className="w-full" onClick={() => void onSignOut()}>
              Sign out
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
