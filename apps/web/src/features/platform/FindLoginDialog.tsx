import { useState } from 'react'
import { CalendarPlus, LogIn, Search } from 'lucide-react'
import { Dialog, DialogContent, DialogTrigger } from '@/shared/ui/dialog'
import { Button } from '@/shared/ui/button'
import { Input } from '@/shared/ui/input'
import { StatusBadge } from '@/shared/ui/status-badge'
import { cn } from '@/shared/ui/cn'
import { useLoginLookup, useOpenFirst, useSetAccessUntil } from './api'
import { extendFrom } from './access-rows'

const GATE: Record<string, { label: string; tone: 'success' | 'info' | 'warning' | 'danger' }> = {
  active: { label: 'Paid plan', tone: 'success' },
  grandfathered: { label: 'Free trial', tone: 'info' },
  grace: { label: 'Grace days', tone: 'warning' },
  expired: { label: 'Expired', tone: 'danger' },
}
const day = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : null

/**
 * Find a login (0269; owner, 17 Oct). When someone extended here still sees
 * "Plan expired", type the email they sign in with: every studio that login
 * opens, each one's access, and which it opens first. The studio they land
 * on can be given 30 days right here, or another of theirs set to open
 * first. A login with an open studio never lands on an expired one now, so
 * this is mostly for a studio that is not the one that was extended.
 */
export function FindLoginDialog() {
  const [open, setOpen] = useState(false)
  const [typed, setTyped] = useState('')
  const [email, setEmail] = useState('')
  const found = useLoginLookup(email)
  const openFirst = useOpenFirst()
  const setUntil = useSetAccessUntil()
  const rows = found.data ?? []

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) { setTyped(''); setEmail('') } }}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline"><LogIn className="size-4" /> Find a login</Button>
      </DialogTrigger>
      <DialogContent title="Find a login" description="The email they sign in with: every studio it opens, and which one comes first.">
        <form
          className="flex gap-2"
          onSubmit={(e) => { e.preventDefault(); setEmail(typed.trim()) }}
        >
          <Input
            type="email"
            autoFocus
            aria-label="Email they sign in with"
            placeholder="name@gmail.com"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            className={cn(!typed && 'border-warning/60')}
          />
          <Button type="submit" disabled={typed.trim().length < 3}><Search className="size-4" /> Find</Button>
        </form>

        {email && (
          <div className="mt-3 flex flex-col gap-2 text-sm">
            {found.isLoading && <p className="text-muted-foreground">Looking…</p>}
            {found.isError && <p className="text-destructive">Could not look that up. Try again.</p>}
            {found.isSuccess && rows.length === 0 && (
              <p className="rounded-lg border border-dashed border-warning/60 bg-warning/5 p-3">
                No login signs in with <b>{email}</b>. Ask them which email they type on the sign-in page.
              </p>
            )}
            {rows.map((r) => {
              const gate = GATE[r.plan_gate] ?? GATE.expired!
              const until = day(r.access_until)
              return (
                <div
                  key={r.profile_id}
                  className={cn('flex flex-col gap-2 rounded-lg border p-3', r.opens_first ? 'border-primary/50 bg-primary/5' : 'border-border')}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="font-medium">{r.company_name}</p>
                      <p className="text-xs text-muted-foreground">
                        {r.is_owner ? 'Owner' : r.role.replace(/_/g, ' ')}
                        {r.opens_first ? ' · opens first when they sign in' : r.last_in ? ' · the one they were last in' : ''}
                      </p>
                    </div>
                    <StatusBadge tone={gate.tone}>{until && r.plan_gate !== 'expired' ? `${gate.label} · until ${until}` : gate.label}</StatusBadge>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {r.plan_gate === 'expired' && (
                      <Button
                        size="sm"
                        disabled={setUntil.isPending}
                        onClick={() => setUntil.mutate({ studioId: r.company_id, until: extendFrom(null, 30) })}
                      >
                        <CalendarPlus className="size-4" /> Give 30 days
                      </Button>
                    )}
                    {!r.opens_first && (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={openFirst.isPending}
                        onClick={() => openFirst.mutate({ email, company_id: r.company_id })}
                      >
                        Open this one first
                      </Button>
                    )}
                  </div>
                </div>
              )
            })}
            {rows.length > 0 && (
              <p className="text-xs text-muted-foreground">After a change, they sign out and sign in again (or reopen the app).</p>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
