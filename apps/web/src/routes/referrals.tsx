import { useState } from 'react'
import { AuthedPage } from '@/shared/layout/AuthedPage'
import { PageHeader } from '@/shared/layout/page-header'
import { StatCard } from '@/shared/ui/stat-card'
import { Button } from '@/shared/ui/button'
import { Input } from '@/shared/ui/input'
import { StatusBadge } from '@/shared/ui/status-badge'
import { humanize } from '@/shared/ui/format'
import { Dialog, DialogContent } from '@/shared/ui/dialog'
import { Select } from '@/shared/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/shared/ui/tabs'
import {
  useReferralCampaigns,
  useReferralSubmissions,
  useSaveReferralCampaign,
  useDeleteReferralCampaign,
  useUpdateReferralCampaignStatus,
  useUpdateSubmissionStatus,
} from '@/features/referrals/api'
import { type CreateReferralCampaignRequest, type ReferralCampaignStatus } from '@ipc/contracts'
import { toast } from 'sonner'
import { Plus, Trash2, Pencil, Copy, Trophy, Users, TrendingUp, Target } from 'lucide-react'

function ReferralsContent() {
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState<CreateReferralCampaignRequest>({
    name: '',
    description: null,
    reward_type: 'fixed',
    reward_value: 0,
    reward_description: null,
  })
  // Kept separate from `form.reward_value` (a number, for the request body)
  // so the field displays exactly what was typed instead of fighting a
  // type="number" input's leading-zero quirks.
  const [rewardValueText, setRewardValueText] = useState('0')

  const { data: campaignData } = useReferralCampaigns()
  const { data: submissionData, fetchNextPage, hasNextPage, isFetchingNextPage } = useReferralSubmissions()
  const saveCampaign = useSaveReferralCampaign()
  const deleteCampaign = useDeleteReferralCampaign()
  const updateCampaignStatus = useUpdateReferralCampaignStatus()
  const updateStatus = useUpdateSubmissionStatus()

  const campaigns = campaignData?.campaigns ?? []
  const summary = campaignData?.summary
  const submissions = submissionData?.pages.flatMap((p) => p.items) ?? []

  function openCreate() {
    setEditingId(null)
    setForm({ name: '', description: null, reward_type: 'fixed', reward_value: 0, reward_description: null })
    setRewardValueText('0')
    setDialogOpen(true)
  }

  function openEdit(campaign: (typeof campaigns)[0]) {
    setEditingId(campaign.id)
    setForm({
      name: campaign.name,
      description: campaign.description,
      reward_type: campaign.reward_type as CreateReferralCampaignRequest['reward_type'],
      reward_value: campaign.reward_value,
      reward_description: campaign.reward_description,
    })
    setRewardValueText(String(campaign.reward_value))
    setDialogOpen(true)
  }

  function handleSubmit() {
    if (!form.name.trim()) return
    saveCampaign.mutate(
      { id: editingId ?? undefined, body: form },
      { onSuccess: () => setDialogOpen(false) },
    )
  }

  const statusTone: Record<string, 'warning' | 'info' | 'success' | 'danger'> = {
    pending: 'warning',
    converted: 'info',
    rewarded: 'success',
    rejected: 'danger',
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Referral Campaigns"
        description="Manage referral campaigns and track submissions"
        actions={
          <Button onClick={openCreate} size="sm">
            <Plus className="mr-1 h-4 w-4" /> New Campaign
          </Button>
        }
      />

      {summary && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard label="Total Campaigns" value={summary.total_campaigns} icon={Trophy} />
          <StatCard label="Active Campaigns" value={summary.active_campaigns} icon={Target} />
          <StatCard label="Total Submissions" value={summary.total_submissions} icon={Users} />
          <StatCard label="Converted" value={summary.converted_submissions} icon={TrendingUp} />
        </div>
      )}

      <Tabs defaultValue="campaigns">
        <TabsList>
          <TabsTrigger value="campaigns">Campaigns</TabsTrigger>
          <TabsTrigger value="submissions">Submissions</TabsTrigger>
        </TabsList>

        <TabsContent value="campaigns" className="space-y-4">
          {campaigns.map((campaign) => (
            <div
              key={campaign.id}
              className="flex items-center justify-between rounded-lg border bg-card p-4 transition-colors hover:bg-accent/50"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-medium">{campaign.name}</span>
                </div>
                {campaign.description && (
                  <p className="mt-1 truncate text-sm text-muted-foreground">{campaign.description}</p>
                )}
                <p className="mt-1 text-xs text-muted-foreground">
                  Reward: {campaign.reward_type} — ₹{campaign.reward_value.toLocaleString()}
                </p>
              </div>
              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  title="Copy the link to share with a client"
                  onClick={() => {
                    void navigator.clipboard.writeText(`${window.location.origin}/refer/${campaign.slug}`)
                    toast.success('Referral link copied')
                  }}
                >
                  <Copy className="h-4 w-4" />
                </Button>
                <Button variant="ghost" size="icon" className="h-8 w-8" title="Edit campaign" onClick={() => openEdit(campaign)}>
                  <Pencil className="h-4 w-4" />
                </Button>
                <Select
                  value={campaign.status}
                  onChange={(e) =>
                    updateCampaignStatus.mutate({ id: campaign.id, status: e.target.value as ReferralCampaignStatus })
                  }
                  className="h-8 w-24"
                  aria-label={`Status for ${campaign.name}`}
                >
                  <option value="active">Active</option>
                  <option value="paused">Paused</option>
                  <option value="ended">Ended</option>
                </Select>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-destructive"
                  onClick={() => { if (confirm('Delete this campaign?')) deleteCampaign.mutate(campaign.id) }}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>
          ))}
          {campaigns.length === 0 && (
            <div className="py-12 text-center text-muted-foreground">No campaigns yet.</div>
          )}
        </TabsContent>

        <TabsContent value="submissions" className="space-y-4">
          {submissions.map((sub) => (
            <div
              key={sub.id}
              className="rounded-lg border bg-card p-4 transition-colors hover:bg-accent/50"
            >
              <div className="flex items-center justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{sub.client_name}</span>
                    <StatusBadge tone={statusTone[sub.status] ?? 'neutral'}>{humanize(sub.status)}</StatusBadge>
                    {sub.reward_granted && <StatusBadge tone="success">Rewarded</StatusBadge>}
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Campaign: {sub.campaign_name}
                    {sub.referrer_name ? ` · Referred by: ${sub.referrer_name}` : ''}
                  </p>
                  {sub.client_phone && (
                    <p className="text-xs text-muted-foreground">Phone: {sub.client_phone}</p>
                  )}
                  {(sub.event_type || sub.event_date || sub.functions_count != null) && (
                    <p className="text-xs text-muted-foreground">
                      {[
                        sub.event_type,
                        sub.event_date && new Date(sub.event_date).toLocaleDateString(),
                        sub.functions_count != null && `${sub.functions_count} function${sub.functions_count === 1 ? '' : 's'}`,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </p>
                  )}
                </div>
                <Select value={sub.status} onChange={(e) => updateStatus.mutate({ id: sub.id, status: e.target.value })} className="w-32">
                  <option value="pending">Pending</option>
                  <option value="converted">Converted</option>
                  <option value="rewarded">Rewarded</option>
                  <option value="rejected">Rejected</option>
                </Select>
              </div>
            </div>
          ))}
          {submissions.length === 0 && (
            <div className="py-12 text-center text-muted-foreground">No submissions yet.</div>
          )}
          {hasNextPage && (
            <Button
              variant="outline"
              className="w-full"
              onClick={() => fetchNextPage()}
              disabled={isFetchingNextPage}
            >
              {isFetchingNextPage ? 'Loading...' : 'Load more'}
            </Button>
          )}
        </TabsContent>
      </Tabs>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent title={editingId ? 'Edit Campaign' : 'New Campaign'}>
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium">Campaign Name</label>
              <Input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="e.g. Wedding Season Referral"
              />
            </div>
            <div>
              <label className="text-sm font-medium">Description</label>
              <Input
                value={form.description ?? ''}
                onChange={(e) => setForm({ ...form, description: e.target.value || null })}
                placeholder="Optional description"
              />
            </div>
            <div>
              <label className="text-sm font-medium">Reward Type</label>
              <Select value={form.reward_type} onChange={(e) => setForm({ ...form, reward_type: e.target.value as CreateReferralCampaignRequest['reward_type'] })}>
                <option value="fixed">Fixed Amount</option>
                <option value="percentage">Percentage</option>
                <option value="credit">Credit</option>
                <option value="custom">Custom</option>
              </Select>
            </div>
            <div>
              <label className="text-sm font-medium">Reward Value (₹)</label>
              <Input
                inputMode="decimal"
                value={rewardValueText}
                onChange={(e) => {
                  setRewardValueText(e.target.value)
                  setForm({ ...form, reward_value: Number(e.target.value) || 0 })
                }}
              />
            </div>
            <div>
              <label className="text-sm font-medium">Reward description (optional)</label>
              <Input
                value={form.reward_description ?? ''}
                onChange={(e) => setForm({ ...form, reward_description: e.target.value || null })}
                placeholder="Shown on the public referral page — defaults to a sensible message if left blank"
              />
            </div>
          </div>
          <div className="mt-6 flex justify-end gap-2">
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleSubmit} disabled={!form.name.trim() || saveCampaign.isPending}>
              {saveCampaign.isPending ? 'Saving...' : 'Save'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}

export function ReferralsPage() {
  return (
    <AuthedPage module="referrals">
      <ReferralsContent />
    </AuthedPage>
  )
}
