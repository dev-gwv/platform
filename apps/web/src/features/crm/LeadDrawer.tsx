import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from '@tanstack/react-router'
import {
  Archive,
  Trash2,
  ArchiveRestore,
  Building2,
  CalendarClock,
  Check,
  Copy,
  Flame,
  FolderPlus,
  Mail,
  MessageCircle,
  NotebookPen,
  Square,
} from 'lucide-react'
import { toast } from 'sonner'
import { LEAD_QUALITY_DEFAULTS, LEAD_SOURCE_DEFAULTS, type CrmLead, type CrmQuote } from '@ipc/contracts'
import { REQUIRED_FIELD_LABEL, missingForStage, sortStages } from '@ipc/domain'
import { Button } from '@/shared/ui/button'
import { CallButton } from '@/features/crm-calls/CallButton'
import { LeadSequencePanel } from '@/features/crm-sequences/LeadSequencePanel'
import { Dialog, DialogContent, DialogFooter } from '@/shared/ui/dialog'
import { SheetContent } from '@/shared/ui/sheet'
import { Input, Label, Select } from '@/shared/ui/input'
import { StatusBadge } from '@/shared/ui/status-badge'
import { cn } from '@/shared/ui/cn'
import { formatINR } from '@/shared/ui/format'
import { useConfirm } from '@/shared/ui/confirm'
import { useAccess } from '@/shared/auth/useAccess'
import { Popover, PopoverContent, PopoverTrigger } from '@/shared/ui/popover'
import { useMembers } from '@/features/allocation/api'
import { useClients } from '@/features/clients/api'
import {
  useConvertLead,
  useContacts,
  useCrmCompanies,
  useCrmSettings,
  useEnrollWorkflow,
  useExitEnrollment,
  useLeadEnrollments,
  useMoveStage,
  usePipelines,
  useQuotes,
  useSendTemplate,
  useTemplates,
  useUpdateLead,
  useEraseLeads,
  useWorkflows,
} from './api'
import { QuoteBuilder } from './QuoteBuilder'
import { QuoteRow } from './tabs/QuotesTab'
import { ScoreBadge } from './tabs/shared'
import { LostReasonDialog } from './LostReasonDialog'
import { ArchiveDialog } from './ArchiveDialog'
import { Timeline } from './Timeline'
import { dateVerdict } from './availability'
import { LookupChip, StagePicker, prettyWord } from './fields'
import { LeadEvents, toFunctions, type EventRow } from './LeadEvents'
import { NoteComposer, NotesThread } from './drawer/NotesThread'
import { FollowUpCard } from './drawer/FollowUpCard'
import { TagPicker } from './TagPicker'
import { convertDefaults } from './convert'
import { followUpChip } from './follow-up-chip'

const when = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

/**
 * The whole lead on one surface: who they are, where the conversation is, and
 * when it continues. Everything saves on the spot — this is opened between
 * phone calls, not filled in like a form.
 */
/**
 * wa.me opens the chat with this person in whichever WhatsApp they have.
 *
 * Privyr's whole product rests on this: the message goes from the studio's own
 * number, in a normal chat, with no Business API account and no per-message
 * fee. Digits only -- wa.me rejects spaces, plus signs and dashes -- and a bare
 * ten-digit Indian number needs its country code.
 */
function waLink(phone: string): string {
  const digits = phone.replace(/\D/g, '')
  const withCode = digits.length === 10 ? `91${digits}` : digits
  return `https://wa.me/${withCode}`
}

const LEAD_TABS = [
  { key: 'overview', label: 'Overview' },
  { key: 'info', label: 'Info' },
  { key: 'timeline', label: 'Timeline' },
] as const
type LeadTab = (typeof LEAD_TABS)[number]['key']

export function LeadDrawer({ lead, onClose }: { lead: CrmLead; onClose: () => void }) {
  const update = useUpdateLead('Lead updated')
  const send = useSendTemplate()
  const { data: members } = useMembers()
  const { data: templates } = useTemplates()
  const access = useAccess()
  const canEdit = access.hasAction('crm', 'edit')
  const [copied, setCopied] = useState(false)
  const [noteOpen, setNoteOpen] = useState(false)
  const [tab, setTab] = useState<LeadTab>('overview')
  const move = useMoveStage()
  const { data: pipelines } = usePipelines()
  const { data: companies } = useCrmCompanies()
  const { data: contacts } = useContacts()
  const { data: settings } = useCrmSettings()
  const [losingTo, setLosingTo] = useState<string | null>(null)
  const [booking, setBooking] = useState(false)
  const [askArchive, setAskArchive] = useState(false)
  const pipeline = (pipelines ?? []).find((p) => p.id === lead.pipeline_id) ?? (pipelines ?? []).find((p) => p.is_default)
  const stages = pipeline ? sortStages(pipeline.stages) : []
  const lostStage = stages.find((s) => s.kind === 'lost')
  // Both converts count: offering Book it again to a lead converted
  // client-only is how one enquiry ends up as two clients.
  const followUp = followUpChip(lead.follow_up_at, !lead.converted_project_id && !lead.converted_client_id && lead.status !== 'lost' && !lead.is_archived)
  const bookable = !lead.converted_project_id && !lead.converted_client_id && lead.status !== 'lost' && !lead.is_archived

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

  const patch = (p: Parameters<typeof update.mutate>[0]['patch']) => update.mutate({ id: lead.id, patch: p })

  // Deleting for good is offered only on an archived lead, behind a confirm.
  const canDelete = access.hasAction('crm', 'delete')
  const erase = useEraseLeads()
  const confirm = useConfirm()
  async function eraseThis() {
    const yes = await confirm({
      title: `Delete ${lead.name ?? 'this lead'} permanently?`,
      description:
        'This removes their name, phone, email, notes, messages and Facebook import records from your studio for good. It cannot be undone.',
      confirmLabel: 'Delete permanently',
      destructive: true,
    })
    if (yes) erase.mutate([lead.id], { onSuccess: onClose })
  }

  // The lead's functions as editable rows; a lead from before 0212 that only
  // has the old single event shows that one.
  const eventRows: EventRow[] = lead.functions.length
    ? lead.functions.map((f) => ({ event_type: f.event_type, event_date: f.event_date, location: f.location }))
    : lead.event_type || lead.event_date
      ? [{ event_type: lead.event_type, event_date: lead.event_date, location: lead.event_location }]
      : []
  function saveEvents(rows: EventRow[]) {
    const next = toFunctions(rows)
    if (JSON.stringify(next) === JSON.stringify(toFunctions(eventRows))) return
    patch({ functions: next })
  }
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
      {/*
        * A panel beside the list, not a modal over it.
        *
        * The dialog covered the middle of the screen, so working four leads
        * meant opening and closing four times and losing your place in the
        * list each time. A sheet keeps the queue visible behind it -- the next
        * lead is a click away rather than a close-and-find.
        */}
      <SheetContent
        title={lead.name ?? 'Unnamed lead'}
        description={`${prettyWord(lead.source)}${lead.source_label ? ` via ${lead.source_label}` : ''} · added ${new Date(lead.created_at).toLocaleDateString('en-IN')}`}
      >
        <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-4 pb-6">
          {/*
            * Who they are and how to reach them, before anything else: the
            * number big enough to read out on a call, the email under it.
            * The Control Center's drawer opens this way and the owner liked
            * it best for a reason -- the phone is what gets used.
            */}
          <div className="flex flex-col gap-1 pr-8 pt-1">
            {/* The panel's title is for screen readers only, so the name has
                to be drawn here -- without it the drawer opened on a bare
                phone number. */}
            <h2 className="text-xl font-semibold leading-tight tracking-tight">{lead.name ?? 'Unnamed lead'}</h2>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-sm text-muted-foreground">
              {lead.phone ? (
                <button
                  type="button"
                  onClick={() => {
                    void navigator.clipboard.writeText(lead.phone!)
                    setCopied(true)
                    toast.success('Number copied')
                  }}
                  className="group inline-flex items-center gap-1.5 font-medium tabular-nums text-foreground hover:text-primary"
                  title="Copy number"
                >
                  {lead.phone}
                  {copied ? (
                    <Check className="size-3.5 text-tone-green" />
                  ) : (
                    <Copy className="size-3.5 opacity-0 transition-opacity group-hover:opacity-100" />
                  )}
                </button>
              ) : canEdit ? (
                // A lead can start with just a name; the number is the next thing to get.
                <input
                  aria-label="Add their number"
                  placeholder="Add their number"
                  inputMode="tel"
                  onBlur={(e) => {
                    const v = e.target.value.trim()
                    if (v.length >= 6) patch({ phone: v })
                  }}
                  onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
                  className="h-7 w-44 rounded-md border border-dashed border-warning/70 bg-warning/10 px-2 text-sm text-foreground placeholder:font-medium placeholder:text-warning focus:outline-none focus:ring-2 focus:ring-ring"
                />
              ) : (
                <span>No phone number</span>
              )}
              {lead.email && <span className="truncate">{lead.email}</span>}
            </div>
          </div>

          {/* The two ways a lead ends, first: booked, or lost with a reason. */}
          {canEdit && bookable && (
            <div className="flex flex-wrap gap-2">
              <Button size="sm" onClick={() => setBooking(true)}>
                <FolderPlus /> Book it
              </Button>
              {lostStage && (
                <Button size="sm" variant="outline" onClick={() => setLosingTo(lostStage.id)}>
                  Lost
                </Button>
              )}
            </div>
          )}

          {/* The four ways to reach them, and a note, always in the same place. */}
          <div className="sticky top-0 z-10 -mx-1 flex flex-wrap gap-2 border-b border-border bg-card px-1 pb-3">
            <CallButton lead={lead} />
            <Button variant="outline" size="sm" disabled={!lead.phone} asChild={!!lead.phone} className="text-tone-green">
              {lead.phone ? (
                <a href={waLink(lead.phone)} target="_blank" rel="noreferrer">
                  <MessageCircle /> WhatsApp
                </a>
              ) : (
                <span>
                  <MessageCircle /> WhatsApp
                </span>
              )}
            </Button>
            <Button variant="outline" size="sm" disabled={!lead.email} asChild={!!lead.email}>
              {lead.email ? (
                <a href={`mailto:${lead.email}`}>
                  <Mail /> Email
                </a>
              ) : (
                <span>
                  <Mail /> Email
                </span>
              )}
            </Button>
            {canEdit && (
              <Popover open={noteOpen} onOpenChange={setNoteOpen}>
                <PopoverTrigger asChild>
                  <Button variant="outline" size="sm">
                    <NotebookPen /> Add note
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-80">
                  <NoteComposer leadId={lead.id} autoFocus onSaved={() => setNoteOpen(false)} />
                </PopoverContent>
              </Popover>
            )}
            {canEdit && (
              <Button
                variant={lead.is_hot ? 'default' : 'outline'}
                size="sm"
                className={cn('ml-auto', lead.is_hot && 'bg-tone-rose text-card hover:bg-tone-rose/90')}
                onClick={() => patch(lead.is_hot ? { is_hot: false, ...(lead.quality === 'hot' ? { quality: 'warm' } : {}) } : { is_hot: true })}
              >
                <Flame /> {lead.is_hot ? 'Hot' : 'Mark hot'}
              </Button>
            )}
          </div>

          {/*
            * What this lead IS, as coloured chips that are also the controls:
            * the stage, the event, how warm, where from, and its tags. Every
            * one opens a list the studio can add to on the spot.
            */}
          <div className="flex flex-wrap items-center gap-1.5">
            <StagePicker
              pipelineId={lead.pipeline_id}
              value={lead.stage_id}
              onChange={moveTo}
              canAdd={canEdit}
              disabled={!canEdit || move.isPending}
            />
            <LookupChip
              category="lead_quality"
              noun="quality"
              value={lead.quality}
              defaults={LEAD_QUALITY_DEFAULTS}
              placeholder="How warm?"
              disabled={!canEdit}
              onChange={(v) =>
                patch(
                  // Warm and cold switch Hot off; a studio's own word ("Super
                  // hot") leaves the Hot flag -- which ranks calls -- as it was.
                  v === 'warm' || v === 'cold'
                    ? { quality: v, ...(lead.is_hot ? { is_hot: false } : {}) }
                    : { quality: v },
                )
              }
            />
            <LookupChip
              category="lead_source"
              noun="source"
              value={lead.source}
              defaults={LEAD_SOURCE_DEFAULTS}
              clearable={false}
              disabled={!canEdit}
              onChange={(v) => v && v !== lead.source && patch({ source: v })}
            />
            {followUp && (
              <button
                type="button"
                onClick={() => setTab('overview')}
                className={cn(
                  'inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium',
                  followUp.missing || followUp.late
                    ? 'border-dashed border-tone-amber bg-tone-amber-soft text-tone-amber'
                    : 'border-border bg-card text-foreground',
                )}
              >
                <CalendarClock className="size-3" /> {followUp.text}
              </button>
            )}
            <ScoreBadge score={lead.score} hotScore={settings?.hot_score ?? 60} />
            {lead.last_contacted_at === null && <StatusBadge tone="warning">Never contacted</StatusBadge>}
            {lead.is_archived && (
              <StatusBadge tone="neutral">
                Archived
                {lead.archive_reason ? ` · ${lead.archive_reason}` : ''}
                {lead.archived_by_name ? ` · ${lead.archived_by_name}` : ''}
              </StatusBadge>
            )}
            {lead.crm_company_name && (
              <StatusBadge tone="neutral">
                <Building2 className="mr-1 size-3" />
                {lead.crm_company_name}
              </StatusBadge>
            )}
            {lead.converted_project_id && (
              <Link
                to="/projects/$id"
                params={{ id: lead.converted_project_id }}
                className="inline-flex items-center gap-1 rounded-full border border-tone-green/40 bg-tone-green-soft px-2.5 py-0.5 text-xs font-semibold text-tone-green hover:border-tone-green"
              >
                <Check className="size-3" /> Booked — {lead.converted_project_name ?? 'open the project'}
              </Link>
            )}
            {lead.converted_client_id && (
              <Button size="sm" variant="ghost" className="h-7" asChild>
                <Link to="/clients" search={{ client: lead.converted_client_id } as never}>
                  Open client
                </Link>
              </Button>
            )}
          </div>
          <TagPicker leadId={lead.id} tags={lead.tags} canEdit={canEdit} />

          {/* Every function they asked for, each with its own day and venue. */}
          <section aria-label="Events" className="flex flex-col gap-1.5">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Events{lead.functions.length > 1 ? ` · ${lead.functions.length}` : ''}
            </p>
            <LeadEvents value={eventRows} onCommit={saveEvents} disabled={!canEdit || update.isPending} compact />
          </section>
          {lead.lost_reason && (
            <p className="-mt-2 text-xs text-muted-foreground">
              Lost: {lead.lost_reason}
              {lead.lost_competitor ? ` · to ${lead.lost_competitor}` : ''}
            </p>
          )}

          {/*
            * Whether the studio can take the job at all. A warm lead for a day
            * you are already shooting is not a lead, and two families on one
            * date is a decision someone has to make.
            */}
          {lead.event_date && lead.date_status !== 'unknown' && lead.date_status !== 'free' && (
            <div
              className={cn(
                'rounded-lg border p-3',
                lead.date_status === 'contested' ? 'border-destructive/40 bg-destructive/5' : 'border-border bg-muted/40',
              )}
            >
              <p className={cn('text-sm font-semibold', lead.date_status === 'contested' && 'text-destructive')}>
                {new Date(lead.event_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                {' — '}
                {dateVerdict(lead).label}
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">{dateVerdict(lead).detail}</p>
            </div>
          )}

          <div role="tablist" aria-label="Lead sections" className="flex gap-1 rounded-lg border border-border bg-muted/30 p-1">
            {LEAD_TABS.map((t) => (
              <button
                key={t.key}
                type="button"
                role="tab"
                aria-selected={tab === t.key}
                onClick={() => setTab(t.key)}
                className={cn(
                  'flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
                  tab === t.key ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {t.label}
              </button>
            ))}
          </div>

          {tab === 'overview' && (
            <div className="flex flex-col gap-4">
              <NotesThread leadId={lead.id} canEdit={canEdit} />
              <FollowUpCard leadId={lead.id} canEdit={canEdit} />

              {/* The facts that change on a call, each saving the moment it changes. */}
              <section aria-label="Quick status" className="grid gap-3 rounded-xl border border-border p-3 sm:grid-cols-2">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="lead-owner">Owner</Label>
                  <Select
                    id="lead-owner"
                    value={lead.assigned_to ?? ''}
                    onChange={(e) => patch({ assigned_to: e.target.value || null })}
                    disabled={update.isPending || !canEdit}
                    className={cn(!lead.assigned_to && 'border-tone-amber/60 bg-tone-amber-soft/30')}
                  >
                    <option value="">Unassigned</option>
                    {(members ?? []).map((m) => (
                      <option key={m.user_id} value={m.user_id}>
                        {m.name}
                      </option>
                    ))}
                  </Select>
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="lead-budget">Budget (₹)</Label>
                  <Input
                    id="lead-budget"
                    type="number"
                    min={0}
                    key={`v-${lead.deal_value ?? ''}`}
                    defaultValue={lead.deal_value ?? ''}
                    placeholder="What they want to spend"
                    disabled={!canEdit}
                    className={cn(lead.deal_value === null && 'border-tone-amber/60 bg-tone-amber-soft/30')}
                    onBlur={(e) => {
                      const v = e.target.value ? Number(e.target.value) : null
                      if (v !== lead.deal_value) patch({ deal_value: v })
                    }}
                  />
                </div>
              </section>

              {canEdit && sendable.length > 0 && (
                <details className="rounded-lg border border-border p-3">
                  <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Quick response · {sendable.length} template{sendable.length === 1 ? '' : 's'}
                  </summary>
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
                </details>
              )}
              {canEdit && <LeadSequencePanel lead={lead} />}
              {canEdit && <WorkflowPanel lead={lead} />}

              {/*
                * Both converts count. Offering the panel again to a lead that was
                * converted client-only is how one enquiry ends up as two clients.
                */}

              <QuotesPanel lead={lead} canEdit={canEdit} />
            </div>
          )}

          {tab === 'info' && (
            <div className="flex flex-col gap-4">
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
            {lead.sla_due_at && !['converted','lost'].includes(lead.status) && (
              <p className={`text-xs font-medium ${new Date(lead.sla_due_at).getTime() < Date.now() ? 'text-destructive' : 'text-muted-foreground'}`}>
                SLA {new Date(lead.sla_due_at).getTime() < Date.now() ? 'breached' : 'due'} {when.format(new Date(lead.sla_due_at))} · {lead.probability ?? 10}% · ₹{lead.deal_value ?? 0}
              </p>
            )}
            </div>
          )}

          {tab === 'timeline' && <Timeline lead={lead} />}

          {booking && <ConvertDialog lead={lead} onClose={() => setBooking(false)} />}
          <LostReasonDialog
            open={losingTo !== null}
            pending={move.isPending}
            onCancel={() => setLosingTo(null)}
            onConfirm={(d) => {
              if (!losingTo) return
              move.mutate({ leadId: lead.id, stage_id: losingTo, ...d }, { onSuccess: () => setLosingTo(null) })
            }}
          />
          <ArchiveDialog
            open={askArchive}
            pending={update.isPending}
            onCancel={() => setAskArchive(false)}
            onConfirm={(reason) => {
              patch(reason === null ? { is_archived: true } : { is_archived: true, archive_reason: reason })
              setAskArchive(false)
            }}
          />
          <div className="sticky bottom-0 -mx-4 mt-auto flex items-center justify-between gap-2 border-t border-border bg-card px-4 py-3">
            {canEdit ? (
              <Button
                size="sm"
                variant="ghost"
                disabled={update.isPending}
                onClick={() => (lead.is_archived ? patch({ is_archived: false }) : setAskArchive(true))}
              >
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
            ) : (
              <span />
            )}
            {canDelete && lead.is_archived && (
              <Button size="sm" variant="ghost" className="mr-auto text-destructive" disabled={erase.isPending} onClick={() => void eraseThis()}>
                <Trash2 /> Delete permanently
              </Button>
            )}
            <Button size="sm" onClick={onClose}>
              Done
            </Button>
          </div>
        </div>
      </SheetContent>
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
function ConvertDialog({ lead, onClose }: { lead: CrmLead; onClose: () => void }) {
  const convert = useConvertLead()
  const navigate = useNavigate()
  const { data: clients } = useClients()
  const clientList = Array.isArray(clients) ? clients : []
  const { data: quotes } = useQuotes(lead.id)
  const defaults = convertDefaults(lead)
  const [clientId, setClientId] = useState('')
  const [quoteId, setQuoteId] = useState('')
  const [name, setName] = useState(defaults.name)
  const [cost, setCost] = useState(defaults.cost)
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
  // once. `picked` latches so choosing "no quote" afterwards sticks. The
  // budget stays the price unless there was none.
  const picked = useRef(false)
  useEffect(() => {
    if (picked.current || !accepted) return
    picked.current = true
    setQuoteId(accepted.id)
    if (!defaults.cost) setCost(String(accepted.total))
    if (accepted.title) setName(accepted.title)
  }, [accepted, defaults.cost])

  function submit() {
    setError(null)
    const amount = Number(cost || 0)
    if (!name.trim()) return setError('Name the project.')
    if (Number.isNaN(amount) || amount < 0) return setError('The booked price must be a number.')
    convert.mutate(
      {
        leadId: lead.id,
        ...(clientId ? { client_id: clientId } : {}),
        ...(quoteId ? { quote_id: quoteId } : {}),
        project: { name: name.trim(), package_cost: amount, status: 'active' },
      },
      {
        onSuccess: (r) => {
          onClose()
          // Booked lands on the quotation, like every new project.
          if (r.project_id) void navigate({ to: '/projects/$id/quotation', params: { id: r.project_id } })
        },
      },
    )
  }

  return (
    <Dialog open onOpenChange={(o) => !o && !convert.isPending && onClose()}>
      <DialogContent
        title={`Book ${lead.name ?? 'this lead'}`}
        description={match ? 'A client with this number already exists.' : 'A client is made from the lead unless you pick one.'}
      >
        <div className="grid gap-3 sm:grid-cols-2">
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
            <Input
              id="conv-cost"
              type="number"
              min={0}
              value={cost}
              onChange={(e) => setCost(e.target.value)}
              placeholder="0"
              className={cn(!cost && 'border-dashed border-tone-amber bg-tone-amber-soft/40')}
            />
            <p className="text-xs text-muted-foreground">This is the booked price, not the quote.</p>
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
              <p className="text-xs text-muted-foreground">The quote's lines become the project's deliverables and show on its quotation.</p>
            </div>
          )}
        </div>
        {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={convert.isPending}>
            Cancel
          </Button>
          <Button disabled={convert.isPending} onClick={submit}>
            {convert.isPending ? 'Booking…' : 'Book it'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
