import { useEffect, useMemo, useState } from 'react'
import { MODULES, SYSTEM_PROFILES, type ModuleKey } from '@ipc/permissions'
import type { DirectoryMember } from '@ipc/contracts'
import { Button } from '@/shared/ui/button'
import { Dialog, DialogContent, DialogFooter } from '@/shared/ui/dialog'
import { Select } from '@/shared/ui/input'
import { StatusBadge } from '@/shared/ui/status-badge'
import { Switch } from '@/shared/ui/switch'
import { useSetUserAccess, useUserAccess } from './api'

const PROFILE_OPTIONS = [
  { key: '__role_default__', label: 'Role default (no custom profile)' },
  ...Object.values(SYSTEM_PROFILES).map((p) => ({ key: p.key, label: p.label })),
]

/** Module groups shown in the dialog (Lovable parity). */
const MODULE_GROUPS: ReadonlyArray<{ label: string; keys: ModuleKey[] }> = [
  { label: 'Core', keys: ['dashboard', 'projects', 'tasks', 'reports'] },
  { label: 'People', keys: ['clients', 'team', 'team_directory', 'team_work_preview', 'team_terms', 'team_roles', 'attendance'] },
  { label: 'Billing & pay', keys: ['money', 'billing', 'financials', 'company_expenses', 'team_salaries', 'team_payouts'] },
  { label: 'CRM', keys: ['crm', 'lead_sources'] },
  { label: 'Settings & Platform', keys: ['settings', 'studio_access', 'usage_analytics'] },
]

/** Modules with per-action Add/Edit/Delete sub-keys in this iteration. */
const ACTION_MODULES = new Set<ModuleKey>(['clients', 'team_directory', 'projects', 'tasks', 'attendance', 'team_salaries', 'team_payouts'])
const ACTIONS: ReadonlyArray<{ key: 'create' | 'edit' | 'delete'; label: string }> = [
  { key: 'create', label: 'Add' },
  { key: 'edit', label: 'Edit' },
  { key: 'delete', label: 'Delete' },
]

/**
 * Assign a system profile or customise per-module View + Add/Edit/Delete,
 * backed by the existing access router (GET/PUT /access/:userId).
 * Owner-only; no-login members cannot hold access.
 */
export function ManageAccessDialog({
  member,
  open,
  onOpenChange,
}: {
  member: DirectoryMember | null
  open: boolean
  onOpenChange: (v: boolean) => void
}) {
  const targetId = member?.user_id ?? null
  const hasLogin = !!member?.login_enabled
  const access = useUserAccess(open ? targetId : null)
  const save = useSetUserAccess()

  const [profileKey, setProfileKey] = useState('__role_default__')
  const [overrides, setOverrides] = useState<Record<string, boolean>>({})

  useEffect(() => {
    if (!open) return
    if (!access.data) {
      setProfileKey('__role_default__')
      setOverrides({})
      return
    }
    setProfileKey(access.data.profile_key ?? '__role_default__')
    const map: Record<string, boolean> = {}
    for (const o of access.data.overrides) map[o.permission_key] = o.enabled
    setOverrides(map)
  }, [open, access.data])

  const effective = useMemo(() => {
    const profile = SYSTEM_PROFILES[profileKey]
    const base = new Set<string>(profile?.permissions ?? [])
    for (const [k, on] of Object.entries(overrides)) {
      if (on) base.add(k)
      else base.delete(k)
    }
    return base
  }, [profileKey, overrides])

  const isRoleDefault = profileKey === '__role_default__'
  const allKeys = Object.keys(MODULES) as ModuleKey[]
  const visible = allKeys.filter((k) => effective.has(k)).map((k) => MODULES[k]!.label)
  const hidden = allKeys.filter((k) => !effective.has(k)).map((k) => MODULES[k]!.label)

  function togglePermission(key: ModuleKey, on: boolean) {
    setOverrides((prev) => {
      const next = { ...prev, [key]: on }
      if (!on && ACTION_MODULES.has(key)) {
        for (const a of ACTIONS) next[`${key}.${a.key}`] = false
      }
      return next
    })
  }

  function toggleAction(module: ModuleKey, action: 'create' | 'edit' | 'delete', on: boolean) {
    setOverrides((prev) => {
      const next = { ...prev, [`${module}.${action}`]: on }
      if (on) next[module] = true
      return next
    })
  }

  async function handleSave() {
    if (!targetId) return
    const profile = SYSTEM_PROFILES[profileKey]
    const cleaned: { permission_key: string; enabled: boolean }[] = []
    if (profile) {
      const base = new Set(profile.permissions)
      for (const [key, on] of Object.entries(overrides)) {
        if (base.has(key as ModuleKey) !== on) cleaned.push({ permission_key: key, enabled: on })
      }
    }
    await save.mutateAsync({
      userId: targetId,
      profile_key: isRoleDefault ? null : profileKey,
      overrides: cleaned,
    })
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={`Manage access${member?.name ? ` for ${member.name}` : ''}`}
        description="Assign a permission profile or customise per-module access."
        className="max-h-[90vh] max-w-2xl overflow-y-auto"
      >
        {member && (
          <div className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-muted/30 p-3 text-sm">
            <span className="text-muted-foreground">{member.email || 'No email'}</span>
            <StatusBadge>{member.role}</StatusBadge>
            <StatusBadge tone={member.status === 'active' ? 'success' : 'neutral'}>{member.status}</StatusBadge>
            {!hasLogin && <StatusBadge tone="danger">No login</StatusBadge>}
          </div>
        )}

        {!hasLogin ? (
          <p className="rounded-md border border-warning/40 bg-warning/10 p-3 text-sm">
            Invite this person to enable dashboard access. Manage access becomes available once
            they accept the invite and sign in for the first time.
          </p>
        ) : access.isLoading ? (
          <p className="py-8 text-center text-sm text-muted-foreground">Loading current access…</p>
        ) : access.isError ? (
          <p className="py-8 text-center text-sm text-destructive">Failed to load access.</p>
        ) : (
          <>
            <div className="flex flex-col gap-1.5">
              <span className="text-sm font-medium">Access profile</span>
              <Select value={profileKey} onChange={(e) => { setProfileKey(e.target.value); setOverrides({}) }}>
                {PROFILE_OPTIONS.map((o) => (
                  <option key={o.key} value={o.key}>{o.label}</option>
                ))}
              </Select>
              <p className="text-xs text-muted-foreground">
                {isRoleDefault
                  ? 'No custom profile. This person sees default access for their role.'
                  : (SYSTEM_PROFILES[profileKey]?.description ?? '')}
              </p>
            </div>

            {!isRoleDefault && (
              <div className="flex flex-col gap-3">
                {MODULE_GROUPS.map((group) => (
                  <div key={group.label} className="rounded-md border border-border p-3">
                    <p className="mb-2 text-sm font-medium">{group.label}</p>
                    <div className="grid gap-2 sm:grid-cols-2">
                      {group.keys.map((key) => {
                        const mod = MODULES[key]
                        if (!mod) return null
                        const on = effective.has(key)
                        const showActions = ACTION_MODULES.has(key) && on
                        return (
                          <div key={key} className="rounded-md px-2 py-2 hover:bg-muted/40">
                            <Switch checked={on} onChange={(v) => togglePermission(key, v)} label={mod.label} />
                            {mod.sensitive && (
                              <span className="ml-14 text-[10px] text-muted-foreground">Sensitive</span>
                            )}
                            {showActions && (
                              <div className="mt-2 flex flex-wrap gap-2 pl-14 text-xs">
                                {ACTIONS.map((a) => {
                                  const actKey = `${key}.${a.key}`
                                  return (
                                    <label key={a.key} className="inline-flex items-center gap-1 rounded border border-border px-2 py-1">
                                      <input
                                        type="checkbox"
                                        checked={effective.has(actKey)}
                                        onChange={(e) => toggleAction(key, a.key, e.target.checked)}
                                      />
                                      {a.label}
                                    </label>
                                  )
                                })}
                              </div>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div className="flex flex-col gap-1 rounded-md border border-border bg-muted/30 p-3 text-xs">
              <p><span className="font-medium">Will see:</span> {visible.length ? visible.join(', ') : '—'}</p>
              <p><span className="font-medium">Will not see:</span> {hidden.length ? hidden.join(', ') : '—'}</p>
            </div>
          </>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={save.isPending}>
            Cancel
          </Button>
          <Button
            onClick={() => void handleSave()}
            disabled={save.isPending || !hasLogin || access.isLoading || access.isError}
          >
            {save.isPending ? 'Saving…' : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
