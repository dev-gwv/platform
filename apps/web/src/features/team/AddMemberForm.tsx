import { useMemo, useState, type ReactNode } from 'react'
import { Check, Loader2, UserPlus, Wand2 } from 'lucide-react'
import type { ProductionStage } from '@ipc/contracts'
import { useFormDraft, DraftRestoredBanner } from '@/shared/hooks/use-form-draft'
import type { FieldErrors } from '@/shared/forms/field-errors'
import { Button } from '@/shared/ui/button'
import { Card, CardContent } from '@/shared/ui/card'
import { cn } from '@/shared/ui/cn'
import { Input, Label } from '@/shared/ui/input'
import { Switch } from '@/shared/ui/switch'
import { useAddMember, useCreateRole, useEmployeeRoles, useRoleLibrary } from './api'
import { CAN_SEE_HINT, CAN_SEE_LABEL, WORKS_AS_LABEL, useTeamPowers } from './powers'
import { pickableRoles, type PickableRole } from './bulk'
import { JobRolePicker } from './JobRolePicker'
import { toRoleCode } from './role-stages'
import {
  EMPTY_MEMBER_FORM,
  formErrors,
  isValid,
  suggestPassword,
  toRequest,
  type MemberForm,
  type MemberFormField,
} from './member-form'

/**
 * Add one person: one screen, four short questions.
 *
 * Who they are, how they work, whether they sign in, what they can see.
 * Pay, address and ID proof are not asked here -- they are set later from
 * the person's profile -- so adding someone takes about a minute.
 */
export function AddMemberForm({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }) {
  const [form, setForm] = useState<MemberForm>(EMPTY_MEMBER_FORM)
  const [showErrors, setShowErrors] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const add = useAddMember()
  const powers = useTeamPowers()

  // What was typed survives a refresh or a closed tab until it is saved.
  // The starting password is never written to storage: it is typed again.
  const { password: _pw, ...typed } = form
  const saved = useFormDraft('team-add-member', typed, (v) => setForm((f) => ({ ...f, ...v })))

  const set = <K extends MemberFormField>(key: K, value: MemberForm[K]) => {
    setForm((f) => ({ ...f, [key]: value }))
    setShowErrors(false)
  }

  const errors: FieldErrors<MemberFormField> = showErrors ? formErrors(form) : {}

  function submit() {
    if (!isValid(form)) {
      setShowErrors(true)
      return
    }
    add.mutate(toRequest(form), {
      onSuccess: () => {
        saved.clear()
        onDone()
      },
    })
  }

  const canSee = (['employee', 'manager', 'admin'] as const).filter(
    (r) => powers.mayGrant(r) || r === form.role,
  )

  return (
    <div className="mx-auto w-full max-w-2xl">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">Add one person</h2>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Name, phone and a login. About a minute.
          </p>
        </div>
        <Button variant="ghost" onClick={onCancel} disabled={add.isPending}>
          Cancel
        </Button>
      </div>

      {saved.restoredAt && (
        <div className="mt-4">
          <DraftRestoredBanner
            at={saved.restoredAt}
            onDismiss={saved.dismissRestored}
            onDiscard={() => {
              saved.clear()
              setForm(EMPTY_MEMBER_FORM)
            }}
          />
        </div>
      )}

      <Card className="mt-4">
        <CardContent className="flex flex-col gap-6 p-4 sm:p-5">
          {/* 1. Who */}
          <Group title="Who">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Name" required error={errors.name}>
                <Input
                  value={form.name}
                  onChange={(e) => set('name', e.target.value)}
                  placeholder="Full name"
                  aria-invalid={!!errors.name}
                  autoFocus
                />
              </Field>
              <Field label="Phone" required error={errors.phone}>
                <Input
                  inputMode="tel"
                  value={form.phone}
                  onChange={(e) => set('phone', e.target.value)}
                  placeholder="9876543210"
                  aria-invalid={!!errors.phone}
                />
              </Field>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>
                Job roles <span className="font-normal text-muted-foreground">(optional)</span>
              </Label>
              <JobRoles chosen={form.role_ids} onChange={(ids) => set('role_ids', ids)} />
            </div>
          </Group>

          {/* 2. Works as */}
          <Group title="Works as">
            <Pills
              value={form.engagement_type}
              onChange={(v) => set('engagement_type', v)}
              options={(['in_house', 'freelancer'] as const).map((v) => ({
                value: v,
                label: WORKS_AS_LABEL[v],
              }))}
              name="Works as"
            />
          </Group>

          {/* 3. Sign in */}
          <Group title="Can they sign in to the app?">
            <Switch
              checked={form.create_login}
              onChange={(v) => set('create_login', v)}
              label={form.create_login ? 'Yes, they can sign in' : 'No sign-in for now'}
              description={
                form.create_login
                  ? 'They use the email and password below.'
                  : 'They can still be booked on shoots.'
              }
            />
            {form.create_login && (
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Email" required error={errors.email}>
                  <Input
                    type="email"
                    value={form.email}
                    onChange={(e) => set('email', e.target.value)}
                    placeholder="name@example.com"
                    aria-invalid={!!errors.email}
                    autoComplete="off"
                  />
                </Field>
                <Field
                  label="Password"
                  required
                  error={errors.password}
                  hint="Share this with them. They can change it later."
                >
                  <div className="flex gap-2">
                    <Input
                      type={showPassword ? 'text' : 'password'}
                      value={form.password}
                      onChange={(e) => set('password', e.target.value)}
                      onFocus={() => setShowPassword(true)}
                      placeholder="At least 6 characters"
                      aria-invalid={!!errors.password}
                      autoComplete="new-password"
                      className="min-w-0 flex-1"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      className="shrink-0"
                      onClick={() => {
                        set('password', suggestPassword())
                        setShowPassword(true)
                      }}
                    >
                      <Wand2 /> Suggest one
                    </Button>
                  </div>
                </Field>
              </div>
            )}
          </Group>

          {/* 4. What can they see */}
          <Group title="What can they see?">
            <Pills
              value={form.role}
              onChange={(v) => set('role', v)}
              options={canSee.map((v) => ({
                value: v,
                label: CAN_SEE_LABEL[v],
                disabled: !powers.mayGrant(v),
              }))}
              name="What can they see"
            />
            <p className="text-xs text-muted-foreground">{CAN_SEE_HINT[form.role]}</p>
          </Group>

          <div className="border-t border-border pt-4">
            <p className="text-xs text-muted-foreground">
              Pay, address and ID proof can be added later from their profile.
            </p>
            <div className="mt-3 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button variant="outline" onClick={onCancel} disabled={add.isPending}>
                Cancel
              </Button>
              <Button onClick={submit} disabled={add.isPending} data-setup-nudge="">
                {add.isPending ? <Loader2 className="animate-spin" /> : <UserPlus />}
                {add.isPending ? 'Adding…' : 'Add to team'}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h3 className="text-sm font-semibold">{title}</h3>
      {children}
    </section>
  )
}

function Field({
  label,
  required,
  error,
  hint,
  children,
}: {
  label: string
  required?: boolean
  error?: string | undefined
  hint?: string
  children: ReactNode
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label>
        {label}
        {required && <span className="ml-0.5 text-destructive">*</span>}
      </Label>
      {children}
      {hint && !error && <p className="text-xs text-muted-foreground">{hint}</p>}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  )
}

/** A short either/or as pills: one is always chosen. */
function Pills<T extends string>({
  value,
  onChange,
  options,
  name,
}: {
  value: T
  onChange: (v: T) => void
  options: Array<{ value: T; label: string; disabled?: boolean }>
  name: string
}) {
  return (
    <div role="radiogroup" aria-label={name} className="flex flex-wrap gap-2">
      {options.map((o) => {
        const on = o.value === value
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={on}
            disabled={o.disabled}
            onClick={() => onChange(o.value)}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-full border px-4 py-2 text-sm font-medium transition-colors',
              'disabled:cursor-not-allowed disabled:opacity-50',
              on
                ? 'border-primary bg-primary text-primary-foreground'
                : 'border-border bg-card hover:border-primary/50 hover:bg-primary/[0.04]',
            )}
          >
            {on && <Check className="size-3.5" aria-hidden />}
            {o.label}
          </button>
        )
      })}
    </div>
  )
}

/**
 * The job roles this person does -- Photographer, Editor, Drone Operator.
 * The studio's roles and the defaults it has not taken yet are one list; a
 * default becomes a real role the moment it is tapped, and a name the list
 * does not have is typed in and added on the spot. `chosen` holds real ids.
 */
function JobRoles({ chosen, onChange }: { chosen: string[]; onChange: (ids: string[]) => void }) {
  const { data: roles } = useEmployeeRoles()
  const { data: library } = useRoleLibrary()
  const create = useCreateRole()
  const { canAddJobRoles } = useTeamPowers()

  const pickable = useMemo(
    () => pickableRoles(roles ?? [], canAddJobRoles ? (library ?? []) : []),
    [roles, library, canAddJobRoles],
  )

  const pick = async (role: PickableRole): Promise<string> =>
    role.owned
      ? role.key
      : (await create.mutateAsync({ type_name: role.type_name, role_code: role.role_code, stage: role.stage })).id

  const add = async (name: string, stage: ProductionStage): Promise<string> =>
    (await create.mutateAsync({ type_name: name, role_code: toRoleCode(name), stage })).id

  return (
    <JobRolePicker
      pickable={pickable}
      chosen={chosen}
      onChange={onChange}
      onPick={pick}
      onCreate={canAddJobRoles ? add : undefined}
    />
  )
}
