import { useState, type FormEvent } from 'react'
import { Archive, ArchiveRestore, Pencil, Plus, Search } from 'lucide-react'
import type { Party } from '@ipc/contracts'
import { AuthedPage } from '@/shared/layout/AuthedPage'
import { PageHeader } from '@/shared/layout/page-header'
import { Button } from '@/shared/ui/button'
import { Dialog, DialogContent } from '@/shared/ui/dialog'
import { Input, Label, Textarea } from '@/shared/ui/input'
import { SkeletonList } from '@/shared/ui/skeleton'
import { EmptyState, ErrorState } from '@/shared/ui/states'
import { cn } from '@/shared/ui/cn'
import { TONE_CHIP } from '@/shared/ui/tones'
import { useCreateParty, useParties, useUpdateParty } from '@/features/parties/api'

type Kind = Party['kind']
const KINDS: Array<{ value: Kind; label: string; tone: string }> = [
  { value: 'vendor', label: 'Vendor', tone: TONE_CHIP.blue },
  { value: 'freelancer', label: 'Freelancer', tone: TONE_CHIP.violet },
  { value: 'other', label: 'Other', tone: TONE_CHIP.slate },
]
const kindOf = (k: Kind) => KINDS.find((x) => x.value === k) ?? KINDS[2]!

export function VendorsPage() {
  return (
    <AuthedPage module="company_expenses">
      <Vendors />
    </AuthedPage>
  )
}

/**
 * The people and shops the studio pays: the album printer, the drone pilot,
 * the hall. Added on the fly from an expense; here a name, phone, GSTIN or
 * address is filled in, and someone the studio no longer uses is archived --
 * they leave the expense picker, and every expense paid to them keeps the name.
 */
function Vendors() {
  const [search, setSearch] = useState('')
  const [kind, setKind] = useState<Kind | ''>('')
  const [archived, setArchived] = useState(false)
  const parties = useParties({ search, kind, active: archived ? 'false' : 'true' })
  const [editing, setEditing] = useState<Party | 'new' | null>(null)

  const rows = parties.data ?? []

  return (
    <>
      <PageHeader
        title="Vendors"
        actions={
          <Button onClick={() => setEditing('new')}>
            <Plus /> Add vendor
          </Button>
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full max-w-xs">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by name" aria-label="Search vendors" className="pl-8" />
        </div>
        <div className="flex flex-wrap gap-1" role="group" aria-label="Kind">
          {[{ value: '' as const, label: 'All', tone: '' }, ...KINDS].map((k) => (
            <button
              key={k.value || 'all'}
              type="button"
              aria-pressed={kind === k.value}
              onClick={() => setKind(k.value)}
              className={cn(
                'rounded-full border px-3 py-1 text-xs font-medium',
                kind === k.value ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-card text-muted-foreground hover:text-foreground',
              )}
            >
              {k.label}
            </button>
          ))}
        </div>
        <button
          type="button"
          aria-pressed={archived}
          onClick={() => setArchived((v) => !v)}
          className={cn(
            'rounded-full border px-3 py-1 text-xs font-medium',
            archived ? 'border-primary bg-primary/10 text-primary' : 'border-border bg-card text-muted-foreground hover:text-foreground',
          )}
        >
          {archived ? 'Showing archived' : 'Archived'}
        </button>
      </div>

      <div className="mt-3">
        {parties.isLoading ? (
          <SkeletonList rows={4} columns={3} />
        ) : parties.isError ? (
          <ErrorState onRetry={() => void parties.refetch()} />
        ) : rows.length === 0 ? (
          <EmptyState
            title={archived ? 'Nobody archived' : search || kind ? 'No vendor matches' : 'No vendors yet'}
            {...(archived || search || kind ? {} : { description: 'Add one here, or pick “+ Add new party” while recording an expense.' })}
          />
        ) : (
          <ul className="flex flex-col gap-1.5">
            {rows.map((p) => (
              <VendorRow key={p.id} party={p} onEdit={() => setEditing(p)} />
            ))}
          </ul>
        )}
      </div>

      {editing && <VendorDialog party={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </>
  )
}

function VendorRow({ party, onEdit }: { party: Party; onEdit: () => void }) {
  const update = useUpdateParty()
  const k = kindOf(party.kind)
  const active = party.is_active !== false
  const details = [party.phone, party.email, party.gstin ? `GSTIN ${party.gstin}` : null, party.state].filter(Boolean)
  return (
    <li className={cn('flex flex-wrap items-center gap-3 rounded-lg border border-border bg-card px-3 py-2', !active && 'opacity-70')}>
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-2 text-sm font-medium">
          <span className="truncate">{party.name}</span>
          <span className={cn('rounded-full border px-2 py-0.5 text-[11px] font-medium', k.tone)}>{k.label}</span>
        </p>
        {details.length > 0 ? (
          <p className="truncate text-xs text-muted-foreground">{details.join(' · ')}</p>
        ) : (
          <button type="button" onClick={onEdit} className="text-xs font-medium text-warning hover:underline">
            Add phone or GSTIN
          </button>
        )}
      </div>
      <Button size="sm" variant="outline" onClick={onEdit}>
        <Pencil /> Edit
      </Button>
      <Button
        size="sm"
        variant="outline"
        disabled={update.isPending}
        onClick={() => update.mutate({ id: party.id, patch: { is_active: !active } })}
        title={active ? 'Leaves the expense picker; past expenses keep the name' : 'Back in the expense picker'}
      >
        {active ? (
          <>
            <Archive /> Archive
          </>
        ) : (
          <>
            <ArchiveRestore /> Bring back
          </>
        )}
      </Button>
    </li>
  )
}

function VendorDialog({ party, onClose }: { party: Party | null; onClose: () => void }) {
  const create = useCreateParty()
  const update = useUpdateParty()
  const [f, setF] = useState({
    name: party?.name ?? '',
    kind: party?.kind ?? ('vendor' as Kind),
    phone: party?.phone ?? '',
    email: party?.email ?? '',
    gstin: party?.gstin ?? '',
    state: party?.state ?? '',
    address: party?.address ?? '',
  })
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((v) => ({ ...v, [k]: e.target.value }))
  const busy = create.isPending || update.isPending

  async function onSave(e: FormEvent) {
    e.preventDefault()
    if (!f.name.trim()) return
    const opt = (v: string) => v.trim() || null
    const body = {
      name: f.name.trim(),
      kind: f.kind,
      phone: opt(f.phone),
      email: opt(f.email),
      gstin: opt(f.gstin.toUpperCase()),
      state: opt(f.state),
      address: opt(f.address),
    }
    if (party) await update.mutateAsync({ id: party.id, patch: body })
    else await create.mutateAsync(body)
    onClose()
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title={party ? `Edit ${party.name}` : 'Add vendor'}>
        <form onSubmit={(e) => void onSave(e)} className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="v-name">Name</Label>
            <Input id="v-name" value={f.name} onChange={set('name')} maxLength={120} autoFocus className={cn(!f.name.trim() && 'border-warning/60')} />
          </div>
          <div className="flex flex-wrap gap-1" role="group" aria-label="Kind">
            {KINDS.map((k) => (
              <button
                key={k.value}
                type="button"
                aria-pressed={f.kind === k.value}
                onClick={() => setF((v) => ({ ...v, kind: k.value }))}
                className={cn('rounded-full border px-3 py-1 text-xs font-medium', f.kind === k.value ? k.tone : 'border-border bg-card text-muted-foreground')}
              >
                {k.label}
              </button>
            ))}
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="v-phone">Phone</Label>
              <Input id="v-phone" value={f.phone} onChange={set('phone')} inputMode="tel" maxLength={40} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="v-email">Email</Label>
              <Input id="v-email" type="email" value={f.email} onChange={set('email')} maxLength={200} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="v-gstin">GSTIN</Label>
              <Input id="v-gstin" value={f.gstin} onChange={set('gstin')} maxLength={20} className="uppercase" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="v-state">State</Label>
              <Input id="v-state" value={f.state} onChange={set('state')} maxLength={80} />
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="v-address">Address</Label>
            <Textarea id="v-address" value={f.address} onChange={set('address')} maxLength={400} rows={2} />
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={!f.name.trim() || busy}>
              {busy ? 'Saving…' : 'Save'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
