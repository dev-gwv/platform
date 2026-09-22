import { Link, useNavigate } from '@tanstack/react-router'
import { UserX } from 'lucide-react'
import { useAuth } from '@/shared/auth/AuthProvider'
import { Button } from '@/shared/ui/button'
import { Card, CardContent } from '@/shared/ui/card'
import { CameraBackdrop } from '@/shared/brand/CameraBackdrop'

/**
 * Lovable parity (/no-account): a signed-in identity with role === 'none' —
 * Google proved who they are but no studio row exists yet. Either complete
 * setup (new studio) or sign out and wait for an invite.
 */
export function NoAccountPage() {
  const { session, signOut } = useAuth()
  const navigate = useNavigate()

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
            <span className="flex size-11 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <UserX className="size-6" />
            </span>
            <h1 className="text-lg font-semibold">No studio found</h1>
            <p className="text-sm text-muted-foreground">
              {session?.email ? (
                <>
                  <span className="font-medium">{session.email}</span> isn&apos;t linked to a
                  studio yet.
                </>
              ) : (
                'This sign-in isn&apos;t linked to a studio yet.'
              )}{' '}
              Start a new studio, or ask your studio admin to invite you.
            </p>
            <Button className="mt-2 w-full" asChild>
              <Link to="/complete-setup">Complete workspace setup</Link>
            </Button>
            <Button variant="outline" className="w-full" onClick={() => void onSignOut()}>
              Sign out
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
