import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { useLocation, useNavigate } from '@tanstack/react-router'
import { Archive, ArchiveRestore, Mail, Phone, Plus, Search, Users } from 'lucide-react'
import { createContactRequest, type ContactLifecycle, type CrmContact, type CrmLead } from '@ipc/contracts'
import { describeActivity } from '@ipc/domain'
import { fieldErrors, type FieldErrors } from '@/shared/forms/field-errors'
import { AuthedPage } from '@/shared/layout/AuthedPage'
import { PageHeader } from '@/shared/layout/page-header'
import { Button } from '@/shared/ui/button'
import { Card, CardContent } from '@/shared/ui/card'
import { Dialog, DialogClose, DialogContent, DialogTrigger } from '@/shared/ui/dialog'
import { HowToUse } from '@/shared/ui/how-to-use'
import { Input, Label, Select } from '@/shared/ui/input'
import { SkeletonList } from '@/shared/ui/skeleton'
import { StatusBadge } from '@/shared/ui/status-badge'
import { EmptyState, ErrorState } from '@/shared/ui/states'
import { formatINR } from '@/shared/ui/format'
import { useIsMobile } from '@/shared/hooks/use-mobile'
import { useAccess } from '@/shared/auth/useAccess'
import { useMembers } from '@/features/allocation/api'
import { useActivities, useContact, useContacts, useCreateContact, useCrmCompanies, useDealsFor, useLogActivity, useUpdateContact } from '@/features/crm/api'
import { LeadDrawer } from '@/features/crm/LeadDrawer'
import { leadStageLabel, STAGE_TONE } from '@/features/crm/tabs/shared'

const LIFECYCLES: ReadonlyArray<{ key: ContactLifecycle; label: string }> = [
  { key: 'lead', label: 'Lead' },
  { key: 'mql', label: 'Marketing qualified' },
  { key: 'sql', label: 'Sales qualified' },
  { key: 'customer', label: 'Customer' },
  { key: 'other', label: 'Other' },
]
const LIFECYCLE_LABEL = Object.fromEntries(LIFECYCLES.map((l) => [l.key, l.label])) as Record<ContactLifecycle, string>
const LIFECYCLE_TONE: Record<ContactLifecycle, 'info' | 'warning' | 'success' | 'neutral'> = {
  lead: 'info',
  mql: 'warning',
  sql: 'warning',
  customer: 'success',
  other: 'neutral',
}

const dayFormat = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })

export function CrmContactsPage() {
  return (
    <AuthedPage module="crm">
      <Contacts />
    </AuthedPage>
  )
}

/** ?contact=<id> opens that contact, so a deal's "Contact" button and a shared link both land on it. */
function useOpenContact(): [string | null, (id: string | null) => void] {
  const { search } = useLocation()
  const navigate = useNavigate()
  const current = (search as { contact?: unknown }).contact
  const id = typeof current === 'string' ? current : null
  const set = (next: string | null) =>
    void navigate({ to: '/crm/contacts', search: (next ? { contact: next } : {}) as never, replace: true })
  return [id, set]
}

function Contacts() {
  const [q, setQ] = useState('')
  const [debounced, setDebounced] = useState('')
  const [showArchived, setShowArchived] = useState(false)
  const [openId, setOpenId] = useOpenContact()
  const { data, isLoading, isError, error, refetch } = useContacts({ q: debounced, includeArchived: showArchived })
  const isMobile = useIsMobile()

  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 250)
    return () => clearTimeout(t)
  }, [q])

  const rows = data ?? []
  // The list is filtered, capped and hides archived rows, so a link from a
  // deal would open nothing whenever the contact was not on screen. Fetch
  // the one that is missing rather than shrugging.
  const fromList = rows.find((c) => c.id === openId) ?? null
  const fetched = useContact(fromList ? null : openId)
  const open = fromList ?? fetched.data ?? null
  const missing = !!openId && !open && !fetched.isLoading

  return (
    <>
      <PageHeader
        title="Contacts"
        description="Every person your studio has spoken to — one record per number, with every deal they have had."
        actions={<NewContactDialog onAdded={setOpenId} />}
      />

      <HowToUse
        title="People, not just leads"
        description="A contact is the person; a deal is one conversation with them. Win a deal and the contact becomes a customer. Add a company to see everything under one roof."
      />

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <div className="relative min-w-64 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, phone, email or company…" className="pl-9" aria-label="Search contacts" />
        </div>
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
          Show archived
        </label>
      </div>

      <div className="mt-4">
        {isLoading ? (
          <SkeletonList rows={5} columns={5} />
        ) : isError ? (
          <ErrorState error={error} onRetry={() => void refetch()} />
        ) : rows.length === 0 ? (
          <Card>
            <CardContent className="py-4">
              <EmptyState
                title={debounced ? 'No contacts match.' : 'No contacts yet.'}
                description={debounced ? 'Try a shorter search.' : 'Every lead that arrives creates a contact; or add one by hand.'}
              />
            </CardContent>
          </Card>
        ) : isMobile ? (
          <div className="flex flex-col gap-3">
            {rows.map((c) => (
              <button key={c.id} type="button" onClick={() => setOpenId(c.id)} className="rounded-lg border border-border bg-card p-4 text-left">
                <div className="flex items-start justify-between gap-2">
                  <p className="truncate font-medium">{c.name ?? c.phone ?? 'Unnamed'}</p>
                  <StatusBadge tone={LIFECYCLE_TONE[c.lifecycle]}>{LIFECYCLE_LABEL[c.lifecycle]}</StatusBadge>
                </div>
                <p className="mt-1 truncate text-sm text-muted-foreground">{[c.phone, c.crm_company_name].filter(Boolean).join(' · ') || '—'}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {c.open_deal_count} open of {c.deal_count} deal{c.deal_count === 1 ? '' : 's'}
                </p>
              </button>
            ))}
          </div>
        ) : (
          <div className="table-wrap rounded-lg border border-border">
            <table className="table-sticky w-full text-sm">
              <thead className="bg-muted/50 text-left text-muted-foreground">
                <tr>
                  <th className="px-4 py-2 font-medium">Contact</th>
                  <th className="px-4 py-2 font-medium">Lifecycle</th>
                  <th className="px-4 py-2 font-medium">Company</th>
                  <th className="px-4 py-2 font-medium">Owner</th>
                  <th className="px-4 py-2 text-right font-medium">Deals</th>
                  <th className="px-4 py-2 font-medium">Last contact</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((c) => (
                  <tr key={c.id} onClick={() => setOpenId(c.id)} className={`cursor-pointer border-t border-border hover:bg-muted/30 ${c.is_archived ? 'opacity-60' : ''}`}>
                    <td className="px-4 py-2">
                      <span className="flex items-center gap-2 font-medium">
                        <Users className="size-4 shrink-0 text-muted-foreground" />
                        {c.name ?? 'Unnamed'}
                      </span>
                      <span className="text-xs text-muted-foreground">{[c.phone, c.email].filter(Boolean).join(' · ') || '—'}</span>
                    </td>
                    <td className="px-4 py-2">
                      <StatusBadge tone={LIFECYCLE_TONE[c.lifecycle]}>{LIFECYCLE_LABEL[c.lifecycle]}</StatusBadge>
                    </td>
                    <td className="px-4 py-2 text-muted-foreground">{c.crm_company_name ?? '—'}</td>
                    <td className="px-4 py-2 text-muted-foreground">{c.owner_name ?? 'Unassigned'}</td>
                    <td className="px-4 py-2 text-right tabular-nums text-muted-foreground">
                      {c.open_deal_count}/{c.deal_count}
                    </td>
                    <td className="px-4 py-2 text-muted-foreground">{c.last_contacted_at ? dayFormat.format(new Date(c.last_contacted_at)) : 'Never'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {missing && (
        <Dialog open onOpenChange={() => setOpenId(null)}>
          <DialogContent title="Contact not found" description="It may have been merged away or deleted.">
            <div className="flex justify-end">
              <Button onClick={() => setOpenId(null)}>Close</Button>
            </div>
          </DialogContent>
        </Dialog>
      )}
      {open && <ContactDrawer contact={open} onClose={() => setOpenId(null)} />}
    </>
  )
}

/** One person: their details, editable in place, and every deal under them. */
function ContactDrawer({ contact, onClose }: { contact: CrmContact; onClose: () => void }) {
  const update = useUpdateContact()
  const { data: members } = useMembers()
  const { data: companies } = useCrmCompanies()
  const deals = useDealsFor({ contactId: contact.id })
  const access = useAccess()
  const canEdit = access.hasAction('crm', 'edit')
  const [notes, setNotes] = useState(contact.notes ?? '')
  const [openDeal, setOpenDeal] = useState<string | null>(null)
  useEffect(() => setNotes(contact.notes ?? ''), [contact.id, contact.notes])
  const patch = (p: Parameters<typeof update.mutate>[0]['patch']) => update.mutate({ id: contact.id, patch: p })
  const dealRows = useMemo(() => deals.data ?? [], [deals.data])
  const selectedDeal = dealRows.find((d) => d.id === openDeal) ?? null

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title={contact.name ?? contact.phone ?? 'Contact'} description={`${LIFECYCLE_LABEL[contact.lifecycle]} · added ${dayFormat.format(new Date(contact.created_at))}`} className="max-w-xl">
        <div className="flex max-h-[75vh] flex-col gap-4 overflow-y-auto pr-1">
          <div className="flex flex-wrap gap-2">
            {contact.phone && (
              <Button variant="outline" size="sm" asChild>
                <a href={`tel:${contact.phone}`}>
                  <Phone /> {contact.phone}
                </a>
              </Button>
            )}
            {contact.email && (
              <Button variant="outline" size="sm" asChild>
                <a href={`mailto:${contact.email}`}>
                  <Mail /> {contact.email}
                </a>
              </Button>
            )}
            {contact.is_archived && <StatusBadge tone="neutral">Archived</StatusBadge>}
            {contact.source && <StatusBadge tone="neutral">via {contact.source}</StatusBadge>}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Name" id="ct-name">
              <Input id="ct-name" defaultValue={contact.name ?? ''} disabled={!canEdit} onBlur={(e) => { const v = e.target.value.trim() || null; if (v !== contact.name) patch({ name: v }) }} />
            </Field>
            <Field label="Phone" id="ct-phone">
              <Input id="ct-phone" defaultValue={contact.phone ?? ''} disabled={!canEdit} onBlur={(e) => { const v = e.target.value.trim() || null; if (v !== contact.phone) patch({ phone: v }) }} />
            </Field>
            <Field label="Email" id="ct-email">
              <Input id="ct-email" type="email" defaultValue={contact.email ?? ''} disabled={!canEdit} onBlur={(e) => { const v = e.target.value.trim() || null; if (v !== contact.email) patch({ email: v }) }} />
            </Field>
            <Field label="Lifecycle" id="ct-life">
              <Select id="ct-life" value={contact.lifecycle} disabled={!canEdit || update.isPending} onChange={(e) => patch({ lifecycle: e.target.value as ContactLifecycle })}>
                {LIFECYCLES.map((l) => (
                  <option key={l.key} value={l.key}>
                    {l.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Owner" id="ct-owner">
              <Select id="ct-owner" value={contact.owner_id ?? ''} disabled={!canEdit || update.isPending} onChange={(e) => patch({ owner_id: e.target.value || null })}>
                <option value="">Unassigned</option>
                {(members ?? []).map((m) => (
                  <option key={m.user_id} value={m.user_id}>
                    {m.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Company" id="ct-company">
              <Select id="ct-company" value={contact.crm_company_id ?? ''} disabled={!canEdit || update.isPending} onChange={(e) => patch({ crm_company_id: e.target.value || null })}>
                <option value="">None</option>
                {(companies ?? []).map((co) => (
                  <option key={co.id} value={co.id}>
                    {co.name}
                  </option>
                ))}
              </Select>
            </Field>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="ct-notes">Notes</Label>
            <textarea
              id="ct-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              disabled={!canEdit}
              className="w-full rounded-md border border-input bg-card px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            {canEdit && (
              <div className="flex justify-end">
                <Button size="sm" variant="outline" disabled={update.isPending || notes === (contact.notes ?? '')} onClick={() => patch({ notes: notes || null })}>
                  Save notes
                </Button>
              </div>
            )}
          </div>

          <ContactActivity contactId={contact.id} canEdit={canEdit} />

          <div className="rounded-lg border border-border p-3">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Deals</p>
            {deals.isLoading ? (
              <SkeletonList rows={2} columns={3} />
            ) : dealRows.length === 0 ? (
              <p className="mt-2 text-sm text-muted-foreground">No deals yet.</p>
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
              <Button size="sm" variant="ghost" disabled={update.isPending} onClick={() => patch({ is_archived: !contact.is_archived })}>
                {contact.is_archived ? (
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

const activityWhen = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

/**
 * What has passed between the studio and this person, across every deal.
 * Activities have always been allowed to hang off a contact rather than a
 * deal; nothing in the product could see one, or make one.
 */
function ContactActivity({ contactId, canEdit }: { contactId: string; canEdit: boolean }) {
  const { data, isLoading } = useActivities({ contactId })
  const log = useLogActivity()
  const [note, setNote] = useState('')
  const rows = data ?? []

  return (
    <div className="rounded-lg border border-border p-3">
      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Activity</p>
      {isLoading ? (
        <SkeletonList rows={2} columns={2} />
      ) : rows.length === 0 ? (
        <p className="mt-2 text-xs text-muted-foreground">Nothing logged against this person yet.</p>
      ) : (
        <ul className="mt-2 flex flex-col gap-1.5">
          {rows.slice(0, 15).map((a) => (
            <li key={a.id} className="text-xs text-muted-foreground">
              <span className="tabular-nums">{activityWhen.format(new Date(a.started_at ?? a.created_at))}</span>
              {' — '}
              {describeActivity(a)}
              {a.lead_name ? ` · ${a.lead_name}` : ''}
              {a.actor_name ? ` · ${a.actor_name}` : ''}
            </li>
          ))}
        </ul>
      )}
      {canEdit && (
        <div className="mt-2 flex items-center gap-2">
          <Input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Note about this person"
            aria-label="Note about this person"
            className="h-8 text-sm"
          />
          <Button
            size="sm"
            variant="outline"
            disabled={!note.trim() || log.isPending}
            onClick={() =>
              log.mutate(
                { contact_id: contactId, type: 'note', direction: 'none', subject: note.trim(), started_at: new Date().toISOString() },
                { onSuccess: () => setNote('') },
              )
            }
          >
            Add
          </Button>
        </div>
      )}
    </div>
  )
}

export function DealRow({ deal, onOpen }: { deal: CrmLead; onOpen: () => void }) {
  return (
    <li>
      <button type="button" onClick={onOpen} className="flex w-full flex-wrap items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent">
        <span className="min-w-0 flex-1 truncate">{deal.title ?? deal.name ?? deal.phone ?? 'Deal'}</span>
        <StatusBadge tone={STAGE_TONE[deal.status]}>{leadStageLabel(deal)}</StatusBadge>
        <span className="w-24 text-right tabular-nums text-muted-foreground">{deal.deal_value !== null ? formatINR(deal.deal_value) : '—'}</span>
      </button>
    </li>
  )
}

export function Field({ label, id, children }: { label: string; id: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
    </div>
  )
}

type NewField = 'name' | 'phone' | 'email'
const NEW_LABELS: Record<NewField, string> = { name: 'Name', phone: 'Phone', email: 'Email' }


function NewContactDialog({ onAdded }: { onAdded: (id: string) => void }) {
  const create = useCreateContact()
  const access = useAccess()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [lifecycle, setLifecycle] = useState<ContactLifecycle>('lead')
  const [companyId, setCompanyId] = useState('')
  const [notes, setNotes] = useState('')
  const { data: companies } = useCrmCompanies()
  const [errors, setErrors] = useState<FieldErrors<NewField>>({})
  if (!access.hasAction('crm', 'create')) return null

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    const body = {
      name: name.trim(),
      ...(phone.trim() ? { phone: phone.trim() } : {}),
      ...(email.trim() ? { email: email.trim() } : {}),
      lifecycle,
      ...(companyId ? { crm_company_id: companyId } : {}),
      ...(notes.trim() ? { notes: notes.trim() } : {}),
    }
    const found = fieldErrors<NewField>(createContactRequest, body, { labels: NEW_LABELS })
    setErrors(found)
    if (Object.keys(found).length > 0) return
    create.mutate(createContactRequest.parse(body), {
      onSuccess: (c) => {
        setOpen(false)
        setName('')
        setPhone('')
        setEmail('')
        setLifecycle('lead')
        setCompanyId('')
        setNotes('')
        onAdded(c.id)
      },
    })
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus /> Add contact
        </Button>
      </DialogTrigger>
      <DialogContent title="Add a contact" description="A person without a deal yet. Deals can be added from the CRM.">
        <form onSubmit={onSubmit} className="flex flex-col gap-3">
          <Field label="Name *" id="nc-name">
            <Input id="nc-name" value={name} onChange={(e) => setName(e.target.value)} aria-invalid={!!errors.name} autoFocus />
            {errors.name && <p className="text-xs text-destructive">{errors.name}</p>}
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Phone" id="nc-phone">
              <Input id="nc-phone" value={phone} onChange={(e) => setPhone(e.target.value)} aria-invalid={!!errors.phone} />
              {errors.phone && <p className="text-xs text-destructive">{errors.phone}</p>}
            </Field>
            <Field label="Email" id="nc-email">
              <Input id="nc-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} aria-invalid={!!errors.email} />
              {errors.email && <p className="text-xs text-destructive">{errors.email}</p>}
            </Field>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Lifecycle" id="nc-life">
              <Select id="nc-life" value={lifecycle} onChange={(e) => setLifecycle(e.target.value as ContactLifecycle)}>
                {LIFECYCLES.map((l) => (
                  <option key={l.key} value={l.key}>
                    {l.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Company" id="nc-company">
              <Select id="nc-company" value={companyId} onChange={(e) => setCompanyId(e.target.value)}>
                <option value="">None</option>
                {(companies ?? []).map((co) => (
                  <option key={co.id} value={co.id}>
                    {co.name}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <Field label="Notes" id="nc-notes">
            <textarea
              id="nc-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              className="w-full rounded-md border border-input bg-card px-3 py-2 text-sm"
              placeholder="What they are after, how they found you."
            />
          </Field>
          <div className="flex justify-end gap-2">
            <DialogClose asChild>
              <Button type="button" variant="outline">
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" disabled={create.isPending}>
              {create.isPending ? 'Adding…' : 'Add contact'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
