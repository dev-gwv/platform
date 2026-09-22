import { useMemo, useState, type FormEvent } from 'react'
import { useLocation, useNavigate } from '@tanstack/react-router'
import { Archive, ArchiveRestore, Building2, Globe, Phone, Plus } from 'lucide-react'
import { createCrmCompanyRequest, type CrmCompany } from '@ipc/contracts'
import { fieldErrors, type FieldErrors } from '@/shared/forms/field-errors'
import { AuthedPage } from '@/shared/layout/AuthedPage'
import { PageHeader } from '@/shared/layout/page-header'
import { Button } from '@/shared/ui/button'
import { Card, CardContent } from '@/shared/ui/card'
import { Dialog, DialogClose, DialogContent, DialogTrigger } from '@/shared/ui/dialog'
import { HowToUse } from '@/shared/ui/how-to-use'
import { Input, Select } from '@/shared/ui/input'
import { SkeletonList } from '@/shared/ui/skeleton'
import { StatusBadge } from '@/shared/ui/status-badge'
import { EmptyState, ErrorState } from '@/shared/ui/states'
import { formatINR } from '@/shared/ui/format'
import { useIsMobile } from '@/shared/hooks/use-mobile'
import { useAccess } from '@/shared/auth/useAccess'
import { useMembers } from '@/features/allocation/api'
import { useContacts, useCreateCrmCompany, useCrmCompanies, useCrmCompany, useDealsFor, useUpdateCrmCompany } from '@/features/crm/api'
import { LeadDrawer } from '@/features/crm/LeadDrawer'
import { DealRow, Field } from './contacts'

export function CrmCompaniesPage() {
  return (
    <AuthedPage module="crm">
      <Companies />
    </AuthedPage>
  )
}

function useOpenCompany(): [string | null, (id: string | null) => void] {
  const { search } = useLocation()
  const navigate = useNavigate()
  const current = (search as { company?: unknown }).company
  const id = typeof current === 'string' ? current : null
  const set = (next: string | null) =>
    void navigate({ to: '/crm/companies', search: (next ? { company: next } : {}) as never, replace: true })
  return [id, set]
}

function Companies() {
  const [showArchived, setShowArchived] = useState(false)
  const [openId, setOpenId] = useOpenCompany()
  const { data, isLoading, isError, error, refetch } = useCrmCompanies(showArchived)
  const isMobile = useIsMobile()
  const rows = data ?? []
  // A link from a deal can name a company the list is not showing.
  const fromList = rows.find((c) => c.id === openId) ?? null
  const fetched = useCrmCompany(fromList ? null : openId)
  const open = fromList ?? fetched.data ?? null
  const missing = !!openId && !open && !fetched.isLoading

  return (
    <>
      <PageHeader
        title="Companies"
        description="The organisations behind your contacts — planners, venues, corporates — with every deal under them."
        actions={<NewCompanyDialog onAdded={setOpenId} />}
      />
      <HowToUse
        title="Group contacts under the organisation they work for"
        description="Attach a company to a contact or a deal and the open value rolls up here. One planner, five weddings, one place to see them."
      />

      <div className="mt-4 flex items-center justify-end">
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
          Show archived
        </label>
      </div>

      <div className="mt-4">
        {isLoading ? (
          <SkeletonList rows={4} columns={5} />
        ) : isError ? (
          <ErrorState error={error} onRetry={() => void refetch()} />
        ) : rows.length === 0 ? (
          <Card>
            <CardContent className="py-4">
              <EmptyState title="No companies yet." description="Add one, then attach it to the contacts and deals that belong to it." />
            </CardContent>
          </Card>
        ) : isMobile ? (
          <div className="flex flex-col gap-3">
            {rows.map((c) => (
              <button key={c.id} type="button" onClick={() => setOpenId(c.id)} className="rounded-lg border border-border bg-card p-4 text-left">
                <p className="truncate font-medium">{c.name}</p>
                <p className="mt-1 truncate text-sm text-muted-foreground">{[c.city, c.domain].filter(Boolean).join(' · ') || '—'}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {c.contact_count} contact{c.contact_count === 1 ? '' : 's'} · {c.deal_count} deal{c.deal_count === 1 ? '' : 's'} · {formatINR(c.open_value)} open
                </p>
              </button>
            ))}
          </div>
        ) : (
          <div className="table-wrap rounded-lg border border-border">
            <table className="table-sticky w-full text-sm">
              <thead className="bg-muted/50 text-left text-muted-foreground">
                <tr>
                  <th className="px-4 py-2 font-medium">Company</th>
                  <th className="px-4 py-2 font-medium">City</th>
                  <th className="px-4 py-2 font-medium">Owner</th>
                  <th className="px-4 py-2 text-right font-medium">Contacts</th>
                  <th className="px-4 py-2 text-right font-medium">Deals</th>
                  <th className="px-4 py-2 text-right font-medium">Open value</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((c) => (
                  <tr key={c.id} onClick={() => setOpenId(c.id)} className={`cursor-pointer border-t border-border hover:bg-muted/30 ${c.is_archived ? 'opacity-60' : ''}`}>
                    <td className="px-4 py-2">
                      <span className="flex items-center gap-2 font-medium">
                        <Building2 className="size-4 shrink-0 text-muted-foreground" />
                        {c.name}
                      </span>
                      <span className="text-xs text-muted-foreground">{[c.domain, c.phone].filter(Boolean).join(' · ') || '—'}</span>
                    </td>
                    <td className="px-4 py-2 text-muted-foreground">{c.city ?? '—'}</td>
                    <td className="px-4 py-2 text-muted-foreground">{c.owner_name ?? 'Unassigned'}</td>
                    <td className="px-4 py-2 text-right tabular-nums text-muted-foreground">{c.contact_count}</td>
                    <td className="px-4 py-2 text-right tabular-nums text-muted-foreground">{c.deal_count}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{formatINR(c.open_value)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {missing && (
        <Dialog open onOpenChange={() => setOpenId(null)}>
          <DialogContent title="Company not found" description="It may have been deleted.">
            <div className="flex justify-end">
              <Button onClick={() => setOpenId(null)}>Close</Button>
            </div>
          </DialogContent>
        </Dialog>
      )}
      {open && <CompanyDrawer company={open} onClose={() => setOpenId(null)} />}
    </>
  )
}

function CompanyDrawer({ company, onClose }: { company: CrmCompany; onClose: () => void }) {
  const update = useUpdateCrmCompany()
  const { data: members } = useMembers()
  const contacts = useContacts({ companyId: company.id })
  const deals = useDealsFor({ companyId: company.id })
  const access = useAccess()
  const canEdit = access.hasAction('crm', 'edit')
  const [openDeal, setOpenDeal] = useState<string | null>(null)
  const patch = (p: Parameters<typeof update.mutate>[0]['patch']) => update.mutate({ id: company.id, patch: p })
  const dealRows = useMemo(() => deals.data ?? [], [deals.data])
  const selectedDeal = dealRows.find((d) => d.id === openDeal) ?? null
  const text = (key: 'name' | 'domain' | 'phone' | 'city') => (e: React.FocusEvent<HTMLInputElement>) => {
    const v = e.target.value.trim() || null
    if (v === company[key]) return
    if (key === 'name') {
      if (v) patch({ name: v })
      return
    }
    patch({ [key]: v })
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title={company.name} description={`${company.contact_count} contact${company.contact_count === 1 ? '' : 's'} · ${formatINR(company.open_value)} open`} className="max-w-xl">
        <div className="flex max-h-[75vh] flex-col gap-4 overflow-y-auto pr-1">
          <div className="flex flex-wrap gap-2">
            {company.phone && (
              <Button variant="outline" size="sm" asChild>
                <a href={`tel:${company.phone}`}>
                  <Phone /> {company.phone}
                </a>
              </Button>
            )}
            {company.domain && (
              <Button variant="outline" size="sm" asChild>
                <a href={`https://${company.domain.replace(/^https?:\/\//, '')}`} target="_blank" rel="noreferrer">
                  <Globe /> {company.domain}
                </a>
              </Button>
            )}
            {company.is_archived && <StatusBadge tone="neutral">Archived</StatusBadge>}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Name" id="co-name">
              <Input id="co-name" defaultValue={company.name} disabled={!canEdit} onBlur={text('name')} />
            </Field>
            <Field label="Website" id="co-domain">
              <Input id="co-domain" defaultValue={company.domain ?? ''} disabled={!canEdit} onBlur={text('domain')} placeholder="example.in" />
            </Field>
            <Field label="Phone" id="co-phone">
              <Input id="co-phone" defaultValue={company.phone ?? ''} disabled={!canEdit} onBlur={text('phone')} />
            </Field>
            <Field label="City" id="co-city">
              <Input id="co-city" defaultValue={company.city ?? ''} disabled={!canEdit} onBlur={text('city')} />
            </Field>
            <Field label="Notes" id="co-notes">
              <textarea
                id="co-notes"
                defaultValue={company.notes ?? ''}
                disabled={!canEdit}
                rows={2}
                className="w-full rounded-md border border-input bg-card px-3 py-2 text-sm"
                onBlur={(e) => {
                  const v = e.target.value.trim() || null
                  if (v !== company.notes) patch({ notes: v })
                }}
              />
            </Field>
            <Field label="Owner" id="co-owner">
              <Select id="co-owner" value={company.owner_id ?? ''} disabled={!canEdit || update.isPending} onChange={(e) => patch({ owner_id: e.target.value || null })}>
                <option value="">Unassigned</option>
                {(members ?? []).map((m) => (
                  <option key={m.user_id} value={m.user_id}>
                    {m.name}
                  </option>
                ))}
              </Select>
            </Field>
          </div>

          <div className="rounded-lg border border-border p-3">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Contacts</p>
            {contacts.isLoading ? (
              <SkeletonList rows={2} columns={2} />
            ) : (contacts.data ?? []).length === 0 ? (
              <p className="mt-2 text-sm text-muted-foreground">No contacts attached. Set the company on a contact to see them here.</p>
            ) : (
              <ul className="mt-2 flex flex-col gap-1 text-sm">
                {(contacts.data ?? []).map((c) => (
                  <li key={c.id} className="flex items-center justify-between gap-2">
                    <span className="truncate">{c.name ?? c.phone ?? 'Unnamed'}</span>
                    <span className="text-xs text-muted-foreground">{c.phone ?? c.email ?? ''}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="rounded-lg border border-border p-3">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Deals</p>
            {deals.isLoading ? (
              <SkeletonList rows={2} columns={3} />
            ) : dealRows.length === 0 ? (
              <p className="mt-2 text-sm text-muted-foreground">No deals under this company yet.</p>
            ) : (
              <ul className="mt-2 flex flex-col gap-1.5">
                {dealRows.map((d) => (
                  <DealRow key={d.id} deal={d} onOpen={() => setOpenDeal(d.id)} />
                ))}
              </ul>
            )}
          </div>

          {canEdit && (
            <div className="flex justify-end border-t border-border pt-3">
              <Button size="sm" variant="ghost" disabled={update.isPending} onClick={() => patch({ is_archived: !company.is_archived })}>
                {company.is_archived ? (
                  <>
                    <ArchiveRestore /> Restore
                  </>
                ) : (
                  <>
                    <Archive /> Archive
                  </>
                )}
              </Button>
            </div>
          )}
        </div>
      </DialogContent>
      {selectedDeal && <LeadDrawer lead={selectedDeal} onClose={() => setOpenDeal(null)} />}
    </Dialog>
  )
}

type NewField = 'name' | 'domain' | 'city'
const NEW_LABELS: Record<NewField, string> = { name: 'Name', domain: 'Website', city: 'City' }

function NewCompanyDialog({ onAdded }: { onAdded: (id: string) => void }) {
  const create = useCreateCrmCompany()
  const access = useAccess()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [domain, setDomain] = useState('')
  const [city, setCity] = useState('')
  const [notes, setNotes] = useState('')
  const [errors, setErrors] = useState<FieldErrors<NewField>>({})
  if (!access.hasAction('crm', 'create')) return null

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    const body = {
      name: name.trim(),
      ...(domain.trim() ? { domain: domain.trim() } : {}),
      ...(city.trim() ? { city: city.trim() } : {}),
      ...(notes.trim() ? { notes: notes.trim() } : {}),
    }
    const found = fieldErrors<NewField>(createCrmCompanyRequest, body, { labels: NEW_LABELS })
    setErrors(found)
    if (Object.keys(found).length > 0) return
    create.mutate(createCrmCompanyRequest.parse(body), {
      onSuccess: (c) => {
        setOpen(false)
        setName('')
        setDomain('')
        setCity('')
        setNotes('')
        onAdded(c.id)
      },
    })
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus /> Add company
        </Button>
      </DialogTrigger>
      <DialogContent title="Add a company" description="An organisation your contacts belong to.">
        <form onSubmit={onSubmit} className="flex flex-col gap-3">
          <Field label="Name *" id="ncp-name">
            <Input id="ncp-name" value={name} onChange={(e) => setName(e.target.value)} aria-invalid={!!errors.name} autoFocus />
            {errors.name && <p className="text-xs text-destructive">{errors.name}</p>}
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Website" id="ncp-domain">
              <Input id="ncp-domain" value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="example.in" aria-invalid={!!errors.domain} />
            </Field>
            <Field label="City" id="ncp-city">
              <Input id="ncp-city" value={city} onChange={(e) => setCity(e.target.value)} aria-invalid={!!errors.city} />
            </Field>
          </div>
          <Field label="Notes" id="ncp-notes">
            <textarea
              id="ncp-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              className="w-full rounded-md border border-input bg-card px-3 py-2 text-sm"
            />
          </Field>
          <div className="flex justify-end gap-2">
            <DialogClose asChild>
              <Button type="button" variant="outline">
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" disabled={create.isPending}>
              {create.isPending ? 'Adding…' : 'Add company'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
