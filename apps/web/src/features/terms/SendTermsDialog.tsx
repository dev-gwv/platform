import { useMemo, useState } from 'react'
import { ArrowLeft, Eye, FileSignature, Plus, Save, Send, X } from 'lucide-react'
import { Button } from '@/shared/ui/button'
import { Dialog, DialogContent, DialogFooter } from '@/shared/ui/dialog'
import { Input, Label, Select, Textarea } from '@/shared/ui/input'
import { cn } from '@/shared/ui/cn'
import { formatINR } from '@/shared/ui/format'
import { useAuth } from '@/shared/auth/AuthProvider'
import {
  useSaveTermsTemplate,
  useSendNewTerms,
  useTermsTemplates,
  type PaymentTermDraft,
  type SentLink,
} from './api'
import {
  BUILT_IN_TEMPLATES,
  DEFAULT_LEGAL_NOTE,
  PAYMENT_PRESETS,
  fillPlaceholders,
  presetTerms,
  type TermsContext,
} from './templates'
import { TermsDocumentLetterhead, TermsDocumentSheet } from './TermsDocumentSheet'
import type { TermsPayload } from './document'
import { ShareTermsPanel } from './ShareTermsPanel'

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

const dayLabel = (iso: string | null | undefined) =>
  iso ? new Date(`${iso}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' }) : 'the event date'

/**
 * Send this project's terms, on one screen.
 *
 * 1. Pick a starting point (the text arrives with the client's name, the
 *    project, the amount and the date already filled in).
 * 2. Check the payment plan -- one tap for the usual splits.
 * 3. Read the terms; change anything.
 * Then "Create link" and send it on WhatsApp, by email, or copy it.
 *
 * "Preview" shows exactly what the client will see. Nothing else: no steps
 * to click through, no drafts to manage, no seeding.
 */
export function SendTermsDialog({ project, onClose }: { project: TermsProject; onClose: () => void }) {
  const { session } = useAuth()
  const studioName = session?.studios.find((s) => s.company_id === session.company_id)?.company_name ?? 'Our studio'
  const ctx: TermsContext = {
    client_name: project.client_name ?? 'the client',
    project_name: project.name,
    studio_name: studioName,
    total: project.total_cost > 0 ? formatINR(project.total_cost) : 'the amount in the quotation',
    event_date: dayLabel(project.event_date),
  }

  const { data: myTemplates } = useTermsTemplates()
  const saveTemplate = useSaveTermsTemplate()
  const send = useSendNewTerms()

  const first = BUILT_IN_TEMPLATES[0]!
  const [picked, setPicked] = useState<string>(`builtin:${first.key}`)
  const [body, setBody] = useState(() => fillPlaceholders(first.body, ctx))
  const [edited, setEdited] = useState(false)
  const [title, setTitle] = useState(`Terms & conditions — ${project.name}`)
  const [plan, setPlan] = useState<PaymentTermDraft[]>(() => presetTerms(PAYMENT_PRESETS.find((p) => p.key === first.preset)!))
  const [expiryDays, setExpiryDays] = useState(14)
  const [view, setView] = useState<'write' | 'preview'>('write')
  const [savingAs, setSavingAs] = useState<string | null>(null)
  const [sent, setSent] = useState<SentLink | null>(null)

  const planTotal = plan.reduce((n, p) => n + (p.mode === 'percent' ? Number(p.value) || 0 : 0), 0)
  const allPercent = plan.every((p) => p.mode === 'percent')

  function pick(key: string) {
    if (edited && !window.confirm('Replace the text you changed with this template?')) return
    setPicked(key)
    if (key.startsWith('builtin:')) {
      const t = BUILT_IN_TEMPLATES.find((b) => `builtin:${b.key}` === key)!
      setBody(fillPlaceholders(t.body, ctx))
      const preset = PAYMENT_PRESETS.find((p) => p.key === t.preset)
      if (preset) setPlan(presetTerms(preset))
    } else {
      const t = (myTemplates ?? []).find((m) => `mine:${m.id}` === key)
      if (t) setBody(fillPlaceholders(t.body, ctx))
    }
    setEdited(false)
  }

  const setPart = (i: number, p: Partial<PaymentTermDraft>) => setPlan((all) => all.map((x, j) => (j === i ? { ...x, ...p } : x)))

  const preview: TermsPayload = useMemo(
    () => ({
      title,
      body,
      project_name: project.name,
      client_name: project.client_name ?? null,
      client_phone: project.client_phone ?? null,
      company_name: studioName,
      logo_url: null,
      company_phone: null,
      company_email: null,
      company_address: null,
      payment_summary: null,
      sections: [],
      expires_at: null,
      revoked: false,
      acknowledged_at: null,
      acknowledged_by_name: null,
      access_count: 0,
      payment_terms: plan.map((p) => ({ ...p, mode: p.mode === 'percent' ? 'percentage' : 'amount' })),
      total_cost: project.total_cost,
      legal_note: DEFAULT_LEGAL_NOTE,
    }),
    [title, body, plan, project, studioName],
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
      { onSuccess: setSent },
    )
  }

  if (sent) {
    return (
      <Dialog open onOpenChange={(v) => !v && onClose()}>
        <DialogContent
          title="Terms are ready to send"
          description={`${project.client_name ?? 'The client'} opens the link, reads the terms and taps "I agree". You will see it here, and get a notification.`}
        >
          <ShareTermsPanel
            documentId={sent.document_id}
            token={sent.token}
            url={sent.url}
            clientName={project.client_name}
            clientPhone={project.client_phone}
            clientEmail={project.client_email}
            projectName={project.name}
          />
          <DialogFooter>
            <Button onClick={onClose}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    )
  }

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent title={`Send terms to ${project.client_name ?? 'the client'}`} className="max-h-[92vh] max-w-2xl overflow-y-auto">
        {view === 'preview' ? (
          <div className="flex flex-col gap-3 rounded-lg border border-border bg-muted/20 p-3">
            <p className="text-xs font-medium text-muted-foreground">This is what {project.client_name ?? 'the client'} will see.</p>
            <TermsDocumentLetterhead doc={preview} />
            <TermsDocumentSheet doc={preview} bodyClassName="" />
          </div>
        ) : (
          <div className="flex flex-col gap-5">
            <Section n={1} title="Start from">
              <div className="flex flex-wrap gap-2">
                {BUILT_IN_TEMPLATES.map((t) => (
                  <Choice key={t.key} on={picked === `builtin:${t.key}`} onClick={() => pick(`builtin:${t.key}`)} title={t.name} hint={t.hint} />
                ))}
                {(myTemplates ?? []).map((t) => (
                  <Choice key={t.id} on={picked === `mine:${t.id}`} onClick={() => pick(`mine:${t.id}`)} title={t.name} hint="Saved by you" />
                ))}
              </div>
            </Section>

            <Section n={2} title="Payment plan">
              <div className="mb-2 flex flex-wrap gap-1.5">
                {PAYMENT_PRESETS.map((p) => (
                  <button
                    key={p.key}
                    type="button"
                    onClick={() => setPlan(presetTerms(p))}
                    className="rounded-full border border-tone-blue/30 bg-tone-blue-soft px-2.5 py-0.5 text-xs font-medium text-tone-blue hover:bg-tone-blue/15"
                  >
                    {p.label}
                  </button>
                ))}
              </div>
              <ul className="flex flex-col gap-1.5">
                {plan.map((p, i) => (
                  <li key={i} className="grid grid-cols-[1fr_4.5rem_1fr_auto] items-center gap-1.5">
                    <Input aria-label={`Part ${i + 1} name`} value={p.label} onChange={(e) => setPart(i, { label: e.target.value })} />
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
                    <Input
                      aria-label={`Part ${i + 1} due`}
                      placeholder="When, e.g. On signing"
                      value={p.due_trigger ?? ''}
                      onChange={(e) => setPart(i, { due_trigger: e.target.value })}
                    />
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      className="size-8"
                      aria-label={`Remove part ${i + 1}`}
                      onClick={() => setPlan((all) => all.filter((_, j) => j !== i))}
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
                  onClick={() => setPlan((all) => [...all, { label: '', mode: 'percent', value: 0, due_trigger: '' }])}
                >
                  <Plus /> Add a part
                </Button>
                {allPercent && plan.length > 0 && (
                  <span className={cn('font-medium', planTotal === 100 ? 'text-tone-green' : 'text-warning')}>
                    {planTotal === 100 ? 'Adds up to 100%' : `Adds up to ${planTotal}% — should be 100%`}
                    {project.total_cost > 0 && planTotal === 100 ? ` of ${formatINR(project.total_cost)}` : ''}
                  </span>
                )}
              </div>
            </Section>

            <Section n={3} title="The terms">
              <Input aria-label="Title" value={title} onChange={(e) => setTitle(e.target.value)} className="mb-2 font-medium" />
              <Textarea
                aria-label="Terms text"
                rows={12}
                value={body}
                onChange={(e) => {
                  setBody(e.target.value)
                  setEdited(true)
                }}
              />
              <div className="mt-1.5 flex flex-wrap items-center gap-2">
                {savingAs === null ? (
                  <Button type="button" size="sm" variant="ghost" onClick={() => setSavingAs('')}>
                    <Save /> Save as my template
                  </Button>
                ) : (
                  <div className="flex flex-1 items-center gap-1.5">
                    <Input
                      autoFocus
                      aria-label="Template name"
                      placeholder="Name, e.g. Our wedding terms"
                      value={savingAs}
                      onChange={(e) => setSavingAs(e.target.value)}
                      className="h-8"
                    />
                    <Button
                      type="button"
                      size="sm"
                      disabled={savingAs.trim().length < 2 || saveTemplate.isPending}
                      // Saved with the project's details written in, as a
                      // reusable text: tidy the names by hand if needed.
                      onClick={() => saveTemplate.mutate({ name: savingAs.trim(), body }, { onSuccess: () => setSavingAs(null) })}
                    >
                      Save
                    </Button>
                    <Button type="button" size="sm" variant="ghost" onClick={() => setSavingAs(null)}>
                      Cancel
                    </Button>
                  </div>
                )}
              </div>
            </Section>

            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <Label htmlFor="terms-expiry" className="text-xs font-normal">
                The link works for
              </Label>
              <Select id="terms-expiry" value={String(expiryDays)} onChange={(e) => setExpiryDays(Number(e.target.value))} className="h-8 w-28">
                {[7, 14, 30, 90].map((d) => (
                  <option key={d} value={d}>
                    {d} days
                  </option>
                ))}
              </Select>
            </div>
          </div>
        )}

        <DialogFooter className="flex-wrap gap-2">
          {view === 'preview' ? (
            <Button variant="outline" onClick={() => setView('write')}>
              <ArrowLeft /> Back to edit
            </Button>
          ) : (
            <Button variant="outline" onClick={() => setView('preview')}>
              <Eye /> Preview
            </Button>
          )}
          <Button disabled={!body.trim() || send.isPending} onClick={createLink}>
            {send.isPending ? 'Creating…' : (
              <>
                <Send /> Create link & send
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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

function Choice({ on, onClick, title, hint }: { on: boolean; onClick: () => void; title: string; hint: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      className={cn(
        'flex min-w-[10rem] flex-1 items-start gap-2 rounded-lg border p-2.5 text-left transition-colors',
        on ? 'border-primary bg-primary/5 ring-1 ring-primary' : 'border-border hover:bg-muted/50',
      )}
    >
      <FileSignature className={cn('mt-0.5 size-4 shrink-0', on ? 'text-primary' : 'text-muted-foreground')} aria-hidden />
      <span>
        <span className="block text-sm font-medium">{title}</span>
        <span className="block text-xs text-muted-foreground">{hint}</span>
      </span>
    </button>
  )
}
