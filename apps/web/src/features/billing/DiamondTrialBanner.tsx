import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { BadgeCheck, Gem } from 'lucide-react'
import { toast } from 'sonner'
import { diamondPhoneResult, subscriptionStatus, type DiamondPhoneResult } from '@ipc/contracts'
import { callApi } from '@/shared/api/client'
import { useAuth } from '@/shared/auth/AuthProvider'
import { Button } from '@/shared/ui/button'
import { Input } from '@/shared/ui/input'
import { cn } from '@/shared/ui/cn'
import { diamondOutcomeWords } from './diamond-phone'

/**
 * "IPC Diamond member? Activate your 30-day free trial" (owner, 21 Oct):
 * members signed up, saw a 7-day trial and were confused, because they were
 * told 30. So while an owner's studio is on its trial and not yet Diamond,
 * Home and Plan & billing carry this banner with the number box in it. A
 * number on the IPC list (diamond_verify_phone, 0277) makes the studio Diamond
 * and the trial 30 days from sign-up at once; the banner then says until when.
 */
export function DiamondTrialBanner() {
  const { session } = useAuth()
  const owner = !!session?.is_owner
  const status = useQuery({
    queryKey: ['subscription', 'status'],
    queryFn: () => callApi('/subscription/status', { responseSchema: subscriptionStatus }),
    enabled: owner,
    staleTime: 10 * 60_000,
  })
  const [done, setDone] = useState<string | null>(null)
  const s = status.data
  if (!owner || !s) return null
  if (done) return <Activated until={done} />
  if (s.member_tier !== 'outsider' || s.plan_source !== 'trial') return null
  return <Ask onVerified={setDone} />
}

function Ask({ onVerified }: { onVerified: (until: string) => void }) {
  const qc = useQueryClient()
  const [phone, setPhone] = useState('')
  const [result, setResult] = useState<DiamondPhoneResult | null>(null)
  const check = useMutation({
    mutationFn: () => callApi('/subscription/diamond/verify', { method: 'POST', body: { phone }, responseSchema: diamondPhoneResult }),
    onSuccess: (r) => {
      setResult(r)
      if (r.outcome === 'verified' || r.outcome === 'already') {
        onVerified(r.access_until ?? '')
        void qc.invalidateQueries({ queryKey: ['subscription'] })
        void qc.invalidateQueries({ queryKey: ['auth'] })
      }
    },
    onError: (e: Error) => toast.error(e.message || 'We could not check that number.'),
  })
  const filled = phone.replace(/[^0-9]/g, '').length >= 10
  const miss = result ? diamondOutcomeWords(result.outcome) : null

  return (
    <section
      id="diamond-trial"
      className="relative mb-4 overflow-hidden rounded-2xl px-5 py-5 text-white sm:px-6"
      style={{ backgroundColor: '#1b2a4a' }}
    >
      <span aria-hidden className="pointer-events-none absolute -right-20 -top-20 size-56 rounded-full opacity-30 blur-3xl" style={{ backgroundColor: '#f2a618' }} />
      <div className="relative flex flex-col gap-4 lg:flex-row lg:items-center lg:gap-6">
        <div className="flex min-w-0 flex-1 items-start gap-3">
          <span className="grid size-12 shrink-0 place-items-center rounded-2xl" style={{ backgroundColor: '#f2a61826' }}>
            <Gem className="size-6" style={{ color: '#f2a618' }} aria-hidden />
          </span>
          <div className="min-w-0">
            <h2 className="text-lg font-bold sm:text-xl">
              IPC Diamond member? <span style={{ color: '#f2a618' }}>Activate your 30-day free trial</span>
            </h2>
            <p className="mt-1 text-sm text-white/80">
              Your trial shows 7 days for now. Type the mobile number you registered with IPC and it becomes 30 days straight away.
            </p>
          </div>
        </div>
        <form
          className="flex w-full flex-col gap-2 sm:flex-row lg:w-auto"
          onSubmit={(e) => {
            e.preventDefault()
            if (filled) check.mutate()
          }}
        >
          <Input
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            aria-label="Your mobile number registered with IPC"
            placeholder="Your IPC mobile number"
            value={phone}
            onChange={(e) => {
              setPhone(e.target.value)
              setResult(null)
            }}
            className={cn(
              'h-11 bg-white text-base text-foreground sm:w-56',
              filled ? 'border-success' : 'border-tone-amber',
            )}
          />
          <Button
            type="submit"
            size="lg"
            disabled={!filled || check.isPending}
            className="h-11 border-0 font-semibold text-[#1b2a4a] hover:opacity-90"
            style={{ backgroundColor: '#f2a618' }}
          >
            {check.isPending ? 'Checking…' : 'Activate 30 days'}
          </Button>
        </form>
      </div>
      {miss && !miss.ok && <p className="relative mt-3 rounded-lg bg-white/10 px-3 py-2 text-sm">{miss.line}</p>}
    </section>
  )
}

function Activated({ until }: { until: string }) {
  const date = until ? new Date(until).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' }) : null
  return (
    <section className="mb-4 flex items-center gap-3 rounded-2xl border border-success/40 bg-success/10 px-5 py-4">
      <BadgeCheck className="size-7 shrink-0 text-success" aria-hidden />
      <div>
        <p className="font-semibold">Welcome, IPC Diamond member. Your 30-day free trial is on.</p>
        <p className="text-sm text-muted-foreground">
          {date ? `It runs until ${date}, and the Diamond prices are yours.` : 'The Diamond prices are yours.'}
        </p>
      </div>
    </section>
  )
}
