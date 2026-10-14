import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Gem, MessageCircle } from 'lucide-react'
import { toast } from 'sonner'
import { diamondPhoneResult, type DiamondPhoneResult } from '@ipc/contracts'
import { callApi } from '@/shared/api/client'
import { useHelp } from '@/features/help/api'
import { whatsappLink } from '@/features/help/support'
import { Button } from '@/shared/ui/button'
import { Card, CardContent } from '@/shared/ui/card'
import { IconTile } from '@/shared/ui/icon-tile'
import { Input } from '@/shared/ui/input'
import { cn } from '@/shared/ui/cn'
import { SALES_WHATSAPP } from './talk-to-us'
import { diamondOutcomeWords } from './diamond-phone'

/**
 * "IPC Diamond member?" (owner, 14 Oct): the owner types the mobile number
 * they registered with IPC; when it is on the member list (the owner's Google
 * Sheet, copied in every hour, 0262) the member prices and 30 days switch on
 * at once. No screenshot any more. A number not found goes to us on WhatsApp.
 */
export function DiamondPhoneCard({ studio, className }: { studio: string; className?: string }) {
  const qc = useQueryClient()
  const [phone, setPhone] = useState('')
  const [result, setResult] = useState<DiamondPhoneResult | null>(null)
  const support = useHelp().data?.support_whatsapp || SALES_WHATSAPP
  const check = useMutation({
    mutationFn: () => callApi('/subscription/diamond/verify', { method: 'POST', body: { phone }, responseSchema: diamondPhoneResult }),
    onSuccess: (r) => {
      setResult(r)
      if (r.outcome === 'verified' || r.outcome === 'already') {
        toast.success('You are verified as an IPC Diamond member. Member prices are on.')
        void qc.invalidateQueries({ queryKey: ['subscription'] })
        void qc.invalidateQueries({ queryKey: ['auth'] })
      }
    },
    onError: (e: Error) => toast.error(e.message || 'We could not check that number.'),
  })
  const words = result ? diamondOutcomeWords(result.outcome) : null
  const ask = `Hi Studio AutoPilot team, I'm an IPC Diamond member from ${studio}. My registered number ${phone.trim() || '(not given)'} was not found. Please check it for me.`
  const filled = phone.replace(/[^0-9]/g, '').length >= 10

  return (
    <Card id="diamond" className={cn('border-tone-violet/40 bg-tone-violet-soft/30', className)}>
      <CardContent className="flex flex-col gap-3 p-4 sm:p-5">
        <div className="flex items-start gap-3">
          <IconTile icon={Gem} tone="violet" />
          <div>
            <p className="font-semibold">IPC Diamond member?</p>
            <p className="text-sm text-muted-foreground">
              Members pay about half and get 30 days free. Type the mobile number you registered with IPC.
            </p>
          </div>
        </div>
        <form
          className="flex flex-col gap-2 sm:flex-row"
          onSubmit={(e) => {
            e.preventDefault()
            if (filled) check.mutate()
          }}
        >
          <Input
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            aria-label="Your registered mobile number"
            placeholder="e.g. 98765 43210"
            value={phone}
            onChange={(e) => {
              setPhone(e.target.value)
              setResult(null)
            }}
            className={cn('sm:max-w-xs', filled ? 'border-success/60' : 'border-tone-amber/60')}
          />
          <Button type="submit" disabled={!filled || check.isPending}>
            {check.isPending ? 'Checking…' : 'Check my number'}
          </Button>
        </form>
        {words && (
          <div
            className={cn(
              'flex flex-wrap items-center gap-2 rounded-lg px-3 py-2 text-sm',
              words.ok ? 'bg-success/10 text-success' : 'bg-tone-amber-soft text-foreground',
            )}
          >
            <span className="flex-1">{words.line}</span>
            {!words.ok && (
              <Button asChild size="sm" className="bg-[#25D366] text-white hover:bg-[#1ebe5b]">
                <a href={whatsappLink(support, ask)} target="_blank" rel="noreferrer">
                  <MessageCircle aria-hidden /> WhatsApp us
                </a>
              </Button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
