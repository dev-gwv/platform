import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { Camera, XCircle } from 'lucide-react'
import { authToken, invitationPreview } from '@ipc/contracts'
import { callApi } from '@/shared/api/client'
import { CameraBackdrop } from '@/shared/brand/CameraBackdrop'
import { setTokens } from '@/shared/auth/token'
import { markCookieSession } from '@/shared/api/client'

/** Store the pair; an empty refresh token means the API keeps it in its cookie. */
function rememberSession(pair: { access_token: string; refresh_token: string }) {
  setTokens(pair)
  markCookieSession(!pair.refresh_token)
}
import { useAuth } from '@/shared/auth/AuthProvider'
import { Button } from '@/shared/ui/button'
import { Card, CardContent } from '@/shared/ui/card'
import { Input, Label } from '@/shared/ui/input'
import { humanize } from '@/shared/ui/format'
import { Skeleton } from '@/shared/ui/skeleton'

/**
 * Landing page for an invitation link (/accept-invite?token=…).
 *
 * The invitee has no account yet, so this is the one screen that creates one
 * without a sign-up form: the studio already filled in who they are, and all
 * that's left is a password. Following the link proved they own the mailbox,
 * so accepting signs them straight in.
 */
export function AcceptInvitePage() {
  const { refresh, session, signOut } = useAuth()
  const navigate = useNavigate()
  const token = new URLSearchParams(window.location.search).get('token')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const preview = useQuery({
    queryKey: ['invite', token],
    queryFn: () =>
      callApi(`/auth/invite?token=${encodeURIComponent(token ?? '')}`, {
        responseSchema: invitationPreview,
      }),
    enabled: !!token,
    retry: false,
  })

  // Lovable parity: a signed-in user opening an invite for a different email
  // sees the mismatch and can recover by signing out first.
  const signedEmail = session?.email?.toLowerCase() ?? null
  const inviteEmail = preview.data?.email?.toLowerCase() ?? null
  const differentEmail = !!session && !!inviteEmail && !!signedEmail && signedEmail !== inviteEmail

  async function signOutDifferent() {
    await signOut()
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    if (password.length < 8) {
      setError('Use at least 8 characters.')
      return
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match.')
      return
    }
    setBusy(true)
    try {
      rememberSession(
        await callApi('/auth/accept-invite', {
          method: 'POST',
          body: { token, password },
          responseSchema: authToken,
        }),
      )
      await refresh()
      await navigate({ to: '/dashboard' })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-muted/40 p-4">
      <CameraBackdrop />

      <div className="relative w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center gap-2 text-center">
          <span className="flex size-11 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <Camera className="size-6" />
          </span>
          <h1 className="text-xl font-semibold tracking-tight">
            <span className="text-brand">IPC</span> Studios
          </h1>
        </div>

        <Card>
          <CardContent className="p-4">
            {!token || preview.isError ? (
              <div className="flex flex-col items-center gap-3 text-center">
                <XCircle className="size-8 text-destructive" />
                <p className="font-medium">This invitation link doesn’t work</p>
                <p className="text-sm text-muted-foreground">
                  It may have expired, been revoked, or already been used. Ask the studio to send a
                  new one.
                </p>
                <Link to="/login" className="text-sm text-primary hover:underline">
                  Go to sign in
                </Link>
              </div>
            ) : preview.isLoading ? (
              <div className="flex flex-col gap-3" role="status" aria-label="Checking your invitation">
                <Skeleton className="h-6 w-2/3" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="mt-2 h-9 w-full" />
                <Skeleton className="h-9 w-full" />
              </div>
            ) : (
              <>
                <h2 className="text-lg font-semibold tracking-tight">
                  Join {preview.data?.company_name}
                </h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  You’re joining as {humanize(preview.data?.role ?? 'employee')}. Choose a password
                  for {preview.data?.email}.
                </p>

                {session && !differentEmail && (
                  <p className="mt-3 rounded-lg bg-muted/50 p-3 text-sm text-muted-foreground">
                    You&apos;re signed in as {session.email}. Accepting links this invitation to
                    your current session — or sign out first to accept as a different email.
                  </p>
                )}
                {differentEmail && (
                  <div className="mt-3 rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm">
                    <p className="font-medium">Different email</p>
                    <p className="mt-0.5 text-muted-foreground">
                      This invite is for {preview.data?.email}, but you&apos;re signed in as{' '}
                      {session?.email}. Sign out and continue as the invited email.
                    </p>
                    <Button
                      size="sm"
                      variant="outline"
                      className="mt-2"
                      onClick={() => void signOutDifferent()}
                    >
                      Sign out and use a different email
                    </Button>
                  </div>
                )}

                <form onSubmit={onSubmit} className="mt-4 flex flex-col gap-3">
                  <div className="flex flex-col gap-1.5">
                    <Label>Password</Label>
                    <Input
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="At least 8 characters"
                      autoComplete="new-password"
                      autoFocus
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label>Confirm password</Label>
                    <Input
                      type="password"
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      autoComplete="new-password"
                    />
                  </div>
                  {error && (
            <p id="form-error" role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
                  <Button type="submit" disabled={busy || differentEmail}>
                    {busy ? 'Setting up…' : 'Accept invitation'}
                  </Button>
                </form>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
