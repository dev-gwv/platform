import { useState, type FormEvent, type ReactNode } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { toast } from 'sonner'
import { changePasswordRequest } from '@ipc/contracts'
import { useChangePassword } from '@/features/settings/api'
import { useAuth } from '@/shared/auth/AuthProvider'
import { Button } from '@/shared/ui/button'
import { Card, CardContent } from '@/shared/ui/card'
import { Input, Label } from '@/shared/ui/input'
import { useConfirm } from '@/shared/ui/confirm'

function Field({ label, required, hint, children }: { label: string; required?: boolean; hint?: string | undefined; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label>
        {label}
        {required && <span className="ml-0.5 text-destructive">*</span>}
      </Label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  )
}

/**
 * Change your own password, and sign out everywhere. On My profile for
 * everyone -- a team member signs in with the password the owner gave them
 * and changes it here -- and on the owner's Company profile as before.
 */
export function SecurityCard() {
  const { signOutEverywhere } = useAuth()
  const confirm = useConfirm()
  const navigate = useNavigate()
  const change = useChangePassword()
  const [busy, setBusy] = useState(false)
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [again, setAgain] = useState('')
  const [error, setError] = useState<string | null>(null)

  async function signOutAll() {
    const yes = await confirm({
      title: 'Sign out everywhere?',
      description:
        'Every device signs out, including this one. Use this if you think someone else has access.',
      confirmLabel: 'Sign out everywhere',
      destructive: true,
    })
    if (!yes) return
    setBusy(true)
    try {
      await signOutEverywhere()
    } catch (e) {
      // Never claim the other devices are dead when the revocation failed.
      toast.error(e instanceof Error ? e.message : 'We could not sign out your other devices.')
    } finally {
      setBusy(false)
    }
    await navigate({ to: '/login' })
  }

  async function onChangePassword(e: FormEvent) {
    e.preventDefault()
    setError(null)
    const parsed = changePasswordRequest.safeParse({ current_password: current, new_password: next })
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Use at least 8 characters.')
      return
    }
    if (next !== again) {
      setError('The new passwords do not match.')
      return
    }
    try {
      await change.mutateAsync(parsed.data)
      setCurrent('')
      setNext('')
      setAgain('')
      toast.success('Password changed. Your other devices were signed out.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'We could not change your password.')
    }
  }

  return (
    <Card>
      <CardContent className="p-4 sm:p-4">
        <h3 className="font-semibold tracking-tight">Security</h3>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Change your password here. Doing so signs out every other device.
        </p>
        <form onSubmit={onChangePassword} className="mt-4 flex flex-col gap-3">
          <Field label="Current password" required>
            <Input type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />
          </Field>
          <Field label="New password" required hint="At least 8 characters.">
            <Input type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} />
          </Field>
          <Field label="Repeat new password" required>
            <Input type="password" autoComplete="new-password" value={again} onChange={(e) => setAgain(e.target.value)} aria-invalid={!!error && next !== again} />
          </Field>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button type="submit" disabled={change.isPending || !current || !next || !again}>
            {change.isPending ? 'Changing…' : 'Change password'}
          </Button>
        </form>
        <div className="mt-4 border-t border-border pt-4">
          <p className="text-sm text-muted-foreground">
            Think someone else has access? Sign out of every browser and device this account is open on.
          </p>
          <Button variant="outline" className="mt-3" disabled={busy} onClick={() => void signOutAll()}>
            {busy ? 'Signing out…' : 'Sign out everywhere'}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
