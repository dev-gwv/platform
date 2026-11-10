import { useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Copy, Download, Eye, Gift, Link2, Loader2, MessageCircle, Pencil, Users } from 'lucide-react'
import type { FriendRewardType, ReferralCampaign } from '@ipc/contracts'
import { Button } from '@/shared/ui/button'
import { Card, CardContent } from '@/shared/ui/card'
import { Input, Label } from '@/shared/ui/input'
import { cn } from '@/shared/ui/cn'
import { parseAmount } from '@/shared/money/parse-amount'
import { NewBadge } from '@/shared/ui/new-badge'
import { useCompanyProfile } from '@/features/settings/api'
import { TEMPLATES } from '@/features/designer/templates'
import { designerFontsReady, loadDesignerFonts } from '@/features/designer/fonts'
import { useReferralSettings, useSaveReferralCampaign } from '../api'
import { CARD, drawReferralCard, offerHeadline, renderReferralCard, saveBlob, shareCard, shareText, type CardData } from './draw'
import { useReferralSubmissions } from '../api'

export const FRIEND_KINDS: { key: FriendRewardType; label: string }[] = [
  { key: 'fixed', label: '₹ off' },
  { key: 'percentage', label: '% off' },
  { key: 'free_addon', label: 'Something free' },
  { key: 'none', label: 'Nothing' },
]

/**
 * The referral card for one booked client (owner, 10 Nov): what their friend
 * gets, drawn as a WhatsApp picture in the studio's look, ready to send to the
 * client (or for them to forward). The friend's offer is saved on the
 * client's campaign, so the friend's invoice picks it up by itself.
 */
export function ReferralCard({
  campaign: c,
  clientName,
  canEdit,
}: {
  campaign: ReferralCampaign
  clientName: string | null
  canEdit: boolean
}) {
  const company = useCompanyProfile()
  const settings = useReferralSettings()
  const save = useSaveReferralCampaign()
  const canvas = useRef<HTMLCanvasElement>(null)
  const [look, setLook] = useState<string | null>(null)
  const [from, setFrom] = useState(clientName ?? '')
  const [editing, setEditing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [kind, setKind] = useState<FriendRewardType>(c.friend_reward_type)
  const [value, setValue] = useState(c.friend_reward_value ? String(c.friend_reward_value) : '')
  const [title, setTitle] = useState(c.friend_reward_title ?? '')
  const [until, setUntil] = useState(c.valid_until ?? '')
  const [fontsReady, setFontsReady] = useState(0)
  const [logoImg, setLogoImg] = useState<HTMLImageElement | null>(null)
  const friends = useReferralSubmissions(c.id)

  const studio = company.data?.display_name || company.data?.name || 'Our studio'
  const logo = company.data?.invoice_logo_url || company.data?.avatar_url || null
  const lookKey = look ?? settings.data?.card_look ?? 'ivory'
  const theme = (TEMPLATES.find((t) => t.key === lookKey) ?? TEMPLATES[0]!).theme
  const link = `${window.location.origin}/refer/${c.slug}`
  const data: CardData = useMemo(
    () => ({
      studio,
      from: from.trim() || clientName || 'Your friend',
      friendType: c.friend_reward_type,
      friendValue: c.friend_reward_value,
      friendTitle: c.friend_reward_title,
      code: c.slug,
      link,
      validUntil: c.valid_until,
    }),
    [studio, from, clientName, c, link],
  )
  const noOffer = c.friend_reward_type === 'none'

  useEffect(() => {
    loadDesignerFonts()
  }, [])

  // The look's two faces, loaded before the preview is drawn again in them.
  useEffect(() => {
    // Until the stylesheet is read, load() finds no face and resolves at once.
    let live = true
    const faces = [`92px '${theme.heading}'`, `700 60px '${theme.body}'`, `italic 32px '${theme.body}'`]
    void (async () => {
      await designerFontsReady()
      try {
        await Promise.all(faces.map((f) => document.fonts.load(f)))
      } catch {
        /* drawn in the fallback face */
      }
      if (live) setFontsReady((n) => n + 1)
    })()
    return () => {
      live = false
    }
  }, [theme.heading, theme.body])

  // The studio's logo, for the preview as well as the download.
  useEffect(() => {
    if (!logo) {
      setLogoImg(null)
      return
    }
    let live = true
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => live && setLogoImg(img)
    img.onerror = () => live && setLogoImg(null)
    img.src = logo
    return () => {
      live = false
    }
  }, [logo])

  // The preview, drawn live.
  useEffect(() => {
    const ctx = canvas.current?.getContext('2d')
    if (ctx) drawReferralCard(ctx, data, theme, logoImg)
  }, [data, theme, fontsReady, logoImg])

  const sent = (friends.data?.pages ?? []).flatMap((p) => p.items)
  const booked = sent.filter((x) => ['booked', 'converted', 'rewarded'].includes(x.status)).length
  const clientReward = c.reward_title?.trim() || c.reward_description?.trim() || null

  async function copy(text: string, what: string) {
    try {
      await navigator.clipboard.writeText(text)
      toast.success(`${what} copied`)
    } catch {
      toast.error('Could not copy. Select it and copy by hand.')
    }
  }

  function saveOffer() {
    const v = kind === 'fixed' || kind === 'percentage' ? (parseAmount(value) ?? 0) : 0
    if (kind === 'percentage' && v > 100) return toast.error('A percent off cannot be more than 100.')
    save.mutate(
      {
        id: c.id,
        body: {
          name: c.name,
          description: c.description,
          reward_type: c.reward_type,
          reward_value: c.reward_value,
          reward_description: c.reward_description,
          friend_reward_type: kind,
          friend_reward_value: v,
          friend_reward_title: title.trim() || null,
          valid_until: until || null,
        },
      },
      { onSuccess: () => setEditing(false) },
    )
  }

  async function make(action: 'share' | 'download') {
    setBusy(true)
    try {
      const blob = await renderReferralCard(data, theme, logo)
      const name = `${(clientName ?? 'referral').replace(/[^\w]+/g, '-').toLowerCase()}-referral-card.png`
      if (action === 'download') {
        saveBlob(blob, name)
        toast.success('Card saved')
        return
      }
      const text = shareText(data)
      const how = await shareCard(blob, name, text)
      if (how === 'saved') {
        window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank', 'noopener')
        toast.success('Card saved. Attach it in the WhatsApp chat that just opened.')
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'The card could not be made.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card className={cn('overflow-hidden', noOffer && 'border-tone-amber/50')}>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-gradient-to-r from-violet-50 via-card to-amber-50/60 px-4 py-3 dark:from-violet-950/30">
        <p className="flex items-center gap-2 font-semibold">
          <Gift className="size-4 text-violet-600" aria-hidden /> Referral card{clientName ? ` for ${clientName}` : ''}
          <NewBadge feature="referralCards" />
        </p>
        <div className="flex flex-wrap gap-1.5 text-xs">
          <span className="inline-flex items-center gap-1 rounded-full border border-border bg-card px-2 py-0.5">
            <Eye className="size-3.5" aria-hidden /> Opened {c.views} time{c.views === 1 ? '' : 's'}
          </span>
          <span className="inline-flex items-center gap-1 rounded-full border border-border bg-card px-2 py-0.5">
            <Users className="size-3.5" aria-hidden /> {sent.length} friend{sent.length === 1 ? '' : 's'} enquired
            {booked > 0 && ` · ${booked} booked`}
          </span>
        </div>
      </div>
      <CardContent className="grid gap-5 p-4 md:grid-cols-[minmax(0,420px)_minmax(0,1fr)]">
        <div className="mx-auto w-full max-w-[420px] md:sticky md:top-4 md:self-start">
          <canvas
            ref={canvas}
            width={CARD}
            height={CARD}
            className="aspect-square w-full rounded-xl border border-border shadow-md"
            aria-label={`Referral card: ${offerHeadline(data.friendType, data.friendValue, data.friendTitle)}`}
          />
          <p className="mt-2 text-center text-xs text-muted-foreground">This is the picture your client sends. 1080 × 1080, sized for WhatsApp.</p>
        </div>
        <div className="flex min-w-0 flex-col gap-4">
          <section className={cn('rounded-xl border p-3', noOffer ? 'border-dashed border-tone-amber bg-tone-amber-soft/40' : 'border-border bg-muted/30')}>
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">A friend who books gets</p>
            <p className="mt-0.5 text-lg font-semibold">
              {noOffer ? 'Nothing set yet' : offerHeadline(c.friend_reward_type, c.friend_reward_value, c.friend_reward_title)}
            </p>
            <p className="text-xs text-muted-foreground">
              {noOffer ? 'Set what a friend gets, so the card has something to offer.' : 'It goes on their first invoice by itself.'}
            </p>
            {!editing && canEdit && (
              <Button size="sm" variant={noOffer ? 'default' : 'outline'} className="mt-2" onClick={() => setEditing(true)}>
                <Pencil /> {noOffer ? 'Set the friend’s offer' : 'Change the offer'}
              </Button>
            )}
            {editing && (
              <div className="mt-3 flex flex-col gap-3 rounded-lg border border-border bg-card p-3">
                <div className="flex flex-wrap gap-1.5">
                  {FRIEND_KINDS.map((k) => (
                    <button
                      key={k.key}
                      type="button"
                      aria-pressed={kind === k.key}
                      onClick={() => setKind(k.key)}
                      className={cn(
                        'rounded-full border px-3 py-1 text-sm',
                        kind === k.key ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-card hover:border-primary/50',
                      )}
                    >
                      {k.label}
                    </button>
                  ))}
                </div>
                {(kind === 'fixed' || kind === 'percentage') && (
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor={`friend-value-${c.id}`}>{kind === 'fixed' ? 'Rupees off' : 'Percent off'}</Label>
                    <Input
                      id={`friend-value-${c.id}`}
                      inputMode="numeric"
                      value={value}
                      onChange={(e) => setValue(e.target.value)}
                      placeholder={kind === 'fixed' ? 'e.g. 10,000' : 'e.g. 10'}
                      className={cn(!value.trim() && 'border-tone-amber/60 bg-tone-amber-soft/30')}
                    />
                  </div>
                )}
                {kind !== 'none' && (
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor={`friend-title-${c.id}`}>On the card, in a few words</Label>
                    <Input
                      id={`friend-title-${c.id}`}
                      value={title}
                      maxLength={120}
                      onChange={(e) => setTitle(e.target.value)}
                      placeholder={kind === 'free_addon' ? 'e.g. Free pre-wedding shoot' : 'e.g. ₹10,000 off your wedding'}
                      className={cn(kind === 'free_addon' && !title.trim() && 'border-tone-amber/60 bg-tone-amber-soft/30')}
                    />
                  </div>
                )}
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor={`friend-until-${c.id}`}>Valid till</Label>
                  <Input id={`friend-until-${c.id}`} type="date" value={until} onChange={(e) => setUntil(e.target.value)} className="w-48" />
                </div>
                <div className="flex justify-end gap-2">
                  <Button variant="ghost" size="sm" onClick={() => setEditing(false)}>
                    Cancel
                  </Button>
                  <Button size="sm" disabled={save.isPending} onClick={saveOffer}>
                    {save.isPending ? 'Saving…' : 'Save offer'}
                  </Button>
                </div>
              </div>
            )}
          </section>

          <section className="rounded-xl border border-border bg-muted/30 p-3">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {clientName ?? 'Your client'} gets, for each friend who books
            </p>
            <p className="mt-0.5 font-semibold">{clientReward ?? 'Not set yet'}</p>
            <p className="text-xs text-muted-foreground">Due by itself when the friend's lead is booked; you mark it given under Rewards.</p>
          </section>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`card-from-${c.id}`}>From</Label>
              <Input
                id={`card-from-${c.id}`}
                value={from}
                maxLength={60}
                onChange={(e) => setFrom(e.target.value)}
                placeholder="e.g. Priya & Rahul"
                className={cn(!from.trim() && 'border-tone-amber/60 bg-tone-amber-soft/30')}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Link</Label>
              <button
                type="button"
                onClick={() => void copy(link, 'Link')}
                className="flex h-10 min-w-0 items-center gap-2 rounded-md border border-input bg-background px-3 text-left text-sm hover:bg-muted"
                title="Copy the link"
              >
                <Link2 className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                <span className="truncate">{link.replace(/^https?:\/\//, '')}</span>
              </button>
            </div>
          </div>

          <div>
            <p className="mb-1.5 text-sm font-medium">Look</p>
            <div className="flex flex-wrap gap-1.5">
              {TEMPLATES.map((t) => (
                <button
                  key={t.key}
                  type="button"
                  aria-pressed={lookKey === t.key}
                  title={t.name}
                  onClick={() => setLook(t.key)}
                  className={cn(
                    'flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs',
                    lookKey === t.key ? 'border-primary ring-1 ring-primary' : 'border-border hover:border-primary/50',
                  )}
                >
                  <span className="size-3.5 rounded-full border border-black/10" style={{ background: t.theme.background }} />
                  <span className="size-3.5 rounded-full border border-black/10" style={{ background: t.theme.accent }} />
                  {t.name}
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-wrap gap-2 border-t border-border pt-4">
            <Button size="lg" disabled={busy} onClick={() => void make('share')} className="bg-[#25D366] text-white hover:bg-[#1ebe5b]">
              {busy ? <Loader2 className="animate-spin" /> : <MessageCircle />} Share on WhatsApp
            </Button>
            <Button size="lg" variant="outline" disabled={busy} onClick={() => void make('download')}>
              <Download /> Download
            </Button>
            <Button size="lg" variant="outline" onClick={() => void copy(shareText(data), 'Message')}>
              <Copy /> Copy message
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
