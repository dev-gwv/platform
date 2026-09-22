import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from '@tanstack/react-router'
import { Camera, XCircle } from 'lucide-react'
import { authToken } from '@ipc/contracts'
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

/**
 * Landing page for the reset link (/reset-password?token=…). A successful reset
 * signs the user straight in — the token proved they own the mailbox.
 */
export function ResetPasswordPage() {
  const { refresh } = useAuth()
  const navigate = useNavigate()
  const token = new URLSearchParams(window.location.search).get('token')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

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
        await callApi('/auth/reset-password', {
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
            {!token ? (
              <div className="flex flex-col items-center gap-3 text-center">
                <XCircle className="size-8 text-destructive" />
                <p className="text-sm font-medium">Invalid reset link</p>
                <p className="text-sm text-muted-foreground">
                  This link is missing its token. Request a new one from the sign-in page.
                </p>
                <Link to="/login" className="text-sm font-medium text-primary hover:underline">
                  Go to sign in
                </Link>
              </div>
            ) : (
              <>
                <div className="mb-6">
                  <h2 className="text-xl font-bold tracking-tight">Choose a new password</h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    At least 8 characters. Signing you in once it's saved.
                  </p>
                </div>
                <form onSubmit={onSubmit} className="flex flex-col gap-4">
                  <div className="flex flex-col gap-1.5">
                    <Label>New password</Label>
                    <Input
                      type="password"
                      placeholder="••••••••"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      required
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label>Confirm password</Label>
                    <Input
                      type="password"
                      placeholder="••••••••"
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      required
                    />
                  </div>

                  {error && (
                    <p id="form-error" role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
                      {error}
                    </p>
                  )}

                  <Button type="submit" disabled={busy} className="mt-1 w-full">
                    {busy ? 'Saving…' : 'Save password'}
                  </Button>
                </form>
                <p className="mt-4 text-center text-sm text-muted-foreground">
                  <Link to="/login" className="font-medium text-primary hover:underline">
                    Back to sign in
                  </Link>
                </p>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
