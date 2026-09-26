import { useState } from 'react'
import { Loader2, UserPlus } from 'lucide-react'
import { toast } from 'sonner'
import { addMemberRequest, type EngagementType } from '@ipc/contracts'
import { ApiError } from '@/shared/api/client'
import { useFormDraft } from '@/shared/hooks/use-form-draft'
import { Button } from '@/shared/ui/button'
import { Dialog, DialogContent, DialogFooter } from '@/shared/ui/dialog'
import { Input, Label, Select } from '@/shared/ui/input'
import { useAddMember, useCreateRole, useEmployeeRoles } from '@/features/team/api'
import { stageOf } from '@/features/team/role-stages'

const slug = (s: string) =>
  s
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40) || 'role'

/**
 * Add someone to the team without leaving the shoot.
 *
 * The usual case is a freelancer the studio has just hired for this day and
 * nobody has entered yet. They are added directory-only (no login -- that can
 * be set up later from Team), with the requirement being filled as their job
 * role, and selected in the picker straight away.
 */
export function QuickAddMemberDialog({
  requirement,
  onClose,
  onCreated,
}: {
  requirement: string
  onClose: () => void
  onCreated: (userId: string) => void
}) {
  const add = useAddMember()
  const roles = useEmployeeRoles()
  const createRole = useCreateRole()
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [engagement, setEngagement] = useState<EngagementType>('freelancer')
  const [rate, setRate] = useState('')
  const [giveRole, setGiveRole] = useState(!!requirement)
  // What was typed survives a refresh or a closed tab until it is saved.
  const draft = useFormDraft(`quick-add-member:${requirement || 'any'}`, { name, phone, email, engagement, rate, giveRole }, (v) => {
    setName(v.name)
    setPhone(v.phone)
    setEmail(v.email)
    setEngagement(v.engagement)
    setRate(v.rate)
    setGiveRole(v.giveRole)
  })
  const busy = add.isPending || createRole.isPending

  const phoneOk = phone.replace(/\D/g, '').length >= 6
  const valid = name.trim().length >= 2 && phoneOk

  async function submit() {
    if (!valid) return
    try {
      let roleIds: string[] = []
      if (giveRole && requirement) {
        const have = (roles.data ?? []).find((r) => r.type_name.trim().toLowerCase() === requirement.trim().toLowerCase())
        if (have) roleIds = [have.id]
        else {
          // Still add the person if the role cannot be made (a clashing code,
          // say) -- the role can be given from Team later; the person is the
          // thing the planner is waiting on.
          const made = await createRole
            .mutateAsync({
              type_name: requirement.trim().slice(0, 60),
              role_code: slug(requirement),
              stage: stageOf({ type_name: requirement, stage: null }),
            })
            .catch(() => null)
          if (made) roleIds = [made.id]
        }
      }
      const amount = rate.trim() ? Number(rate) : undefined
      const out = await add.mutateAsync(
        addMemberRequest.parse({
          name: name.trim(),
          phone: phone.trim(),
          ...(email.trim() ? { email: email.trim() } : {}),
          create_login: false,
          engagement_type: engagement,
          role: 'employee',
          role_ids: roleIds,
          ...(engagement === 'freelancer' && amount !== undefined && Number.isFinite(amount) && amount > 0
            ? { freelancer_rate: amount, payout_type: 'per_shoot' }
            : {}),
        }),
      )
      draft.clear()
      onCreated(out.user_id)
    } catch (e) {
      // The mutation hooks toast the server's own failures; what reaches here
      // otherwise is the form not parsing -- in practice, a mistyped email.
      if (!(e instanceof ApiError)) toast.error('Please check the details — the email may be mistyped.')
    }
  }

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent
        title="Add a team member"
        description="Added to your team without a sign-in. You can give them one later from Team."
      >
        <div className="flex flex-col gap-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="qa-name">
                Name <span className="text-destructive">*</span>
              </Label>
              <Input id="qa-name" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="qa-phone">
                Phone <span className="text-destructive">*</span>
              </Label>
              <Input id="qa-phone" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="qa-email">Email</Label>
              <Input id="qa-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Optional" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="qa-eng">Works as</Label>
              <Select id="qa-eng" value={engagement} onChange={(e) => setEngagement(e.target.value as EngagementType)}>
                <option value="freelancer">Per shoot</option>
                <option value="in_house">On salary</option>
              </Select>
            </div>
            {engagement === 'freelancer' && (
              <div className="flex flex-col gap-1.5 sm:col-span-2">
                <Label htmlFor="qa-rate">Rate per shoot (₹)</Label>
                <Input
                  id="qa-rate"
                  inputMode="decimal"
                  value={rate}
                  onChange={(e) => setRate(e.target.value.replace(/[^\d.]/g, ''))}
                  placeholder="Optional — pre-fills their payout on every booking"
                />
              </div>
            )}
          </div>
          {requirement && (
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={giveRole} onChange={(e) => setGiveRole(e.target.checked)} />
              Give them the job role “{requirement}”
            </label>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!valid || busy} onClick={() => void submit()}>
            {busy ? <Loader2 className="animate-spin" /> : <UserPlus />} Add and select
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
