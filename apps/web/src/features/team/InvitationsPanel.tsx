import { useState } from 'react'
import { MailCheck, Pencil, RotateCw, X } from 'lucide-react'
import { toast } from 'sonner'
import type { AssignableRole } from '@ipc/contracts'
import { Button } from '@/shared/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/ui/card'
import { StatusBadge } from '@/shared/ui/status-badge'
import { Input, Select } from '@/shared/ui/input'
import { humanize } from '@/shared/ui/format'
import { useConfirm } from '@/shared/ui/confirm'
import { useInvitations, useResendInvitation, useRevokeInvitation, useUpdateInvitation } from './api'
import { ROLE_LABEL, useTeamPowers } from './powers'

const dayFormat = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short' })

/** "in 5 days" / "expired" — the only thing an owner needs from that timestamp. */
function expiryLabel(iso: string, expired: boolean): string {
  if (expired) return 'Expired'
  const days = Math.max(0, Math.round((new Date(iso).getTime() - Date.now()) / 86_400_000))
  if (days === 0) return 'Expires today'
  return `Expires in ${days} day${days === 1 ? '' : 's'} · ${dayFormat.format(new Date(iso))}`
}

/**
 * Invitations that have been sent and not yet accepted. Owner-only, and shown
 * even when empty: a studio that just invited someone should see where that
 * went, and an empty panel is the answer to "did it send?".
 */
export function InvitationsPanel() {
  const powers = useTeamPowers()
  const { data, isLoading } = useInvitations()
  const resend = useResendInvitation()
  const revoke = useRevokeInvitation()
  const update = useUpdateInvitation()
  const confirm = useConfirm()
  const [editing, setEditing] = useState<{ id: string; name: string; role: AssignableRole } | null>(null)

  async function onRevoke(id: string, email: string) {
    const yes = await confirm({
      title: `Revoke the invitation to ${email}?`,
      description: 'Their link stops working immediately. You can invite them again afterwards.',
      confirmLabel: 'Revoke',
      destructive: true,
    })
    if (yes) revoke.mutate(id)
  }

  return (
    <Card className="mt-6">
      <CardHeader className="pb-4">
        <CardTitle>Pending invitations</CardTitle>
        <CardDescription>Invited users who haven’t accepted yet.</CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : !data || data.length === 0 ? (
          <p className="text-sm text-muted-foreground">No pending invitations.</p>
        ) : (
          <ul className="divide-y divide-border">
            {data.map((i) =>
              editing?.id === i.id ? (
                <li key={i.id} className="flex flex-wrap items-center gap-2 py-3 first:pt-0 last:pb-0">
                  <Input
                    value={editing.name}
                    onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                    className="h-8 max-w-xs"
                    autoFocus
                  />
                  <Select
                    value={editing.role}
                    onChange={(e) => setEditing({ ...editing, role: e.target.value as AssignableRole })}
                    className="h-8 w-32"
                  >
                    {(['employee', 'manager', 'admin'] as const)
                    .filter((r) => powers.mayGrant(r) || r === editing.role)
                    .map((r) => (
                      <option key={r} value={r} disabled={!powers.mayGrant(r)}>
                        {ROLE_LABEL[r]}
                      </option>
                    ))}
                  </Select>
                  <Button
                    size="sm"
                    disabled={!editing.name.trim() || update.isPending}
                    onClick={() =>
                      update.mutate(
                        { id: i.id, patch: { name: editing.name.trim(), role: editing.role } },
                        { onSuccess: () => setEditing(null) },
                      )
                    }
                  >
                    Save
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setEditing(null)}>
                    Cancel
                  </Button>
                </li>
              ) : (
                <li key={i.id} className="flex flex-wrap items-center gap-3 py-3 first:pt-0 last:pb-0">
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                    <MailCheck className="size-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{i.name}</p>
                    <p className="truncate text-sm text-muted-foreground">{i.email}</p>
                  </div>
                  <StatusBadge tone={i.expired ? 'danger' : 'warning'}>
                    {expiryLabel(i.expires_at, i.expired)}
                  </StatusBadge>
                  <StatusBadge>{humanize(i.role)}</StatusBadge>
                  <div className="flex items-center gap-1">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setEditing({ id: i.id, name: i.name, role: i.role as AssignableRole })}
                    >
                      <Pencil /> Edit
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={resend.isPending}
                      onClick={() =>
                        resend.mutate(i.id, {
                          onSuccess: (res) => {
                            void navigator.clipboard.writeText(res.invite_link)
                            toast.success('New link sent and copied to your clipboard')
                          },
                        })
                      }
                    >
                      <RotateCw /> Resend
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={revoke.isPending}
                      onClick={() => void onRevoke(i.id, i.email)}
                    >
                      <X /> Revoke
                    </Button>
                  </div>
                </li>
              ),
            )}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}
