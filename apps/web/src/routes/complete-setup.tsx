import { useEffect, useState, type FormEvent } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { completeSetupRequest, sessionState } from '@ipc/contracts'
import { callApi, ApiError } from '@/shared/api/client'
import { useAuth } from '@/shared/auth/AuthProvider'
import { Button } from '@/shared/ui/button'
import { Card, CardContent } from '@/shared/ui/card'
import { Input, Label } from '@/shared/ui/input'
import { TiltCard } from '@/shared/ui/tilt-card'
import { CameraBackdrop } from '@/shared/brand/CameraBackdrop'

/**
 * The second half of Google sign-in for a first-time identity: Google already
 * proved who they are, so all that's missing is a studio to put them in. If a
 * session already resolves a studio (this page revisited, or a normal login),
 * there's nothing to complete -- send them on rather than asking again.
 */
export function CompleteSetupPage() {
  const navigate = useNavigate()
  const { session, loading, refresh } = useAuth()
  const [companyName, setCompanyName] = useState('')
  const [adminName, setAdminName] = useState('')
  const [phone, setPhone] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!loading && session) void navigate({ to: '/dashboard' })
  }, [loading, session, navigate])

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    if (!phone.trim()) {
      setError('Phone is required — 10 digits, or with a country code.')
      return
    }
    const parsed = completeSetupRequest.safeParse({
      company_name: companyName.trim(),
      admin_name: adminName.trim(),
      phone: phone.trim(),
    })
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Please check the form and try again.')
      return
    }
    setBusy(true)
    try {
      await callApi('/auth/complete-setup', { method: 'POST', body: parsed.data, responseSchema: sessionState })
      await refresh()
      await navigate({ to: '/dashboard' })
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'We could not set up your studio. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  if (loading || session) return null

  return (
    <div className="relative flex min-h-screen items-center justify-center bg-background p-4 font-sans">
      <CameraBackdrop />
      <TiltCard className="relative z-10 w-full max-w-md">
        <Card>
          <CardContent className="flex flex-col gap-4 p-4">
            <div>
              <h1 className="text-lg font-semibold">Name your studio</h1>
              <p className="mt-1 text-sm text-muted-foreground">
                One more step — tell us what to call your studio, and you're in.
              </p>
            </div>

            <form onSubmit={onSubmit} className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="company-name">Company name</Label>
                <Input
                  id="company-name"
                  autoFocus
                  placeholder="e.g. Aperture Studios"
                  value={companyName}
                  onChange={(e) => setCompanyName(e.target.value)}
                  required
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="admin-name">Your name</Label>
                <Input
                  id="admin-name"
                  placeholder="e.g. Priya Sharma"
                  value={adminName}
                  onChange={(e) => setAdminName(e.target.value)}
                  required
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="phone">Phone</Label>
                <Input
                  id="phone"
                  type="tel"
                  placeholder="98765 43210"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  required
                />
                <p className="text-xs text-muted-foreground">Required — 10 digits, or with a country code.</p>
              </div>

              {error && (
                <p role="alert" className="text-sm text-destructive">
                  {error}
                </p>
              )}
              <Button type="submit" disabled={busy || !companyName.trim() || !adminName.trim() || !phone.trim()}>
                {busy ? 'Setting up…' : 'Create my studio'}
              </Button>
            </form>
          </CardContent>
        </Card>
      </TiltCard>
    </div>
  )
}
