import { useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { CheckCircle2, Clock, Gem, ImageUp, Loader2, XCircle } from 'lucide-react'
import { diamondClaimResult, type SubscriptionStatus } from '@ipc/contracts'
import { callApi, uploadFile } from '@/shared/api/client'
import { Button } from '@/shared/ui/button'
import { Card, CardContent } from '@/shared/ui/card'
import { cn } from '@/shared/ui/cn'

const longDate = (iso: string) => new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })

/**
 * "Are you an IPC Diamond member?" -- for a studio on the outsider price.
 *
 * The owner's rule: a member is in the IPC Diamonds - Premium WhatsApp group,
 * and a screenshot of it is the proof. One upload; the answer comes back in a
 * few seconds (the server reads the group name off the image). Approved: 30
 * days and member prices, straight away. Not approved: why, and try again.
 * Could not be read: the team looks and emails.
 */
export function DiamondVerifyCard({ status, className }: { status: SubscriptionStatus; className?: string }) {
  const qc = useQueryClient()
  const input = useRef<HTMLInputElement>(null)
  const [picked, setPicked] = useState<File | null>(null)

  const send = useMutation({
    mutationFn: async (file: File) => {
      const stored = await uploadFile(file)
      return callApi('/subscription/diamond/claim', {
        method: 'POST',
        body: { file_id: stored.id },
        responseSchema: diamondClaimResult,
      })
    },
    onSettled: () => {
      setPicked(null)
      void qc.invalidateQueries({ queryKey: ['subscription'] })
    },
  })

  if (status.member_tier === 'diamond') {
    return (
      <p className={cn('inline-flex items-center gap-2 rounded-full border border-tone-violet/30 bg-tone-violet-soft px-3 py-1 text-sm font-semibold text-tone-violet', className)}>
        <Gem className="size-4" aria-hidden /> IPC Diamond member · member prices are on
      </p>
    )
  }

  const last = send.data ?? status.diamond_claim
  const lastStatus = send.data?.status ?? status.diamond_claim?.status
  const reason = send.data ? send.data.reason : (status.diamond_claim?.reason ?? null)

  return (
    <Card id="diamond" className={cn('border-tone-violet/40', className)}>
      <CardContent className="flex flex-col gap-3 p-4">
        <div className="flex items-start gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-tone-violet-soft text-tone-violet">
            <Gem className="size-5" aria-hidden />
          </span>
          <div>
            <p className="font-semibold">Are you an IPC Diamond member?</p>
            <p className="text-sm text-muted-foreground">
              Upload a screenshot of the <strong className="text-foreground">IPC Diamonds - Premium</strong> WhatsApp group, with the
              group name showing at the top. Members get a 30-day trial and member prices.
            </p>
          </div>
        </div>

        {/* What the screenshot should look like: open the group, tap its name,
            screenshot that page. Seeing it beats describing it. */}
        {lastStatus !== 'approved' && send.data?.status !== 'approved' && (
          <div className="flex flex-wrap items-start gap-3 rounded-lg border border-border bg-muted/30 p-3">
            <a href="/diamond/group-example.png" target="_blank" rel="noreferrer" className="shrink-0" title="Open the example">
              <img
                src="/diamond/group-example.png"
                alt="Example: the IPC Diamonds - Premium group info page, with the group name and members count"
                className="h-40 w-auto rounded-md border border-border object-cover"
                loading="lazy"
              />
            </a>
            <div className="min-w-[12rem] flex-1 text-sm">
              <p className="font-medium">Your screenshot should look like this</p>
              <ol className="mt-1 list-decimal space-y-0.5 pl-4 text-muted-foreground">
                <li>Open the IPC Diamonds - Premium group in WhatsApp.</li>
                <li>Tap the group name at the top.</li>
                <li>Take a screenshot of that page and upload it below.</li>
              </ol>
              {status.diamond_group_link && (
                <a
                  href={status.diamond_group_link}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-2 inline-flex items-center gap-1 rounded-full bg-[#25D366] px-3 py-1 text-xs font-semibold text-white hover:bg-[#1fb857]"
                >
                  Open the group
                </a>
              )}
            </div>
          </div>
        )}

        {lastStatus === 'pending' && !send.isPending && (
          <p className="flex items-center gap-2 rounded-lg bg-tone-amber-soft px-3 py-2 text-sm text-tone-amber">
            <Clock className="size-4 shrink-0" aria-hidden /> We have your screenshot. Our team will check it and email you.
          </p>
        )}
        {lastStatus === 'rejected' && !send.isPending && (
          <p className="flex items-start gap-2 rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
            <XCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
            <span>{reason ?? 'We could not confirm it from that screenshot.'} Try a clearer one.</span>
          </p>
        )}
        {send.data?.status === 'approved' && (
          <p className="flex items-center gap-2 rounded-lg bg-success/10 px-3 py-2 text-sm text-success">
            <CheckCircle2 className="size-4 shrink-0" aria-hidden />
            Verified.{send.data.access_until ? ` Your trial now runs until ${longDate(send.data.access_until)}.` : ''} Member prices
            are below.
          </p>
        )}
        {send.isError && (
          <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {send.error instanceof Error ? send.error.message : 'That did not go through. Please try again.'}
          </p>
        )}

        {lastStatus !== 'pending' && (
          <div className="flex flex-wrap items-center gap-2">
            <input
              ref={input}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="sr-only"
              aria-label="Screenshot of the group"
              onChange={(e) => setPicked(e.target.files?.[0] ?? null)}
            />
            <Button
              type="button"
              variant="outline"
              className={cn(!picked && 'border-dashed border-tone-amber/60 bg-tone-amber-soft/30 text-tone-amber')}
              onClick={() => input.current?.click()}
              disabled={send.isPending}
            >
              <ImageUp /> {picked ? picked.name.slice(0, 28) : 'Choose screenshot'}
            </Button>
            <Button type="button" disabled={!picked || send.isPending} onClick={() => picked && send.mutate(picked)}>
              {send.isPending ? (
                <>
                  <Loader2 className="animate-spin" /> Checking…
                </>
              ) : (
                <>
                  <Gem /> Verify
                </>
              )}
            </Button>
            {last && lastStatus === 'rejected' && <span className="text-xs text-muted-foreground">You can try again.</span>}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
