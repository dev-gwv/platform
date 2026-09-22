import { useEffect, useState } from 'react'
import { Link, useNavigate } from '@tanstack/react-router'
import { Camera, Loader2, XCircle } from 'lucide-react'
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
import { Card, CardContent } from '@/shared/ui/card'

/** Landing page for the email verification link (/verify?token=…). */
export function VerifyEmailPage() {
  const { refresh } = useAuth()
  const navigate = useNavigate()
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    const token = new URLSearchParams(window.location.search).get('token')
    if (!token) {
      setFailed(true)
      return
    }
    let active = true
    void (async () => {
      try {
        rememberSession(
          await callApi('/auth/verify', {
            method: 'POST',
            body: { token },
            responseSchema: authToken,
          }),
        )
        await refresh()
        if (active) await navigate({ to: '/dashboard' })
      } catch {
        if (active) setFailed(true)
      }
    })()
    return () => {
      active = false
    }
  }, [navigate, refresh])

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
          <CardContent className="flex flex-col items-center gap-3 p-4 text-center">
            {failed ? (
              <>
                <XCircle className="size-8 text-destructive" />
                <p className="text-sm font-medium">Verification failed</p>
                <p className="text-sm text-muted-foreground">
                  This link is invalid or has expired. Sign in and request a new one.
                </p>
                <Link to="/login" className="text-sm font-medium text-primary hover:underline">
                  Go to sign in
                </Link>
              </>
            ) : (
              <>
                <Loader2 className="size-8 animate-spin text-primary" />
                <p className="text-sm text-muted-foreground">Verifying your email…</p>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
