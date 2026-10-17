import { useEffect, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { CreditCard, Store } from 'lucide-react'
import { useAuth } from '@/shared/auth/AuthProvider'
import { Button } from '@/shared/ui/button'
import { Card, CardContent } from '@/shared/ui/card'
import { StatusBadge } from '@/shared/ui/status-badge'
import { PageBackdrop } from '@/shared/brand/PageBackdrop'
import { humanize } from '@/shared/ui/format'

/** How often the page asks again whether access is back (a platform admin may extend it meanwhile). */
const RECHECK_MS = 30_000

/**
 * Lovable parity (/plan-expired): standalone expired-plan page with
 * Status/Role, owner Renew CTA, and sign out. Mounted behind
 * RequireAuth allowExpired so it stays reachable precisely when lapsed.
 *
 * Two ways out besides paying. A login can belong to several studios
 * (0159) and opens the one it was last in, so the studio someone extended
 * may not be the one on screen: every other studio of the login is listed
 * here with Open. And the page re-reads the session on focus and every 30 s,
 * leaving for Home the moment access is back -- an extension in Studio
 * Access Manager reaches a phone that was left on this page without a
 * sign-out.
 */
export function PlanExpiredPage() {
  const { session, signOut, refresh, switchStudio } = useAuth()
  const navigate = useNavigate()
  const isOwner = session?.is_owner ?? false
  const gate = session?.plan_gate ?? 'expired'
  const others = (session?.studios ?? []).filter((s) => s.company_id !== session?.company_id)
  const [opening, setOpening] = useState<string | null>(null)

  useEffect(() => {
    if (gate !== 'expired') {
      void navigate({ to: '/dashboard' })
      return
    }
    const recheck = () => void refresh()
    const timer = window.setInterval(recheck, RECHECK_MS)
    window.addEventListener('focus', recheck)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('focus', recheck)
    }
  }, [gate, navigate, refresh])

  async function open(profileId: string) {
    setOpening(profileId)
    try {
      await switchStudio(profileId)
    } finally {
      setOpening(null)
    }
  }

  async function onSignOut() {
    await signOut()
    await navigate({ to: '/login' })
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center bg-background p-4">
      <PageBackdrop />
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
            {isOwner && (
              <p className="text-xs text-muted-foreground">
                IPC Diamond member? On the billing page, check the mobile number registered with IPC to get 30 days.
              </p>
            )}
            {others.length > 0 && (
              <div className="flex w-full flex-col gap-2 border-t pt-3 text-left">
                <p className="text-sm font-medium">Your other {others.length === 1 ? 'studio' : 'studios'}</p>
                {others.map((s) => (
                  <Button
                    key={s.profile_id}
                    variant="outline"
                    className="w-full justify-start"
                    disabled={opening !== null}
                    onClick={() => void open(s.profile_id)}
                  >
                    <Store className="mr-2 size-4" />
                    <span className="truncate">{opening === s.profile_id ? 'Opening…' : `Open ${s.company_name}`}</span>
                  </Button>
                ))}
              </div>
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
