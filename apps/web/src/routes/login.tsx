import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { LegalLinks } from '@/features/legal/LegalPage'
import { Link, useNavigate } from '@tanstack/react-router'
import { MailCheck } from 'lucide-react'
import {
  z,
  authToken,
  registerRequest,
  registerResult,
  loginRequest,
  forgotPasswordRequest,
  forgotPasswordResult,
  type SessionState,
} from '@ipc/contracts'
import { callApi, ApiError } from '@/shared/api/client'
import { fieldErrors, type FieldErrors } from '@/shared/forms/field-errors'
import { setTokens } from '@/shared/auth/token'
import { markCookieSession } from '@/shared/api/client'

/** Store the pair; an empty refresh token means the API keeps it in its cookie. */
function rememberSession(pair: { access_token: string; refresh_token: string }) {
  setTokens(pair)
  markCookieSession(!pair.refresh_token)
}
import { MOCK_ENABLED } from '@/shared/dev/mock'
import { useAuth } from '@/shared/auth/AuthProvider'
import { setupLanding } from '@/features/onboarding/journey'
import { Button } from '@/shared/ui/button'
import { Card, CardContent } from '@/shared/ui/card'
import { Input, Label } from '@/shared/ui/input'
import { PageBackdrop } from '@/shared/brand/PageBackdrop'
import { Wordmark } from '@/shared/ui/wordmark'

type Mode = 'signin' | 'register' | 'forgot'
const ok = z.object({ ok: z.boolean() })

/** Every field any of the three modes can show, plus the one the API has no say in. */
type FieldName = 'company_name' | 'admin_name' | 'email' | 'phone' | 'password' | 'confirm_password'

const LABELS: Record<FieldName, string> = {
  company_name: 'Company name',
  admin_name: 'Your name',
  email: 'Email',
  phone: 'Phone',
  password: 'Password',
  confirm_password: 'Confirm password',
}

const OVERRIDES: Partial<Record<FieldName, string | undefined>> = {
  // The contract's phone message ("invalid phone number") says what is wrong but
  // not what to do; every phone failure is the same failure, so one sentence covers it.
  phone: 'Enter a valid phone number — 10 digits, or with a country code.',
}

/** The wiring a Field hands its control so label, error and input stay tied together. */
interface ControlProps {
  id: string
  name: string
  'aria-invalid'?: true | undefined
  'aria-describedby'?: string | undefined
}

/** Focus order for the jump-to-first-problem on submit; matches the visual order. */
const FIELD_ORDER: FieldName[] = [
  'company_name',
  'admin_name',
  'email',
  'phone',
  'password',
  'confirm_password',
]

export function LoginPage() {
  const { refresh } = useAuth()
  const navigate = useNavigate()
  const redirect = new URLSearchParams(window.location.search).get('redirect') ?? ''
  // `?mode=register|forgot` opens straight into that form (old /register and
  // /forgot-password links land here).
  const [mode, setMode] = useState<Mode>(() => {
    const m = new URLSearchParams(window.location.search).get('mode')
    return m === 'register' || m === 'forgot' ? m : 'signin'
  })
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [companyName, setCompanyName] = useState('')
  const [adminName, setAdminName] = useState('')
  const [phone, setPhone] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [errors, setErrors] = useState<FieldErrors<FieldName>>({})
  const [busy, setBusy] = useState(false)
  const formRef = useRef<HTMLFormElement>(null)
  // Set once the user needs to verify their email (after register, or a 403 login).
  const [pendingEmail, setPendingEmail] = useState<string | null>(null)
  const [resent, setResent] = useState(false)
  // Set once a reset link has been requested (shown regardless of whether the
  // account exists — the API never tells us).
  const [resetSentTo, setResetSentTo] = useState<string | null>(null)
  const googleClientId = import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined
  const googleDivRef = useRef<HTMLDivElement>(null)
  const [googleReady, setGoogleReady] = useState(false)

  const isRegister = mode === 'register'
  const isForgot = mode === 'forgot'

  /**
   * The payload as the API would receive it, so the form is checked against the
   * exact same object the server will parse. Phone is required on register
   * (Lovable parity) — always sent, never omitted.
   */
  function payload(): Record<string, unknown> {
    if (isForgot) return { email }
    if (isRegister) {
      return {
        company_name: companyName,
        admin_name: adminName,
        email,
        password,
        phone: phone.trim(),
      }
    }
    return { email, password }
  }

  const schema = isForgot ? forgotPasswordRequest : isRegister ? registerRequest : loginRequest

  /** Contract failures, plus the confirm-password rule the API has no opinion on. */
  function validate(): FieldErrors<FieldName> {
    const found = fieldErrors<FieldName>(schema, payload(), {
      labels: LABELS,
      overrides: OVERRIDES,
    })
    if (isRegister) {
      if (!phone.trim()) found.phone = 'Phone is required — 10 digits, or with a country code.'
      if (!found.password) {
        if (!confirmPassword) found.confirm_password = 'Please re-type your password.'
        else if (password !== confirmPassword) found.confirm_password = 'Passwords do not match.'
      }
    }
    return found
  }

  /** Re-check one field once the user leaves it — but never nag about a blank one. */
  function validateField(field: FieldName, value: string) {
    if (!value.trim()) return setErrors((prev) => ({ ...prev, [field]: undefined }))
    setErrors((prev) => ({ ...prev, [field]: validate()[field] }))
  }

  /** Switching tabs must not carry the previous form's complaints across. */
  function switchMode(next: Mode) {
    setMode(next)
    setErrors({})
    setError(null)
    setPassword('')
    setConfirmPassword('')
  }

  /** Editing a field clears its complaint; submitting decides whether it comes back. */
  function edit(field: FieldName, set: (v: string) => void) {
    return (e: React.ChangeEvent<HTMLInputElement>) => {
      set(e.target.value)
      setErrors((prev) => (prev[field] ? { ...prev, [field]: undefined } : prev))
      setError(null)
    }
  }

  /**
   * Where to go after signing in: an explicit ?redirect= first; else, while
   * the studio is still being set up, its current setup step; else the
   * dashboard. A brand-new account never follows ?redirect=: it is left over
   * from whoever signed out on this screen (signing out on Leads leaves
   * ?redirect=/leads), and a new studio starts at step 1 of setup.
   */
  function goNext(s: SessionState | null = null, fresh = false) {
    if (!fresh && redirect && redirect.startsWith('/') && !redirect.startsWith('//')) {
      window.location.assign(redirect)
      return
    }
    const landing = setupLanding(s)
    void navigate(landing ? { to: landing.to, search: landing.search as never } : { to: '/dashboard' })
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)

    const found = validate()
    setErrors(found)
    if (Object.values(found).some(Boolean)) {
      // Land the cursor on the first problem rather than making them hunt for it.
      const first = FIELD_ORDER.find((f) => found[f])
      formRef.current?.querySelector<HTMLInputElement>(`[name="${first}"]`)?.focus()
      return
    }

    setBusy(true)
    try {
      if (isForgot) {
        await callApi('/auth/forgot-password', {
          method: 'POST',
          body: payload(),
          responseSchema: forgotPasswordResult,
        })
        setResetSentTo(email)
        return
      }
      if (MOCK_ENABLED) {
        goNext(await refresh())
        return
      }
      if (isRegister) {
        const made = await callApi('/auth/register', {
          method: 'POST',
          body: payload(),
          responseSchema: registerResult,
        })
        // Straight in: the confirmation email is asked for inside the app.
        if (made.session) {
          rememberSession(made.session)
          goNext(await refresh(), true)
          return
        }
        setPendingEmail(email) // an older API: show the "check your inbox" screen
        return
      }
      rememberSession(
        await callApi('/auth/login', {
          method: 'POST',
          body: payload(),
          responseSchema: authToken,
        }),
      )
      // Role/plan routing (Lovable parity): no role → /no-account,
      // expired plan → /plan-expired, else the current setup step while the
      // studio is being set up, else dashboard (or ?redirect=). The guards
      // re-route the first two.
      goNext(await refresh())
    } catch (err) {
      // Nothing on sign-in waits for an email check. A 403 here is the
      // studio having turned this person's sign-in off: say so, plainly.
      if (err instanceof ApiError && err.status === 403) {
        setError(err.message)
        return
      }
      // "Email already taken" is a fact about one field, so it belongs under
      // that field rather than in a banner the user has to map back themselves.
      if (err instanceof ApiError && err.status === 409 && /email/i.test(err.message)) {
        setErrors((prev) => ({ ...prev, email: err.message }))
        formRef.current?.querySelector<HTMLInputElement>('[name="email"]')?.focus()
        return
      }
      setError(err instanceof Error ? err.message : 'Something went wrong.')
    } finally {
      setBusy(false)
    }
  }

  async function resend() {
    if (!pendingEmail) return
    setBusy(true)
    try {
      await callApi('/auth/resend-verification', {
        method: 'POST',
        body: { email: pendingEmail },
        responseSchema: ok,
      })
      setResent(true)
    } finally {
      setBusy(false)
    }
  }

  async function handleGoogleCredential(idToken: string) {
    setError(null)
    setBusy(true)
    try {
      const result = await callApi('/auth/google', {
        method: 'POST',
        body: { id_token: idToken },
        responseSchema: authToken,
      })
      rememberSession(result)
      if (result.needs_setup) {
        // Google proved who they are; there's no studio yet to fetch a session for.
        await navigate({ to: '/complete-setup' })
        return
      }
      // Lovable parity: expired plan after Google sign-in lands on /plan-expired.
      // The guard also enforces this; this is the fast path before session settles.
      goNext(await refresh())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Google sign-in failed.')
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    if (!googleClientId || mode !== 'signin' || pendingEmail || resetSentTo) return
    if (document.getElementById('google-gsi')) {
      setGoogleReady(true)
      return
    }
    const s = document.createElement('script')
    s.id = 'google-gsi'
    s.src = 'https://accounts.google.com/gsi/client'
    s.async = true
    s.defer = true
    s.onload = () => setGoogleReady(true)
    s.onerror = () => setGoogleReady(false)
    document.head.appendChild(s)
  }, [googleClientId, mode, pendingEmail, resetSentTo])

  useEffect(() => {
    if (!googleReady || !googleClientId || !googleDivRef.current) return
    const g = (window as unknown as { google?: { accounts: { id: { initialize(opts: unknown): void; renderButton(el: HTMLElement, opts: unknown): void } } } }).google
    if (!g?.accounts?.id) return
    try {
      g.accounts.id.initialize({
        client_id: googleClientId,
        callback: (resp: { credential: string }) => void handleGoogleCredential(resp.credential),
        ux_mode: 'popup',
        auto_select: false,
      })
      googleDivRef.current.innerHTML = ''
      /*
       * Google draws this button itself and takes a width in pixels, so it
       * cannot stretch on its own. Hard-coded at 320 it was 12px wider than
       * the card's inner width once the sm:p-8 padding applied, and Google
       * clamps anything outside 200-400 — so the number has to be measured,
       * not guessed.
       */
      const room = googleDivRef.current.clientWidth
      const width = Math.round(Math.min(400, Math.max(200, room || 300)))
      g.accounts.id.renderButton(googleDivRef.current, {
        theme: 'outline',
        size: 'large',
        width,
        text: 'continue_with',
        shape: 'rectangular',
      } as unknown as Record<string, unknown>)
    } catch {
      // GIS may throw if already initialized — ignore
    }
  }, [googleReady, googleClientId])

  return (
    <div className="relative flex min-h-dvh items-center justify-center bg-background px-4 py-10">
      <PageBackdrop />

      {/*
        * Still, not tilting.
        *
        * The card used to follow the pointer by three degrees. On the one
        * screen whose job is to look dependable to someone deciding whether
        * to trust this with their client list, furniture that moves when you
        * approach it reads as a demo rather than as a product.
        */}
      <div className="relative w-full max-w-[27rem]">
        <h1 className="mb-7 text-center text-2xl font-bold tracking-tight">
          {/*
            * The raw brand amber (#f2a618) on a near-white ground fails
            * contrast as body text. At this size and weight it clears the
            * large-text threshold, which is why the wordmark may carry it and
            * the links below may not.
            */}
          <Link to="/" aria-label="Studio AutoPilot home">
            <Wordmark />
          </Link>
        </h1>

        {resetSentTo ? (
          <Card className="rounded-xl shadow-sm">
            <CardContent className="flex flex-col items-center gap-4 p-6 text-center">
              <span className="flex size-11 items-center justify-center rounded-full bg-primary/10 text-primary">
                <MailCheck className="size-6" />
              </span>
              <div className="space-y-1">
                <p className="text-sm font-medium">Check your inbox</p>
                <p className="text-sm text-muted-foreground">
                  If an account exists for <span className="font-medium">{resetSentTo}</span>, we've
                  sent a link to reset the password. It expires in 1 hour.
                </p>
                <p className="text-sm text-muted-foreground">
                  Signing in with a work username your studio gave you? Ask your studio to set a new password.
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setResetSentTo(null)
                  switchMode('signin')
                }}
                className="text-sm font-medium text-primary hover:underline"
              >
                Back to sign in
              </button>
            </CardContent>
          </Card>
        ) : pendingEmail ? (
          <Card className="rounded-xl shadow-sm">
            <CardContent className="flex flex-col items-center gap-4 p-6 text-center">
              <span className="flex size-11 items-center justify-center rounded-full bg-primary/10 text-primary">
                <MailCheck className="size-6" />
              </span>
              <div className="space-y-1">
                <p className="text-sm font-medium">Check your inbox</p>
                <p className="text-sm text-muted-foreground">
                  We sent a verification link to <span className="font-medium">{pendingEmail}</span>
                  . Click it to activate your studio, then sign in.
                </p>
              </div>
              {resent ? (
                <p className="text-sm text-success">Verification email sent again.</p>
              ) : (
                <Button
                  variant="outline"
                  className="w-full"
                  disabled={busy}
                  onClick={() => void resend()}
                >
                  {busy ? 'Sending…' : 'Resend email'}
                </Button>
              )}
              <button
                type="button"
                onClick={() => {
                  setPendingEmail(null)
                  setResent(false)
                  switchMode('signin')
                }}
                className="text-sm font-medium text-primary hover:underline"
              >
                Back to sign in
              </button>
            </CardContent>
          </Card>
        ) : (
          <>
            <Card className="rounded-xl shadow-sm">
              <CardContent className="auth-scale p-6 sm:p-8">
                <div className="mb-7">
                  <h2 className="text-2xl font-semibold tracking-tight">
                    {isForgot
                      ? 'Forgot password'
                      : isRegister
                        ? 'Create your account'
                        : 'Welcome back'}
                  </h2>
                  <p className="mt-1.5 text-sm text-muted-foreground">
                    {isForgot
                      ? "Enter your email and we'll send a reset link"
                      : isRegister
                        ? 'Start your studio workspace'
                        : 'Sign in to your studio workspace'}
                  </p>
                </div>

                {/* noValidate: the browser's own bubbles ("Please fill out this
                    field") would fire first and hide the specific messages below. */}
                <form ref={formRef} onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
                  {isRegister && (
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                      <Field label="Company name" name="company_name" error={errors.company_name}>
                        {(p) => (
                          <Input
                            {...p}
                            placeholder="e.g. Aperture Studios"
                            value={companyName}
                            onChange={edit('company_name', setCompanyName)}
                            onBlur={(e) => validateField('company_name', e.target.value)}
                            required
                          />
                        )}
                      </Field>
                      <Field label="Your name" name="admin_name" error={errors.admin_name}>
                        {(p) => (
                          <Input
                            {...p}
                            placeholder="e.g. Priya Sharma"
                            value={adminName}
                            onChange={edit('admin_name', setAdminName)}
                            onBlur={(e) => validateField('admin_name', e.target.value)}
                            required
                          />
                        )}
                      </Field>
                    </div>
                  )}

                  <Field label="Email" name="email" error={errors.email}>
                    {(p) => (
                      <Input
                        {...p}
                        type="email"
                        autoComplete="email"
                        placeholder="you@studio.in"
                        value={email}
                        onChange={edit('email', setEmail)}
                        onBlur={(e) => validateField('email', e.target.value)}
                        required
                      />
                    )}
                  </Field>

                  {isRegister && (
                    <Field
                      label="Phone"
                      name="phone"
                      error={errors.phone}
                      hint="Required — 10 digits, or with a country code."
                    >
                      {(p) => (
                        <Input
                          {...p}
                          type="tel"
                          autoComplete="tel"
                          placeholder="98765 43210"
                          value={phone}
                          onChange={edit('phone', setPhone)}
                          onBlur={(e) => validateField('phone', e.target.value)}
                          required
                        />
                      )}
                    </Field>
                  )}

                  {isRegister ? (
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                      <Field
                        label="Password"
                        name="password"
                        error={errors.password}
                        hint="At least 8 characters."
                      >
                        {(p) => (
                          <Input
                            {...p}
                            type="password"
                            autoComplete="new-password"
                            placeholder="••••••••"
                            value={password}
                            onChange={edit('password', setPassword)}
                            onBlur={(e) => validateField('password', e.target.value)}
                            required
                          />
                        )}
                      </Field>
                      <Field
                        label="Confirm password"
                        name="confirm_password"
                        error={errors.confirm_password}
                      >
                        {(p) => (
                          <Input
                            {...p}
                            type="password"
                            autoComplete="new-password"
                            placeholder="••••••••"
                            value={confirmPassword}
                            onChange={edit('confirm_password', setConfirmPassword)}
                            onBlur={() => {
                              // Compared, not format-checked — only meaningful once
                              // both boxes have something in them.
                              if (confirmPassword && password !== confirmPassword) {
                                setErrors((prev) => ({
                                  ...prev,
                                  confirm_password: 'Passwords do not match.',
                                }))
                              }
                            }}
                            required
                          />
                        )}
                      </Field>
                    </div>
                  ) : (
                    !isForgot && (
                      <Field
                        label="Password"
                        name="password"
                        error={errors.password}
                        action={
                          <button
                            type="button"
                            onClick={() => switchMode('forgot')}
                            className="text-xs font-medium text-primary hover:underline"
                          >
                            Forgot password?
                          </button>
                        }
                      >
                        {(p) => (
                          <Input
                            {...p}
                            type="password"
                            autoComplete="current-password"
                            placeholder="••••••••"
                            value={password}
                            onChange={edit('password', setPassword)}
                            required
                          />
                        )}
                      </Field>
                    )
                  )}

                  {error && (
                    <p
                      role="alert"
                      className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive"
                    >
                      {error}
                    </p>
                  )}

                  <Button type="submit" disabled={busy} className="mt-1 w-full text-base font-semibold">
                    {busy
                      ? 'Please wait…'
                      : isForgot
                        ? 'Send reset link'
                        : isRegister
                          ? 'Create account'
                          : 'Sign in'}
                  </Button>

                  {!isForgot && !isRegister && googleClientId && (
                    <>
                      <div className="my-5 flex items-center gap-3">
                        <div className="h-px flex-1 bg-border" />
                        <span className="text-xs text-muted-foreground">or</span>
                        <div className="h-px flex-1 bg-border" />
                      </div>
                      <div ref={googleDivRef} className="flex justify-center" />
                      {!googleReady && (
                        <p className="mt-2 text-center text-xs text-muted-foreground">Loading Google…</p>
                      )}
                    </>
                  )}
                </form>
              </CardContent>
            </Card>

            <p className="mt-5 text-center text-sm text-muted-foreground">
              {isForgot ? (
                <button
                  type="button"
                  onClick={() => {
                    switchMode('signin')
                  }}
                  className="font-medium text-primary hover:underline"
                >
                  Back to sign in
                </button>
              ) : (
                <>
                  {isRegister ? 'Already have an account?' : 'New studio?'}{' '}
                  <button
                    type="button"
                    onClick={() => {
                      switchMode(isRegister ? 'signin' : 'register')
                    }}
                    className="font-medium text-primary hover:underline"
                  >
                    {isRegister ? 'Sign in' : 'Register'}
                  </button>
                </>
              )}
            </p>
            <LegalLinks className="mt-6" />
          </>
        )}
      </div>
    </div>
  )
}

/**
 * A labelled input with its own error slot. The error replaces the hint rather
 * than stacking under it, and is tied to the control by aria-describedby so it
 * is announced instead of just being red.
 */
function Field({
  label,
  name,
  error,
  hint,
  action,
  children,
}: {
  label: string
  name: string
  error?: string | undefined
  hint?: string | undefined
  /** Optional control on the label row, e.g. "Forgot password?". */
  action?: React.ReactNode
  /** Given the id/aria wiring this field owns, so the control cannot forget it. */
  children: (props: ControlProps) => React.ReactNode
}) {
  const id = useId()
  const messageId = `${id}-message`

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between">
        <Label htmlFor={id}>{label}</Label>
        {action}
      </div>
      {children({
        id,
        name,
        'aria-invalid': error ? true : undefined,
        'aria-describedby': error || hint ? messageId : undefined,
      })}
      {error ? (
        <p id={messageId} role="alert" className="text-xs font-medium text-destructive">
          {error}
        </p>
      ) : hint ? (
        <p id={messageId} className="text-xs text-muted-foreground">
          {hint}
        </p>
      ) : null}
    </div>
  )
}
