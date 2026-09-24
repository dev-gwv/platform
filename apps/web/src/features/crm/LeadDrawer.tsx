import { useEffect, useRef, useState } from 'react'
import { Link } from '@tanstack/react-router'
import {
  Archive,
  ArchiveRestore,
  Building2,
  Check,
  Contact,
  Copy,
  Flame,
  FolderPlus,
  Mail,
  MessageCircle,
  Phone,
  Repeat,
  Square,
} from 'lucide-react'
import { toast } from 'sonner'
import type { CrmLead, CrmQuote, LeadQuality } from '@ipc/contracts'
import { REQUIRED_FIELD_LABEL, missingForStage, sortStages } from '@ipc/domain'
import { Button } from '@/shared/ui/button'
import { Dialog, DialogContent } from '@/shared/ui/dialog'
import { Input, Label, Select } from '@/shared/ui/input'
import { StatusBadge } from '@/shared/ui/status-badge'
import { cn } from '@/shared/ui/cn'
import { formatINR } from '@/shared/ui/format'
import { useAccess } from '@/shared/auth/useAccess'
import { useMembers } from '@/features/allocation/api'
import { useClients } from '@/features/clients/api'
import {
  useCadences,
  useConvertLead,
  useContacts,
  useCrmCompanies,
  useCrmSettings,
  useEnrollWorkflow,
  useExitEnrollment,
  useLeadCadence,
  useLeadEnrollments,
  useMoveStage,
  usePipelines,
  useQuotes,
  useSendTemplate,
  useStartCadence,
  useStopCadence,
  useTemplates,
  useUpdateLead,
  useWorkflows,
} from './api'
import { QuoteBuilder } from './QuoteBuilder'
import { QuoteRow } from './tabs/QuotesTab'
import { ScoreBadge } from './tabs/shared'
import { LostReasonDialog } from './LostReasonDialog'
import { Timeline } from './Timeline'
import { LookupSelect } from '@/features/settings/LookupSelect'
import { EVENT_TYPE_DEFAULTS } from './event-types'
import { STAGE_LABEL, dueBucket } from './leads'

/** A datetime-local value from an ISO string, in the viewer's own timezone. */
function toLocalInput(iso: string | null): string {
  if (!iso) return ''
  const at = new Date(iso)
  if (Number.isNaN(at.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}T${pad(at.getHours())}:${pad(at.getMinutes())}`
}

const QUICK_DATES: ReadonlyArray<{ label: string; days: number }> = [
  { label: 'Tomorrow', days: 1 },
  { label: 'In 3 days', days: 3 },
  { label: 'Next week', days: 7 },
]

const when = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

/**
 * The whole lead on one surface: who they are, where the conversation is, and
 * when it continues. Everything saves on the spot — this is opened between
 * phone calls, not filled in like a form.
 */
export function LeadDrawer({ lead, onClose }: { lead: CrmLead; onClose: () => void }) {
  const update = useUpdateLead('Lead updated')
  const send = useSendTemplate()
  const { data: members } = useMembers()
  const { data: templates } = useTemplates()
  const access = useAccess()
  const canEdit = access.hasAction('crm', 'edit')
  const [notes, setNotes] = useState(lead.notes ?? '')
  const [followUp, setFollowUp] = useState(toLocalInput(lead.follow_up_at))
  const [copied, setCopied] = useState(false)
  const move = useMoveStage()
  const { data: pipelines } = usePipelines()
  const { data: companies } = useCrmCompanies()
  const { data: contacts } = useContacts()
  const { data: settings } = useCrmSettings()
  const [losingTo, setLosingTo] = useState<string | null>(null)
  const pipeline = (pipelines ?? []).find((p) => p.id === lead.pipeline_id) ?? (pipelines ?? []).find((p) => p.is_default)
  const stages = pipeline ? sortStages(pipeline.stages) : []

  function moveTo(stageId: string) {
    const stage = stages.find((s) => s.id === stageId)
    if (!stage || stage.id === lead.stage_id) return
    if (stage.kind === 'lost') {
      setLosingTo(stage.id)
      return
    }
    const missing = missingForStage(stage.required_fields, lead)
    if (missing.length > 0) {
      toast.error(`Fill in ${missing.map((m) => REQUIRED_FIELD_LABEL[m] ?? m).join(', ')} before moving to ${stage.name}.`)
      return
    }
    move.mutate({ leadId: lead.id, stage_id: stage.id })
  }

  // A refetch can land while this is open; take the server's version unless the
  // person is mid-edit on that field.
  useEffect(() => {
    setNotes(lead.notes ?? '')
    setFollowUp(toLocalInput(lead.follow_up_at))
  }, [lead.id, lead.notes, lead.follow_up_at])

  const patch = (p: Parameters<typeof update.mutate>[0]['patch']) => update.mutate({ id: lead.id, patch: p })
  const bucket = dueBucket(lead, new Date())
  const sendable = (templates ?? []).filter((t) => t.kind !== 'note')

  function sendTemplate(templateId: string, channel: 'whatsapp' | 'email') {
    send.mutate(
      { leadId: lead.id, template_id: templateId, channel },
      {
        onSuccess: (r) => {
          if (r.delivery === 'api') {
            toast.success('Sent on WhatsApp')
            return
          }
          if (!r.url) return
          const w = window.open(r.url, '_blank', 'noopener')
          if (!w) {
            void navigator.clipboard.writeText(r.rendered)
            toast.message('Pop-up blocked — the message is on your clipboard.')
          }
        },
      },
    )
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        title={lead.name ?? 'Unnamed lead'}
        description={`${lead.source} · added ${new Date(lead.created_at).toLocaleDateString('en-IN')}`}
        className="max-w-xl"
      >
        <div className="flex max-h-[75vh] flex-col gap-4 overflow-y-auto pr-1">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge tone={lead.is_hot ? 'danger' : 'neutral'}>{lead.is_hot ? 'Hot lead' : 'Normal'}</StatusBadge>
            <ScoreBadge score={lead.score} hotScore={settings?.hot_score ?? 60} />
            {lead.is_archived && <StatusBadge tone="neutral">Archived</StatusBadge>}
            {bucket === 'overdue' && <StatusBadge tone="danger">Follow-up overdue</StatusBadge>}
            {bucket === 'today' && <StatusBadge tone="warning">Due today</StatusBadge>}
            {lead.last_contacted_at === null && <StatusBadge tone="warning">Never contacted</StatusBadge>}
            {lead.converted_project_id && (
              <Button size="sm" variant="ghost" asChild>
                <Link to="/projects/$id" params={{ id: lead.converted_project_id }}>
                  Open project
                </Link>
              </Button>
            )}
            {lead.converted_client_id && (
              <Button size="sm" variant="ghost" asChild>
                <Link to="/clients" search={{ client: lead.converted_client_id } as never}>
                  Open client
                </Link>
              </Button>
            )}
            {lead.contact_id && (
              <Button size="sm" variant="ghost" asChild>
                <Link to="/crm/contacts" search={{ contact: lead.contact_id } as never}>
                  <Contact /> Contact
                </Link>
              </Button>
            )}
            {lead.crm_company_id && (
              <Button size="sm" variant="ghost" asChild>
                <Link to="/crm/companies" search={{ company: lead.crm_company_id } as never}>
                  <Building2 /> {lead.crm_company_name ?? 'Company'}
                </Link>
              </Button>
            )}
          </div>

          {/* Reaching the person is the point of the screen, so it comes first. */}
          <div className="flex flex-wrap gap-2">
            {lead.phone && (
              <>
                <Button variant="outline" size="sm" asChild>
                  <a href={`tel:${lead.phone}`}>
                    <Phone /> {lead.phone}
                  </a>
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    void navigator.clipboard.writeText(lead.phone!)
                    setCopied(true)
                    toast.success('Number copied')
                  }}
                >
                  {copied ? <Check /> : <Copy />} Copy
                </Button>
              </>
            )}
            {lead.email && (
              <Button variant="outline" size="sm" asChild>
                <a href={`mailto:${lead.email}`}>
                  <Mail /> {lead.email}
                </a>
              </Button>
            )}
            {canEdit && (
              <Button variant={lead.is_hot ? 'default' : 'outline'} size="sm" onClick={() => patch({ is_hot: !lead.is_hot })}>
                <Flame /> {lead.is_hot ? 'Hot' : 'Mark hot'}
              </Button>
            )}
          </div>

          {canEdit && sendable.length > 0 && (
            <div className="rounded-lg border border-border p-3">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Send a template</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Sends from the studio's WhatsApp when connected, otherwise opens your own app with the message filled in. Either way the lead is marked contacted.
              </p>
              <ul className="mt-2 flex flex-col gap-1.5">
                {sendable.map((t) => (
                  <li key={t.id} className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="min-w-0 flex-1 truncate">{t.name}</span>
                    {lead.phone && (
                      <Button size="sm" variant="outline" disabled={send.isPending} onClick={() => sendTemplate(t.id, 'whatsapp')}>
                        <MessageCircle /> WhatsApp
                      </Button>
                    )}
                    {lead.email && (
                      <Button size="sm" variant="outline" disabled={send.isPending} onClick={() => sendTemplate(t.id, 'email')}>
                        <Mail /> Email
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="lead-stage">Stage{pipeline ? ` · ${pipeline.name}` : ''}</Label>
              <Select
                id="lead-stage"
                value={lead.stage_id ?? ''}
                onChange={(e) => moveTo(e.target.value)}
                disabled={move.isPending || !canEdit || stages.length === 0}
              >
                {stages.length === 0 && <option value="">{STAGE_LABEL[lead.status]}</option>}
                {stages.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                    {s.required_fields.length > 0 ? ' *' : ''}
                  </option>
                ))}
              </Select>
              {lead.lost_reason && (
                <p className="text-xs text-muted-foreground">
                  Lost: {lead.lost_reason}
                  {lead.lost_competitor ? ` · to ${lead.lost_competitor}` : ''}
                </p>
              )}
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="lead-owner">Owner</Label>
              <Select id="lead-owner" value={lead.assigned_to ?? ''} onChange={(e) => patch({ assigned_to: e.target.value || null })} disabled={update.isPending || !canEdit}>
                <option value="">Unassigned</option>
                {(members ?? []).map((m) => (
                  <option key={m.user_id} value={m.user_id}>
                    {m.name}
                  </option>
                ))}
              </Select>
            </div>
            {/* Hot / warm / cold. The Mark hot button above only ever set the
                binary flag; a trigger keeps the two consistent either way, so
                picking "hot" here lights that button up too. */}
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="lead-quality">Quality</Label>
              <Select
                id="lead-quality"
                value={lead.quality ?? ''}
                onChange={(e) => patch({ quality: (e.target.value || null) as LeadQuality | null })}
                disabled={update.isPending || !canEdit}
              >
                <option value="">Not rated yet</option>
                <option value="hot">Hot — ready to book</option>
                <option value="warm">Warm — interested, no date</option>
                <option value="cold">Cold — just looking</option>
              </Select>
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="lead-title">Deal title</Label>
              <Input id="lead-title" defaultValue={lead.title ?? ''} placeholder={`${lead.name ?? 'New'} wedding`} disabled={!canEdit}
                onBlur={(e) => { const v = e.target.value.trim() || null; if (v !== lead.title) patch({ title: v }) }} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="lead-company">Company</Label>
              <Select id="lead-company" value={lead.crm_company_id ?? ''} onChange={(e) => patch({ crm_company_id: e.target.value || null })} disabled={update.isPending || !canEdit}>
                <option value="">None</option>
                {(companies ?? []).map((co) => (
                  <option key={co.id} value={co.id}>
                    {co.name}
                  </option>
                ))}
              </Select>
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="lead-contact">Contact</Label>
              <Select
                id="lead-contact"
                value={lead.contact_id ?? ''}
                onChange={(e) => patch({ contact_id: e.target.value || null })}
                disabled={update.isPending || !canEdit}
              >
                <option value="">None</option>
                {(contacts ?? []).map((ct) => (
                  <option key={ct.id} value={ct.id}>
                    {ct.name ?? ct.phone ?? ct.email ?? 'Unnamed'}
                  </option>
                ))}
              </Select>
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="lead-event-type">Event type</Label>
              {canEdit ? (
                <LookupSelect
                  category="project_type"
                  id="lead-event-type"
                  aria-label="Event type"
                  value={lead.event_type ?? ''}
                  onChange={(v) => { const next = v || null; if (next !== lead.event_type) patch({ event_type: next }) }}
                  defaults={EVENT_TYPE_DEFAULTS}
                  placeholder="—"
                  addLabel="Add an event type…"
                  inputPlaceholder="e.g. Baby shower"
                />
              ) : (
                <Input id="lead-event-type" value={lead.event_type ?? ''} disabled readOnly />
              )}
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="lead-event-date">Event date</Label>
              <Input id="lead-event-date" type="date" defaultValue={lead.event_date ?? ''} disabled={!canEdit}
                onBlur={(e) => { const v = e.target.value || null; if (v !== lead.event_date) patch({ event_date: v }) }} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="lead-event-location">Venue / location</Label>
              <Input id="lead-event-location" defaultValue={lead.event_location ?? ''} disabled={!canEdit}
                onBlur={(e) => { const v = e.target.value.trim() || null; if (v !== lead.event_location) patch({ event_location: v }) }} />
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="lead-city">City</Label>
              <Input id="lead-city" defaultValue={lead.city ?? ''} disabled={!canEdit}
                onBlur={(e) => { const v = e.target.value.trim() || null; if (v !== lead.city) patch({ city: v }) }} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="lead-alt-phone">Alternate phone</Label>
              <Input id="lead-alt-phone" defaultValue={lead.alternate_phone ?? ''} disabled={!canEdit}
                onBlur={(e) => { const v = e.target.value.trim() || null; if (v !== lead.alternate_phone) patch({ alternate_phone: v }) }} />
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="lead-group">Group / tag</Label>
            <Input id="lead-group" defaultValue={lead.group_name ?? ''} placeholder="e.g. Hot Lead, Already Booked" disabled={!canEdit}
              onBlur={(e) => { const v = e.target.value.trim() || null; if (v !== lead.group_name) patch({ group_name: v }) }} />
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="lead-value">Deal value (₹)</Label>
              <Input id="lead-value" type="number" min={0} defaultValue={lead.deal_value ?? ''} placeholder="0" disabled={!canEdit}
                onBlur={(e)=>{ const v = e.target.value ? Number(e.target.value) : null; if (v !== lead.deal_value) patch({ deal_value: v })}} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="lead-prob">Probability %</Label>
              <Input id="lead-prob" type="number" min={0} max={100} defaultValue={lead.probability ?? ''} placeholder="auto" disabled={!canEdit}
                onBlur={(e)=>{ const v = e.target.value === '' ? null : Number(e.target.value); if (v !== lead.probability) patch({ probability: v })}} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="lead-close">Expected close</Label>
              <Input id="lead-close" type="date" defaultValue={lead.close_date ?? ''} disabled={!canEdit}
                onBlur={(e) => { const v = e.target.value || null; if (v !== lead.close_date) patch({ close_date: v }) }} />
            </div>
          </div>
          <LostReasonDialog
            open={losingTo !== null}
            pending={move.isPending}
            onCancel={() => setLosingTo(null)}
            onConfirm={(d) => {
              if (!losingTo) return
              move.mutate({ leadId: lead.id, stage_id: losingTo, ...d }, { onSuccess: () => setLosingTo(null) })
            }}
          />
          {lead.sla_due_at && !['converted','lost'].includes(lead.status) && (
            <p className={`text-xs font-medium ${new Date(lead.sla_due_at).getTime() < Date.now() ? 'text-destructive' : 'text-muted-foreground'}`}>
              SLA {new Date(lead.sla_due_at).getTime() < Date.now() ? 'breached' : 'due'} {when.format(new Date(lead.sla_due_at))} · {lead.probability ?? 10}% · ₹{lead.deal_value ?? 0}
            </p>
          )}

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="lead-followup">Next follow-up</Label>
            <div className="flex flex-wrap items-center gap-2">
              <Input id="lead-followup" type="datetime-local" value={followUp} onChange={(e) => setFollowUp(e.target.value)} className="w-56" disabled={!canEdit} />
              <Button
                size="sm"
                disabled={update.isPending || !canEdit || followUp === toLocalInput(lead.follow_up_at)}
                onClick={() => patch({ follow_up_at: followUp ? new Date(followUp).toISOString() : null })}
              >
                Set
              </Button>
              {lead.follow_up_at && canEdit && (
                <Button size="sm" variant="ghost" onClick={() => patch({ follow_up_at: null })} disabled={update.isPending}>
                  Clear
                </Button>
              )}
            </div>
            {canEdit && (
              <div className="mt-1 flex flex-wrap gap-1.5">
                {QUICK_DATES.map((q) => (
                  <button
                    key={q.label}
                    type="button"
                    onClick={() => {
                      const at = new Date()
                      at.setDate(at.getDate() + q.days)
                      at.setHours(10, 0, 0, 0)
                      patch({ follow_up_at: at.toISOString() })
                    }}
                    className={cn(
                      'rounded-full border border-border px-2.5 py-1 text-xs text-muted-foreground',
                      'transition-colors hover:border-primary/40 hover:text-foreground',
                    )}
                  >
                    {q.label}
                  </button>
                ))}
              </div>
            )}
          </div>

          {canEdit && <CadencePanel lead={lead} />}
          {canEdit && <WorkflowPanel lead={lead} />}

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="lead-notes">Notes</Label>
            <textarea
              id="lead-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={4}
              disabled={!canEdit}
              placeholder="What was said, what they asked for, what you promised."
              className="w-full rounded-md border border-input bg-card px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            {canEdit && (
              <div className="flex justify-end">
                <Button size="sm" variant="outline" disabled={update.isPending || notes === (lead.notes ?? '')} onClick={() => patch({ notes })}>
                  Save notes
                </Button>
              </div>
            )}
          </div>

          {/*
            * Both converts count. Offering the panel again to a lead that was
            * converted client-only is how one enquiry ends up as two clients,
            * each with its own projects and invoices.
            */}
          {canEdit && !lead.converted_project_id && !lead.converted_client_id && lead.status !== 'lost' && (
            <ConvertPanel lead={lead} onDone={onClose} />
          )}

          <QuotesPanel lead={lead} canEdit={canEdit} />

          <Timeline lead={lead} />

          {canEdit && (
            <div className="flex justify-end border-t border-border pt-3">
              <Button size="sm" variant="ghost" disabled={update.isPending} onClick={() => patch({ is_archived: !lead.is_archived })}>
                {lead.is_archived ? (
                  <>
                    <ArchiveRestore /> Restore to inbox
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
    </Dialog>
  )
}

/** Priced offers on this deal: build one, send its link, watch it land. */
function QuotesPanel({ lead, canEdit }: { lead: CrmLead; canEdit: boolean }) {
  const { data: quotes } = useQuotes(lead.id)
  const [building, setBuilding] = useState(false)
  const [editing, setEditing] = useState<CrmQuote | null>(null)
  const rows = (quotes ?? []).filter((q) => q.lead_id === lead.id)

  return (
    <div className="rounded-lg border border-border p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Quotes ({rows.length})
        </p>
        {canEdit && (
          <Button size="sm" variant="outline" onClick={() => setBuilding(true)}>
            New quote
          </Button>
        )}
      </div>
      {rows.length > 0 ? (
        <ul className="mt-2 divide-y divide-border">
          {rows.map((q) => (
            <QuoteRow key={q.id} quote={q} compact onEdit={q.status === 'draft' && canEdit ? () => setEditing(q) : undefined} />
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-xs text-muted-foreground">
          No quotes yet. One becomes the number the project is built from.
        </p>
      )}
      {building && <QuoteBuilder lead={lead} open onClose={() => setBuilding(false)} />}
      {editing && <QuoteBuilder lead={lead} quote={editing} open onClose={() => setEditing(null)} />}
    </div>
  )
}

/** The follow-up sequence this lead is on, or the one to put it on. */
function CadencePanel({ lead }: { lead: CrmLead }) {
  const { data: current } = useLeadCadence(lead.id)
  const { data: cadences } = useCadences()
  const start = useStartCadence()
  const stop = useStopCadence()
  const [pick, setPick] = useState('')
  const options = (cadences ?? []).filter((c) => c.is_active && c.steps.length > 0)
  const closed = lead.status === 'converted' || lead.status === 'lost'
  const running = current && !current.completed_at && !current.stopped_at

  if (options.length === 0 && !current) return null

  return (
    <div className="rounded-lg border border-border p-3">
      <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        <Repeat className="size-3.5" /> Cadence
      </p>
      {running ? (
        <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
          <span className="font-medium">{current.cadence_name}</span>
          <StatusBadge tone="info">
            step {current.step_no} of {current.total_steps}
          </StatusBadge>
          {current.next_at && <span className="text-muted-foreground">next {when.format(new Date(current.next_at))}</span>}
          <Button size="sm" variant="ghost" className="ml-auto" disabled={stop.isPending} onClick={() => stop.mutate(lead.id)}>
            <Square /> Stop
          </Button>
        </div>
      ) : (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {current && (
            <span className="text-xs text-muted-foreground">
              {current.cadence_name} {current.completed_at ? 'completed' : 'stopped'}.
            </span>
          )}
          {!closed && options.length > 0 && (
            <>
              <Select value={pick} onChange={(e) => setPick(e.target.value)} className="w-56" aria-label="Cadence">
                <option value="">Put on a cadence…</option>
                {options.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} · {c.steps.length} step{c.steps.length === 1 ? '' : 's'}
                  </option>
                ))}
              </Select>
              <Button size="sm" disabled={!pick || start.isPending} onClick={() => start.mutate({ leadId: lead.id, cadence_id: pick }, { onSuccess: () => setPick('') })}>
                Start
              </Button>
            </>
          )}
        </div>
      )}
    </div>
  )
}

/** The workflows this deal is in, and the one to put it in. */
function WorkflowPanel({ lead }: { lead: CrmLead }) {
  const { data: enrollments } = useLeadEnrollments(lead.id)
  const { data: workflows } = useWorkflows()
  const enroll = useEnrollWorkflow()
  const exit = useExitEnrollment()
  const [pick, setPick] = useState('')
  const active = (enrollments ?? []).filter((e) => e.status === 'active')
  const options = (workflows ?? []).filter((w) => w.is_active && !active.some((e) => e.workflow_id === w.id))
  if (options.length === 0 && active.length === 0) return null
  return (
    <div className="rounded-lg border border-border p-3">
      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Workflows</p>
      {active.length > 0 && (
        <ul className="mt-2 flex flex-col gap-1 text-sm">
          {active.map((e) => (
            <li key={e.id} className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{e.workflow_name ?? 'Workflow'}</span>
              <StatusBadge tone="info">step {e.current_step}</StatusBadge>
              {e.next_at && <span className="text-xs text-muted-foreground">next {when.format(new Date(e.next_at))}</span>}
              <Button size="sm" variant="ghost" className="ml-auto" disabled={exit.isPending} onClick={() => exit.mutate(e.id)}>
                <Square /> Stop
              </Button>
            </li>
          ))}
        </ul>
      )}
      {options.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Select value={pick} onChange={(e) => setPick(e.target.value)} className="w-56" aria-label="Workflow">
            <option value="">Enroll in a workflow…</option>
            {options.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </Select>
          <Button size="sm" disabled={!pick || enroll.isPending} onClick={() => enroll.mutate({ workflowId: pick, lead_ids: [lead.id] }, { onSuccess: () => setPick('') })}>
            Enroll
          </Button>
        </div>
      )}
    </div>
  )
}

/** Won it? Make it a project, with the client it belongs to. */
function ConvertPanel({ lead, onDone }: { lead: CrmLead; onDone: () => void }) {
  const convert = useConvertLead()
  const { data: clients } = useClients()
  const clientList = Array.isArray(clients) ? clients : []
  const { data: quotes } = useQuotes(lead.id)
  const [open, setOpen] = useState(false)
  const [clientId, setClientId] = useState('')
  const [quoteId, setQuoteId] = useState('')
  const [name, setName] = useState(`${lead.name ?? 'New'} project`)
  const [cost, setCost] = useState('')
  const [error, setError] = useState<string | null>(null)

  // A client with this number is very likely the same person.
  const digits = (lead.phone ?? '').replace(/\D/g, '').slice(-10)
  const match = digits ? clientList.find((c) => (c.phone ?? '').replace(/\D/g, '').endsWith(digits)) : undefined
  const rows = (quotes ?? []).filter((q) => q.lead_id === lead.id)
  const accepted = rows.find((q) => q.status === 'accepted')

  useEffect(() => {
    if (match && !clientId) setClientId(match.id)
  }, [match, clientId])

  // The accepted quote is what the client agreed to, so it is the default —
  // once. `picked` latches so choosing "no quote" afterwards sticks.
  const picked = useRef(false)
  useEffect(() => {
    if (picked.current || !accepted) return
    picked.current = true
    setQuoteId(accepted.id)
    setCost(String(accepted.total))
    if (accepted.title) setName(accepted.title)
  }, [accepted])

  if (!open) {
    return (
      <div className="flex justify-end">
        <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
          <FolderPlus /> Convert to project
        </Button>
      </div>
    )
  }

  function submit() {
    setError(null)
    const amount = Number(cost || 0)
    if (!name.trim()) return setError('Name the project.')
    if (Number.isNaN(amount) || amount < 0) return setError('Package cost must be a number.')
    convert.mutate(
      {
        leadId: lead.id,
        ...(clientId ? { client_id: clientId } : {}),
        ...(quoteId ? { quote_id: quoteId } : {}),
        project: { name: name.trim(), package_cost: amount, status: 'active' },
      },
      { onSuccess: () => onDone() },
    )
  }

  return (
    <div className="rounded-lg border border-primary/30 bg-primary/5 p-3">
      <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        <FolderPlus className="size-3.5" /> Convert to project
      </p>
      <p className="mt-0.5 text-xs text-muted-foreground">
        Marks the lead won and creates the project. {match ? 'A client with this number already exists.' : 'A client is created from the lead unless you pick one.'}
      </p>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1 sm:col-span-2">
          <Label htmlFor="conv-client">Client</Label>
          <Select id="conv-client" value={clientId} onChange={(e) => setClientId(e.target.value)}>
            <option value="">Create “{lead.name ?? lead.phone ?? 'New client'}”</option>
            {clientList.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
                {c.phone ? ` · ${c.phone}` : ''}
              </option>
            ))}
          </Select>
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="conv-name">Project name</Label>
          <Input id="conv-name" value={name} onChange={(e) => setName(e.target.value)} aria-invalid={!!error && !name.trim()} />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="conv-cost">Package (₹)</Label>
          <Input id="conv-cost" type="number" min={0} value={cost} onChange={(e) => setCost(e.target.value)} placeholder="0" />
        </div>
        {rows.length > 0 && (
          <div className="flex flex-col gap-1 sm:col-span-2">
            <Label htmlFor="conv-quote">Build it from a quote</Label>
            <Select
              id="conv-quote"
              value={quoteId}
              onChange={(e) => {
                setQuoteId(e.target.value)
                const q = rows.find((x) => x.id === e.target.value)
                if (q) setCost(String(q.total))
              }}
            >
              <option value="">No quote — package cost only</option>
              {rows.map((q) => (
                <option key={q.id} value={q.id}>
                  {q.quote_number} · {q.status} · {formatINR(q.total)}
                </option>
              ))}
            </Select>
            <p className="text-xs text-muted-foreground">
              The quote's lines become the project's deliverables and show on its quotation.
            </p>
          </div>
        )}
      </div>
      {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
      <div className="mt-3 flex justify-end gap-2">
        <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
        <Button size="sm" disabled={convert.isPending} onClick={submit}>
          {convert.isPending ? 'Creating…' : 'Create project'}
        </Button>
      </div>
    </div>
  )
}
