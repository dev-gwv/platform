import { useEffect } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useAuth } from '@/shared/auth/AuthProvider'
import { Landing } from '@/features/marketing/Landing'

/**
 * `/` is the front door: anyone can read it. A signed-in person has no use for
 * it, so they go straight to their dashboard (the installed app starts there
 * too). Nothing is drawn until we know which, so a signed-in visit never
 * flashes the landing page.
 */
export function HomePage() {
  const { session, loading } = useAuth()
  const navigate = useNavigate()
  useEffect(() => {
    if (!loading && session) void navigate({ to: '/dashboard', replace: true })
  }, [loading, session, navigate])

  if (loading || session) return null
  return <Landing />
}
