import { useEffect, useState, type FormEvent } from 'react'
import { useParams } from '@tanstack/react-router'
import { Gift, CheckCircle2, Share2, MessageCircle, Mail, Copy } from 'lucide-react'
import { toast } from 'sonner'
import { publicReferralCampaign, z, buildWhatsAppUrl, type PublicReferralCampaign } from '@ipc/contracts'

const created = z.object({ id: z.string().uuid() })
const duplicateResponse = z.object({ duplicate: z.boolean(), message: z.string().nullish() })
import { callApi, ApiError } from '@/shared/api/client'
import { CameraBackdrop } from '@/shared/brand/CameraBackdrop'
import { Button } from '@/shared/ui/button'
import { Card, CardContent } from '@/shared/ui/card'
import { Input, Label } from '@/shared/ui/input'
import { Dialog, DialogContent, DialogTrigger } from '@/shared/ui/dialog'
import { Skeleton } from '@/shared/ui/skeleton'
import { formatINR } from '@/shared/ui/format'

const REWARD_LABEL: Record<PublicReferralCampaign['reward_type'], (v: number) => string> = {
  percentage: (v) => `${v}% off their next booking`,
  fixed: (v) => `${formatINR(v)} credit`,
  credit: (v) => `${formatINR(v)} studio credit`,
  custom: () => 'a thank-you reward',
  discount: (v) => `${v}% off their next booking`,
  cashback: (v) => `${formatINR(v)} cashback`,
  free_pre_wedding: () => 'a free pre-wedding shoot',
  free_maternity: () => 'a free maternity shoot',
  extra_album: () => 'an extra album',
}

/**
 * PUBLIC page — no auth, no app shell. What a past client's friend sees when
 * they follow a shared referral link: who's asking, what's in it for them,
 * and a short form to introduce themselves.
 *
 * Lovable parity: logo + referring-client + reward title header, phone ≥7
 * required, 409 duplicate keeps the form open, auto crm_lead + admin notify
 * happen server-side, WhatsApp share dialog for passing the link on.
 */
export function ReferPage() {
  const { slug } = useParams({ from: '/refer/$slug' })
  const [campaign, setCampaign] = useState<PublicReferralCampaign | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [referrerName, setReferrerName] = useState('')
  const [referrerPhone, setReferrerPhone] = useState('')
  const [clientName, setClientName] = useState('')
  const [clientPhone, setClientPhone] = useState('')
  const [clientEmail, setClientEmail] = useState('')
  const [eventType, setEventType] = useState('')
  const [eventDate, setEventDate] = useState('')
  const [functionsCount, setFunctionsCount] = useState('')
  const [notes, setNotes] = useState('')
  const [done, setDone] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    callApi(`/public/referrals/campaign/${slug}`, { responseSchema: publicReferralCampaign })
      .then(setCampaign)
      .catch((e) => setLoadError(e instanceof ApiError ? e.message : 'This referral link is invalid or no longer active.'))
  }, [slug])

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (!campaign) return
    setError(null)
    if (!clientName.trim()) {
      setError('Please enter their name.')
      return
    }
    // Lovable parity: phone ≥7 digits required (server enforces too).
    if (clientPhone.replace(/[^\d]/g, '').length < 7) {
      setError('Please enter a valid phone number (at least 7 digits).')
      return
    }
    setBusy(true)
    try {
      await callApi(`/public/referrals/submit?campaign_id=${campaign.campaign_id}`, {
        method: 'POST',
        body: {
          referrer_name: referrerName.trim() || undefined,
          referrer_phone: referrerPhone.trim() || undefined,
          client_name: clientName.trim(),
          client_phone: clientPhone.trim() || undefined,
          client_email: clientEmail.trim() || undefined,
          event_type: eventType.trim() || undefined,
          event_date: eventDate || undefined,
          functions_count: functionsCount.trim() ? Number(functionsCount) : undefined,
          notes: notes.trim() || undefined,
        },
        responseSchema: created,
      })
      setDone(true)
    } catch (err) {
      // Lovable parity: 409 duplicate keeps the form open so the user can
      // enter a different contact — never close into the thank-you state.
      if (err instanceof ApiError && err.status === 409) {
        let msg = 'This contact has already been referred to the studio. Please share details of another friend or family member.'
        try {
          const parsed = duplicateResponse.safeParse((err as unknown as { body?: unknown }).body)
          if (parsed.success && parsed.data.message) msg = parsed.data.message
          else if (/already been referred/i.test(err.message)) msg = err.message
        } catch { /* keep default */ }
        toast.info(msg)
        setError(msg)
        return
      }
      setError(err instanceof ApiError ? err.message : 'We could not submit this referral.')
    } finally {
      setBusy(false)
    }
  }

  const shareUrl = typeof window !== 'undefined' ? window.location.href : ''

  return (
    <div className="relative flex min-h-screen items-center justify-center bg-background p-4 font-sans">
      <CameraBackdrop />
      <Card className="relative z-10 w-full max-w-lg">
        <CardContent className="flex flex-col gap-4 p-4">
          <div className="flex items-center gap-3">
            {campaign?.logo_url ? (
              <img src={campaign.logo_url} alt={campaign.studio_name ?? 'Studio logo'} className="size-10 rounded-lg object-contain" />
            ) : (
              <span className="flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <Gift className="size-5" />
              </span>
            )}
            <div className="min-w-0">
              <p className="text-xs uppercase tracking-wider text-muted-foreground">
                {campaign?.studio_name ?? "You've been referred"}
              </p>
              <h1 className="truncate text-lg font-semibold">{campaign?.reward_title ?? campaign?.name ?? 'Refer a friend'}</h1>
              {campaign?.referring_client_name && (
                <p className="truncate text-xs text-muted-foreground">Shared by {campaign.referring_client_name}</p>
              )}
            </div>
          </div>

          {loadError ? (
            <p className="text-sm text-destructive">{loadError}</p>
          ) : !campaign ? (
            <Skeleton className="h-40" />
          ) : done ? (
            <div className="flex flex-col items-center gap-2 py-4 text-center">
              <CheckCircle2 className="size-10 text-success" />
              <p className="font-medium">Thanks — we've got it.</p>
              <p className="text-sm text-muted-foreground">{campaign.studio_name ?? 'The studio'} will reach out shortly.</p>
              <WhatsAppShareDialog url={shareUrl} studio={campaign.studio_name} />
            </div>
          ) : (
            <form onSubmit={onSubmit} className="flex flex-col gap-4">
              {campaign.description && <p className="text-sm text-muted-foreground">{campaign.description}</p>}
              <p className="rounded-lg bg-muted/30 p-3 text-sm">
                {campaign.reward_description ?? `Refer a friend and get ${REWARD_LABEL[campaign.reward_type](campaign.reward_value)}, once they book.`}
              </p>

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="flex flex-col gap-1.5">
                  <Label>Your name</Label>
                  <Input value={referrerName} onChange={(e) => setReferrerName(e.target.value)} placeholder="Optional" />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label>Your phone</Label>
                  <Input value={referrerPhone} onChange={(e) => setReferrerPhone(e.target.value)} placeholder="Optional" />
                </div>
              </div>

              <div className="flex flex-col gap-1.5">
                <Label>
                  Your friend's name <span className="text-destructive">*</span>
                </Label>
                <Input value={clientName} onChange={(e) => setClientName(e.target.value)} required />
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="flex flex-col gap-1.5">
                  <Label>
                    Their phone <span className="text-destructive">*</span>
                  </Label>
                  <Input value={clientPhone} onChange={(e) => setClientPhone(e.target.value)} placeholder="98765 43210" required />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label>Their email</Label>
                  <Input type="email" value={clientEmail} onChange={(e) => setClientEmail(e.target.value)} placeholder="Optional" />
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="flex flex-col gap-1.5">
                  <Label>What's the event?</Label>
                  <Input value={eventType} onChange={(e) => setEventType(e.target.value)} placeholder="Wedding, pre-wedding…" />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label>Event date</Label>
                  <Input type="date" value={eventDate} onChange={(e) => setEventDate(e.target.value)} />
                </div>
              </div>

              <div className="flex flex-col gap-1.5">
                <Label>How many functions?</Label>
                <Input
                  type="number"
                  min={0}
                  max={50}
                  value={functionsCount}
                  onChange={(e) => setFunctionsCount(e.target.value)}
                  placeholder="e.g. haldi, mehendi, wedding, reception"
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <Label>Anything else?</Label>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={2}
                  placeholder="What are they celebrating, roughly when…"
                  className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm"
                />
              </div>

              {error && (
                <p role="alert" className="text-sm text-destructive">
                  {error}
                </p>
              )}
              <Button type="submit" disabled={busy}>
                {busy ? 'Sending…' : 'Send referral'}
              </Button>
              <div className="flex justify-center">
                <WhatsAppShareDialog url={shareUrl} studio={campaign.studio_name} />
              </div>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

/** WhatsApp share dialog: pass this referral link on to another friend. */
function WhatsAppShareDialog({ url, studio }: { url: string; studio: string | null }) {
  const text = `You've been referred to ${studio ?? 'the studio'}! Share your details here: ${url}`
  const wa = buildWhatsAppUrl(null, text)
  async function copy() {
    try {
      await navigator.clipboard.writeText(url)
      toast.success('Referral link copied.')
    } catch {
      toast.error('Could not copy the link.')
    }
  }
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" type="button">
          <Share2 className="mr-1 size-4" /> Share this link
        </Button>
      </DialogTrigger>
      <DialogContent>
        <h2 className="font-semibold">Share this referral link</h2>
        <p className="text-sm text-muted-foreground">Send it to a friend on WhatsApp, email, or copy it anywhere.</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button size="sm" asChild>
            <a href={wa} target="_blank" rel="noreferrer noopener">
              <MessageCircle className="mr-1 size-4" /> WhatsApp
            </a>
          </Button>
          <Button size="sm" variant="outline" asChild>
            <a href={`mailto:?subject=${encodeURIComponent(`You've been referred to ${studio ?? 'the studio'}`)}&body=${encodeURIComponent(text)}`}>
              <Mail className="mr-1 size-4" /> Email
            </a>
          </Button>
          <Button size="sm" variant="outline" type="button" onClick={() => void copy()}>
            <Copy className="mr-1 size-4" /> Copy link
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
