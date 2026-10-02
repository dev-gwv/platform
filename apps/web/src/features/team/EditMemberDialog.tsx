import { useMemo, useState } from 'react'
import { Pencil } from 'lucide-react'
import type { DirectoryMember, ProductionStage } from '@ipc/contracts'
import { useFormDraft, DraftRestoredBanner } from '@/shared/hooks/use-form-draft'
import { Button } from '@/shared/ui/button'
import { Card, CardContent } from '@/shared/ui/card'
import { Dialog, DialogClose, DialogContent, DialogTrigger } from '@/shared/ui/dialog'
import { Input, Label, Select } from '@/shared/ui/input'
import { useUpdateMember, useAssignRoles, useCreateRole, useEmployeeRoles, useRoleLibrary } from './api'
import { pickableRoles, type PickableRole } from './bulk'
import { JobRolePicker } from './JobRolePicker'
import { CompensationFields, type CompensationDraft } from './CompensationFields'
import { ROLE_LABEL, useTeamPowers } from './powers'
import { toRoleCode } from './role-stages'

/** The pay fields as they are on record, for the form to start from. */
function compFrom(member: DirectoryMember): CompensationDraft {
  return {
    payment_type: member.payment_type ?? '',
    pay_components: member.pay_components,
    payment_status: member.payment_status,
    salary: member.salary != null ? String(member.salary) : '',
    freelancer_rate: member.freelancer_rate != null ? String(member.freelancer_rate) : '',
    rate_wedding_day: member.rate_wedding_day != null ? String(member.rate_wedding_day) : '',
    rate_half_day: member.rate_half_day != null ? String(member.rate_half_day) : '',
    has_login_access: member.login_enabled,
    payout_type: member.payout_type ?? '',
    commission_pct: member.commission_pct != null ? String(member.commission_pct) : '',
    commission_basis: member.commission_basis ?? '',
    stipend_amount: member.stipend_amount != null ? String(member.stipend_amount) : '',
    pay_effective_from: member.pay_effective_from ?? '',
    pay_effective_to: member.pay_effective_to ?? '',
    compensation_notes: member.compensation_notes ?? '',
  }
}

/**
 * Everything about a team member the create wizard could set, editable
 * afterwards: this is the same field set, not a trimmed-down version of it.
 * Pay is its own section since it's owner-only and most edits here are
 * contact-detail fixes, not salary revisions.
 */
export function EditMemberDialog({ member }: { member: DirectoryMember }) {
  const powers = useTeamPowers()
  const update = useUpdateMember()
  const assignRoles = useAssignRoles()
  const { data: roles } = useEmployeeRoles()
  const [open, setOpen] = useState(false)

  const [name, setName] = useState(member.name)
  const [phone, setPhone] = useState(member.phone ?? '')
  const [alternatePhone, setAlternatePhone] = useState(member.alternate_phone ?? '')
  const [address, setAddress] = useState(member.address ?? '')
  const [role, setRole] = useState(member.role as 'super_admin' | 'admin' | 'manager' | 'employee')
  const [engagementType, setEngagementType] = useState<'in_house' | 'freelancer'>(
    member.engagement_type === 'freelancer' ? 'freelancer' : 'in_house',
  )
  const [roleIds, setRoleIds] = useState<string[]>(member.role_ids)
  const createRole = useCreateRole()
  const { data: library } = useRoleLibrary()
  const pickable = useMemo(
    () => pickableRoles(roles ?? [], powers.canAddJobRoles ? (library ?? []) : []),
    [roles, library, powers.canAddJobRoles],
  )

  // A default or a role the studio doesn't have yet is made here and ticked,
  // rather than sending the owner off to settings mid-edit.
  const pickRole = async (r: PickableRole): Promise<string> =>
    r.owned ? r.key : (await createRole.mutateAsync({ type_name: r.type_name, role_code: r.role_code, stage: r.stage })).id
  const addRole = async (name: string, stage: ProductionStage): Promise<string> =>
    (await createRole.mutateAsync({ type_name: name, role_code: toRoleCode(name), stage })).id

  const [comp, setComp] = useState<CompensationDraft>(() => compFrom(member))
  function setCompField<K extends keyof CompensationDraft>(key: K, value: CompensationDraft[K]) {
    setComp((prev) => ({ ...prev, [key]: value }))
  }

  const [error, setError] = useState<string | null>(null)

  // What was typed survives a refresh or a closed tab until it is saved.
  const draft = useFormDraft(
    open ? `edit-member:${member.user_id}` : null,
    { name, phone, alternatePhone, address, role, engagementType, roleIds, comp },
    (v) => {
      setName(v.name)
      setPhone(v.phone)
      setAlternatePhone(v.alternatePhone)
      setAddress(v.address)
      setRole(v.role)
      setEngagementType(v.engagementType)
      setRoleIds(v.roleIds)
      setComp(v.comp)
    },
  )

  // "Start fresh" goes back to what is on record for this person.
  function discardDraft() {
    draft.clear()
    setName(member.name)
    setPhone(member.phone ?? '')
    setAlternatePhone(member.alternate_phone ?? '')
    setAddress(member.address ?? '')
    setRole(member.role as typeof role)
    setEngagementType(member.engagement_type === 'freelancer' ? 'freelancer' : 'in_house')
    setRoleIds(member.role_ids)
    setComp(compFrom(member))
  }

  async function onSave() {
    setError(null)
    try {
      // Pay goes only from someone who handles salaries, and the role only
      // when it changed -- the server checks both against who is asking.
      const pay = {
        salary: comp.salary.trim() === '' ? null : Number(comp.salary),
        freelancer_rate: comp.freelancer_rate.trim() === '' ? null : Number(comp.freelancer_rate),
        rate_wedding_day: !comp.rate_wedding_day?.trim() ? null : Number(comp.rate_wedding_day),
        rate_half_day: !comp.rate_half_day?.trim() ? null : Number(comp.rate_half_day),
        payout_type: comp.payout_type ? (comp.payout_type as NonNullable<typeof member.payout_type>) : null,
        commission_pct: comp.commission_pct.trim() === '' ? null : Number(comp.commission_pct),
        commission_basis: comp.commission_basis
          ? (comp.commission_basis as NonNullable<typeof member.commission_basis>)
          : null,
        stipend_amount: comp.stipend_amount.trim() === '' ? null : Number(comp.stipend_amount),
        pay_effective_from: comp.pay_effective_from || null,
        pay_effective_to: comp.pay_effective_to || null,
        compensation_notes: comp.compensation_notes.trim() || null,
        payment_type: comp.payment_type.trim() || null,
        pay_components: comp.pay_components,
        payment_status: comp.payment_status,
      }
      await update.mutateAsync({
        userId: member.user_id,
        patch: {
          name: name.trim(),
          phone: phone.trim() || null,
          alternate_phone: alternatePhone.trim() || null,
          address: address.trim() || null,
          ...(role === 'super_admin' || role === member.role ? {} : { role }),
          engagement_type: engagementType,
          ...(powers.canPay ? pay : {}),
        },
      })
      const currentIds = new Set(member.role_ids)
      const nextIds = new Set(roleIds)
      const changed = currentIds.size !== nextIds.size || [...currentIds].some((id) => !nextIds.has(id))
      if (changed) await assignRoles.mutateAsync({ userId: member.user_id, roles: { role_ids: roleIds } })
      draft.clear()
      setOpen(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save these changes.')
    }
  }

  const busy = update.isPending || assignRoles.isPending

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="ghost" title={`Edit ${member.name}`}>
          <Pencil />
          Edit
          <span className="sr-only"> {member.name}</span>
        </Button>
      </DialogTrigger>
      <DialogContent title={`Edit ${member.name}`} description="Anything set when they joined can be corrected here.">
        <div className="flex max-h-[70vh] flex-col gap-4 overflow-y-auto pr-1">
          <DraftRestoredBanner at={draft.restoredAt} onDismiss={draft.dismissRestored} onDiscard={discardDraft} />
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label>Name</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Phone</Label>
              <Input value={phone} onChange={(e) => setPhone(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Alternate phone</Label>
              <Input value={alternatePhone} onChange={(e) => setAlternatePhone(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Engagement</Label>
              <Select value={engagementType} onChange={(e) => setEngagementType(e.target.value as 'in_house' | 'freelancer')}>
                <option value="in_house">In-house staff</option>
                <option value="freelancer">Freelancer / Vendor</option>
              </Select>
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>Address</Label>
            <Input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="City or full address" />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>Access level</Label>
            <Select value={role} onChange={(e) => setRole(e.target.value as typeof role)} disabled={role === 'super_admin'}>
              {role === 'super_admin' && <option value="super_admin">Owner</option>}
              {(['admin', 'manager', 'employee'] as const)
                .filter((r) => powers.mayGrant(r) || r === member.role)
                .map((r) => (
                  <option key={r} value={r} disabled={!powers.mayGrant(r) && r !== member.role}>
                    {ROLE_LABEL[r]}
                  </option>
                ))}
            </Select>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>Job roles</Label>
            <JobRolePicker
              pickable={pickable}
              chosen={roleIds}
              onChange={setRoleIds}
              onPick={pickRole}
              onCreate={powers.canAddJobRoles ? addRole : undefined}
              compact
            />
          </div>

          <hr className="border-border" />

          {powers.canPay && <CompensationFields value={comp} onChange={setCompField} effectiveFromRequired={false} />}

          <Card>
            <CardContent className="p-3 text-xs text-muted-foreground">
              Active / inactive and removing this person happen from the row actions, not here.
            </CardContent>
          </Card>

          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <div className="mt-3 flex justify-end gap-2">
          <DialogClose asChild>
            <Button type="button" variant="outline">
              Cancel
            </Button>
          </DialogClose>
          <Button type="button" onClick={() => void onSave()} disabled={busy || !name.trim()}>
            {busy ? 'Saving…' : 'Save changes'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
