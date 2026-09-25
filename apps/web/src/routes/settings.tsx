import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { PLAN_SOURCE_LABEL } from '@ipc/domain'
import { Link, useNavigate } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, Palette } from 'lucide-react'
import { toast } from 'sonner'
import {
  changePasswordRequest,
  companyProfile,
  companyTheme,
  myProfile,
  subscriptionStatus,
  type CompanyProfile,
  type UpdateCompanyRequest,
  type UpdateMyProfileRequest,
} from '@ipc/contracts'
import { presetFor } from '@/shared/theme/presets'
import { fontOr } from '@/shared/theme/fonts'
import { SettingsTabs } from '@/features/settings/SettingsTabs'
import { useChangePassword } from '@/features/settings/api'
import { callApi, uploadFile } from '@/shared/api/client'
import { useAuth } from '@/shared/auth/AuthProvider'
import { DraftRestoredBanner, useFormDraft } from '@/shared/hooks/use-form-draft'
import { AuthedPage } from '@/shared/layout/AuthedPage'
import { PageHeader } from '@/shared/layout/page-header'
import { Button } from '@/shared/ui/button'
import { SkeletonCards } from '@/shared/ui/skeleton'
import { ErrorState } from '@/shared/ui/states'
import { Card, CardContent } from '@/shared/ui/card'
import { HowToUse } from '@/shared/ui/how-to-use'
import { Input, Label, Textarea } from '@/shared/ui/input'
import { StatusBadge } from '@/shared/ui/status-badge'

import { humanize } from '@/shared/ui/format'
import { useConfirm } from '@/shared/ui/confirm'

export function SettingsPage() {
  return (
    <AuthedPage module="settings">
      <Settings />
    </AuthedPage>
  )
}

function Settings() {
  const { session } = useAuth()
  const isOwner = session?.is_owner ?? false

  return (
    <>
      <PageHeader
        title="Settings"
        description="Manage your company profile, roles and subscription."
      />
      <SettingsTabs />

      <h2 className="text-lg font-semibold tracking-tight">Company profile</h2>
      <p className="mt-0.5 text-sm text-muted-foreground">
        View and update your company and admin profile.
      </p>

      <HowToUse
        className="mt-4"
        title="Manage studio settings"
        description="Update your company profile, job roles, appearance, and plan."
        steps={['Update company details.', 'Manage roles and access.', 'Pick your theme and font.']}
      />

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <ProfileCard className="lg:col-span-2" canEditCompany={isOwner} />
        <AccountStatusCard />
      </div>

      <BrandIdentityCard readOnly={!isOwner} />

      <Section
        title="Advanced hubs"
        description="Task bundles, attendance geo-fence, lookups and secondary tools live on their own pages."
      >
        <div className="grid gap-2 sm:grid-cols-2">
          <Button variant="outline" asChild><Link to="/settings/task-bundles">Task Bundles</Link></Button>
          <Button variant="outline" asChild><Link to="/settings/attendance-location">Attendance Location</Link></Button>
          <Button variant="outline" asChild><Link to="/settings/lookups">Lookups</Link></Button>
          <Button variant="outline" asChild><Link to="/settings/advanced">Advanced Tools</Link></Button>
        </div>
      </Section>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <ThemeSummaryCard readOnly={!isOwner} className="lg:col-span-2" />
        <SecurityCard />
      </div>
    </>
  )
}

function Section({
  title,
  description,
  children,
}: {
  title: string
  description: string
  children: ReactNode
}) {
  return (
    <Card className="mt-4">
      <CardContent className="p-4 sm:p-4">
        <h3 className="font-semibold tracking-tight">{title}</h3>
        <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>
        <div className="mt-4">{children}</div>
      </CardContent>
    </Card>
  )
}

function Field({
  label,
  required,
  hint,
  children,
}: {
  label: string
  required?: boolean
  hint?: string | undefined
  children: ReactNode
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label>
        {label}
        {required && <span className="ml-0.5 text-destructive">*</span>}
      </Label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  )
}

/**
 * The company's name and the signed-in person's own details, saved together —
 * which is how they read on screen, even though they are two rows in two
 * tables. Only an owner may rename the studio; anyone may fix their own name.
 */
function ProfileCard({ className, canEditCompany }: { className?: string; canEditCompany: boolean }) {
  const qc = useQueryClient()
  const { refresh } = useAuth()

  const company = useQuery({
    queryKey: ['settings', 'company'],
    queryFn: () => callApi('/settings/company', { responseSchema: companyProfile }),
  })
  const profile = useQuery({
    queryKey: ['settings', 'profile'],
    queryFn: () => callApi('/settings/profile', { responseSchema: myProfile }),
  })

  const saveCompany = useMutation({
    mutationFn: (input: UpdateCompanyRequest) =>
      callApi('/settings/company', { method: 'PATCH', body: input, responseSchema: companyProfile }),
  })
  const saveProfile = useMutation({
    mutationFn: (input: UpdateMyProfileRequest) =>
      callApi('/settings/profile', { method: 'PATCH', body: input, responseSchema: myProfile }),
  })

  const [companyName, setCompanyName] = useState('')
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [avatarUrl, setAvatarUrl] = useState('')
  const [saved, setSaved] = useState(false)

  function reset() {
    setCompanyName(company.data?.name ?? '')
    setName(profile.data?.name ?? '')
    setPhone(profile.data?.phone ?? '')
    setAvatarUrl(profile.data?.avatar_url ?? '')
    setSaved(false)
  }
  useEffect(reset, [company.data, profile.data])

  // What was typed survives a refresh or a closed tab until it is saved. Only
  // once both records are in, and only what differs from them, counts.
  const serverProfile = {
    companyName: company.data?.name ?? '',
    name: profile.data?.name ?? '',
    phone: profile.data?.phone ?? '',
    avatarUrl: profile.data?.avatar_url ?? '',
  }
  const draft = useFormDraft(
    company.data && profile.data ? 'settings:profile' : null,
    { companyName, name, phone, avatarUrl },
    (v) => {
      setCompanyName(v.companyName)
      setName(v.name)
      setPhone(v.phone)
      setAvatarUrl(v.avatarUrl)
    },
    { isBlank: (v) => JSON.stringify(v) === JSON.stringify(serverProfile) },
  )

  const dirty =
    companyName !== (company.data?.name ?? '') ||
    name !== (profile.data?.name ?? '') ||
    phone !== (profile.data?.phone ?? '') ||
    avatarUrl !== (profile.data?.avatar_url ?? '')
  const busy = saveCompany.isPending || saveProfile.isPending

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    try {
      // Two writes, because they are two records. The company one only goes out
      // when it actually changed, so a manager saving their phone is never
      // refused for a studio rename they did not make.
      if (canEditCompany && companyName !== company.data?.name) {
        await saveCompany.mutateAsync({ name: companyName.trim() })
      }
      if (
        name !== profile.data?.name ||
        phone !== (profile.data?.phone ?? '') ||
        avatarUrl !== (profile.data?.avatar_url ?? '')
      ) {
        await saveProfile.mutateAsync({ name: name.trim(), phone: phone.trim() || null, avatar_url: avatarUrl.trim() || null })
      }
      await qc.invalidateQueries({ queryKey: ['settings'] })
      await refresh()
      draft.clear()
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'We could not save your changes.')
    }
  }

  if (company.isLoading || profile.isLoading) {
    return (
      <Card className={className}>
        <CardContent className="p-4">
          <SkeletonCards count={3} />
        </CardContent>
      </Card>
    )
  }

  // Blank fields backed by a failed fetch would submit as a real rename —
  // stop short of the form entirely rather than let that overwrite anything.
  if (company.isError || profile.isError) {
    return (
      <Card className={className}>
        <CardContent className="p-4">
          <ErrorState
            error={company.error ?? profile.error}
            onRetry={() => {
              void company.refetch()
              void profile.refetch()
            }}
          />
        </CardContent>
      </Card>
    )
  }

  return (
    <Card className={className}>
      <CardContent className="p-4 sm:p-4">
        <h3 className="font-semibold tracking-tight">Profile</h3>
        <p className="mt-0.5 text-sm text-muted-foreground">Editable fields are saved together.</p>

        <form onSubmit={onSubmit} className="mt-4 flex flex-col gap-4">
          <DraftRestoredBanner
            at={draft.restoredAt}
            onDismiss={draft.dismissRestored}
            onDiscard={() => {
              draft.clear()
              reset()
            }}
          />
          <Field
            label="Company name"
            required
            hint={canEditCompany ? undefined : 'Only the studio owner can rename the studio.'}
          >
            <Input
              value={companyName}
              onChange={(e) => setCompanyName(e.target.value)}
              disabled={!canEditCompany}
            />
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Your name" required>
              <Input value={name} onChange={(e) => setName(e.target.value)} />
            </Field>
            <Field label="Email" hint="This is your login, so it is not editable here.">
              <Input value={profile.data?.email ?? ''} disabled />
            </Field>
            <Field label="Phone">
              <Input
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="9876543210"
              />
            </Field>
            <Field label="Photo URL" hint="Shown wherever your name appears — a link, not an upload.">
              <Input
                value={avatarUrl}
                onChange={(e) => setAvatarUrl(e.target.value)}
                placeholder="https://…"
              />
            </Field>
          </div>

          <div className="flex items-center justify-end gap-2">
            {saved && (
              <span className="mr-auto flex items-center gap-1 text-sm text-success">
                <Check className="size-4" /> Saved
              </span>
            )}
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                draft.clear()
                reset()
              }}
              disabled={!dirty || busy}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={!dirty || busy || name.trim().length < 2}>
              {busy ? 'Saving…' : 'Save changes'}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}

/** Read-only facts about this account — role, status, and where the plan stands. */
function AccountStatusCard() {
  const { session } = useAuth()
  const profile = useQuery({
    queryKey: ['settings', 'profile'],
    queryFn: () => callApi('/settings/profile', { responseSchema: myProfile }),
  })
  // The gate alone cannot tell a trial from a paid year.
  const sub = useQuery({
    queryKey: ['subscription', 'status'],
    queryFn: () => callApi('/subscription/status', { responseSchema: subscriptionStatus }),
  })

  const expiry = session?.plan_expiry ? new Date(session.plan_expiry) : null
  const daysLeft = expiry ? Math.max(0, Math.ceil((expiry.getTime() - Date.now()) / 86_400_000)) : null
  const gate = session?.plan_gate ?? 'expired'
  const active = gate === 'active' || gate === 'grandfathered'

  return (
    <Card>
      <CardContent className="p-4 sm:p-4">
        <h3 className="font-semibold tracking-tight">Account status</h3>
        <dl className="mt-4 flex flex-col gap-3 text-sm">
          <Row label="Your role">
            <StatusBadge tone="info">{humanize(session?.role ?? 'none')}</StatusBadge>
          </Row>
          <Row label="Status">
            <StatusBadge tone={profile.data?.status === 'active' ? 'success' : 'neutral'}>
              {humanize(profile.data?.status ?? 'active')}
            </StatusBadge>
          </Row>
          <Row label="Plan">
            <span className="font-medium">{humanize(gate)}</span>
          </Row>
          <Row label="Plan source">
            <span className="font-medium">
              {sub.data ? PLAN_SOURCE_LABEL[sub.data.plan_source] : '—'}
            </span>
          </Row>
          <Row label="Plan expiry">
            <span className="font-medium">{expiry ? expiry.toLocaleDateString('en-IN') : '—'}</span>
          </Row>
          <Row label="Days remaining">
            <span className="font-medium tabular-nums">{daysLeft ?? '—'}</span>
          </Row>
          <Row label="Plan active">
            <StatusBadge tone={active ? 'success' : 'danger'}>
              {active ? 'Active' : 'Expired'}
            </StatusBadge>
          </Row>
        </dl>
        <Button variant="outline" className="mt-4 w-full" asChild>
          <Link to="/settings/subscription">Manage subscription</Link>
        </Button>
      </CardContent>
    </Card>
  )
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd>{children}</dd>
    </div>
  )
}

/** The brand details as the server has them: what the form starts from, and what counts as unchanged. */
function brandForm(data: CompanyProfile): UpdateCompanyRequest {
  return {
    display_name: data.display_name ?? '',
    legal_name: data.legal_name ?? '',
    invoice_gst_number: data.invoice_gst_number ?? '',
    website: data.website ?? '',
    city: data.city ?? '',
    state: data.state ?? '',
    country: data.country ?? '',
    avatar_url: data.avatar_url ?? '',
    invoice_logo_url: (data as unknown as Record<string, unknown>)['invoice_logo_url'] as string ?? '',
    document_footer_note: (data as unknown as Record<string, unknown>)['document_footer_note'] as string ?? '',
    // How a client reaches the studio. The old app keeps these under
    // Settings → Contact Details; ours had them only on the invoice
    // templates page, so the natural place to look did not have them.
    invoice_phone: data.invoice_phone ?? '',
    invoice_email: data.invoice_email ?? '',
    invoice_address: data.invoice_address ?? '',
    invoice_number_prefix: data.invoice_number_prefix,
    invoice_next_number: data.invoice_next_number,
    quote_number_prefix: data.quote_number_prefix,
    quote_next_number: data.quote_next_number,
  }
}

/** What clients see on quotations and invoices, as against the studio's own name. */
function BrandIdentityCard({ readOnly }: { readOnly: boolean }) {
  const qc = useQueryClient()
  const { data, isLoading } = useQuery({
    queryKey: ['settings', 'company'],
    queryFn: () => callApi('/settings/company', { responseSchema: companyProfile }),
  })
  const save = useMutation({
    mutationFn: (input: UpdateCompanyRequest) =>
      callApi('/settings/company', { method: 'PATCH', body: input, responseSchema: companyProfile }),
    onSuccess: () => {
      toast.success('Brand details saved')
      void qc.invalidateQueries({ queryKey: ['settings', 'company'] })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const [form, setForm] = useState<UpdateCompanyRequest>({})
  const [uploadingLogo, setUploadingLogo] = useState(false)
  useEffect(() => {
    if (!data) return
    setForm(brandForm(data))
  }, [data])

  // What was typed survives a refresh or a closed tab until it is saved.
  // Unchanged server values are not a draft.
  const brandDraft = useFormDraft(!readOnly && data ? 'settings:brand' : null, form, setForm, {
    isBlank: (v) => !data || JSON.stringify(v) === JSON.stringify(brandForm(data)),
  })

  if (isLoading) return null
  const set = (patch: UpdateCompanyRequest) => setForm((f) => ({ ...f, ...patch }))

  return (
    <Section
      title="Brand identity"
      description="Used on quotations, invoices, and future client documents."
    >
      <form
        onSubmit={(e) => {
          e.preventDefault()
          save.mutate(form, { onSuccess: () => brandDraft.clear() })
        }}
        className="flex flex-col gap-4"
      >
        <DraftRestoredBanner
          at={brandDraft.restoredAt}
          onDismiss={brandDraft.dismissRestored}
          onDiscard={() => {
            brandDraft.clear()
            if (data) setForm(brandForm(data))
          }}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Display name" hint="The name clients see.">
            <Input
              value={form.display_name ?? ''}
              onChange={(e) => set({ display_name: e.target.value })}
              disabled={readOnly}
              placeholder="IPC Studios"
            />
          </Field>
          <Field label="Legal company name" hint="Printed on invoices.">
            <Input
              value={form.legal_name ?? ''}
              onChange={(e) => set({ legal_name: e.target.value })}
              disabled={readOnly}
              placeholder="IPC Studios Pvt. Ltd."
            />
          </Field>
          <Field label="GST number">
            <Input
              value={form.invoice_gst_number ?? ''}
              onChange={(e) => set({ invoice_gst_number: e.target.value })}
              disabled={readOnly}
              placeholder="27AAAAA0000A1Z5"
            />
          </Field>
          <Field label="Website">
            <Input
              value={form.website ?? ''}
              onChange={(e) => set({ website: e.target.value })}
              disabled={readOnly}
              placeholder="ipcstudios.in"
            />
          </Field>
          <Field label="Logo URL" hint="Shown on invoices and quotes.">
            <Input
              value={form.avatar_url ?? ''}
              onChange={(e) => set({ avatar_url: e.target.value })}
              disabled={readOnly}
              placeholder="https://…/logo.png"
            />
          </Field>
          <Field label="Invoice logo URL" hint="Separate logo for invoices — falls back to the logo above.">
            <Input
              value={(form as unknown as Record<string, unknown>)['invoice_logo_url'] as string ?? ''}
              onChange={(e) => set({ invoice_logo_url: e.target.value } as UpdateCompanyRequest)}
              disabled={readOnly}
              placeholder="https://…/invoice-logo.png"
            />
          </Field>
          {!readOnly && (
            <div className="sm:col-span-2">
              <Field
                label="Upload logo"
                hint="PNG, JPG, WEBP or SVG. Max 5 MB. Stored on the server and filled into the Logo URL above."
              >
                <Input
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/svg+xml"
                  disabled={uploadingLogo}
                  onChange={(e) => {
                    const input = e.currentTarget
                    const f = input.files?.[0]
                    if (!f) return
                    if (f.size > 5 * 1024 * 1024) {
                      toast.error('That file is larger than 5 MB.')
                      input.value = ''
                      return
                    }
                    setUploadingLogo(true)
                    // Public: a client opening an emailed quotation has no session,
                    // so the logo has to load without one.
                    uploadFile(f, { isPublic: true })
                      .then((stored) => {
                        set({ avatar_url: stored.url })
                        toast.success('Logo uploaded — remember to save.')
                      })
                      .catch((err: unknown) =>
                        toast.error(err instanceof Error ? err.message : 'We could not upload that file.'),
                      )
                      .finally(() => {
                        setUploadingLogo(false)
                        input.value = ''
                      })
                  }}
                />
              </Field>
            </div>
          )}
          <Field label="City">
            <Input
              value={form.city ?? ''}
              onChange={(e) => set({ city: e.target.value })}
              disabled={readOnly}
            />
          </Field>
          <Field label="State">
            <Input
              value={form.state ?? ''}
              onChange={(e) => set({ state: e.target.value })}
              disabled={readOnly}
            />
          </Field>
          <Field label="Country">
            <Input
              value={form.country ?? ''}
              onChange={(e) => set({ country: e.target.value })}
              disabled={readOnly}
              placeholder="India"
            />
          </Field>
          <Field label="Document footer note" hint="Printed at the bottom of quotations, invoices and terms.">
            <Input
              value={(form as unknown as Record<string, unknown>)['document_footer_note'] as string ?? ''}
              onChange={(e) => set({ document_footer_note: e.target.value } as UpdateCompanyRequest)}
              disabled={readOnly}
              placeholder="Thank you for choosing us."
            />
          </Field>
        </div>

        <div className="border-t border-border pt-4">
          <p className="text-sm font-medium">Contact details</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Printed on quotations, invoices and receipts — this is how a client reaches you. The
            invoice templates page edits the same three.
          </p>
          <div className="mt-3 grid gap-4 sm:grid-cols-2">
            <Field label="Business phone">
              <Input
                value={form.invoice_phone ?? ''}
                onChange={(e) => set({ invoice_phone: e.target.value })}
                disabled={readOnly}
                placeholder="+91 98200 00000"
              />
            </Field>
            <Field label="Business email">
              <Input
                type="email"
                value={form.invoice_email ?? ''}
                onChange={(e) => set({ invoice_email: e.target.value })}
                disabled={readOnly}
                placeholder="billing@yourstudio.in"
              />
            </Field>
            <Field label="Business address" hint="The block printed at the top of a document.">
              <Textarea
                rows={3}
                value={form.invoice_address ?? ''}
                onChange={(e) => set({ invoice_address: e.target.value })}
                disabled={readOnly}
                placeholder={'12 Turner Road\nBandra West, Mumbai 400050'}
              />
            </Field>
          </div>
        </div>

        <div className="border-t border-border pt-4">
          <p className="text-sm font-medium">Invoice &amp; quote numbering</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            The next document takes this prefix and number. Only change the number to correct a mistake.
          </p>
          <div className="mt-3 grid gap-4 sm:grid-cols-2">
            <Field label="Invoice prefix">
              <Input
                value={form.invoice_number_prefix ?? ''}
                onChange={(e) => set({ invoice_number_prefix: e.target.value })}
                disabled={readOnly}
                placeholder="INV-"
              />
            </Field>
            <Field label="Next invoice number">
              <Input
                inputMode="numeric"
                value={form.invoice_next_number ?? 1}
                onChange={(e) => set({ invoice_next_number: Number(e.target.value) || 1 })}
                disabled={readOnly}
              />
            </Field>
            <Field label="Quote prefix">
              <Input
                value={form.quote_number_prefix ?? ''}
                onChange={(e) => set({ quote_number_prefix: e.target.value })}
                disabled={readOnly}
                placeholder="Q-"
              />
            </Field>
            <Field label="Next quote number">
              <Input
                inputMode="numeric"
                value={form.quote_next_number ?? 1}
                onChange={(e) => set({ quote_next_number: Number(e.target.value) || 1 })}
                disabled={readOnly}
              />
            </Field>
          </div>
        </div>

        {!readOnly && (
          <div className="flex justify-end">
            <Button type="submit" disabled={save.isPending}>
              {save.isPending ? 'Saving…' : 'Save brand details'}
            </Button>
          </div>
        )}
      </form>
    </Section>
  )
}

function ThemeSummaryCard({ readOnly, className }: { readOnly: boolean; className?: string }) {
  const { data } = useQuery({
    queryKey: ['settings', 'theme'],
    queryFn: () => callApi('/settings/theme', { responseSchema: companyTheme }),
  })
  const preset = presetFor(data?.preset_key)
  const font = fontOr(data?.font_key, preset.font)

  return (
    <Card className={className}>
      <CardContent className="p-4 sm:p-4">
        <h3 className="font-semibold tracking-tight">Theme &amp; branding</h3>
        <p className="mt-0.5 text-sm text-muted-foreground">
          The palette and typeface your whole studio sees.
        </p>
        <div className="mt-4 flex items-center gap-3">
          <span className="size-9 shrink-0 rounded-lg" style={{ backgroundColor: preset.swatch }} />
          <div className="min-w-0">
            <p className="truncate font-medium">{preset.label}</p>
            <p className="truncate text-sm text-muted-foreground">
              {font.family} · {preset.description}
            </p>
          </div>
        </div>
        <Button variant="outline" className="mt-4" asChild>
          <Link to="/settings/appearance">
            <Palette /> {readOnly ? 'View themes' : 'Change theme & font'}
          </Link>
        </Button>
      </CardContent>
    </Card>
  )
}

function SecurityCard() {
  const { signOutEverywhere } = useAuth()
  const confirm = useConfirm()
  const navigate = useNavigate()
  const change = useChangePassword()
  const [busy, setBusy] = useState(false)
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [again, setAgain] = useState('')
  const [error, setError] = useState<string | null>(null)

  async function signOutAll() {
    const yes = await confirm({
      title: 'Sign out everywhere?',
      description:
        'Every device signs out, including this one. Use this if you think someone else has access.',
      confirmLabel: 'Sign out everywhere',
      destructive: true,
    })
    if (!yes) return
    setBusy(true)
    try {
      await signOutEverywhere()
    } catch (e) {
      // Never claim the other devices are dead when the revocation failed.
      toast.error(e instanceof Error ? e.message : 'We could not sign out your other devices.')
    } finally {
      setBusy(false)
    }
    await navigate({ to: '/login' })
  }

  async function onChangePassword(e: FormEvent) {
    e.preventDefault()
    setError(null)
    const parsed = changePasswordRequest.safeParse({ current_password: current, new_password: next })
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Use at least 8 characters.')
      return
    }
    if (next !== again) {
      setError('The new passwords do not match.')
      return
    }
    try {
      await change.mutateAsync(parsed.data)
      setCurrent('')
      setNext('')
      setAgain('')
      toast.success('Password changed. Your other devices were signed out.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'We could not change your password.')
    }
  }

  return (
    <Card>
      <CardContent className="p-4 sm:p-4">
        <h3 className="font-semibold tracking-tight">Security</h3>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Change your password here. Doing so signs out every other device.
        </p>
        <form onSubmit={onChangePassword} className="mt-4 flex flex-col gap-3">
          <Field label="Current password" required>
            <Input type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />
          </Field>
          <Field label="New password" required hint="At least 8 characters.">
            <Input type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} />
          </Field>
          <Field label="Repeat new password" required>
            <Input type="password" autoComplete="new-password" value={again} onChange={(e) => setAgain(e.target.value)} aria-invalid={!!error && next !== again} />
          </Field>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button type="submit" disabled={change.isPending || !current || !next || !again}>
            {change.isPending ? 'Changing…' : 'Change password'}
          </Button>
        </form>
        <div className="mt-4 border-t border-border pt-4">
          <p className="text-sm text-muted-foreground">
            Think someone else has access? Sign out of every browser and device this account is open on.
          </p>
          <Button variant="outline" className="mt-3" disabled={busy} onClick={() => void signOutAll()}>
            {busy ? 'Signing out…' : 'Sign out everywhere'}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
