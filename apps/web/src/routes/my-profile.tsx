import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Camera, Check, Loader2, Lock } from 'lucide-react'
import { toast } from 'sonner'
import { PROFILE_FIELD_LABEL, type MyProfile, type ProfileField } from '@ipc/contracts'
import { AuthedPage } from '@/shared/layout/AuthedPage'
import { PageHeader } from '@/shared/layout/page-header'
import { Avatar } from '@/shared/ui/avatar'
import { Button } from '@/shared/ui/button'
import { Card, CardContent } from '@/shared/ui/card'
import { Input, Label, Select, Textarea } from '@/shared/ui/input'
import { SkeletonList } from '@/shared/ui/skeleton'
import { cn } from '@/shared/ui/cn'
import { uploadFile } from '@/shared/api/client'
import { DraftRestoredBanner, useFormDraft } from '@/shared/hooks/use-form-draft'
import { useMyProfile, useSaveMyProfile } from '@/features/profile/api'

export function MyProfilePage() {
  return (
    <AuthedPage module="dashboard">
      <MyProfileForm />
    </AuthedPage>
  )
}

type Form = {
  name: string
  phone: string
  address: string
  date_of_birth: string
  blood_group: string
  joined_on: string
  emergency_name: string
  emergency_relation: string
  emergency_phone: string
  upi_id: string
  bank_account_name: string
  bank_account_number: string
  bank_ifsc: string
  pan: string
}

const fromProfile = (p: MyProfile): Form => ({
  name: p.name ?? '',
  phone: p.phone ?? '',
  address: p.address ?? '',
  date_of_birth: p.date_of_birth ?? '',
  blood_group: p.blood_group ?? '',
  joined_on: p.joined_on ?? '',
  emergency_name: p.emergency_name ?? '',
  emergency_relation: p.emergency_relation ?? '',
  emergency_phone: p.emergency_phone ?? '',
  upi_id: p.upi_id ?? '',
  bank_account_name: p.bank_account_name ?? '',
  bank_account_number: p.bank_account_number ?? '',
  bank_ifsc: p.bank_ifsc ?? '',
  pan: p.pan ?? '',
})

/** Bank account number and PAN are never kept in the on-device draft. */
const SENSITIVE: (keyof Form)[] = ['bank_account_number', 'pan']

const BLOOD_GROUPS = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-']

/**
 * Your own profile: who you are, who to call in an emergency, and where to
 * send your pay. The personal parts are private -- only you and the studio
 * owner can see them. Until it is complete, the dashboard and a daily
 * reminder say what is still missing.
 */
function MyProfileForm() {
  const profile = useMyProfile()
  const save = useSaveMyProfile()
  const [form, setForm] = useState<Form | null>(null)
  const [uploading, setUploading] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (profile.data && !form) setForm(fromProfile(profile.data))
  }, [profile.data, form])

  const safe = form ? (Object.fromEntries(Object.entries(form).filter(([k]) => !SENSITIVE.includes(k as keyof Form))) as Partial<Form>) : null
  const draft = useFormDraft(form ? 'my-profile' : null, safe, (v) => v && setForm((f) => (f ? { ...f, ...v } : f)))

  if (profile.isLoading || !form || !profile.data) return <SkeletonList rows={6} columns={2} />
  const p = profile.data
  const missing = new Set<ProfileField>(p.completeness.missing)
  const set = (k: keyof Form) => (e: { target: { value: string } }) => setForm({ ...form, [k]: e.target.value })
  const inHouse = (p.engagement_type ?? 'in_house') === 'in_house'

  async function onPhoto(file: File | undefined) {
    if (!file) return
    if (!file.type.startsWith('image/')) {
      toast.error('Pick a photo (JPG or PNG).')
      return
    }
    setUploading(true)
    try {
      const stored = await uploadFile(file, { isPublic: true })
      save.mutate({ avatar_url: stored.url })
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setUploading(false)
    }
  }

  function submit() {
    if (!form) return
    const body = Object.fromEntries(Object.entries(form).map(([k, v]) => [k, v.trim() === '' ? null : v.trim()]))
    save.mutate({ ...body, name: form.name.trim() || p.name }, { onSuccess: () => draft.clear() })
  }

  return (
    <section className="flex flex-col gap-4">
      <PageHeader title="My profile" description="Your details for the studio. The personal parts are private to you and the studio owner." />

      <Card className={cn(p.completeness.percent === 100 ? 'border-success/40 bg-success/5' : 'border-primary/30 bg-primary/5')}>
        <CardContent className="flex flex-wrap items-center gap-4 p-4">
          <div className="relative">
            <Avatar name={p.name} src={p.avatar_url} size="lg" />
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="absolute -bottom-1 -right-1 rounded-full border border-border bg-card p-1.5 shadow hover:bg-muted"
              aria-label="Change photo"
            >
              {uploading ? <Loader2 className="size-3.5 animate-spin" /> : <Camera className="size-3.5" />}
            </button>
            <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => void onPhoto(e.target.files?.[0])} />
          </div>
          <div className="min-w-[14rem] flex-1">
            <p className="text-sm font-semibold">
              {p.completeness.percent === 100 ? (
                <span className="inline-flex items-center gap-1 text-success">
                  <Check className="size-4" /> Profile complete
                </span>
              ) : (
                `${p.completeness.percent}% complete`
              )}
            </p>
            <div className="mt-1.5 h-2 w-full max-w-md overflow-hidden rounded-full bg-muted">
              <div className={cn('h-full rounded-full', p.completeness.percent === 100 ? 'bg-success' : 'bg-primary')} style={{ width: `${p.completeness.percent}%` }} />
            </div>
            {missing.size > 0 && (
              <p className="mt-1.5 text-xs text-muted-foreground">
                Still needed: {[...missing].map((m) => PROFILE_FIELD_LABEL[m]).join(', ')}
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      <DraftRestoredBanner
        at={draft.restoredAt}
        onDismiss={draft.dismissRestored}
        onDiscard={() => {
          draft.clear()
          setForm(fromProfile(p))
        }}
      />

      <Section title="About you">
        <F label="Full name">
          <Input value={form.name} onChange={set('name')} />
        </F>
        <F label="Phone" missing={missing.has('phone')}>
          <Input value={form.phone} onChange={set('phone')} inputMode="tel" placeholder="98765 43210" />
        </F>
        <F label="Address" missing={missing.has('address')} wide>
          <Textarea rows={2} value={form.address} onChange={set('address')} placeholder="House, street, city, PIN" />
        </F>
      </Section>

      <Section title="Personal" lock>
        <F label="Date of birth" missing={missing.has('date_of_birth')}>
          <Input type="date" value={form.date_of_birth} onChange={set('date_of_birth')} />
        </F>
        <F label="Blood group">
          <Select value={form.blood_group} onChange={set('blood_group')} aria-label="Blood group">
            <option value="">—</option>
            {BLOOD_GROUPS.map((b) => (
              <option key={b} value={b}>
                {b}
              </option>
            ))}
          </Select>
        </F>
        <F label="Joined the studio on">
          <Input type="date" value={form.joined_on} onChange={set('joined_on')} />
        </F>
      </Section>

      <Section title="Emergency contact" lock>
        <F label="Name" missing={missing.has('emergency_contact') && !form.emergency_name.trim()}>
          <Input value={form.emergency_name} onChange={set('emergency_name')} />
        </F>
        <F label="Relation">
          <Input value={form.emergency_relation} onChange={set('emergency_relation')} placeholder="Mother, spouse…" />
        </F>
        <F label="Phone" missing={missing.has('emergency_contact') && !form.emergency_phone.trim()}>
          <Input value={form.emergency_phone} onChange={set('emergency_phone')} inputMode="tel" />
        </F>
      </Section>

      <Section title="Getting paid" lock hint="UPI, or a bank account with IFSC — whichever you prefer.">
        <F label="UPI ID" missing={missing.has('payout')}>
          <Input value={form.upi_id} onChange={set('upi_id')} placeholder="name@okbank" />
        </F>
        <F label="Account holder">
          <Input value={form.bank_account_name} onChange={set('bank_account_name')} />
        </F>
        <F label="Account number">
          <Input value={form.bank_account_number} onChange={set('bank_account_number')} inputMode="numeric" autoComplete="off" />
        </F>
        <F label="IFSC">
          <Input value={form.bank_ifsc} onChange={set('bank_ifsc')} placeholder="ABCD0123456" className="uppercase" />
        </F>
        {inHouse && (
          <F label="PAN" missing={missing.has('pan')}>
            <Input value={form.pan} onChange={set('pan')} placeholder="ABCDE1234F" className="uppercase" autoComplete="off" />
          </F>
        )}
      </Section>

      <div className="sticky bottom-3 flex justify-end">
        <Button onClick={submit} disabled={save.isPending} className="shadow-lg">
          {save.isPending ? <Loader2 className="animate-spin" /> : <Check />} Save profile
        </Button>
      </div>
    </section>
  )
}

function Section({ title, hint, lock, children }: { title: string; hint?: string; lock?: boolean; children: ReactNode }) {
  return (
    <Card>
      <CardContent className="p-4">
        <h2 className="flex items-center gap-1.5 font-semibold">
          {title}
          {lock && (
            <span className="inline-flex items-center gap-1 text-xs font-normal text-muted-foreground">
              <Lock className="size-3" aria-hidden /> private
            </span>
          )}
        </h2>
        {hint && <p className="mt-0.5 text-sm text-muted-foreground">{hint}</p>}
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{children}</div>
      </CardContent>
    </Card>
  )
}

function F({ label, missing, wide, children }: { label: string; missing?: boolean; wide?: boolean; children: ReactNode }) {
  return (
    <div className={cn('flex flex-col gap-1.5', wide && 'sm:col-span-2 lg:col-span-3')}>
      <Label className="flex items-center gap-1.5">
        {label}
        {missing && <span className="rounded-full bg-warning/15 px-1.5 text-[10px] font-semibold text-warning">needed</span>}
      </Label>
      {children}
    </div>
  )
}
