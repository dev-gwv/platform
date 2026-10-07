import { useEffect, useState, type FormEvent } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { completeSetupRequest, sessionState } from '@ipc/contracts'
import { callApi, ApiError } from '@/shared/api/client'
import { useAuth } from '@/shared/auth/AuthProvider'
import { setupLanding } from '@/features/onboarding/journey'
import { Button } from '@/shared/ui/button'
import { Card, CardContent } from '@/shared/ui/card'
import { Input, Label } from '@/shared/ui/input'
import { TiltCard } from '@/shared/ui/tilt-card'
import { PageBackdrop } from '@/shared/brand/PageBackdrop'

/**
 * The second half of Google sign-in for a first-time identity: Google already
 * proved who they are, so all that's missing is a studio to put them in. If a
 * session already resolves a studio (this page revisited, or a normal login),
 * there's nothing to complete -- send them on rather than asking again.
 */
export function CompleteSetupPage() {
  const navigate = useNavigate()
  const { session, loading, refresh, signOut } = useAuth()
  const [companyName, setCompanyName] = useState('')
  const [adminName, setAdminName] = useState('')
  const [phone, setPhone] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!loading && session) {
      // A brand-new studio lands on its first setup step, not the dashboard.
      const landing = setupLanding(session)
      void navigate(landing ? { to: landing.to, search: landing.search as never } : { to: '/dashboard' })
    }
  }, [loading, session, navigate])

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    // Read the fields themselves, not React state: Chrome shows an autofilled
    // value but tells the page nothing until the person touches that field, so
    // a filled-in "Your name" read as empty and the button never sent anything.
    const form = new FormData(e.currentTarget)
    const field = (name: string, fallback: string) => String(form.get(name) ?? fallback).trim()
    const values = {
      company_name: field('company_name', companyName),
      admin_name: field('admin_name', adminName),
      phone: field('phone', phone),
    }
    if (values.company_name.length < 2) return setError('Enter your studio’s name.')
    if (values.admin_name.length < 2) return setError('Enter your name.')
    if (!values.phone) return setError('Phone is required — 10 digits, or with a country code.')
    const parsed = completeSetupRequest.safeParse(values)
    if (!parsed.success) {
      setError(
        parsed.error.issues[0]?.path[0] === 'phone'
          ? 'That phone number does not look right — 10 digits, or with a country code.'
          : 'Please check the form and try again.',
      )
      return
    }
    setBusy(true)
    try {
      await callApi('/auth/complete-setup', { method: 'POST', body: parsed.data, responseSchema: sessionState })
      // The effect above moves on once the session lands (to setup step 1).
      await refresh()
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 401
          ? 'Your sign-in has expired. Use a different account below and sign in again.'
          : err instanceof ApiError
            ? err.message
            : 'We could not set up your studio. Please try again.',
      )
    } finally {
      setBusy(false)
    }
  }

  if (loading || session) return null

  return (
    <div className="relative flex min-h-screen items-center justify-center bg-background p-4 font-sans">
      <PageBackdrop />
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
                  name="company_name"
                  autoComplete="organization"
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
                  name="admin_name"
                  autoComplete="name"
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
                  name="phone"
                  type="tel"
                  autoComplete="tel"
                  placeholder="e.g. 98765 43210"
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
              {/* Never disabled for an empty field: a button that silently does
                  nothing is worse than one that says what is missing. */}
              <Button type="submit" disabled={busy}>
                {busy ? 'Setting up…' : 'Create my studio'}
              </Button>
            </form>
            <button
              type="button"
              onClick={() => void signOut().then(() => navigate({ to: '/login' }))}
              className="self-center text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
            >
              Use a different account
            </button>
          </CardContent>
        </Card>
      </TiltCard>
    </div>
  )
}
