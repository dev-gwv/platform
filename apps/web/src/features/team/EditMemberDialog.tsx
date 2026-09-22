import { useState } from 'react'
import { Pencil } from 'lucide-react'
import type { DirectoryMember } from '@ipc/contracts'
import { Button } from '@/shared/ui/button'
import { Card, CardContent } from '@/shared/ui/card'
import { Dialog, DialogClose, DialogContent, DialogTrigger } from '@/shared/ui/dialog'
import { Input, Label, Select } from '@/shared/ui/input'
import { useUpdateMember, useAssignRoles, useEmployeeRoles } from './api'
import { CompensationFields, type CompensationDraft } from './CompensationFields'
import { byStage } from './role-stages'

/**
 * Everything about a team member the create wizard could set, editable
 * afterwards: this is the same field set, not a trimmed-down version of it.
 * Pay is its own section since it's owner-only and most edits here are
 * contact-detail fixes, not salary revisions.
 */
export function EditMemberDialog({ member }: { member: DirectoryMember }) {
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

  const [comp, setComp] = useState<CompensationDraft>({
    payment_type: member.payment_type ?? '',
    pay_components: member.pay_components,
    payment_status: member.payment_status,
    salary: member.salary != null ? String(member.salary) : '',
    freelancer_rate: member.freelancer_rate != null ? String(member.freelancer_rate) : '',
    has_login_access: member.login_enabled,
    payout_type: member.payout_type ?? '',
    commission_pct: member.commission_pct != null ? String(member.commission_pct) : '',
    commission_basis: member.commission_basis ?? '',
    stipend_amount: member.stipend_amount != null ? String(member.stipend_amount) : '',
    pay_effective_from: member.pay_effective_from ?? '',
    pay_effective_to: member.pay_effective_to ?? '',
    compensation_notes: member.compensation_notes ?? '',
  })
  function setCompField<K extends keyof CompensationDraft>(key: K, value: CompensationDraft[K]) {
    setComp((prev) => ({ ...prev, [key]: value }))
  }

  const [error, setError] = useState<string | null>(null)

  function toggleRole(id: string) {
    setRoleIds((prev) => (prev.includes(id) ? prev.filter((r) => r !== id) : [...prev, id]))
  }

  async function onSave() {
    setError(null)
    try {
      await update.mutateAsync({
        userId: member.user_id,
        patch: {
          name: name.trim(),
          phone: phone.trim() || null,
          alternate_phone: alternatePhone.trim() || null,
          address: address.trim() || null,
          ...(role === 'super_admin' ? {} : { role }),
          engagement_type: engagementType,
          salary: comp.salary.trim() === '' ? null : Number(comp.salary),
          freelancer_rate: comp.freelancer_rate.trim() === '' ? null : Number(comp.freelancer_rate),
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
        },
      })
      const currentIds = new Set(member.role_ids)
      const nextIds = new Set(roleIds)
      const changed = currentIds.size !== nextIds.size || [...currentIds].some((id) => !nextIds.has(id))
      if (changed) await assignRoles.mutateAsync({ userId: member.user_id, roles: { role_ids: roleIds } })
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
              <option value="admin">Admin</option>
              <option value="manager">Manager</option>
              <option value="employee">Employee</option>
            </Select>
          </div>

          <div className="flex flex-col gap-2">
            <Label>Job roles</Label>
            {byStage(roles ?? []).map(
              (group) =>
                group.roles.length > 0 && (
                  <div key={group.stage}>
                    <p className="mb-1 text-xs font-medium text-muted-foreground">{group.label}</p>
                    <div className="grid gap-1.5 sm:grid-cols-2">
                      {group.roles.map((r) => (
                        <label key={r.id} className="flex items-center gap-2 rounded-md border border-border p-2 text-sm">
                          <input type="checkbox" checked={roleIds.includes(r.id)} onChange={() => toggleRole(r.id)} />
                          {r.type_name}
                        </label>
                      ))}
                    </div>
                  </div>
                ),
            )}
          </div>

          <hr className="border-border" />

          <CompensationFields value={comp} onChange={setCompField} effectiveFromRequired={false} />

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
