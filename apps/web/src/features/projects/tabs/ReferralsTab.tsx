import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { Copy, ExternalLink, Gift, Link2, MessageCircle, Phone, Users } from 'lucide-react'
import { toast } from 'sonner'
import { buildWhatsAppUrl, type ReferralCampaign, type ReferralRewardType, type ReferralSubmission } from '@ipc/contracts'
import { Button } from '@/shared/ui/button'
import { Card, CardContent } from '@/shared/ui/card'
import { Input, Label, Textarea } from '@/shared/ui/input'
import { SkeletonList } from '@/shared/ui/skeleton'
import { ErrorState } from '@/shared/ui/states'
import { StatusBadge } from '@/shared/ui/status-badge'
import { cn } from '@/shared/ui/cn'
import { useCompanyProfile } from '@/features/settings/api'
import {
  useProjectCampaign,
  useReferralSubmissions,
  useSaveReferralCampaign,
  useUpdateSubmissionStatus,
} from '@/features/referrals/api'

/** The rewards a studio offers, in its words (the old app's list). */
const REWARDS: { key: ReferralRewardType; label: string }[] = [
  { key: 'cashback', label: 'Cashback' },
  { key: 'free_pre_wedding', label: 'Free pre-wedding shoot' },
  { key: 'free_maternity', label: 'Free maternity shoot' },
  { key: 'extra_album', label: 'Extra album' },
  { key: 'discount', label: 'Discount' },
  { key: 'custom', label: 'Something else' },
]

const STATUS: Record<string, { label: string; tone: 'neutral' | 'warning' | 'info' | 'success' | 'danger' }> = {
  new: { label: 'New', tone: 'warning' },
  pending: { label: 'New', tone: 'warning' },
  contacted: { label: 'Contacted', tone: 'info' },
  booked: { label: 'Booked', tone: 'success' },
  converted: { label: 'Booked', tone: 'success' },
  rewarded: { label: 'Booked', tone: 'success' },
  rejected: { label: 'Not interested', tone: 'neutral' },
  duplicate: { label: 'Duplicate', tone: 'neutral' },
}
const REWARD_STATUS: Record<string, { label: string; tone: 'neutral' | 'warning' | 'success' }> = {
  not_due: { label: 'Reward after booking', tone: 'neutral' },
  due: { label: 'Reward due', tone: 'warning' },
  given: { label: 'Reward given', tone: 'success' },
  cancelled: { label: 'No reward', tone: 'neutral' },
}

async function copy(text: string, what: string) {
  try {
    await navigator.clipboard.writeText(text)
    toast.success(`${what} copied`)
  } catch {
    toast.error('Could not copy — select it and copy by hand')
  }
}

/**
 * This project's referrals, as the old app's tab had them: the reward the
 * client was promised, the link and two ready messages to send, and the
 * friends who came through it -- with who has been called, who booked, and
 * whether the client has had their reward. Every campaign is also on the
 * Referrals page.
 */
export function ReferralsTab({
  projectId,
  projectName,
  clientName,
  clientPhone,
  canEdit,
}: {
  projectId: string
  projectName: string
  clientName: string | null
  clientPhone: string | null
  canEdit: boolean
}) {
  const campaign = useProjectCampaign(projectId, canEdit)

  if (campaign.isLoading) return <SkeletonList rows={3} columns={2} />
  if (campaign.isError) return <ErrorState onRetry={() => void campaign.refetch()} />
  if (!campaign.data) {
    return (
      <Card className="mt-4">
        <CardContent className="p-6 text-center text-sm text-muted-foreground">
          No referral link for {projectName} yet. Someone who manages referrals can set one up here.
        </CardContent>
      </Card>
    )
  }
  return (
    <div className="mt-4 flex flex-col gap-4">
      <RewardCard campaign={campaign.data} canEdit={canEdit} />
      <ShareCard campaign={campaign.data} projectName={projectName} clientName={clientName} clientPhone={clientPhone} />
      <Received campaign={campaign.data} canEdit={canEdit} />
    </div>
  )
}

function rewardText(c: ReferralCampaign): string | null {
  return c.reward_title?.trim() || c.reward_description?.trim() || null
}

function RewardCard({ campaign: c, canEdit }: { campaign: ReferralCampaign; canEdit: boolean }) {
  const save = useSaveReferralCampaign()
  const reward = rewardText(c)
  const [editing, setEditing] = useState(false)
  const [type, setType] = useState<ReferralRewardType>(c.reward_type)
  const [title, setTitle] = useState(c.reward_title ?? '')
  const [details, setDetails] = useState(c.reward_description ?? '')

  const onSave = () =>
    save.mutate(
      {
        id: c.id,
        body: {
          name: c.name,
          description: c.description,
          reward_type: type,
          reward_value: c.reward_value,
          reward_description: details.trim() || null,
          reward_title: title.trim() || null,
        },
      },
      { onSuccess: () => setEditing(false) },
    )

  return (
    <Card className={cn(!reward && 'border-tone-amber/50')}>
      <CardContent className="flex flex-col gap-3 p-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <p className="flex items-center gap-2 text-sm font-semibold">
              <Gift className="size-4 text-muted-foreground" aria-hidden /> Referral reward
            </p>
            <p className="mt-0.5 text-sm text-muted-foreground">
              {reward ? (
                <>
                  <span className="font-medium text-foreground">{reward}</span>
                  {c.reward_type !== 'custom' && ` · ${REWARDS.find((r) => r.key === c.reward_type)?.label ?? 'Reward'}`}
                </>
              ) : (
                'Say what the client gets when a friend books — it goes into the messages below.'
              )}
            </p>
          </div>
          {canEdit && !editing && (
            <Button size="sm" variant={reward ? 'outline' : 'default'} onClick={() => setEditing(true)}>
              {reward ? 'Edit reward' : 'Set the reward'}
            </Button>
          )}
        </div>
        {editing && (
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap gap-1.5">
              {REWARDS.map((r) => (
                <button
                  key={r.key}
                  type="button"
                  onClick={() => setType(r.key)}
                  aria-pressed={type === r.key}
                  className={cn(
                    'rounded-full border px-3 py-1 text-sm',
                    type === r.key ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-card hover:border-primary/50',
                  )}
                >
                  {r.label}
                </button>
              ))}
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`reward-title-${c.id}`}>The reward, in a few words</Label>
              <Input
                id={`reward-title-${c.id}`}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. ₹5,000 cashback"
                maxLength={160}
                className={cn(!title.trim() && 'border-tone-amber/60 bg-tone-amber-soft/30')}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`reward-details-${c.id}`}>Details (optional)</Label>
              <Textarea
                id={`reward-details-${c.id}`}
                rows={2}
                value={details}
                onChange={(e) => setDetails(e.target.value)}
                placeholder="When it is given, any conditions"
                maxLength={200}
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setEditing(false)}>
                Cancel
              </Button>
              <Button size="sm" disabled={save.isPending || !title.trim()} onClick={onSave}>
                {save.isPending ? 'Saving…' : 'Save reward'}
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function ShareCard({
  campaign: c,
  projectName,
  clientName,
  clientPhone,
}: {
  campaign: ReferralCampaign
  projectName: string
  clientName: string | null
  clientPhone: string | null
}) {
  const company = useCompanyProfile()
  const studio = company.data?.display_name || company.data?.name || 'our studio'
  const url = `${window.location.origin}/refer/${c.slug}`
  const reward = rewardText(c)
  const first = (clientName ?? '').split(' ')[0] || 'there'
  const toClient = `Hi ${first}, thank you for choosing ${studio} for ${projectName}! If a friend or family member is planning their wedding, please share this link with them${reward ? ` — when they book with us, you get ${reward}` : ''}: ${url}`
  const toFriends = `Planning a wedding? ${clientName ?? 'My family'} recommends ${studio}. Leave your details here and they will call you: ${url}`
  return (
    <Card>
      <CardContent className="flex flex-col gap-3 p-4">
        <p className="flex items-center gap-2 text-sm font-semibold">
          <Link2 className="size-4 text-muted-foreground" aria-hidden /> Share the referral link
        </p>
        <div className="flex items-center gap-2 rounded-lg border border-dashed border-border bg-muted/30 p-2">
          <span className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground" title={url}>
            {url}
          </span>
          <Button size="sm" variant="ghost" onClick={() => void copy(url, 'Link')}>
            <Copy /> Copy
          </Button>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          <Message
            title={`Message to ${clientName ?? 'the client'}`}
            text={toClient}
            whatsapp={buildWhatsAppUrl(clientPhone, toClient)}
            whatsappLabel={clientPhone ? `WhatsApp ${first}` : 'WhatsApp'}
          />
          <Message title={`For ${first} to forward to friends`} text={toFriends} whatsapp={buildWhatsAppUrl(null, toFriends)} whatsappLabel="WhatsApp" />
        </div>
      </CardContent>
    </Card>
  )
}

function Message({ title, text, whatsapp, whatsappLabel }: { title: string; text: string; whatsapp: string; whatsappLabel: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-xs font-medium text-muted-foreground">{title}</p>
      <p className="whitespace-pre-wrap rounded-lg border border-border bg-card p-2.5 text-sm">{text}</p>
      <div className="flex gap-2">
        <Button size="sm" variant="outline" onClick={() => void copy(text, 'Message')}>
          <Copy /> Copy
        </Button>
        <Button size="sm" asChild className="bg-[#25D366] text-white hover:bg-[#1ebe57]">
          <a href={whatsapp} target="_blank" rel="noreferrer noopener">
            <MessageCircle /> {whatsappLabel}
          </a>
        </Button>
      </div>
    </div>
  )
}

function Received({ campaign: c, canEdit }: { campaign: ReferralCampaign; canEdit: boolean }) {
  const subs = useReferralSubmissions(c.id)
  const items: ReferralSubmission[] = (subs.data?.pages ?? []).flatMap((p) => p.items)
  return (
    <Card>
      <CardContent className="flex flex-col gap-3 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="flex items-center gap-2 text-sm font-semibold">
            <Users className="size-4 text-muted-foreground" aria-hidden /> Friends who came through this link
            {items.length > 0 && <span className="text-muted-foreground">· {items.length}</span>}
          </p>
          <Link to="/referrals" className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">
            All referrals <ExternalLink className="size-3" aria-hidden />
          </Link>
        </div>
        {subs.isLoading ? (
          <SkeletonList rows={2} columns={3} />
        ) : items.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nobody yet. When a friend fills in the link, they show up here and in your leads.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-border">
            {items.map((s) => (
              <SubmissionRow key={s.id} s={s} canEdit={canEdit} />
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}

function SubmissionRow({ s, canEdit }: { s: ReferralSubmission; canEdit: boolean }) {
  const update = useUpdateSubmissionStatus()
  const name = s.referred_name ?? s.client_name
  const phone = s.referred_phone ?? s.client_phone
  const st = STATUS[s.status] ?? { label: s.status, tone: 'neutral' as const }
  const rw = REWARD_STATUS[s.reward_status] ?? REWARD_STATUS.not_due!
  const booked = ['booked', 'converted', 'rewarded'].includes(s.status)
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-2 py-2.5">
      <div className="min-w-[12rem] flex-1">
        <p className="text-sm font-medium">{name}</p>
        <p className="text-xs text-muted-foreground">
          {[
            phone,
            s.event_type,
            s.event_date ? new Date(`${s.event_date}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : null,
          ]
            .filter(Boolean)
            .join(' · ')}
        </p>
      </div>
      <StatusBadge tone={st.tone}>{st.label}</StatusBadge>
      <StatusBadge tone={rw.tone}>{rw.label}</StatusBadge>
      <div className="flex flex-wrap gap-1.5">
        {phone && (
          <Button size="sm" variant="ghost" asChild>
            <a href={`tel:${phone}`} aria-label={`Call ${name}`}>
              <Phone />
            </a>
          </Button>
        )}
        {canEdit && !booked && s.status !== 'contacted' && (
          <Button size="sm" variant="outline" disabled={update.isPending} onClick={() => update.mutate({ id: s.id, status: 'contacted' })}>
            Called them
          </Button>
        )}
        {canEdit && !booked && (
          <Button size="sm" variant="outline" disabled={update.isPending} onClick={() => update.mutate({ id: s.id, status: 'booked', reward_status: 'due' })}>
            They booked
          </Button>
        )}
        {canEdit && booked && s.reward_status !== 'given' && (
          <Button size="sm" disabled={update.isPending} onClick={() => update.mutate({ id: s.id, reward_status: 'given' })}>
            Reward given
          </Button>
        )}
      </div>
    </li>
  )
}
