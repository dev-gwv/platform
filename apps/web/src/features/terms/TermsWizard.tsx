import { useEffect, useMemo, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { AlertTriangle, ChevronLeft, ChevronRight, Copy, FileText, Link2, Mail, MessageCircle, Printer, RefreshCw, Save, Sparkles, Send } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/shared/ui/button'
import { Card, CardContent } from '@/shared/ui/card'
import { Input, Label, Select } from '@/shared/ui/input'
import { StatusBadge } from '@/shared/ui/status-badge'
import { formatINR } from '@/shared/ui/format'
import { useProject } from '@/features/projects/api'
import { useCompanyProfile } from '@/features/settings/api'
import {
  useIssueTerms,
  useSaveTermsTemplate,
  useSeedTermsTemplates,
  useTermsEmailLogs,
  useTermsTemplates,
  useDiscardTermsDraft,
  useSaveTermsDraft,
  useTermsDraft,
  type PaymentTermDraft,
} from './api'
import { useClient } from '@/features/clients/api'
import { callApi } from '@/shared/api/client'
import { z } from '@ipc/contracts'

const TEXTAREA =
  'w-full rounded-md border border-input bg-card px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'

/**
 * The payment schedules studios actually use, as one click each.
 *
 * Percentages, not amounts: the total moves while a project is being built, and
 * a schedule that stays proportional survives that. It is converted to money
 * only in the preview and in the frozen snapshot at issue time.
 */
const PRESETS: ReadonlyArray<{ label: string; parts: ReadonlyArray<{ label: string; percent: number; when: string }> }> = [
  {
    label: '30 / 30 / 30 / 10',
    parts: [
      { label: 'On booking', percent: 30, when: 'On signing' },
      { label: 'Before first shoot', percent: 30, when: 'Before the first shoot' },
      { label: 'Before final shoot', percent: 30, when: 'Before the final shoot' },
      { label: 'On delivery', percent: 10, when: 'On delivery' },
    ],
  },
  {
    label: '30 / 40 / 30',
    parts: [
      { label: 'On booking', percent: 30, when: 'On signing' },
      { label: 'Before shoot', percent: 40, when: 'Before the shoot' },
      { label: 'On delivery', percent: 30, when: 'On delivery' },
    ],
  },
  {
    label: '50 / 50',
    parts: [
      { label: 'Advance', percent: 50, when: 'On signing' },
      { label: 'Balance', percent: 50, when: 'On delivery' },
    ],
  },
  {
    label: '100% Advance',
    parts: [{ label: 'Full payment', percent: 100, when: 'On signing' }],
  },
  {
    label: 'Retainer + Balance',
    parts: [
      { label: 'Retainer', percent: 25, when: 'On signing' },
      { label: 'Balance', percent: 75, when: 'On delivery' },
    ],
  },
]

type Step = 1 | 2 | 3

/**
 * Author a terms document in three steps, with the client's view beside you.
 *
 * The preview is the point: terms are a document somebody signs, and writing
 * one blind into a textarea is how clauses end up contradicting the payment
 * schedule two panels away.
 */
export function TermsWizard({
  projectId,
  onIssued,
  onCancel,
}: {
  projectId: string
  onIssued?: () => void
  onCancel?: () => void
}) {
  const project = useProject(projectId)
  const company = useCompanyProfile()
  const templates = useTermsTemplates()
  const seed = useSeedTermsTemplates()
  const saveTemplate = useSaveTermsTemplate()
  const issue = useIssueTerms()
  const draft = useTermsDraft(projectId)
  const saveDraft = useSaveTermsDraft()
  const discardDraft = useDiscardTermsDraft()
  /** Only ever restore once, or typing would be overwritten on every refetch. */
  const [restored, setRestored] = useState(false)

  const [step, setStep] = useState<Step>(1)
  const [title, setTitle] = useState('Terms & Conditions')
  const [templateId, setTemplateId] = useState('')
  const [terms, setTerms] = useState('')
  const [parts, setParts] = useState<PaymentTermDraft[]>([])
  const [legalNote, setLegalNote] = useState('')
  const [expiryDays, setExpiryDays] = useState('30')
  /** Set once the document exists; everything on step 3 hangs off it. */
  const [issued, setIssued] = useState<{ documentId: string; link: string } | null>(null)
  const [emailTo, setEmailTo] = useState('')
  const [emailSubject, setEmailSubject] = useState('')
  const [emailBody, setEmailBody] = useState('')
  const [sending, setSending] = useState(false)

  /**
   * Pick the draft back up. Guarded on `restored` rather than on the fields
   * being empty: a studio that deliberately cleared the terms text would
   * otherwise have the draft poured back in under them on the next refetch.
   */
  useEffect(() => {
    const d = draft.data
    if (!d || restored) return
    setRestored(true)
    if (d.title) setTitle(d.title)
    if (d.rendered_body) setTerms(d.rendered_body)
    if (d.legal_note) setLegalNote(d.legal_note)
    if (d.template_id) setTemplateId(d.template_id)
    if (Array.isArray(d.payment_terms) && d.payment_terms.length) {
      setParts(d.payment_terms as unknown as PaymentTermDraft[])
    }
  }, [draft.data, restored])

  const total = project.data?.total_cost ?? 0
  const client = project.data?.client_name ?? null
  const clientRecord = useClient(project.data?.client_id ?? '')
  const emailLogs = useTermsEmailLogs(issued?.documentId ?? null)

  /** What the studio has filled in against what a document needs to look real. */
  const brandingGaps = useMemo(() => {
    const c = company.data as Record<string, unknown> | undefined
    if (!c) return []
    const missing: string[] = []
    if (!c['invoice_logo_url'] && !c['avatar_url']) missing.push('logo')
    if (!c['invoice_gst_number']) missing.push('GST')
    if (!c['invoice_phone']) missing.push('phone')
    if (!c['invoice_email']) missing.push('email')
    if (!c['invoice_address']) missing.push('address')
    return missing
  }, [company.data])

  const amountFor = (p: PaymentTermDraft) =>
    p.mode === 'percent' ? Math.round((total * p.value) / 100) : p.value

  const scheduled = parts.reduce((s, p) => s + amountFor(p), 0)
  const percentTotal = parts.filter((p) => p.mode === 'percent').reduce((s, p) => s + p.value, 0)

  function applyPreset(label: string) {
    const preset = PRESETS.find((p) => p.label === label)
    if (!preset) return
    setParts(preset.parts.map((x) => ({ label: x.label, mode: 'percent', value: x.percent, due_trigger: x.when })))
  }

  function applyTemplate() {
    const t = (templates.data ?? []).find((x) => x.id === templateId)
    if (!t) {
      toast.error('Pick a template first.')
      return
    }
    setTerms(t.body)
    toast.success(`Applied "${t.name}"`)
  }

  function onSaveDraft() {
    saveDraft.mutate({
      project_id: projectId,
      rendered_body: terms,
      title: title.trim() || 'Terms & Conditions',
      payment_summary: parts.length
        ? parts.map((p) => `${p.label}: ${formatINR(amountFor(p))}`).join(' · ')
        : null,
      payment_terms: parts.length ? parts : null,
      total_cost: total || null,
      legal_note: legalNote.trim() || null,
      ...(templateId ? { template_id: templateId } : {}),
    })
  }

  function onIssue() {
    if (!terms.trim()) {
      toast.error('The terms need some text before you can send them.')
      setStep(2)
      return
    }
    issue
      .mutateAsync({
        project_id: projectId,
        rendered_body: terms.trim(),
        title: title.trim() || 'Terms & Conditions',
        payment_summary: parts.length
          ? parts.map((p) => `${p.label}: ${formatINR(amountFor(p))}`).join(' · ')
          : undefined,
        payment_terms: parts.length ? parts : undefined,
        total_cost: total || undefined,
        legal_note: legalNote.trim() || undefined,
        expiry_days: Number(expiryDays) || undefined,
      })
      .then((res) => {
        const link = `${window.location.origin}/terms/acknowledge?token=${res.token}`
        setIssued({ documentId: res.document_id, link })
        const to = clientRecord.data?.email ?? ''
        setEmailTo(to)
        setEmailSubject(`${title.trim() || 'Terms & Conditions'} — ${project.data?.name ?? 'your project'}`)
        setEmailBody(
          `Hi ${client ?? 'there'},\n\nPlease review and acknowledge the terms for ${
            project.data?.name ?? 'your project'
          } here:\n${link}\n\nYou can view it, save a PDF, and acknowledge from that link.`,
        )
      })
      .catch(() => undefined)
  }

  const shareText = issued
    ? `Hi ${client ?? 'there'}, please review and acknowledge the Terms & Conditions for ${
        project.data?.name ?? 'your project'
      } here: ${issued.link}. You can view, print/save a PDF, and acknowledge it from the link.`
    : ''

  /**
   * Records the send against the document. The provider may not be configured,
   * which is why the manual share sits beside this rather than behind it.
   */
  async function sendEmail() {
    if (!issued) return
    setSending(true)
    try {
      await callApi('/terms/email-log', {
        method: 'POST',
        body: {
          document_id: issued.documentId,
          to: emailTo.trim(),
          subject: emailSubject.trim(),
          body: emailBody,
          status: 'sent',
        },
        responseSchema: z.object({ id: z.string() }),
      })
      toast.success('Email recorded')
      void emailLogs.refetch()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'We could not record that email.')
    } finally {
      setSending(false)
    }
  }

  async function copyText(text: string, what: string) {
    try {
      await navigator.clipboard.writeText(text)
      toast.success(`${what} copied`)
    } catch {
      toast.error(`Could not copy the ${what.toLowerCase()}.`)
    }
  }

  return (
    <div className="mt-4 flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="flex items-center gap-2 font-semibold tracking-tight">
            {title || 'Terms & Conditions'}
            <StatusBadge tone="warning">draft</StatusBadge>
          </h2>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Create, review and send client terms in a few steps.
            {project.data ? ` — ${project.data.name}${client ? ` · ${client}` : ''}` : ''}
          </p>
          {/* Resuming is only worth saying while there is something to resume. */}
          {draft.data && !issued && (
            <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <Save className="size-3.5" />
              Picked up from your saved draft.
              <button
                type="button"
                className="underline underline-offset-2 hover:text-foreground"
                onClick={() => discardDraft.mutate(projectId)}
              >
                Discard it
              </button>
            </p>
          )}
        </div>
        {!issued && (
          <Button variant="outline" size="sm" onClick={onSaveDraft} disabled={saveDraft.isPending}>
            <Save /> {saveDraft.isPending ? 'Saving…' : 'Save draft'}
          </Button>
        )}
        <Button variant="outline" size="sm" onClick={() => window.print()}>
          <Printer /> Print / PDF
        </Button>
        {onCancel && (
          <Button variant="ghost" size="sm" onClick={onCancel}>
            Close
          </Button>
        )}
      </div>

      <ol className="grid gap-2 sm:grid-cols-3">
        {([1, 2, 3] as Step[]).map((n) => (
          <li key={n}>
            <button
              type="button"
              onClick={() => setStep(n)}
              aria-current={step === n ? 'step' : undefined}
              className={`flex w-full items-center gap-2 rounded-lg border p-3 text-left text-sm transition ${
                step === n ? 'border-primary bg-primary/5 font-medium' : 'border-border text-muted-foreground'
              }`}
            >
              <span
                className={`flex size-6 shrink-0 items-center justify-center rounded-full text-xs ${
                  step === n ? 'bg-primary text-primary-foreground' : 'bg-muted'
                }`}
              >
                {n}
              </span>
              Step {n}: {n === 1 ? 'Template & Payment Terms' : n === 2 ? 'Terms & Conditions' : 'Send to Client'}
            </button>
          </li>
        ))}
      </ol>

      {brandingGaps.length > 0 && (
        <p className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" />
          <span>
            Company branding is incomplete: {brandingGaps.join(', ')}. Add it in{' '}
            <Link to="/settings" className="font-medium text-primary hover:underline">
              Settings → Brand identity
            </Link>{' '}
            for a professional document.
          </span>
        </p>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="self-start">
          <CardContent className="p-4">
            {step === 1 && (
              <div className="flex flex-col gap-4">
                <div>
                  <h3 className="font-medium">Template</h3>
                  <p className="mt-0.5 text-sm text-muted-foreground">
                    Choose a starting point. You can edit everything after applying it.
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <Select
                      value={templateId}
                      onChange={(e) => setTemplateId(e.target.value)}
                      aria-label="Choose a template"
                      className="min-w-48 flex-1"
                    >
                      <option value="">Choose a template…</option>
                      {(templates.data ?? []).map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name}
                        </option>
                      ))}
                    </Select>
                    <Button onClick={applyTemplate} disabled={!templateId}>
                      Apply template
                    </Button>
                    <Button variant="outline" onClick={() => seed.mutate()} disabled={seed.isPending}>
                      <Sparkles /> Seed
                    </Button>
                  </div>
                </div>

                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="terms-title">Document title</Label>
                  <Input id="terms-title" value={title} onChange={(e) => setTitle(e.target.value)} />
                </div>

                <div>
                  <h3 className="font-medium">Set payment terms</h3>
                  <p className="mt-0.5 text-sm text-muted-foreground">
                    Pick a preset or edit the schedule below. The client sees this in the document.
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {PRESETS.map((p) => (
                      <Button key={p.label} size="sm" variant="outline" onClick={() => applyPreset(p.label)}>
                        {p.label}
                      </Button>
                    ))}
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setParts((v) => [...v, { label: 'Instalment', mode: 'percent', value: 0 }])}
                    >
                      Custom
                    </Button>
                  </div>

                  {parts.length === 0 ? (
                    <p className="mt-3 rounded-lg border border-dashed border-border p-4 text-center text-sm text-muted-foreground">
                      No payment terms yet. Pick a preset above.
                    </p>
                  ) : (
                    <div className="mt-3 flex flex-col gap-2">
                      {parts.map((p, i) => (
                        <div key={i} className="grid gap-2 rounded-lg border border-border p-2 sm:grid-cols-[1fr_auto_auto_auto]">
                          <Input
                            value={p.label}
                            aria-label={`Instalment ${i + 1} label`}
                            onChange={(e) =>
                              setParts((v) => v.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))
                            }
                          />
                          <Select
                            value={p.mode}
                            aria-label={`Instalment ${i + 1} mode`}
                            onChange={(e) =>
                              setParts((v) =>
                                v.map((x, j) => (j === i ? { ...x, mode: e.target.value as 'percent' | 'amount' } : x)),
                              )
                            }
                            className="w-28"
                          >
                            <option value="percent">%</option>
                            <option value="amount">₹</option>
                          </Select>
                          <Input
                            inputMode="decimal"
                            value={String(p.value)}
                            aria-label={`Instalment ${i + 1} value`}
                            className="w-24"
                            onChange={(e) =>
                              setParts((v) =>
                                v.map((x, j) => (j === i ? { ...x, value: Number(e.target.value) || 0 } : x)),
                              )
                            }
                          />
                          <Button
                            size="sm"
                            variant="ghost"
                            aria-label={`Remove instalment ${i + 1}`}
                            onClick={() => setParts((v) => v.filter((_, j) => j !== i))}
                          >
                            Remove
                          </Button>
                        </div>
                      ))}
                      <p className="text-xs text-muted-foreground">
                        Scheduled {formatINR(scheduled)} of {formatINR(total)}
                        {percentTotal > 0 && percentTotal !== 100 && (
                          <span className="text-warning"> · percentages add up to {percentTotal}%, not 100%</span>
                        )}
                      </p>
                    </div>
                  )}
                </div>
              </div>
            )}

            {step === 2 && (
              <div className="flex flex-col gap-3">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="terms-body">Terms &amp; conditions</Label>
                  <textarea
                    id="terms-body"
                    rows={16}
                    value={terms}
                    onChange={(e) => setTerms(e.target.value)}
                    placeholder="One clause per line."
                    className={TEXTAREA}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="terms-legal">Legal note (optional)</Label>
                  <textarea
                    id="terms-legal"
                    rows={2}
                    value={legalNote}
                    onChange={(e) => setLegalNote(e.target.value)}
                    placeholder="Please review with your legal advisor before use."
                    className={TEXTAREA}
                  />
                </div>
                <div className="flex justify-end">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={!terms.trim() || saveTemplate.isPending}
                    onClick={() =>
                      saveTemplate.mutate({ name: title.trim() || 'Untitled template', body: terms.trim() })
                    }
                  >
                    Save as template
                  </Button>
                </div>
              </div>
            )}

            {step === 3 && (
              <div className="flex flex-col gap-4">
                {/* 1. The link itself. Everything below needs it to exist. */}
                <section className="rounded-lg border border-border p-3">
                  <h3 className="flex items-center gap-2 text-sm font-medium">
                    <Link2 className="size-4" /> Client approval link
                  </h3>
                  {!issued ? (
                    <>
                      <p className="mt-1 rounded-md border border-warning/40 bg-warning/10 p-2 text-xs">
                        Issue the document first to generate a client link.
                      </p>
                      <div className="mt-2 flex flex-wrap items-end gap-2">
                        <div className="flex flex-col gap-1.5">
                          <Label htmlFor="terms-expiry">Link expires after</Label>
                          <Select
                            id="terms-expiry"
                            value={expiryDays}
                            onChange={(e) => setExpiryDays(e.target.value)}
                            className="w-40"
                          >
                            <option value="7">7 days</option>
                            <option value="14">14 days</option>
                            <option value="30">30 days</option>
                            <option value="90">90 days</option>
                            <option value="365">A year</option>
                          </Select>
                        </div>
                        <Button onClick={onIssue} disabled={issue.isPending || !terms.trim()}>
                          <Send /> {issue.isPending ? 'Issuing…' : 'Generate client link'}
                        </Button>
                      </div>
                      <p className="mt-2 text-xs text-muted-foreground">
                        Issuing replaces any active link for this project. The client reads the document and types
                        their name to agree; that is recorded with their IP address and the time.
                      </p>
                    </>
                  ) : (
                    <div className="mt-2 flex items-center gap-2">
                      <code className="min-w-0 flex-1 truncate rounded-md bg-muted/40 px-2 py-1.5 font-mono text-xs">
                        {issued.link}
                      </code>
                      <Button size="sm" variant="outline" onClick={() => void copyText(issued.link, 'Link')}>
                        <Copy /> Copy
                      </Button>
                    </div>
                  )}
                </section>

                {/* 2. Email, with the draft pre-filled from the client record. */}
                <section className="rounded-lg border border-border p-3">
                  <h3 className="flex items-center gap-2 text-sm font-medium">
                    <Mail className="size-4" /> Email draft
                  </h3>
                  {!issued && (
                    <p className="mt-1 rounded-md border border-warning/40 bg-warning/10 p-2 text-xs">
                      Generate the client link first to enable email actions.
                    </p>
                  )}
                  <div className="mt-2 grid gap-2 sm:grid-cols-2">
                    <div className="flex flex-col gap-1.5">
                      <Label htmlFor="terms-to">To</Label>
                      <Input
                        id="terms-to"
                        value={emailTo}
                        onChange={(e) => setEmailTo(e.target.value)}
                        placeholder="client@example.com"
                      />
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <Label htmlFor="terms-subject">Subject</Label>
                      <Input
                        id="terms-subject"
                        value={emailSubject}
                        onChange={(e) => setEmailSubject(e.target.value)}
                      />
                    </div>
                  </div>
                  <div className="mt-2 flex flex-col gap-1.5">
                    <Label htmlFor="terms-body-email">Body</Label>
                    <textarea
                      id="terms-body-email"
                      rows={5}
                      value={emailBody}
                      onChange={(e) => setEmailBody(e.target.value)}
                      className={TEXTAREA}
                    />
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    The email carries the secure link. The client can view it, save a PDF, and acknowledge from there.
                  </p>
                  <div className="mt-2 flex flex-wrap justify-end gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={!issued}
                      asChild={!!issued}
                    >
                      {issued ? (
                        <a
                          href={`mailto:${encodeURIComponent(emailTo)}?subject=${encodeURIComponent(
                            emailSubject,
                          )}&body=${encodeURIComponent(emailBody)}`}
                        >
                          Open in email app
                        </a>
                      ) : (
                        <span>Open in email app</span>
                      )}
                    </Button>
                    <Button
                      size="sm"
                      disabled={!issued || sending || !emailTo.trim()}
                      onClick={() => void sendEmail()}
                    >
                      <Send /> {sending ? 'Recording…' : 'Send email'}
                    </Button>
                  </div>
                </section>

                {/* 3. The path that always works, even with no mail provider. */}
                <section className="rounded-lg border border-border p-3">
                  <h3 className="flex items-center gap-2 text-sm font-medium">
                    <MessageCircle className="size-4" /> Share manually
                  </h3>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Send the secure link yourself over WhatsApp or email.
                  </p>
                  <div className="mt-2 flex flex-col gap-1.5">
                    <Label htmlFor="terms-msg">Message text</Label>
                    <textarea
                      id="terms-msg"
                      rows={3}
                      readOnly
                      value={shareText || 'Generate the client link to build the message.'}
                      className={TEXTAREA}
                    />
                  </div>
                  <div className="mt-2 flex flex-wrap justify-end gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={!issued}
                      onClick={() => void copyText(shareText, 'Message')}
                    >
                      <Copy /> Copy message
                    </Button>
                    <Button size="sm" variant="outline" disabled={!issued} asChild={!!issued}>
                      {issued ? (
                        <a
                          href={`https://wa.me/?text=${encodeURIComponent(shareText)}`}
                          target="_blank"
                          rel="noreferrer noopener"
                        >
                          <MessageCircle /> Open WhatsApp
                        </a>
                      ) : (
                        <span>Open WhatsApp</span>
                      )}
                    </Button>
                  </div>
                </section>

                {/* 4. What has actually gone out. */}
                <section className="rounded-lg border border-border p-3">
                  <div className="flex items-center justify-between">
                    <h3 className="flex items-center gap-2 text-sm font-medium">
                      <Mail className="size-4" /> Email history
                    </h3>
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-label="Refresh email history"
                      disabled={!issued}
                      onClick={() => void emailLogs.refetch()}
                    >
                      <RefreshCw />
                    </Button>
                  </div>
                  {!issued || !emailLogs.data || emailLogs.data.length === 0 ? (
                    <p className="mt-1 text-sm text-muted-foreground">No emails yet.</p>
                  ) : (
                    <ul className="mt-2 divide-y divide-border text-sm">
                      {emailLogs.data.map((row) => (
                        <li key={row.id} className="flex flex-wrap items-center gap-2 py-1.5">
                          <span className="min-w-0 flex-1 truncate">{row.to_email ?? 'No address'}</span>
                          <StatusBadge tone={row.status === 'sent' ? 'success' : row.status === 'failed' ? 'danger' : 'neutral'}>
                            {row.status}
                          </StatusBadge>
                          <span className="text-xs text-muted-foreground">
                            {new Date(row.created_at).toLocaleString('en-IN')}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>

                {issued && (
                  <Button variant="outline" onClick={() => onIssued?.()}>
                    Done
                  </Button>
                )}
              </div>
            )}

            <div className="mt-4 flex items-center justify-between border-t border-border pt-4">
              <Button
                variant="outline"
                size="sm"
                disabled={step === 1}
                onClick={() => setStep((s) => (s > 1 ? ((s - 1) as Step) : s))}
              >
                <ChevronLeft /> Back
              </Button>
              <span className="text-xs text-muted-foreground">Step {step} of 3</span>
              <Button
                size="sm"
                disabled={step === 3}
                onClick={() => setStep((s) => (s < 3 ? ((s + 1) as Step) : s))}
              >
                Next <ChevronRight />
              </Button>
            </div>
          </CardContent>
        </Card>

        <TermsPreview
          title={title}
          studio={(company.data?.display_name ?? company.data?.name) as string | undefined}
          projectName={project.data?.name ?? null}
          clientName={client}
          total={total}
          parts={parts}
          amountFor={amountFor}
          terms={terms}
          legalNote={legalNote}
        />
      </div>
    </div>
  )
}

/** The client's side, redrawn as the studio types. Marked `.paper` so Print gives them the document alone. */
function TermsPreview({
  title,
  studio,
  projectName,
  clientName,
  total,
  parts,
  amountFor,
  terms,
  legalNote,
}: {
  title: string
  studio: string | undefined
  projectName: string | null
  clientName: string | null
  total: number
  parts: PaymentTermDraft[]
  amountFor: (p: PaymentTermDraft) => number
  terms: string
  legalNote: string
}) {
  const clauses = terms.split('\n').map((l) => l.trim()).filter(Boolean)
  return (
    <Card className="paper self-start">
      <CardContent className="p-4 sm:p-4">
        <div className="paper-toolbar mb-3 flex items-center justify-between text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <FileText className="size-3.5" /> Live preview
          </span>
          <span>Updates as you edit</span>
        </div>

        <p className="text-sm font-semibold">{studio ?? 'Your studio'}</p>
        <h3 className="mt-2 text-xl font-semibold">{title || 'Terms & Conditions'}</h3>
        <dl className="mt-2 grid gap-1 text-sm sm:grid-cols-2">
          <div>
            <dt className="inline text-muted-foreground">Project: </dt>
            <dd className="inline font-medium">{projectName ?? '—'}</dd>
          </div>
          <div>
            <dt className="inline text-muted-foreground">Client: </dt>
            <dd className="inline font-medium">{clientName ?? '—'}</dd>
          </div>
          <div>
            <dt className="inline text-muted-foreground">Project value: </dt>
            <dd className="inline font-medium">{formatINR(total)}</dd>
          </div>
        </dl>

        {parts.length > 0 && (
          <section className="paper-block mt-4">
            <h4 className="text-sm font-semibold">Payment schedule</h4>
            <div className="mt-2 overflow-x-auto rounded-lg border border-border">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-left text-xs uppercase tracking-wider text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2">Instalment</th>
                    <th className="px-3 py-2">Due</th>
                    <th className="px-3 py-2 text-right">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {parts.map((p, i) => (
                    <tr key={i} className="border-t border-border">
                      <td className="px-3 py-2">
                        {p.label}
                        {p.mode === 'percent' ? ` (${p.value}%)` : ''}
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">{p.due_trigger ?? '—'}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{formatINR(amountFor(p))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        <section className="paper-block mt-4">
          {clauses.length === 0 ? (
            <p className="rounded-lg border border-dashed border-border p-4 text-center text-sm text-muted-foreground">
              No terms yet. Apply a template or write them in step 2.
            </p>
          ) : (
            <ol className="list-decimal space-y-1.5 pl-5 text-sm text-muted-foreground">
              {clauses.map((c, i) => (
                <li key={i}>{c.replace(/^\d+\.\s*/, '')}</li>
              ))}
            </ol>
          )}
        </section>

        <section className="paper-block mt-4 border-t border-border pt-4">
          <h4 className="text-sm font-semibold">Acknowledgement</h4>
          <p className="mt-1 text-sm text-muted-foreground">
            By accepting these terms, the client confirms they have read and agreed to the above.
          </p>
          <div className="mt-6 grid gap-4 text-xs text-muted-foreground sm:grid-cols-2">
            <p className="border-t border-dashed border-border pt-1.5">Client signature &amp; date</p>
            <p className="border-t border-dashed border-border pt-1.5">For {studio ?? 'the studio'}</p>
          </div>
          {legalNote.trim() && <p className="mt-4 text-[11px] italic text-muted-foreground">{legalNote}</p>}
        </section>
      </CardContent>
    </Card>
  )
}
