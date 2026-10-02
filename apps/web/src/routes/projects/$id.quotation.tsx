import { useEffect, useState, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link, useNavigate, useParams } from '@tanstack/react-router'
import { toast } from 'sonner'
import {
  buildWhatsAppUrl,
  companyProfile,
  companyTheme,
  DEFAULT_QUOTATION_TERMS_TEXT,
  quotationNumber,
  shootListItem,
  type IssueQuotationRequest,
  type ShootListItem,
} from '@ipc/contracts'
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  ChevronDown,
  Ellipsis,
  FileText,
  Link2,
  Mail,
  MessageCircle,
  Printer,
  RefreshCw,
  RotateCcw,
  Send,
  Star,
  Eye,
} from 'lucide-react'
import { callApi } from '@/shared/api/client'
import { DraftRestoredBanner, useFormDraft } from '@/shared/hooks/use-form-draft'
import { useUrlParam } from '@/shared/hooks/use-url-param'
import { AuthedPage } from '@/shared/layout/AuthedPage'
import { Breadcrumbs } from '@/shared/layout/breadcrumbs'
import { Button } from '@/shared/ui/button'
import { Dialog, DialogContent } from '@/shared/ui/dialog'
import { Input, Label, Textarea } from '@/shared/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/shared/ui/popover'
import { Switch } from '@/shared/ui/switch'
import { ErrorState } from '@/shared/ui/states'
import { SkeletonCards } from '@/shared/ui/skeleton'
import { useAccess } from '@/shared/auth/useAccess'
import { formatINR } from '@/shared/ui/format'
import {
  useIssueQuotation,
  useProject,
  useSendQuotationEmail,
  useUpdateQuotation,
} from '@/features/projects/api'
import {
  QUOTATION_PREFS,
  QuotationDocument,
  resolveQuotationPrefs,
  type QuotationDocShoot,
  type QuotationDocumentData,
  type QuotationPrefKey,
  type QuotationPrefs,
} from '@/features/projects/QuotationDocument'
import { ProjectJourney } from '@/features/projects/ProjectJourney'
import {
  defaultTermsBody,
  useDeleteTermsPreset,
  useMoveLocalPresets,
  useSaveTermsPreset,
  useTermsPresets,
  useUpdateTermsPreset,
} from '@/features/projects/terms-presets'
import type { JourneyKey } from '@/features/projects/journey'

const TERMS_LIMIT = 5000

/** "18:30" from a shoot's start, in the studio's own time zone. */
function clockTime(iso: string | null): string | null {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

/** The shoots as the client reads them: dated ones in order, dropped ones left out. */
function toSchedule(shoots: ShootListItem[]): QuotationDocShoot[] {
  return shoots
    .filter((s) => s.status !== 'cancelled')
    .sort((a, b) => (a.shoot_date ?? '9999').localeCompare(b.shoot_date ?? '9999'))
    .map((s) => ({
      title: s.name,
      date: s.shoot_date,
      time: clockTime(s.start_at),
      city: s.location,
      services: s.requirements.map((r) => ({ name: r.name, quantity: r.quantity })),
    }))
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}

export function ProjectQuotationPage() {
  return (
    <AuthedPage module="projects" studioWork="/my-work">
      <ProjectQuotation />
    </AuthedPage>
  )
}

function ProjectQuotation() {
  const { id } = useParams({ from: '/authed/projects/$id/quotation' })
  const navigate = useNavigate()
  const access = useAccess()
  const canEdit = access.hasAction('projects', 'edit')
  const { data, isLoading, isError, refetch, isFetching } = useProject(id)
  const update = useUpdateQuotation(id)
  const issue = useIssueQuotation()
  // The studio's own presets; the default stands in for a project with no terms.
  const presetsQ = useTermsPresets(canEdit)
  const presets = presetsQ.data ?? []
  const studioTerms = defaultTermsBody(presets)
  const baseTerms = studioTerms ?? DEFAULT_QUOTATION_TERMS_TEXT
  useMoveLocalPresets(presetsQ.data, canEdit)
  const savePresetM = useSaveTermsPreset()
  const updatePreset = useUpdateTermsPreset()
  const deletePresetM = useDeleteTermsPreset()
  const sendEmail = useSendQuotationEmail()

  // Same key the project's Shoots tab uses, so the two share one cache.
  const shoots = useQuery({
    queryKey: ['shoots', 'project', id],
    queryFn: () => callApi(`/shoots?project_id=${id}`, { responseSchema: shootListItem.array() }),
    enabled: !!id,
    staleTime: 15_000,
  })
  // The letterhead: the same company profile invoices print with.
  const { data: company } = useQuery({
    queryKey: ['settings', 'company'],
    queryFn: () => callApi('/settings/company', { responseSchema: companyProfile }),
  })
  const { data: theme } = useQuery({
    queryKey: ['settings', 'theme'],
    queryFn: () => callApi('/settings/theme', { responseSchema: companyTheme }),
  })

  const [prefs, setPrefs] = useState<QuotationPrefs>(() => resolveQuotationPrefs(null))
  const [loaded, setLoaded] = useState(false)
  const [termsOpen, setTermsOpen] = useState(false)
  const [termsDraft, setTermsDraft] = useState('')
  const [presetTitle, setPresetTitle] = useState('')
  const [emailOpen, setEmailOpen] = useState(false)
  const [emailTo, setEmailTo] = useState('')
  const [emailSubject, setEmailSubject] = useState('')
  const [emailMessage, setEmailMessage] = useState('')
  // "Send to client" lives in one menu; the journey bar opens the same menu.
  const [sendOpen, setSendOpen] = useState(false)
  // "See it as the client": the full paper the client's link shows, here --
  // nothing is issued, opened or counted.
  const [asParam, setAs] = useUrlParam('as')
  const asClient = asParam === 'client'

  useEffect(() => {
    if (data && !loaded) {
      setPrefs(resolveQuotationPrefs(data.quotation_display_prefs))
      setTermsDraft(data.quotation_terms ?? '')
      setLoaded(true)
    }
  }, [data, loaded])

  // Terms being written survive a refresh or a closed tab until they are
  // saved; a restored draft reopens the editor so it is not missed.
  const termsDraftSave = useFormDraft(
    loaded && canEdit ? `quotation-terms:${id}` : null,
    { terms: termsDraft },
    (v) => {
      setTermsDraft(v.terms)
      setTermsOpen(true)
    },
    { isBlank: (v) => v.terms === (data?.quotation_terms ?? '') },
  )

  if (isLoading) return <SkeletonCards count={2} />
  if (isError || !data) return <ErrorState onRetry={() => void refetch()} />
  const project = data

  const studioName = company?.display_name || company?.name || 'Studio'
  const quoted = project.deliverables.filter(
    (d) => d.visibility_scope === 'client' && d.show_on_quotation && d.status !== 'cancelled',
  )
  // Pending money has not arrived; only what was paid counts as received.
  const received = project.payments
    .filter((p) => (p.status ?? 'paid') === 'paid')
    .reduce((s, p) => s + p.amount, 0)
  const balance = Math.max(0, project.total_cost - received)
  const schedule = toSchedule(shoots.data ?? [])

  const doc: QuotationDocumentData = {
    studio: {
      name: studioName,
      legalName: company?.legal_name,
      logoUrl: company?.invoice_logo_url ?? company?.avatar_url,
      gstin: company?.invoice_gst_number,
      phone: company?.invoice_phone,
      email: company?.invoice_email,
      website: company?.website,
      address: company?.invoice_address,
      footerNote: company?.document_footer_note,
    },
    brandColor: theme?.is_custom_theme ? (theme.primary_color ?? theme.custom_color ?? null) : null,
    number: quotationNumber(company?.quote_number_prefix, project.id),
    issuedAt: project.created_at,
    client: {
      name: project.client_name,
      phone: project.client_phone,
      email: project.client_email,
      address: project.client_address,
    },
    project: { name: project.name, status: project.status, createdAt: project.created_at },
    deliverables: quoted.filter((d) => d.list_key === 'primary'),
    additional: quoted.filter((d) => d.list_key !== 'primary'),
    shoots: schedule,
    summary: {
      packageCost: project.package_cost,
      additional: project.additional_deliverables_cost,
      total: project.total_cost,
      received,
      balance,
    },
    terms: project.quotation_terms?.trim() ? project.quotation_terms : studioTerms,
  }

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

  async function togglePref(key: QuotationPrefKey, value: boolean) {
    const before = prefs
    const next = { ...prefs, [key]: value }
    setPrefs(next)
    try {
      await update.mutateAsync({ quotation_display_prefs: next })
    } catch (err) {
      setPrefs(before)
      toast.error(err instanceof Error ? err.message : 'Could not save display options.')
    }
  }

  async function toggleVisibility(next: boolean) {
    try {
      await update.mutateAsync({ show_quotation: next })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not update visibility.')
    }
  }

  function openTerms() {
    setTermsDraft(project.quotation_terms ?? '')
    setTermsOpen(true)
  }

  async function saveTerms() {
    try {
      await update.mutateAsync({ quotation_terms: termsDraft.trim() ? termsDraft : null })
      termsDraftSave.clear()
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
    savePresetM.mutate(
      { title, body },
      {
        onSuccess: () => {
          setPresetTitle('')
          toast.success('Preset saved for your whole studio')
        },
      },
    )
  }

  function deletePreset(presetId: string) {
    deletePresetM.mutate(presetId)
  }

  /**
   * A fresh link carrying this page as it stands: the project's terms, the
   * display options and the shoot schedule. The server snapshots the prices.
   */
  async function issueLink() {
    const wasHidden = !project.show_quotation
    const body: IssueQuotationRequest = {
      project_id: id,
      notes: null,
      // The project's own terms, else the studio's default preset.
      terms_text: (project.quotation_terms?.trim() || studioTerms?.trim() || '').slice(0, 8000) || null,
      display_prefs: prefs,
      shoots_schedule: schedule.map((s) => ({ ...s })),
    }
    const r = await issue.mutateAsync(body)
    if (wasHidden) toast.message('The quotation is now visible to the client.')
    return r
  }

  async function onShare() {
    try {
      const { link } = await issueLink()
      if (await copyText(link)) toast.success('Share link copied')
      else window.prompt('Copy this link:', link)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not create the share link.')
    }
  }

  async function onWhatsApp() {
    if (!(project.client_phone ?? '').replace(/\D/g, '')) {
      toast.error('Add a client phone number to send this on WhatsApp.')
      return
    }
    // Opened before the wait, or the browser blocks it as a pop-up.
    const win = window.open('', '_blank')
    try {
      const { link } = await issueLink()
      const text = [
        `Hi ${project.client_name ?? 'there'},`,
        '',
        `Please find your quotation for "${project.name}".`,
        `Total quotation value: ${formatINR(project.total_cost)}`,
        received > 0 ? `Balance pending: ${formatINR(balance)}` : '',
        '',
        `View the full quotation: ${link}`,
        '',
        'Regards,',
        studioName,
      ]
        .filter((l, i, all) => l !== '' || all[i - 1] !== '')
        .join('\n')
      const url = buildWhatsAppUrl(project.client_phone, text)
      if (win) {
        win.opener = null
        win.location.href = url
      } else {
        window.location.href = url
      }
    } catch (err) {
      win?.close()
      toast.error(err instanceof Error ? err.message : 'Could not create the share link.')
    }
  }

  function openEmail() {
    setEmailTo(project.client_email ?? '')
    setEmailSubject(`Quotation — ${project.name} · ${studioName}`)
    setEmailMessage(
      `Hi ${project.client_name ?? 'there'},\n\nPlease find your quotation for "${project.name}". Open the link to view it and let us know.\n\nRegards,\n${studioName}`,
    )
    setEmailOpen(true)
  }

  async function onSendEmail() {
    const to = emailTo.trim()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
      toast.error('Enter a valid email address.')
      return
    }
    try {
      const issued = await issueLink()
      const r = await sendEmail.mutateAsync({
        quotationId: issued.id,
        to_email: to,
        subject: emailSubject.trim() || null,
        message: emailMessage.trim() || null,
      })
      if (r.status === 'sent') {
        toast.success(`Quotation emailed to ${to}`)
        setEmailOpen(false)
      } else if (r.status === 'provider_missing') {
        const copied = await copyText(r.url)
        toast.error(
          `Email is not set up for your studio yet.${copied ? ' The link is copied — paste it into your own email.' : ''}`,
        )
      } else {
        toast.error(r.error ?? 'The email could not be sent.')
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'The email could not be sent.')
    }
  }

  function onPrint() {
    const original = document.title
    document.title = `Quotation — ${project.name} · ${studioName}`
    window.print()
    window.setTimeout(() => {
      document.title = original
    }, 1000)
  }

  /**
   * The journey's next step, taken from here: the project page opens on the
   * right tab with the next thing already open (?invoice=next opens the
   * booking-amount invoice; ?focus=assign points at the first day short of
   * people).
   */
  function go(key: JourneyKey) {
    const search =
      key === 'invoice' ? '?tab=billing&invoice=next' : key === 'team' ? '?tab=shoots&focus=assign' : key === 'deliver' ? '?tab=deliverables' : ''
    void navigate({ href: `/projects/${id}${search}` })
  }

  /** Another tab of the project, from the same row. */
  const refreshing = isFetching || shoots.isFetching
  const emailBusy = issue.isPending || sendEmail.isPending

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

      {/* The document, one short toolbar, and the journey's next step. The
          owner: "only the quotation should be visible" -- and then "quotation
          is good, next step", which is the bar under the toolbar. */}
      {/* Solid card, no blur: the paper scrolls under it. */}
      <div className="no-print sticky top-0 z-20 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border bg-card p-2.5 shadow-sm">
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="outline" size="sm" asChild>
            <Link to="/projects/$id" params={{ id }}>
              <ArrowLeft /> Back to project
            </Link>
          </Button>
          {canEdit ? (
            <Switch
              className="w-auto"
              label={project.show_quotation ? 'Client can see it' : 'Hidden from client'}
              checked={project.show_quotation}
              onChange={(v) => void toggleVisibility(v)}
              disabled={update.isPending}
            />
          ) : (
            <span className="text-xs text-muted-foreground">{project.show_quotation ? 'Client can see it' : 'Hidden from client'}</span>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {canEdit && (
            <Popover open={sendOpen} onOpenChange={setSendOpen}>
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm">
                  <Send /> Send to client <ChevronDown className="size-3.5" />
                </Button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-56 p-1.5">
                <MenuItem icon={<Eye />} label="See it as the client" onSelect={() => { setSendOpen(false); setAs('client') }} />
                <MenuItem icon={<Mail />} label="Email" onSelect={() => { setSendOpen(false); openEmail() }} />
                <MenuItem icon={<MessageCircle />} label="WhatsApp" disabled={issue.isPending} onSelect={() => { setSendOpen(false); void onWhatsApp() }} />
                <MenuItem icon={<Link2 />} label={issue.isPending ? 'Preparing…' : 'Copy link'} disabled={issue.isPending} onSelect={() => { setSendOpen(false); void onShare() }} />
              </PopoverContent>
            </Popover>
          )}
          <Button size="sm" variant="outline" onClick={onPrint}>
            <Printer /> Print / PDF
          </Button>
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm" aria-label="More">
                <Ellipsis />
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-72 p-1.5">
              {canEdit && <MenuItem icon={<FileText />} label="Edit terms" onSelect={openTerms} />}
              <MenuItem
                icon={<RefreshCw className={refreshing ? 'animate-spin' : undefined} />}
                label="Refresh"
                disabled={refreshing}
                onSelect={() => void Promise.all([refetch(), shoots.refetch()])}
              />
              {canEdit && (
                <div className="mt-1 border-t border-border px-2 pb-1 pt-2">
                  <p className="text-xs font-semibold text-muted-foreground">Show on quotation</p>
                  <div className="mt-2 flex flex-col gap-2">
                    {QUOTATION_PREFS.map((p) => (
                      <Switch
                        key={p.key}
                        label={p.label}
                        checked={prefs[p.key]}
                        onChange={(v) => void togglePref(p.key, v)}
                        disabled={
                          (p.key === 'showDeliverablesEstimated' && !prefs.showDeliverables) ||
                          (p.key === 'showShootServices' && !prefs.showEventSchedule)
                        }
                      />
                    ))}
                  </div>
                </div>
              )}
            </PopoverContent>
          </Popover>
        </div>
      </div>

      {canEdit && (
        <ProjectJourney
          project={project}
          here="quotation"
          onGo={go}
          onSend={() => setSendOpen(true)}
          className="mt-2"
        />
      )}

      {project.quotation_accepted_at && (
        <div className="no-print mt-2 flex items-start gap-2 rounded-lg border border-success/40 bg-success/10 px-3 py-1.5 text-sm" role="status">
          <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" aria-hidden />
          <p className="font-medium">
            Client acknowledged on{' '}
            {new Date(project.quotation_accepted_at).toLocaleString('en-IN', {
              day: 'numeric',
              month: 'short',
              year: 'numeric',
              hour: 'numeric',
              minute: '2-digit',
            })}
            {project.quotation_accepted_by ? ` by ${project.quotation_accepted_by}` : ''}.
          </p>
        </div>
      )}

      {/* A quotation with no logo, GST number or address goes out looking like
          a draft. The studio cannot see that from here — they are reading their
          own document and their eye fills in what is missing. */}
      {missingBranding.length > 0 && (
        <div className="no-print mt-2 flex flex-wrap items-center gap-2 rounded-lg border border-warning/40 bg-warning/10 px-3 py-1.5 text-xs">
          <AlertTriangle className="size-4 shrink-0 text-warning" aria-hidden />
          <span className="min-w-0 flex-1">
            Complete your studio branding to make quotations look professional. Missing:{' '}
            {missingBranding.join(', ')}.
          </span>
          <Button variant="outline" size="sm" className="h-7" asChild>
            <Link to="/settings/company">Open settings</Link>
          </Button>
        </div>
      )}

      {asClient && (
        <div className="no-print mt-2 flex flex-wrap items-center gap-2 rounded-lg border border-primary/30 bg-primary/5 px-3 py-1.5 text-sm" role="status">
          <Eye className="size-4 shrink-0 text-primary" aria-hidden />
          <span className="min-w-0 flex-1">
            This is what your client sees. Opening it here isn&apos;t counted as a client view.
            {!project.show_quotation && ' It is hidden from them until you turn on "Client can see it".'}
          </span>
          <Button size="sm" variant="outline" className="h-7" onClick={() => setAs('')}>
            Back to my view
          </Button>
        </div>
      )}

      <div className="mt-3">
        {asClient ? (
          <QuotationDocument data={doc} prefs={prefs} />
        ) : (
          <QuotationDocument
            data={doc}
            prefs={prefs}
            compact
            onEditTerms={canEdit ? openTerms : undefined}
            onEditFrom={
              canEdit
                ? (where) => void navigate({ to: '/projects/$id', params: { id }, search: { tab: where } as never })
                : undefined
            }
          />
        )}
      </div>

      <Dialog open={termsOpen} onOpenChange={(o) => !update.isPending && setTermsOpen(o)}>
        <DialogContent
          className="sm:max-w-2xl"
          title="Edit terms & notes"
          description={`These appear at the bottom of the quotation. One point per line. Leave it empty to use ${studioTerms ? 'your studio’s default terms' : 'the standard terms'}.`}
        >
          <div className="flex flex-col gap-3">
            <DraftRestoredBanner
              at={termsDraftSave.restoredAt}
              onDismiss={termsDraftSave.dismissRestored}
              onDiscard={() => {
                termsDraftSave.clear()
                setTermsDraft(project.quotation_terms ?? '')
              }}
            />
            <Textarea
              value={termsDraft}
              onChange={(e) => setTermsDraft(e.target.value)}
              rows={12}
              placeholder={baseTerms}
              aria-label="Terms"
              className="min-h-[14rem] text-sm leading-relaxed"
            />
            <p className={`text-xs ${termsDraft.length > TERMS_LIMIT ? 'text-destructive' : 'text-muted-foreground'}`}>
              {termsDraft.length}/{TERMS_LIMIT} characters · One point per line.
            </p>
            <div className="rounded-lg border border-border/60 p-3">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Presets</p>
              {presets.length > 0 && (
                <ul className="mt-2 flex flex-col gap-1.5">
                  {presets.map((p) => (
                    <li key={p.id} className="flex items-center justify-between gap-2 rounded-md border border-border/60 px-2 py-1.5 text-sm">
                      <button type="button" className="min-w-0 flex-1 truncate text-left hover:underline" title={p.body} onClick={() => setTermsDraft(p.body)}>
                        {p.title}
                      </button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className={p.is_default ? 'text-warning' : 'text-muted-foreground'}
                        aria-pressed={p.is_default}
                        title={p.is_default ? 'Used on every project without its own terms. Press to stop.' : 'Use on every project without its own terms'}
                        disabled={updatePreset.isPending}
                        onClick={() => updatePreset.mutate({ id: p.id, patch: { is_default: !p.is_default } })}
                      >
                        <Star className={p.is_default ? 'fill-current' : undefined} aria-hidden /> {p.is_default ? 'Default' : 'Make default'}
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => deletePreset(p.id)}>
                        Delete
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
              <div className="mt-2 flex flex-wrap gap-2">
                <Input value={presetTitle} onChange={(e) => setPresetTitle(e.target.value)} placeholder="Preset name" className="w-44" aria-label="Preset name" />
                <Button size="sm" variant="outline" onClick={savePreset} disabled={savePresetM.isPending}>
                  Save as preset
                </Button>
              </div>
            </div>
            <div className="flex flex-wrap justify-end gap-2">
              <Button variant="outline" size="sm" className="mr-auto" onClick={() => setTermsDraft(baseTerms)}>
                <RotateCcw /> Reset to default
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  termsDraftSave.clear()
                  setTermsDraft(project.quotation_terms ?? '')
                  setTermsOpen(false)
                }}
              >
                Cancel
              </Button>
              <Button size="sm" onClick={() => void saveTerms()} disabled={update.isPending || termsDraft.length > TERMS_LIMIT}>
                {update.isPending ? 'Saving…' : 'Save terms'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={emailOpen} onOpenChange={(o) => !emailBusy && setEmailOpen(o)}>
        <DialogContent
          className="sm:max-w-lg"
          title="Email quotation"
          description="Sends your client an email with a link to view, print and accept the quotation."
        >
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="qemail-to">To</Label>
              <Input id="qemail-to" type="email" value={emailTo} onChange={(e) => setEmailTo(e.target.value)} placeholder="client@example.com" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="qemail-subject">Subject</Label>
              <Input id="qemail-subject" value={emailSubject} maxLength={200} onChange={(e) => setEmailSubject(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="qemail-message">Message</Label>
              <Textarea id="qemail-message" rows={6} value={emailMessage} maxLength={2000} onChange={(e) => setEmailMessage(e.target.value)} />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => setEmailOpen(false)} disabled={emailBusy}>
                Cancel
              </Button>
              <Button size="sm" onClick={() => void onSendEmail()} disabled={emailBusy}>
                <Send /> {emailBusy ? 'Sending…' : 'Send email'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}

/** One row of the toolbar's menus. */
function MenuItem({
  icon,
  label,
  onSelect,
  disabled,
}: {
  icon: ReactNode
  label: string
  onSelect: () => void
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onSelect}
      className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm hover:bg-muted disabled:opacity-50 [&_svg]:size-4 [&_svg]:text-muted-foreground"
    >
      {icon}
      {label}
    </button>
  )
}
