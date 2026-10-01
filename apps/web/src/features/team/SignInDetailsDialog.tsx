import { useEffect, useState, type FormEvent } from 'react'
import { Wand2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/shared/ui/button'
import { cn } from '@/shared/ui/cn'
import { Dialog, DialogClose, DialogContent } from '@/shared/ui/dialog'
import { Input, Label } from '@/shared/ui/input'
import { useSetSignIn } from './api'
import { suggestPassword } from './member-form'

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/**
 * Sign-in details: the owner sets the email and password a team member
 * signs in with. One dialog does three jobs -- gives a no-login member a
 * login, fixes a mistyped email, and gets someone back in whose email is
 * made up (a reset link can never reach it). Any email works; it is only
 * their username. Saving signs out wherever they were signed in.
 */
export function SignInDetailsDialog({
  member,
  open,
  onOpenChange,
}: {
  member: { user_id: string; name: string; email: string | null; login_enabled: boolean }
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const save = useSetSignIn()
  const [email, setEmail] = useState(member.email ?? '')
  const [password, setPassword] = useState('')
  const [show, setShow] = useState(false)
  const [tried, setTried] = useState(false)

  // Fresh each time it opens: a password is never kept between openings.
  useEffect(() => {
    if (!open) return
    setEmail(member.email ?? '')
    setPassword('')
    setShow(false)
    setTried(false)
  }, [open, member.email])

  const emailOk = EMAIL.test(email.trim())
  const passwordOk = password.length >= 6
  const first = member.name.split(' ')[0] || member.name

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    setTried(true)
    if (!emailOk || !passwordOk) return
    const typed = email.trim().toLowerCase()
    save.mutate(
      {
        userId: member.user_id,
        body: { password, ...(typed !== (member.email ?? '').toLowerCase() || !member.login_enabled ? { email: typed } : {}) },
      },
      {
        onSuccess: (r) => {
          toast.success(`${first} can sign in with ${r.email} and the new password. Tell them the password yourself.`, {
            duration: 8000,
          })
          onOpenChange(false)
        },
      },
    )
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={`${first}'s sign-in`}
        description={
          member.login_enabled
            ? 'Set a new password, or change the email they sign in with.'
            : `${first} cannot sign in yet. Give them an email and a password.`
        }
      >
        <form className="flex flex-col gap-4" onSubmit={onSubmit} noValidate>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="signin-email">Email</Label>
            <Input
              id="signin-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="name@example.com"
              autoComplete="off"
              aria-invalid={tried && !emailOk}
              className={cn(!emailOk ? 'border-warning/60 bg-warning/5' : 'border-success/50')}
            />
            <p className={cn('text-xs', tried && !emailOk ? 'text-destructive' : 'text-muted-foreground')}>
              {tried && !emailOk ? 'Type an email, like name@studio.com.' : 'Any email works — it is just their username.'}
            </p>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="signin-password">New password</Label>
            <div className="flex gap-2">
              <Input
                id="signin-password"
                type={show ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onFocus={() => setShow(true)}
                placeholder="At least 6 characters"
                autoComplete="new-password"
                aria-invalid={tried && !passwordOk}
                className={cn('min-w-0 flex-1', !passwordOk ? 'border-warning/60 bg-warning/5' : 'border-success/50')}
              />
              <Button
                type="button"
                variant="outline"
                className="shrink-0"
                onClick={() => {
                  setPassword(suggestPassword())
                  setShow(true)
                }}
              >
                <Wand2 /> Suggest one
              </Button>
            </div>
            <p className={cn('text-xs', tried && !passwordOk ? 'text-destructive' : 'text-muted-foreground')}>
              {tried && !passwordOk
                ? 'Use at least 6 characters.'
                : `${first} is signed out everywhere and uses this from now on.`}
            </p>
          </div>
          <div className="flex justify-end gap-2">
            <DialogClose asChild>
              <Button type="button" variant="ghost">
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" disabled={save.isPending}>
              {save.isPending ? 'Saving…' : 'Save sign-in'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
