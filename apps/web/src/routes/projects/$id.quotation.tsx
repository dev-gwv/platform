import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link, useParams } from '@tanstack/react-router'
import { toast } from 'sonner'
import { companyProfile } from '@ipc/contracts'
import { callApi } from '@/shared/api/client'
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Eye,
  EyeOff,
  FileText,
  Link2,
  Mail,
  MessageCircle,
  Pencil,
  Printer,
  RefreshCw,
} from 'lucide-react'
import { AuthedPage } from '@/shared/layout/AuthedPage'
import { Breadcrumbs } from '@/shared/layout/breadcrumbs'
import { PageHeader } from '@/shared/layout/page-header'
import { Button } from '@/shared/ui/button'
import { DownloadDocumentButton } from '@/shared/ui/download-document'
import { Input } from '@/shared/ui/input'
import { StatusBadge } from '@/shared/ui/status-badge'
import { ErrorState, EmptyState } from '@/shared/ui/states'
import { SkeletonCards } from '@/shared/ui/skeleton'
import { useAccess } from '@/shared/auth/useAccess'
import { formatINR, humanize } from '@/shared/ui/format'
import { useIssueQuotation, useProject, useUpdateQuotation } from '@/features/projects/api'

/** The eight sections the studio can show or hide on the client quotation. */
const PREFS = [
  { key: 'showBillTo', label: 'Bill to' },
  { key: 'showProject', label: 'Project summary' },
  { key: 'showDeliverables', label: 'Deliverables' },
  { key: 'showDeliverablesEstimated', label: 'Estimated dates on deliverables' },
  { key: 'showEventSchedule', label: 'Event schedule' },
  { key: 'showShootServices', label: 'Services per shoot' },
  { key: 'showCostSummary', label: 'Cost summary' },
  { key: 'showTerms', label: 'Terms & notes' },
] as const

const DEFAULT_PREFS: Record<string, boolean> = Object.fromEntries(PREFS.map((p) => [p.key, true]))

const PRESET_KEY = 'ipc.quotation.presets'

interface TermsPreset {
  id: string
  title: string
  body: string
}

function readPresets(): TermsPreset[] {
  try {
    const raw = localStorage.getItem(PRESET_KEY)
    const parsed: unknown = raw ? JSON.parse(raw) : null
    return Array.isArray(parsed) ? (parsed as TermsPreset[]) : []
  } catch {
    return []
  }
}

export function ProjectQuotationPage() {
  return (
    <AuthedPage module="projects">
      <ProjectQuotation />
    </AuthedPage>
  )
}

function ProjectQuotation() {
  const { id } = useParams({ from: '/authed/projects/$id/quotation' })
  const access = useAccess()
  const canEdit = access.hasAction('projects', 'edit')
  const { data, isLoading, isError, refetch } = useProject(id)
  const update = useUpdateQuotation(id)
  const issue = useIssueQuotation()

  const [prefs, setPrefs] = useState<Record<string, boolean>>(DEFAULT_PREFS)
  const [prefsLoaded, setPrefsLoaded] = useState(false)
  const [termsOpen, setTermsOpen] = useState(false)
  const [termsDraft, setTermsDraft] = useState('')
  const [presets, setPresets] = useState<TermsPreset[]>([])
  const [presetTitle, setPresetTitle] = useState('')
  const [shareLink, setShareLink] = useState<string | null>(null)
  // Studio branding for the preview header — same company profile the
  // invoices print with (logo + display name).
  const { data: company } = useQuery({
    queryKey: ['settings', 'company'],
    queryFn: () => callApi('/settings/company', { responseSchema: companyProfile }),
  })

  useEffect(() => {
    setPresets(readPresets())
  }, [])

  useEffect(() => {
    if (data && !prefsLoaded) {
      setPrefs({ ...DEFAULT_PREFS, ...(data.quotation_display_prefs ?? {}) })
      setTermsDraft(data.quotation_terms ?? '')
      setPrefsLoaded(true)
    }
  }, [data, prefsLoaded])

  if (isLoading) return <SkeletonCards count={2} />
  if (isError || !data) return <ErrorState onRetry={() => void refetch()} />
  const project = data
  const quoted = project.deliverables.filter(
    (d) => d.visibility_scope === 'client' && d.show_on_quotation && d.status !== 'cancelled',
  )

  /**
   * What the client will notice is absent. Named in the studio's words rather
   * than as column names — "GST number", not invoice_gst_number.
   */
  const c = company
  const missingBranding = c
    ? ([
        [!c.invoice_logo_url && !c.avatar_url, 'logo'],
        [!c.invoice_gst_number, 'GST number'],
        [!c.invoice_address, 'address'],
        [!c.invoice_phone, 'phone'],
        [!c.invoice_email, 'email'],
      ] as const)
        .filter(([missing]) => missing)
        .map(([, label]) => label)
    : []

  const show = (key: string) => prefs[key] ?? true
  const received = project.payments.reduce((s, p) => s + p.amount, 0)
  const balance = Math.max(0, data.total_cost - received)

  async function togglePref(key: string, value: boolean) {
    const next = { ...prefs, [key]: value }
    setPrefs(next)
    try {
      await update.mutateAsync({ quotation_display_prefs: next })
    } catch (err) {
      setPrefs(prefs)
      toast.error(err instanceof Error ? err.message : 'Could not save display preferences.')
    }
  }

  async function toggleVisibility(next: boolean) {
    try {
      await update.mutateAsync({ show_quotation: next })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not update visibility.')
    }
  }

  async function saveTerms() {
    try {
      await update.mutateAsync({ quotation_terms: termsDraft.trim() ? termsDraft : null })
      setTermsOpen(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not save terms.')
    }
  }

  function savePreset() {
    const body = termsDraft.trim()
    const title = presetTitle.trim()
    if (!body || !title) {
      toast.error('Give the preset a name and some text first.')
      return
    }
    const next = [{ id: `${Date.now()}`, title, body }, ...presets]
    setPresets(next)
    try {
      localStorage.setItem(PRESET_KEY, JSON.stringify(next))
    } catch {
      // Storage full or blocked — the list still works for this session.
    }
    setPresetTitle('')
    toast.success('Preset saved')
  }

  function deletePreset(presetId: string) {
    const next = presets.filter((p) => p.id !== presetId)
    setPresets(next)
    try {
      localStorage.setItem(PRESET_KEY, JSON.stringify(next))
    } catch {
      // Ignore persistence failures.
    }
  }

  async function onShare() {
    try {
      const r = await issue.mutateAsync({ project_id: id, notes: null })
      setShareLink(r.link)
      await navigator.clipboard?.writeText(r.link)
      toast.success('Quotation link copied')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not create the share link.')
    }
  }

  function onEmail() {
    const subject = encodeURIComponent(`Quotation — ${project.name} — ${formatINR(project.total_cost)}`)
    const body = encodeURIComponent(
      `Hi ${project.client_name ?? 'there'},\n\nPlease find your quotation for "${project.name}".\nTotal: ${formatINR(project.total_cost)}${received > 0 ? `\nReceived: ${formatINR(received)}\nBalance: ${formatINR(balance)}` : ''}\n\n${shareLink ?? ''}`,
    )
    window.location.href = `mailto:?subject=${subject}&body=${body}`
  }

  function onWhatsApp() {
    const digits = (project.client_phone ?? '').replace(/\D/g, '')
    if (!digits) {
      toast.error('Add a client phone number to send this quotation on WhatsApp.')
      return
    }
    const text = encodeURIComponent(
      `Hi ${project.client_name ?? 'there'},\n\nYour quotation for "${project.name}": ${formatINR(project.total_cost)}${balance > 0 ? ` (balance ${formatINR(balance)})` : ''}.\n\n${shareLink ?? ''}`,
    )
    window.open(`https://wa.me/${digits}?text=${text}`, '_blank', 'noopener,noreferrer')
  }

  return (
    <>
      <Breadcrumbs
        items={[
          { label: 'Home', to: '/dashboard' },
          { label: 'Projects', to: '/projects' },
          { label: project.name, to: `/projects/${id}` },
          { label: 'Quotation' },
        ]}
      />
      <PageHeader
        title="Quotation"
        description="Preview, toggle visibility, and send this project's quotation."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" asChild>
              <Link to="/projects/$id" params={{ id }}>
                <ArrowLeft /> Back to project
              </Link>
            </Button>
            <Button variant="outline" size="sm" onClick={() => void refetch()}>
              <RefreshCw /> Refresh
            </Button>
            <Button variant="outline" size="sm" onClick={onEmail}>
              <Mail /> Email
            </Button>
            <Button variant="outline" size="sm" onClick={onWhatsApp}>
              <MessageCircle /> WhatsApp
            </Button>
            <Button variant="outline" size="sm" onClick={() => void onShare()} disabled={issue.isPending}>
              <Link2 /> {issue.isPending ? 'Preparing…' : 'Share link'}
            </Button>
            <DownloadDocumentButton
              name={`Quotation ${data.name}`}
              label="Download PDF"
            />
            <Button size="sm" onClick={() => window.print()}>
              <Printer /> Print
            </Button>
          </div>
        }
      />

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <StatusBadge tone={project.show_quotation ? 'success' : 'warning'}>
          {project.show_quotation ? (
            <span className="flex items-center gap-1"><Eye className="size-3" /> Visible to client</span>
          ) : (
            <span className="flex items-center gap-1"><EyeOff className="size-3" /> Hidden from client</span>
          )}
        </StatusBadge>
        {canEdit && (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={project.show_quotation} onChange={(e) => void toggleVisibility(e.target.checked)} />
            Show to client
          </label>
        )}
        {shareLink && (
          <StatusBadge tone="info">
            <span className="flex items-center gap-1"><CheckCircle2 className="size-3" /> Link ready — copied to clipboard</span>
          </StatusBadge>
        )}
      </div>

      {/* A quotation with no logo, GST number or address goes out looking like
          a draft. The studio cannot see that from here — they are reading their
          own document and their eye fills in what is missing. */}
      {missingBranding.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm">
          <AlertTriangle className="size-4 shrink-0 text-warning" aria-hidden />
          <span className="min-w-0 flex-1">
            Complete your studio branding to make quotations look professional. Missing:{' '}
            {missingBranding.join(', ')}.
          </span>
          <Button variant="outline" size="sm" asChild>
            <Link to="/settings/company">Open settings</Link>
          </Button>
        </div>
      )}

      {/* Acknowledgement state: what the client sees and how they answer. */}
      {!project.show_quotation ? (
        <div className="mt-3 flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm" role="status">
          <EyeOff className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
          <p>
            <span className="font-medium">Hidden from the client.</span>{' '}
            The public link shows a “hidden by the studio” notice until you switch visibility back on.
          </p>
        </div>
      ) : (
        <div className="mt-3 flex items-start gap-2 rounded-lg border border-border bg-muted/30 p-3 text-sm text-muted-foreground" role="status">
          <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" aria-hidden />
          <p>
            The client answers on the public link — typing their name and pressing{' '}
            <span className="font-medium text-foreground">Accept quotation</span> records their
            approval with a timestamp. Resend the link after any price change so the snapshot
            they see matches this page.
          </p>
        </div>
      )}

      {canEdit && (
        <div className="mt-4 rounded-lg border border-border bg-card p-4">
          <h3 className="text-sm font-semibold">Show on quotation</h3>
          <p className="text-xs text-muted-foreground">Toggle the sections the client will see. Saved per project.</p>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {PREFS.map((p) => (
              <label key={p.key} className="flex items-center justify-between gap-3 rounded-md border border-border/60 px-3 py-2 text-sm">
                {p.label}
                <input type="checkbox" checked={show(p.key)} onChange={(e) => void togglePref(p.key, e.target.checked)} aria-label={p.label} />
              </label>
            ))}
          </div>
        </div>
      )}

      {/* `paper` is the whole contract: everything outside it is hidden on
          paper, so Print gives the client their quotation rather than a
          screenshot of the studio's editing screen -- toolbar, visibility
          toggles, branding warning and all. */}
      <div className="paper mt-4 rounded-xl border border-border bg-card p-4 sm:p-8">
        <header className="paper-block flex flex-wrap items-start justify-between gap-4 border-b border-border pb-5">
          <div>
            <div className="flex items-center gap-2">
              {(company?.invoice_logo_url ?? company?.avatar_url) ? (
                <img
                  src={(company?.invoice_logo_url ?? company?.avatar_url) as string}
                  alt={company?.display_name ?? company?.name ?? 'Studio logo'}
                  className="size-9 rounded-lg object-contain"
                />
              ) : (
                <span className="flex size-9 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                  <FileText className="size-5" />
                </span>
              )}
              <div>
                <p className="font-semibold leading-tight">{company?.display_name ?? company?.name ?? 'Quotation'}</p>
                {(company?.invoice_phone ?? company?.invoice_email) && (
                  <p className="text-xs text-muted-foreground">
                    {[company?.invoice_phone, company?.invoice_email].filter(Boolean).join(' · ')}
                  </p>
                )}
              </div>
            </div>
            <p className="mt-3 text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">Project Quotation</p>
            <h2 className="mt-1 text-xl font-semibold">{project.name}</h2>
            <p className="mt-1 text-sm text-muted-foreground">Prepared for {project.client_name ?? 'client'}</p>
          </div>
          <div className="text-sm">
            <p className="text-xs uppercase tracking-wider text-muted-foreground">Issued</p>
            <p>{project.created_at.slice(0, 10)}</p>
            <p className="mt-2 text-xs uppercase tracking-wider text-muted-foreground">Status</p>
            <p>{humanize(project.status)}</p>
          </div>
        </header>

        {show('showBillTo') && (
          <section className="mt-4 rounded-lg border border-border/60 p-4">
            <h3 className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">Bill to</h3>
            <p className="mt-1 font-medium">{project.client_name ?? 'No client linked'}</p>
            {project.client_phone && <p className="text-sm text-muted-foreground">{project.client_phone}</p>}
          </section>
        )}

        {show('showDeliverables') && (
          <section className="mt-4">
            {/* Only what was promised to the client -- never the team's own work. */}
            <h3 className="text-sm font-semibold">Deliverables</h3>
            {quoted.length === 0 ? (
              <EmptyState title="No deliverables yet" description="Deliverables will appear here once added." />
            ) : (
              <ul className="mt-2 divide-y divide-border rounded-lg border border-border">
                {quoted.map((d) => (
                  <li key={d.id} className="flex items-center justify-between gap-4 px-3 py-2.5 text-sm">
                    <span className="min-w-0 flex-1">
                      {d.title}
                      {show('showDeliverablesEstimated') && d.estimated_date && (
                        <span className="block text-xs text-muted-foreground">
                          Estimated {new Date(`${d.estimated_date}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                        </span>
                      )}
                    </span>
                    <span className="shrink-0 tabular-nums text-muted-foreground">
                      {d.is_additional_charge ? formatINR(d.additional_charge_amount) : 'Included'}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

        {show('showCostSummary') && (
          <section className="ml-auto mt-6 w-full max-w-sm rounded-xl border border-border bg-muted/30 p-4">
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Summary</h3>
            <dl className="flex flex-col gap-1.5 text-sm">
              <div className="flex justify-between"><dt>Package cost</dt><dd className="tabular-nums">{formatINR(project.package_cost)}</dd></div>
              {project.additional_deliverables_cost > 0 && (
                <div className="flex justify-between"><dt>Additional deliverables</dt><dd className="tabular-nums">{formatINR(project.additional_deliverables_cost)}</dd></div>
              )}
              <div className="flex justify-between border-t border-border pt-1.5 font-semibold">
                <dt>Total quotation value</dt><dd className="tabular-nums text-primary">{formatINR(project.total_cost)}</dd>
              </div>
              {received > 0 && (
                <>
                  <div className="flex justify-between text-muted-foreground"><dt>Amount received</dt><dd className="tabular-nums">{formatINR(received)}</dd></div>
                  <div className="flex justify-between font-medium"><dt>Balance pending</dt><dd className="tabular-nums">{formatINR(balance)}</dd></div>
                </>
              )}
            </dl>
          </section>
        )}

        {show('showTerms') && (
          <section className="mt-6 border-t border-border pt-4">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Terms &amp; notes</h3>
              {canEdit && (
                <Button variant="ghost" size="sm" onClick={() => setTermsOpen((v) => !v)}>
                  <Pencil /> {termsOpen ? 'Close editor' : 'Edit terms'}
                </Button>
              )}
            </div>
            {termsOpen ? (
              <div className="mt-3 flex flex-col gap-3">
                <textarea
                  value={termsDraft}
                  onChange={(e) => setTermsDraft(e.target.value)}
                  rows={8}
                  placeholder="One point per line. Leave empty to use the default terms."
                  className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm"
                />
                <div className="rounded-lg border border-border/60 p-3">
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Presets</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <Input value={presetTitle} onChange={(e) => setPresetTitle(e.target.value)} placeholder="Preset name" className="w-44" aria-label="Preset name" />
                    <Button size="sm" variant="outline" onClick={savePreset}>Save current as preset</Button>
                  </div>
                  {presets.length > 0 && (
                    <ul className="mt-2 flex flex-col gap-1.5">
                      {presets.map((p) => (
                        <li key={p.id} className="flex items-center justify-between gap-2 rounded-md border border-border/60 px-2 py-1.5 text-sm">
                          <button type="button" className="min-w-0 flex-1 truncate text-left hover:underline" title={p.body} onClick={() => setTermsDraft(p.body)}>
                            {p.title}
                          </button>
                          <Button size="sm" variant="ghost" onClick={() => deletePreset(p.id)}>Delete</Button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                <div className="flex justify-end gap-2">
                  <Button variant="outline" size="sm" onClick={() => { setTermsDraft(project.quotation_terms ?? ''); setTermsOpen(false) }}>Cancel</Button>
                  <Button size="sm" onClick={() => void saveTerms()} disabled={update.isPending}>
                    {update.isPending ? 'Saving…' : 'Save terms'}
                  </Button>
                </div>
              </div>
            ) : (
              <p className="mt-2 whitespace-pre-line text-sm text-muted-foreground">
                {project.quotation_terms?.trim() || 'Standard studio terms apply. Ask the studio for details.'}
              </p>
            )}
          </section>
        )}
        {!show('showTerms') && (
          <p className="mt-6 rounded-lg border border-dashed border-border p-3 text-xs text-muted-foreground">
            <EyeOff className="mr-1 inline size-3" /> Terms &amp; notes are hidden from the client quotation.
          </p>
        )}

        <footer className="mt-6 border-t border-border pt-4 text-[11px] text-muted-foreground">
          <p className="flex items-center gap-2">
            <FileText className="size-3.5" /> {project.name} · Project Quotation
          </p>
          {company?.document_footer_note && (
            <p className="mt-1">{company.document_footer_note}</p>
          )}
        </footer>
      </div>
    </>
  )
}
