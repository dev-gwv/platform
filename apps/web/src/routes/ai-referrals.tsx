import { useMemo, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { Gift, Settings2 } from 'lucide-react'
import { AuthedPage } from '@/shared/layout/AuthedPage'
import { PageHeader } from '@/shared/layout/page-header'
import { Button } from '@/shared/ui/button'
import { Card, CardContent } from '@/shared/ui/card'
import { cn } from '@/shared/ui/cn'
import { SkeletonList } from '@/shared/ui/skeleton'
import { ErrorState } from '@/shared/ui/states'
import { useUrlParam } from '@/shared/hooks/use-url-param'
import { useAccess } from '@/shared/auth/useAccess'
import { useCompanyProfile } from '@/features/settings/api'
import { ProjectPicker } from '@/features/projects/ProjectPicker'
import { useProject } from '@/features/projects/api'
import { useProjectCampaign, useReferralCampaigns, useReferralSettings } from '@/features/referrals/api'
import { ReferralCard } from '@/features/referrals/card/ReferralCard'
import { CardPreview, sampleCard } from '@/features/referrals/card/CardPreview'

export function AiReferralsPage() {
  return (
    <AuthedPage module="referrals">
      <PageHeader
        title="Referral cards"
        actions={
          <Button variant="outline" asChild>
            <Link to="/referrals">
              <Settings2 /> Offers, rewards & friends
            </Link>
          </Button>
        }
      />
      <CardMaker />
    </AuthedPage>
  )
}

/**
 * Referral cards in one place (owner audit, 10 Nov: "the card is not even
 * showing up"): pick a client and their card is there to change and send;
 * clients who already have one are one tap away. Before a pick, a sample card
 * in the studio's own defaults shows how it will look.
 */
function CardMaker() {
  const [projectId, setProjectId] = useUrlParam('project')
  const [pickedName, setPickedName] = useState<string | null>(null)
  const campaigns = useReferralCampaigns()
  const recent = useMemo(
    () => (campaigns.data?.campaigns ?? []).filter((c) => c.project_id && c.status !== 'archived').slice(0, 8),
    [campaigns.data],
  )

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardContent className="flex flex-col gap-3 p-4">
          <p className="text-sm font-semibold">Whose card?</p>
          <ProjectPicker
            value={projectId}
            label={pickedName}
            placeholder="Pick a booked client's project"
            onChange={(id, name) => {
              setProjectId(id)
              setPickedName(name)
            }}
            aria-label="Pick a project"
            className={cn(!projectId && 'border-dashed border-amber-400 bg-amber-50/50')}
          />
          {recent.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-xs text-muted-foreground">Cards made:</span>
              {recent.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  aria-pressed={projectId === c.project_id}
                  onClick={() => {
                    setProjectId(c.project_id!)
                    setPickedName(c.project_name)
                  }}
                  className={cn(
                    'rounded-full border px-3 py-1 text-sm transition-colors',
                    projectId === c.project_id ? 'border-violet-600 bg-violet-600 text-white' : 'border-border bg-card hover:border-violet-400',
                  )}
                >
                  {c.client_name ?? c.project_name}
                </button>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
      {projectId ? <ForProject key={projectId} projectId={projectId} /> : <Sample />}
    </div>
  )
}

function ForProject({ projectId }: { projectId: string }) {
  const canEdit = useAccess().hasAction('referrals', 'edit')
  const project = useProject(projectId)
  const campaign = useProjectCampaign(projectId, canEdit)
  if (campaign.isLoading || project.isLoading) return <SkeletonList rows={2} columns={2} />
  if (campaign.isError) return <ErrorState onRetry={() => void campaign.refetch()} />
  if (!campaign.data)
    return (
      <Card>
        <CardContent className="p-6 text-center text-sm text-muted-foreground">
          This project has no referral card yet, and only someone who manages referrals can make one.
        </CardContent>
      </Card>
    )
  return (
    <ReferralCard
      campaign={campaign.data}
      clientName={campaign.data.client_name ?? project.data?.client_name ?? null}
      canEdit={canEdit}
    />
  )
}

/** How it will look: the studio's defaults on a sample couple. */
function Sample() {
  const settings = useReferralSettings()
  const company = useCompanyProfile()
  const s = settings.data
  const studio = company.data?.display_name || company.data?.name || 'Your studio'
  const data = useMemo(
    () =>
      sampleCard(studio, {
        friendType: s?.friend_reward_type ?? 'fixed',
        friendValue: s?.friend_reward_value || 10000,
        friendTitle: s?.friend_reward_title ?? null,
        validDays: s?.valid_days,
      }),
    [studio, s],
  )

  return (
    <Card>
      <CardContent className="grid items-center gap-6 p-4 md:grid-cols-[minmax(0,420px)_minmax(0,1fr)]">
        <CardPreview data={data} look={s?.card_look} className="mx-auto max-w-[420px]" />
        <div className="flex flex-col gap-3">
          <span className="flex size-12 items-center justify-center rounded-xl bg-gradient-to-br from-amber-500 to-rose-500 text-white shadow">
            <Gift className="size-6" aria-hidden />
          </span>
          <p className="text-lg font-semibold">This is how a card looks</p>
          <ul className="flex list-disc flex-col gap-1 pl-5 text-sm text-muted-foreground">
            <li>Pick a client above. Their card opens here, with their name on it.</li>
            <li>Their friend scans it, sends their details and becomes your lead.</li>
            <li>The friend's offer goes on their first invoice; your client's reward falls due when the friend books.</li>
          </ul>
          <p className="text-sm">
            The offer and look shown come from{' '}
            <Link to="/referrals" className="font-medium text-primary underline-offset-2 hover:underline">
              your referral defaults
            </Link>
            .
          </p>
        </div>
      </CardContent>
    </Card>
  )
}
