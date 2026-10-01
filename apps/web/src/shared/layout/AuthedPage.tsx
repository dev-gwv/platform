import { useEffect, type ReactNode } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { seesStudioWork, type ModuleKey } from '@ipc/permissions'
import { ModuleRouteGuard } from '../auth/ModuleRouteGuard'
import { useAuth } from '../auth/AuthProvider'
import { useAccess } from '../auth/useAccess'
import { SkeletonCards } from '../ui/skeleton'

/**
 * A page's module gate.
 *
 * The session check and the shell live on the layout route now (see
 * app/router.tsx), so this is only the per-page permission check — which
 * genuinely differs per route and therefore belongs with the route.
 *
 * Keeping the shell out here is the point: it used to be rebuilt on every
 * navigation, which reset any state it held and re-ran every mount effect.
 *
 * `studioWork` marks a page that shows the studio's work (every project, the
 * booking calendar, the data book). Staff see only their own work, so they
 * are sent to where their own version lives instead -- the address to go to,
 * worked out from where they were (a notification's `?d=` keeps its drawer).
 */
export function AuthedPage({
  module,
  studioWork,
  children,
}: {
  module: ModuleKey
  studioWork?: string | ((at: { pathname: string; search: URLSearchParams }) => string)
  children: ReactNode
}) {
  const { loading } = useAuth()
  const access = useAccess()
  const away = !!studioWork && !loading && !seesStudioWork(access)
  if (away) return <StaffRedirect to={studioWork} />
  return <ModuleRouteGuard module={module}>{children}</ModuleRouteGuard>
}

function StaffRedirect({ to }: { to: NonNullable<Parameters<typeof AuthedPage>[0]['studioWork']> }) {
  const navigate = useNavigate()
  useEffect(() => {
    const href =
      typeof to === 'string'
        ? to
        : to({ pathname: window.location.pathname, search: new URLSearchParams(window.location.search) })
    void navigate({ href, replace: true })
  }, [navigate, to])
  return <SkeletonCards count={2} />
}
