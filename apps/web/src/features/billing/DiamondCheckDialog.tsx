import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { BadgeCheck, Gem, MessageCircle } from 'lucide-react'
import { toast } from 'sonner'
import { diamondPhoneResult, type DiamondPhoneResult, type Plan } from '@ipc/contracts'
import { callApi } from '@/shared/api/client'
import { Button } from '@/shared/ui/button'
import { Dialog, DialogContent } from '@/shared/ui/dialog'
import { Input } from '@/shared/ui/input'
import { cn } from '@/shared/ui/cn'
import { diamondOutcomeWords } from './diamond-phone'

/**
 * The door to the member price (owner, 14 Oct): everyone sees the IPC Diamond
 * prices, but Talk to us on WhatsApp on one of them first asks for the mobile
 * number registered with IPC. Only a number on the member list (the owner's
 * Google Sheet, copied in every hour, 0262) goes on to WhatsApp; the match
 * also makes the studio Diamond, with 30 days from sign-up. A miss offers the
 * number again or the regular price -- never WhatsApp from here.
 *
 * WhatsApp opens on a press of Continue, not by itself after the check, so
 * the browser never blocks it as a pop-up. With no plan (opened from "Already
 * a member? Check your number") a match ends with Done.
 */
export function DiamondCheckDialog({
  open,
  plan,
  onClose,
  onWhatsApp,
  onSeeRegular,
}: {
  open: boolean
  plan: Plan | null
  onClose: () => void
  onWhatsApp: (p: Plan) => void
  onSeeRegular: () => void
}) {
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      {/* Keyed so each opening starts with an empty box. */}
      {open && <CheckBody key={plan?.id ?? 'none'} plan={plan} onClose={onClose} onWhatsApp={onWhatsApp} onSeeRegular={onSeeRegular} />}
    </Dialog>
  )
}

function CheckBody({
  plan,
  onClose,
  onWhatsApp,
  onSeeRegular,
}: {
  plan: Plan | null
  onClose: () => void
  onWhatsApp: (p: Plan) => void
  onSeeRegular: () => void
}) {
  const qc = useQueryClient()
  const [phone, setPhone] = useState('')
  const [result, setResult] = useState<DiamondPhoneResult | null>(null)
  const check = useMutation({
    mutationFn: () => callApi('/subscription/diamond/verify', { method: 'POST', body: { phone }, responseSchema: diamondPhoneResult }),
    onSuccess: (r) => {
      setResult(r)
      if (r.outcome === 'verified' || r.outcome === 'already') {
        void qc.invalidateQueries({ queryKey: ['subscription'] })
        void qc.invalidateQueries({ queryKey: ['auth'] })
      }
    },
    onError: (e: Error) => toast.error(e.message || 'We could not check that number.'),
  })
  const words = result ? diamondOutcomeWords(result.outcome) : null
  const filled = phone.replace(/[^0-9]/g, '').length >= 10

  return (
    // The close cross sits on the navy band, so it is drawn light there.
    <DialogContent className="overflow-hidden p-0 sm:max-w-md [&>button:last-child]:text-white/80 [&>button:last-child]:hover:text-white" aria-describedby={undefined}>
      <div className="relative overflow-hidden px-5 pb-5 pt-6 text-white" style={{ backgroundColor: '#1b2a4a' }}>
        <span aria-hidden className="pointer-events-none absolute -right-16 -top-16 size-48 rounded-full opacity-30 blur-3xl" style={{ backgroundColor: '#f2a618' }} />
        <div className="relative flex items-center gap-3">
          <span className="grid size-11 shrink-0 place-items-center rounded-2xl" style={{ backgroundColor: '#f2a61826' }}>
            {words?.ok ? (
              <BadgeCheck className="size-6" style={{ color: '#f2a618' }} aria-hidden />
            ) : (
              <Gem className="size-6" style={{ color: '#f2a618' }} aria-hidden />
            )}
          </span>
          <div>
            <DialogPrimitive.Title className="text-lg font-bold">
              {words?.ok ? 'Welcome, IPC Diamond member' : 'Only for IPC Diamond members'}
            </DialogPrimitive.Title>
            {plan && <p className="text-sm text-white/75">{plan.name}</p>}
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-4 p-5">
        {words?.ok ? (
          <>
            <p className="rounded-lg bg-success/10 px-3 py-2 text-sm text-success">{words.line}</p>
            {plan ? (
              <Button
                size="lg"
                className="border-0 bg-[#25D366] text-white hover:bg-[#1ebe5b]"
                onClick={() => {
                  onWhatsApp(plan)
                  onClose()
                }}
              >
                <MessageCircle aria-hidden /> Continue on WhatsApp
              </Button>
            ) : (
              <Button size="lg" onClick={onClose}>
                Done
              </Button>
            )}
          </>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">
              Only IPC Diamond members can take this price to WhatsApp. Type the mobile number you registered with IPC and we'll check it.
            </p>
            <form
              className="flex flex-col gap-2"
              onSubmit={(e) => {
                e.preventDefault()
                if (filled) check.mutate()
              }}
            >
              <Input
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                autoFocus
                aria-label="Your mobile number registered with IPC"
                placeholder="e.g. 98765 43210"
                value={phone}
                onChange={(e) => {
                  setPhone(e.target.value)
                  setResult(null)
                }}
                className={cn('h-11 text-base', filled ? 'border-success/60' : 'border-tone-amber/60 bg-tone-amber-soft/40')}
              />
              <Button type="submit" size="lg" disabled={!filled || check.isPending}>
                {check.isPending ? 'Checking…' : 'Check my number'}
              </Button>
            </form>
            {words && (
              <div className="flex flex-col gap-2 rounded-lg bg-tone-amber-soft px-3 py-2.5 text-sm">
                <p>{words.line}</p>
                <Button
                  variant="outline"
                  size="sm"
                  className="self-start"
                  onClick={() => {
                    onClose()
                    onSeeRegular()
                  }}
                >
                  See regular prices
                </Button>
              </div>
            )}
          </>
        )}
      </div>
    </DialogContent>
  )
}
