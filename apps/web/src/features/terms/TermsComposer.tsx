import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, FileSignature, Plus, Save, Send, Trash2, X } from 'lucide-react'
import { Button } from '@/shared/ui/button'
import { Card, CardContent } from '@/shared/ui/card'
import { Input, Label, Select, Textarea } from '@/shared/ui/input'
import { cn } from '@/shared/ui/cn'
import { formatINR } from '@/shared/ui/format'
import { useConfirm } from '@/shared/ui/confirm'
import { useAuth } from '@/shared/auth/AuthProvider'
import { useCompanyProfile } from '@/features/settings/api'
import {
  useAutosaveTermsDraft,
  useDeleteTermsTemplate,
  useSaveTermsTemplate,
  useSendNewTerms,
  useTermsDraft,
  useTermsTemplates,
  type PaymentTermDraft,
  type SentLink,
} from './api'
import {
  BUILT_IN_TEMPLATES,
  DEFAULT_LEGAL_NOTE,
  PAYMENT_PRESETS,
  advanceAndBalance,
  fillPlaceholders,
  presetTerms,
  type TermsContext,
} from './templates'
import { TermsDocumentLetterhead, TermsDocumentSheet } from './TermsDocumentSheet'
import type { TermsPayload } from './document'

export interface TermsProject {
  id: string
  name: string
  client_name: string | null | undefined
  client_phone: string | null | undefined
  client_email: string | null | undefined
  total_cost: number
  /** The first shoot's date, if any, for {{event_date}}. */
  event_date: string | null | undefined
}

/** What to start from when this is a new version of terms already sent. */
export interface TermsStart {
  title: string
  body: string
  plan: PaymentTermDraft[]
}

const dayLabel = (iso: string | null | undefined) =>
  iso ? new Date(`${iso}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' }) : 'the event date'

const timeLabel = (d: Date) => d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })

/** A saved draft's payment rows come back as loose records; keep only what makes sense. */
function planFromRecords(rows: ReadonlyArray<Record<string, unknown>> | null | undefined): PaymentTermDraft[] | null {
  if (!rows || rows.length === 0) return null
  return rows.map((r) => ({
    label: typeof r.label === 'string' ? r.label : '',
    mode: r.mode === 'amount' ? 'amount' : 'percent',
    value: Number(r.value) || 0,
    due_trigger: typeof r.due_trigger === 'string' ? r.due_trigger : '',
  }))
}

/**
 * Write and send this project's terms, right on the Terms tab.
 *
 * Left: pick your usual terms, check the payment plan (in % and in rupees),
 * read or change the words. Right: exactly what the client will see, updating
 * as you type. Everything is kept as a draft while you work, so leaving the
 * tab loses nothing. One button creates the link.
 */
export function TermsComposer({
  project,
  start,
  onSent,
  onCancel,
}: {
  project: TermsProject
  /** Present when this is a new version: prefill from what was sent last. */
  start?: TermsStart | undefined
  onSent: (link: SentLink) => void
  onCancel?: (() => void) | undefined
}) {
  const { session } = useAuth()
  const company = useCompanyProfile()
  const studioName =
    company.data?.display_name ||
    company.data?.name ||
    session?.studios.find((s) => s.company_id === session.company_id)?.company_name ||
    'Our studio'
  const ctx: TermsContext = {
    client_name: project.client_name ?? 'the client',
    project_name: project.name,
    studio_name: studioName,
    total: project.total_cost > 0 ? formatINR(project.total_cost) : 'the amount in the quotation',
    event_date: dayLabel(project.event_date),
  }

  const { data: myTemplates } = useTermsTemplates()
  const draft = useTermsDraft(project.id)
  const autosave = useAutosaveTermsDraft()
  const saveTemplate = useSaveTermsTemplate()
  const deleteTemplate = useDeleteTermsTemplate()
  const send = useSendNewTerms()
  const confirm = useConfirm()

  const first = BUILT_IN_TEMPLATES[0]!
  /** The words to fill, with the advance and balance of this plan. */
  const ctxFor = (plan: PaymentTermDraft[]): TermsContext => ({
    ...ctx,
    ...(advanceAndBalance(plan, project.total_cost, formatINR) ?? { advance: 'the booking amount', balance: 'the balance' }),
  })
  const firstPlan = presetTerms(PAYMENT_PRESETS.find((p) => p.key === first.preset)!)
  const [picked, setPicked] = useState<string>(start ? 'current' : `builtin:${first.key}`)
  const [title, setTitle] = useState(start?.title ?? `Terms & conditions — ${project.name}`)
  const [body, setBody] = useState(() => start?.body ?? fillPlaceholders(first.body, ctxFor(firstPlan)))
  const [plan, setPlan] = useState<PaymentTermDraft[]>(() => start?.plan ?? firstPlan)
  const [edited, setEdited] = useState(false)
  const [expiryDays, setExpiryDays] = useState(14)
  const [savingAs, setSavingAs] = useState<string | null>(null)
  const [savedAt, setSavedAt] = useState<Date | null>(null)
  const [restored, setRestored] = useState(false)
  /** Only autosave once the owner has changed something -- opening the tab is not a draft. */
  const touched = useRef(false)

  // Pick the draft back up, once. The studio name arrives a moment later than
  // the draft on a cold load; a draft already has its words, so that is fine.
  useEffect(() => {
    if (restored || draft.isLoading) return
    setRestored(true)
    const d = draft.data
    if (!d || !d.rendered_body.trim()) return
    setBody(d.rendered_body)
    if (d.title) setTitle(d.title)
    const p = planFromRecords(d.payment_terms)
    if (p) setPlan(p)
    setPicked('draft')
    setEdited(true)
    if (d.updated_at) setSavedAt(new Date(d.updated_at))
  }, [draft.isLoading, draft.data, restored])

  // Save as you go: a second and a half after the last change.
  const { mutate: saveDraft } = autosave
  useEffect(() => {
    if (!touched.current) return
    const t = window.setTimeout(() => {
      saveDraft(
        { project_id: project.id, rendered_body: body, title: title.trim() || null, payment_terms: plan, total_cost: project.total_cost || null },
        { onSuccess: () => setSavedAt(new Date()) },
      )
    }, 1500)
    return () => window.clearTimeout(t)
  }, [body, title, plan, project.id, project.total_cost, saveDraft])

  const change = () => {
    touched.current = true
  }

  async function pick(key: string) {
    if (key === picked) return
    if (edited && !(await confirm({ title: 'Replace your text with these terms?', description: 'What you typed will be replaced.', confirmLabel: 'Replace' }))) return
    change()
    setPicked(key)
    if (key.startsWith('builtin:')) {
      const t = BUILT_IN_TEMPLATES.find((b) => `builtin:${b.key}` === key)!
      const preset = PAYMENT_PRESETS.find((p) => p.key === t.preset)
      const nextPlan = preset ? presetTerms(preset) : plan
      setBody(fillPlaceholders(t.body, ctxFor(nextPlan)))
      if (preset) setPlan(nextPlan)
    } else {
      const t = (myTemplates ?? []).find((m) => `mine:${m.id}` === key)
      if (t) setBody(fillPlaceholders(t.body, ctxFor(plan)))
    }
    setEdited(false)
  }

  const setPart = (i: number, p: Partial<PaymentTermDraft>) => {
    change()
    setPlan((all) => all.map((x, j) => (j === i ? { ...x, ...p } : x)))
  }

  const planTotal = plan.reduce((n, p) => n + (p.mode === 'percent' ? Number(p.value) || 0 : 0), 0)
  const allPercent = plan.every((p) => p.mode === 'percent')
  const rupees = (pct: number) => (project.total_cost > 0 ? formatINR(Math.round((pct / 100) * project.total_cost)) : null)

  const preview: TermsPayload = useMemo(
    () => ({
      title,
      body,
      project_name: project.name,
      client_name: project.client_name ?? null,
      client_phone: project.client_phone ?? null,
      company_name: studioName,
      logo_url: company.data?.invoice_logo_url ?? company.data?.avatar_url ?? null,
      company_phone: company.data?.invoice_phone ?? null,
      company_email: company.data?.invoice_email ?? null,
      company_address: company.data?.invoice_address ?? null,
      payment_summary: null,
      sections: [],
      expires_at: null,
      revoked: false,
      acknowledged_at: null,
      acknowledged_by_name: null,
      access_count: 0,
      payment_terms: plan.filter((p) => p.label.trim()).map((p) => ({ ...p, mode: p.mode === 'percent' ? 'percentage' : 'amount' })),
      total_cost: project.total_cost,
      legal_note: DEFAULT_LEGAL_NOTE,
    }),
    [title, body, plan, project, studioName, company.data],
  )

  function createLink() {
    send.mutate(
      {
        project_id: project.id,
        rendered_body: body.trim(),
        title: title.trim() || undefined,
        payment_terms: plan.filter((p) => p.label.trim()),
        total_cost: project.total_cost || undefined,
        legal_note: DEFAULT_LEGAL_NOTE,
        expiry_days: expiryDays,
      },
      { onSuccess: onSent },
    )
  }

  const client = project.client_name ?? 'the client'

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      {/* ── Write ─────────────────────────────────────────────── */}
      <Card>
        <CardContent className="flex flex-col gap-5 p-4">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <p className="text-base font-semibold">{start ? 'Send a new version' : `Send terms to ${client}`}</p>
              <p className="text-sm text-muted-foreground">
                {client} opens a link on their phone, reads these terms and taps “I agree”.
              </p>
            </div>
            <span className="text-xs text-muted-foreground" aria-live="polite">
              {autosave.isPending ? 'Saving…' : savedAt ? `Draft saved ${timeLabel(savedAt)}` : ''}
            </span>
          </div>

          <Section n={1} title="Pick your terms">
            <div className="grid gap-2 sm:grid-cols-2">
              {start && <Choice on={picked === 'current'} onClick={() => void pick('current')} title="What you sent last" hint="Edit and send again" />}
              {picked === 'draft' && <Choice on title="Your draft" hint="Picked up where you left off" onClick={() => undefined} />}
              {(myTemplates ?? []).map((t) => (
                <Choice
                  key={t.id}
                  on={picked === `mine:${t.id}`}
                  onClick={() => void pick(`mine:${t.id}`)}
                  title={t.name}
                  hint="Your saved terms"
                  onRemove={async () => {
                    if (await confirm({ title: `Delete “${t.name}”?`, destructive: true, confirmLabel: 'Delete' })) deleteTemplate.mutate(t.id)
                  }}
                />
              ))}
              {BUILT_IN_TEMPLATES.map((t) => (
                <Choice key={t.key} on={picked === `builtin:${t.key}`} onClick={() => void pick(`builtin:${t.key}`)} title={t.name} hint={t.hint} />
              ))}
            </div>
          </Section>

          <Section n={2} title="Payment plan">
            <div className="mb-2 flex flex-wrap gap-1.5">
              {PAYMENT_PRESETS.map((p) => (
                <button
                  key={p.key}
                  type="button"
                  onClick={() => {
                    change()
                    setPlan(presetTerms(p))
                  }}
                  className="rounded-full border border-tone-blue/30 bg-tone-blue-soft px-2.5 py-0.5 text-xs font-medium text-tone-blue hover:bg-tone-blue/15"
                >
                  {p.label}
                </button>
              ))}
            </div>
            <ul className="flex flex-col gap-1.5">
              {plan.map((p, i) => (
                <li key={i} className="grid grid-cols-[1fr_4.5rem_5.5rem_auto] items-center gap-1.5 sm:grid-cols-[1fr_4.5rem_5.5rem_1fr_auto]">
                  <Input aria-label={`Part ${i + 1} name`} placeholder="e.g. On booking" value={p.label} onChange={(e) => setPart(i, { label: e.target.value })} />
                  <div className="relative">
                    <Input
                      aria-label={`Part ${i + 1} percent`}
                      inputMode="decimal"
                      value={String(p.value)}
                      onChange={(e) => setPart(i, { value: Number(e.target.value) || 0, mode: 'percent' })}
                      className="pr-6"
                    />
                    <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">%</span>
                  </div>
                  <span className="text-right text-sm tabular-nums text-muted-foreground">{p.mode === 'percent' ? (rupees(Number(p.value) || 0) ?? '—') : formatINR(p.value)}</span>
                  <Input
                    aria-label={`Part ${i + 1} due`}
                    placeholder="When, e.g. On signing"
                    value={p.due_trigger ?? ''}
                    onChange={(e) => setPart(i, { due_trigger: e.target.value })}
                    className="col-span-3 sm:col-span-1"
                  />
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className="size-8"
                    aria-label={`Remove part ${i + 1}`}
                    onClick={() => {
                      change()
                      setPlan((all) => all.filter((_, j) => j !== i))
                    }}
                  >
                    <X />
                  </Button>
                </li>
              ))}
            </ul>
            <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2 text-xs">
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => {
                  change()
                  setPlan((all) => [...all, { label: '', mode: 'percent', value: 0, due_trigger: '' }])
                }}
              >
                <Plus /> Add a part
              </Button>
              {allPercent && plan.length > 0 && (
                <span className={cn('font-medium', planTotal === 100 ? 'text-tone-green' : 'text-warning')}>
                  {planTotal === 100 ? 'Adds up to 100%' : `Adds up to ${planTotal}% — should be 100%`}
                  {project.total_cost > 0 && planTotal === 100 ? ` = ${formatINR(project.total_cost)}` : ''}
                </span>
              )}
            </div>
          </Section>

          <Section n={3} title="Read the terms — change anything">
            <Input
              aria-label="Title"
              value={title}
              onChange={(e) => {
                change()
                setTitle(e.target.value)
              }}
              className="mb-2 font-medium"
            />
            <Textarea
              aria-label="Terms text"
              rows={14}
              value={body}
              onChange={(e) => {
                change()
                setBody(e.target.value)
                setEdited(true)
              }}
            />
            <div className="mt-1.5 flex flex-wrap items-center gap-2">
              {savingAs === null ? (
                <Button type="button" size="sm" variant="ghost" onClick={() => setSavingAs('')}>
                  <Save /> Save as my terms, for next time
                </Button>
              ) : (
                <div className="flex flex-1 items-center gap-1.5">
                  <Input
                    autoFocus
                    aria-label="Name for these terms"
                    placeholder="Name, e.g. Our wedding terms"
                    value={savingAs}
                    onChange={(e) => setSavingAs(e.target.value)}
                    className="h-8"
                  />
                  <Button
                    type="button"
                    size="sm"
                    disabled={savingAs.trim().length < 2 || saveTemplate.isPending}
                    onClick={() => saveTemplate.mutate({ name: savingAs.trim(), body }, { onSuccess: () => setSavingAs(null) })}
                  >
                    <Check /> Save
                  </Button>
                  <Button type="button" size="sm" variant="ghost" onClick={() => setSavingAs(null)}>
                    Cancel
                  </Button>
                </div>
              )}
            </div>
          </Section>

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Label htmlFor="terms-expiry" className="text-xs font-normal">
                Link works for
              </Label>
              <Select id="terms-expiry" value={String(expiryDays)} onChange={(e) => setExpiryDays(Number(e.target.value))} className="h-8 w-28">
                {[7, 14, 30, 90].map((d) => (
                  <option key={d} value={d}>
                    {d} days
                  </option>
                ))}
              </Select>
            </div>
            <div className="flex gap-2">
              {onCancel && (
                <Button variant="ghost" onClick={onCancel}>
                  Cancel
                </Button>
              )}
              <Button size="lg" disabled={!body.trim() || send.isPending} onClick={createLink}>
                <Send /> {send.isPending ? 'Creating link…' : 'Create link & send'}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ── What the client sees ──────────────────────────────── */}
      <div className="lg:sticky lg:top-4 lg:self-start">
        <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          <FileSignature className="size-3.5" aria-hidden /> What {client} will see
        </p>
        <div className="flex max-h-[80vh] flex-col gap-4 overflow-y-auto rounded-lg border border-border bg-muted/20 p-3">
          <TermsDocumentLetterhead doc={preview} />
          <TermsDocumentSheet doc={preview} bodyClassName="" />
        </div>
      </div>
    </div>
  )
}

function Section({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <section>
      <p className="mb-2 flex items-center gap-2 text-sm font-semibold">
        <span className="flex size-5 items-center justify-center rounded-full bg-primary text-[11px] text-primary-foreground">{n}</span>
        {title}
      </p>
      {children}
    </section>
  )
}

function Choice({
  on,
  onClick,
  title,
  hint,
  onRemove,
}: {
  on: boolean
  onClick: () => void
  title: string
  hint: string
  onRemove?: () => void
}) {
  return (
    <div
      className={cn(
        'group relative flex items-start gap-2 rounded-lg border p-2.5 text-left transition-colors',
        on ? 'border-primary bg-primary/5 ring-1 ring-primary' : 'border-border hover:bg-muted/50',
      )}
    >
      <button type="button" onClick={onClick} aria-pressed={on} className="flex flex-1 items-start gap-2 text-left">
        <FileSignature className={cn('mt-0.5 size-4 shrink-0', on ? 'text-primary' : 'text-muted-foreground')} aria-hidden />
        <span>
          <span className="block text-sm font-medium">{title}</span>
          <span className="block text-xs text-muted-foreground">{hint}</span>
        </span>
      </button>
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          aria-label={`Delete ${title}`}
          className="rounded p-1 text-muted-foreground opacity-60 hover:bg-muted hover:text-destructive group-hover:opacity-100"
        >
          <Trash2 className="size-3.5" />
        </button>
      )}
    </div>
  )
}
