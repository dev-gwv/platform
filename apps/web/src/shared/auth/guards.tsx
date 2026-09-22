import { useEffect, type ReactNode } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useAuth } from './AuthProvider'
import { Button } from '../ui/button'
import { Skeleton } from '../ui/skeleton'
import { ErrorState } from '../ui/states'

/**
 * Blocks children until a studio session exists; bounces to /login otherwise.
 * An expired plan blocks the whole app EXCEPT pages that pass allowExpired
 * (the subscription/renewal page — the recovery path).
 *
 * Lovable parity: ?redirect= round-trips the destination through /login,
 * role === 'none' bounces to /no-account, and an expired plan bounces to
 * the standalone /plan-expired page (which itself uses allowExpired).
 */
export function RequireAuth({
  children,
  allowExpired = false,
  allowNoAccount = false,
}: {
  children: ReactNode
  allowExpired?: boolean
  allowNoAccount?: boolean
}) {
  const { session, loading, bootError, retry } = useAuth()
  const navigate = useNavigate()

  useEffect(() => {
    if (loading || session || bootError) return
    const redirect = `${window.location.pathname}${window.location.search}`
    void navigate({ to: '/login', search: { redirect } as never })
  }, [loading, session, bootError, navigate])

  useEffect(() => {
    if (loading || !session) return
    if (session.role === 'none' && !allowNoAccount) {
      void navigate({ to: '/no-account' })
      return
    }
    if (session.plan_gate === 'expired' && !allowExpired && window.location.pathname !== '/plan-expired') {
      void navigate({ to: '/plan-expired' })
    }
  }, [loading, session, allowExpired, allowNoAccount, navigate])

  if (loading) return <BootSkeleton />
  if (bootError && !session) {
    return (
      <Centered>
        <ErrorState message={bootError} onRetry={() => void retry()} />
      </Centered>
    )
  }
  if (!session) return null
  if (session.role === 'none' && !allowNoAccount) return null
  if (session.plan_gate === 'expired' && !allowExpired) return <PlanExpired />
  return <>{children}</>
}

/** The shell's silhouette while the session resolves, so nothing jumps on arrival. */
function BootSkeleton() {
  return (
    <div className="flex h-screen bg-background" role="status" aria-label="Loading">
      <div className="hidden w-64 shrink-0 flex-col gap-2 border-r border-border bg-sidebar p-4 md:flex">
        <Skeleton className="h-5 w-24" />
        <Skeleton className="mt-6 h-3 w-12" />
        {Array.from({ length: 7 }, (_, i) => (
          <Skeleton key={i} className="h-8 w-full" />
        ))}
      </div>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex h-14 items-center gap-3 border-b border-border bg-card px-4">
          <Skeleton className="ml-auto h-8 w-64" />
        </div>
        <div className="flex flex-col gap-4 p-4">
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-3 w-80" />
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {Array.from({ length: 4 }, (_, i) => (
              <Skeleton key={i} className="h-20 w-full" />
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

/** Only the owner can buy or renew a plan — everyone else has no button to press. */
function PlanExpired() {
  const navigate = useNavigate()
  const { session, signOut } = useAuth()
  const isOwner = session?.is_owner ?? false
  return (
    <Centered>
      <div className="max-w-sm">
        <h1 className="text-xl font-semibold">Subscription expired</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {isOwner
            ? 'Your studio’s plan has lapsed. Renew to regain access.'
            : "Your studio’s plan has lapsed. Contact your studio’s owner to renew."}
        </p>
        {isOwner ? (
          <Button className="mt-4" onClick={() => void navigate({ to: '/settings/subscription' })}>
            Renew plan
          </Button>
        ) : (
          <Button className="mt-4" variant="outline" onClick={() => void signOut()}>
            Sign out
          </Button>
        )}
      </div>
    </Centered>
  )
}

function Centered({ children }: { children: ReactNode }) {
  return <div className="grid min-h-[60vh] place-items-center bg-background text-center">{children}</div>
}
