import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  Bookmark,
  CalendarDays,
  Check,
  CheckCircle2,
  Copy,
  FileText,
  Send,
  Clock,
  MapPin,
  Package,
  Plus,
  Pencil,
  RotateCcw,
  Save,
  Search,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  UserPlus,
  Users,
  Wallet,
  X,
  type LucideIcon,
} from 'lucide-react'
import {
  DUE_BASIS_OPTIONS,
  deliverableRuleForTitle,
  internalLeadDaysForTitle,
  type DueBasis,
} from '@ipc/domain'
import {
  z,
  type CreateShootRequest,
  type ShootPreset,
  type ShootPresetKind,
  type ShootPresetPayload,
} from '@ipc/contracts'
import { callApi } from '@/shared/api/client'
import { AuthedPage } from '@/shared/layout/AuthedPage'
import { Breadcrumbs } from '@/shared/layout/breadcrumbs'
import { PageHeader } from '@/shared/layout/page-header'
import { Button } from '@/shared/ui/button'
import { Card, CardContent } from '@/shared/ui/card'
import { Dialog, DialogClose, DialogContent, DialogTrigger } from '@/shared/ui/dialog'
import { cn } from '@/shared/ui/cn'
import { Input, Label, Select } from '@/shared/ui/input'
import { formatINR } from '@/shared/ui/format'
import { StatusBadge } from '@/shared/ui/status-badge'
import { Stepper } from '@/shared/ui/stepper'
import { Switch } from '@/shared/ui/switch'
import { useConfirm } from '@/shared/ui/confirm'
import { scrollIntoView } from '@/shared/ui/motion'
import { useClients, useCreateClient } from '@/features/clients/api'
import {
  useCreateProject,
  useDeleteDeliverableSet,
  useDeliverableSets,
  useIssueQuotation,
  useSaveDeliverableSet,
  useShootTypes,
} from '@/features/projects/api'
import { useRoleLibrary } from '@/features/team/api'
import { PaymentModePicker } from '@/features/settings/PaymentModePicker'
import {
  useDeleteShootPreset,
  useRememberService,
  useSaveShootPreset,
  useServices,
  useShootPresets,
} from '@/features/shoots/api'
import {
  groupRequirementOptions,
  requirementOptions,
  stageOfRequirement,
} from '@/features/projects/requirements'
import { STAGE_TONE } from '@/features/team/role-stages'
import { useBackToSetup, useFromSetup } from '@/features/onboarding/setup-flow'
import { QuantityStepper, ToneChip, TONE_CHIP_STATIC, TONE_DOT, TONE_TEXT, toneAt } from '@/shared/ui/tone-chip'
import {
  BUILT_IN_SETS,
  EMPTY_DRAFT,
  QUICK_SHOOTS,
  learnedDeliverables,
  quickDeliverables,
  rememberDeliverables,
  SHOOT_PRESET,
  STEP_HINTS,
  STEP_LABELS,
  WIZARD_STEPS,
  canSubmit,
  clearDraft,
  deliverablesIn,
  draftTotals,
  estimatedDateFor,
  isDirty,
  internalWorkFor,
  internalWorkSuggestions,
  loadDraft,
  matchShootTypes,
  money,
  newAddOn,
  newClientDeliverable,
  newInternalWork,
  newPayment,
  newShoot,
  nextStep,
  prevStep,
  rememberDueDays,
  removeShootAt,
  saveDraft,
  shootIssues,
  stepErrors,
  stepIndex,
  toProjectRequest,
  shootDeliverables,
  toShootRequests,
  withDeliverables,
  withShoots,
  type DeliverableDraft,
  type ProjectDraft,
  type ShootDraft,
  type ShootRequirementDraft,
  type WizardStep,
} from '@/features/projects/wizard'

const dayFormat = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
const prettyDate = (iso: string) => dayFormat.format(new Date(`${iso}T00:00:00`))

export function NewProjectPage() {
  return (
    <AuthedPage module="projects">
      <NewProject />
    </AuthedPage>
  )
}

function NewProject() {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const confirm = useConfirm()
  const createClient = useCreateClient()
  const createProject = useCreateProject()
  const createShoot = useMutation({
    mutationFn: (input: CreateShootRequest) =>
      callApi('/shoots', { method: 'POST', body: input, responseSchema: z.object({ id: z.string() }) }),
  })

  const [draft, setDraft] = useState<ProjectDraft>(EMPTY_DRAFT)
  const [step, setStep] = useState<WizardStep>('client')
  const [visited, setVisited] = useState<Set<WizardStep>>(new Set(['client']))
  const [showErrors, setShowErrors] = useState(false)
  const [savedAt, setSavedAt] = useState<string | null>(null)
  const [restored, setRestored] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /** Set once the project exists; the dialog takes over from there. */
  const [created, setCreated] = useState<{ id: string; warning: string | null } | null>(null)
  const loaded = useRef(false)
  const sectionRef = useRef<HTMLDivElement>(null)

  const errors = stepErrors(draft)
  const totals = draftTotals(draft)
  const stepError = errors[step]

  // Restore before the first save runs, or the empty initial draft would
  // overwrite the thing we are about to offer back.
  useEffect(() => {
    const stored = loadDraft()
    if (stored && isDirty(stored.draft)) {
      setDraft(stored.draft)
      setRestored(stored.savedAt)
    }
    loaded.current = true
  }, [])

  // Autosave, debounced: typing a project name should not write on every key.
  useEffect(() => {
    if (!loaded.current) return
    const at = new Date().toISOString()
    const timer = setTimeout(() => {
      saveDraft(draft, at)
      setSavedAt(isDirty(draft) ? at : null)
    }, 600)
    return () => clearTimeout(timer)
  }, [draft])

  const patch = (p: Partial<ProjectDraft>) => {
    setDraft((d) => ({ ...d, ...p }))
    setShowErrors(false)
  }

  function goTo(next: WizardStep) {
    setStep(next)
    setVisited((v) => new Set(v).add(next))
    setShowErrors(false)
    // A long step leaves you at its foot; the next question is at the top.
    scrollIntoView(sectionRef.current)
  }

  function onNext() {
    if (stepError) {
      setShowErrors(true)
      return
    }
    goTo(nextStep(step))
  }

  async function onDiscard() {
    const yes = await confirm({
      title: 'Discard this draft?',
      description: 'Everything you have filled in here is cleared. Nothing has been created yet.',
      confirmLabel: 'Discard draft',
      destructive: true,
    })
    if (!yes) return
    clearDraft()
    setDraft(EMPTY_DRAFT)
    setRestored(null)
    setSavedAt(null)
    goTo('client')
  }

  /**
   * Create in order: client (only if new), then project, then shoots. The
   * client is created here rather than on step 1 so an abandoned wizard leaves
   * nothing behind.
   */
  async function onSubmit() {
    setError(null)
    setBusy(true)
    try {
      let clientId = draft.client_id
      if (!clientId) {
        const { toNewClientRequest } = await import('@/features/projects/wizard')
        const created = await createClient.mutateAsync(toNewClientRequest(draft))
        clientId = created.id
      }

      const { id } = await createProject.mutateAsync(toProjectRequest(draft, clientId))
      // What was promised to the client becomes a quick-add chip next time.
      rememberDeliverables(
        [...deliverablesIn(draft, 'client'), ...deliverablesIn(draft, 'add_on')].map(({ item }) => item.title),
      )

      // Shoots hang off the project, so they can only be created once it exists.
      // A failure here leaves a real project behind — say so rather than
      // pretending the whole thing failed.
      const shoots = toShootRequests(draft, id)
      const perShoot = shootDeliverables(draft)
      const failed: string[] = []
      for (const { draftIndex, ...shoot } of shoots) {
        try {
          const made = await createShoot.mutateAsync(shoot)
          // That shoot's own team work, now that there is a shoot to tie it to.
          for (const d of perShoot.get(draftIndex) ?? []) {
            await callApi(`/projects/${id}/deliverables`, {
              method: 'POST',
              body: { ...d, shoot_id: made.id },
              responseSchema: z.object({ id: z.string() }),
            })
          }
        } catch {
          failed.push(shoot.name)
        }
      }
      void qc.invalidateQueries({ queryKey: ['shoots'] })

      clearDraft()
      // The project exists now, so the wizard's job is done whether or not
      // every shoot landed. Hand over to the "what next?" dialog and carry the
      // bad news into it rather than dropping someone on a page with a toast.
      setCreated({
        id,
        warning: failed.length
          ? `Created, but these shoots did not save: ${failed.join(', ')}. Add them from the project.`
          : null,
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create the project.')
    } finally {
      setBusy(false)
    }
  }

  const invalid = useMemo(
    () => new Set(WIZARD_STEPS.filter((s) => visited.has(s) && errors[s])),
    [visited, errors],
  )

  return (
    <>
      {created && (
        <CreatedDialog
          projectId={created.id}
          warning={created.warning}
          onClose={() => void navigate({ to: '/projects/$id', params: { id: created.id } })}
        />
      )}
      <Breadcrumbs items={[{ label: 'Home', to: '/dashboard' }, { label: 'Projects', to: '/projects' }, { label: 'New' }]} />
      <PageHeader
        title="Create project"
        description="Client, shoots, deliverables and billing — one section at a time."
        actions={
          <Button variant="outline" onClick={() => void navigate({ to: '/projects' })}>
            <ArrowLeft /> Back to projects
          </Button>
        }
      />

      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-muted/30 p-4">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Sparkles className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">Guided setup</p>
          <p className="text-xs text-muted-foreground">
            {restored
              ? `Draft restored from ${prettyTime(restored)}. It saves on this device as you type.`
              : 'Your draft saves automatically on this device. Deliverable dates follow your shoot dates.'}
          </p>
        </div>
        <StatusBadge tone={savedAt ? 'success' : 'neutral'}>
          {savedAt ? `Draft saved ${prettyTime(savedAt)}` : 'No draft yet'}
        </StatusBadge>
        {isDirty(draft) && (
          <Button variant="ghost" size="sm" onClick={() => void onDiscard()}>
            <RotateCcw /> Discard
          </Button>
        )}
      </div>

      <Card className="mt-4">
        <CardContent className="flex flex-wrap items-start justify-between gap-3 p-4">
          <div className="min-w-0">
            <p className="text-sm font-medium">Step-by-step setup</p>
            <p className="text-xs text-muted-foreground">Complete one focused section at a time.</p>
            <Stepper
              className="mt-3"
              steps={WIZARD_STEPS.map((s) => ({ value: s, label: STEP_LABELS[s] }))}
              current={step}
              visited={visited}
              invalid={invalid}
              onJump={goTo}
            />
          </div>
          <StatusBadge tone="info">
            Step {stepIndex(step) + 1} of {WIZARD_STEPS.length}
          </StatusBadge>
        </CardContent>
      </Card>

      <div ref={sectionRef} className="mt-4 scroll-mt-4">
        <Section title={STEP_LABELS[step]} hint={STEP_HINTS[step]}>
          {step === 'client' && <ClientStep draft={draft} patch={patch} />}
          {step === 'shoots' && <ShootsStep draft={draft} patch={patch} />}
          {step === 'deliverables' && (
            <DeliverablesStep draft={draft} patch={patch} />
          )}
          {step === 'billing' && <BillingStep draft={draft} patch={patch} totals={totals} />}
          {step === 'review' && <ReviewStep draft={draft} totals={totals} errors={errors} onJump={goTo} />}

          {showErrors && stepError && <p className="mt-4 text-sm text-destructive">{stepError}</p>}
          {error && (
            <p id="form-error" role="alert" className="mt-4 text-sm text-destructive">
              {error}
            </p>
          )}
        </Section>
      </div>

      {/* The running total follows you down the flow: the number a studio is
          actually deciding against is the one on the quotation. */}
      <div className="sticky bottom-0 z-30 -mx-4 mt-4 border-t border-border bg-card/95 backdrop-blur md:-mx-6">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 p-3 md:px-6 md:py-4">
          <Money label="Package" value={totals.packageCost} />
          <Money label="Add-ons" value={totals.addOns} />
          <Money label="Total" value={totals.total} strong />
          {totals.received > 0 && <Money label="Received" value={totals.received} />}
          {totals.received > 0 && <Money label="Balance" value={totals.balance} />}

          <div className="ml-auto flex items-center gap-2">
            <Button variant="ghost" onClick={() => void navigate({ to: '/projects' })} disabled={busy}>
              Cancel
            </Button>
            <Button
              variant="outline"
              onClick={() => goTo(prevStep(step))}
              disabled={step === 'client' || busy}
            >
              <ArrowLeft /> Back
            </Button>
            {step === 'review' ? (
              <Button onClick={() => void onSubmit()} disabled={!canSubmit(draft) || busy}>
                {busy ? 'Creating…' : 'Create project'}
              </Button>
            ) : (
              <Button onClick={onNext} disabled={busy}>
                Next <ArrowRight />
              </Button>
            )}
          </div>
        </div>
      </div>
    </>
  )
}

const prettyTime = (iso: string) =>
  new Intl.DateTimeFormat('en-IN', { hour: 'numeric', minute: '2-digit' }).format(new Date(iso))

function Money({ label, value, strong }: { label: string; value: number; strong?: boolean }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={cn('tabular-nums', strong ? 'text-base font-semibold text-primary' : 'font-medium')}>
        {formatINR(value)}
      </p>
    </div>
  )
}

/**
 * What now? — the moment after a project is created.
 *
 * The wizard's last press is not really the end of the job: nine times in ten
 * the next thing is the quotation, and hunting for it on a page they have
 * never seen is a poor reward for finishing six steps. So the three things
 * anyone actually does next are offered here, and "Continue to project" stays
 * plain because it is the least likely of them.
 */
function CreatedDialog({
  projectId,
  warning,
  onClose,
}: {
  projectId: string
  warning: string | null
  onClose: () => void
}) {
  const navigate = useNavigate()
  const issue = useIssueQuotation()
  const [link, setLink] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const fromSetup = useFromSetup()
  const backToSetup = useBackToSetup()

  const openProject = (quotation?: boolean) =>
    void navigate({ to: quotation ? '/projects/$id/quotation' : '/projects/$id', params: { id: projectId } })

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title="Project created" description="What would you like to do next?">
        {/* A shoot that failed to save is the one thing here worth
            interrupting for — the project exists either way. */}
        {warning && (
          <p className="mb-3 rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm text-warning">
            {warning}
          </p>
        )}

        {link ? (
          <div className="flex flex-col gap-3">
            <p className="text-sm">
              Send the client this link. It opens without an account, and the prices on it stay as
              they are today.
            </p>
            <div className="flex items-center gap-2">
              <Input readOnly value={link} onFocus={(e) => e.currentTarget.select()} />
              <Button
                variant="outline"
                onClick={() => {
                  void navigator.clipboard?.writeText(link)
                  setCopied(true)
                }}
              >
                {copied ? <Check /> : <Copy />}
                {copied ? 'Copied' : 'Copy'}
              </Button>
            </div>
            <Button variant="outline" onClick={() => openProject()}>
              Go to the project
            </Button>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <Button className="w-full justify-start" onClick={() => openProject(true)}>
              <FileText /> View / edit quotation
            </Button>
            <Button
              variant="outline"
              className="w-full justify-start"
              disabled={issue.isPending}
              onClick={() =>
                issue.mutate(
                  { project_id: projectId, notes: null },
                  { onSuccess: (r) => setLink(r.link) },
                )
              }
            >
              <Send /> {issue.isPending ? 'Preparing…' : 'Share quotation'}
            </Button>
            {issue.isError && (
              <p className="text-sm text-destructive">
                {issue.error instanceof Error ? issue.error.message : 'Could not build the link.'}
              </p>
            )}
            <Button variant="ghost" className="w-full" onClick={() => openProject()}>
              Continue to project
            </Button>
            {/* Opened from the setup journey: the obvious next thing is the
                next setup step, so it is offered by name rather than left to
                the sidebar. */}
            {fromSetup && (
              <Button variant="outline" className="w-full" onClick={backToSetup}>
                Next setup step <ArrowRight />
              </Button>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

function Section({ title, hint, children }: { title: string; hint: string; children: ReactNode }) {
  return (
    <Card>
      <CardContent className="p-4 sm:p-4">
        <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
        <p className="mt-0.5 text-sm text-muted-foreground">{hint}</p>
        <div className="mt-4">{children}</div>
      </CardContent>
    </Card>
  )
}

/** A repeated block of rows — shoots, deliverables, payments all share it. */
function RowList({
  items,
  empty,
  addLabel,
  onAdd,
  children,
}: {
  items: unknown[]
  empty: string
  addLabel: string
  onAdd: () => void
  children: ReactNode
}) {
  return (
    <div className="flex flex-col gap-3">
      {items.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border p-4 text-center text-sm text-muted-foreground">
          {empty}
        </p>
      ) : (
        children
      )}
      <div>
        <Button variant="outline" onClick={onAdd}>
          <Plus /> {addLabel}
        </Button>
      </div>
    </div>
  )
}

type Patch = (p: Partial<ProjectDraft>) => void

function Field({
  label,
  required,
  hint,
  icon: Icon,
  children,
}: {
  label: string
  required?: boolean
  hint?: string
  icon?: LucideIcon
  children: ReactNode
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label className="flex items-center gap-1.5">
        {Icon && <Icon className="size-3.5 text-muted-foreground" aria-hidden />}
        {label}
        {required && <span className="ml-0.5 text-destructive">*</span>}
      </Label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  )
}

function ClientStep({ draft, patch }: { draft: ProjectDraft; patch: Patch }) {
  const { data: clients } = useClients()
  const [mode, setMode] = useState<'existing' | 'new'>(draft.new_client_name ? 'new' : 'existing')
  const [q, setQ] = useState('')

  const matches = (Array.isArray(clients) ? clients : []).filter((c) =>
    [c.name, c.phone].filter(Boolean).some((v) => String(v).toLowerCase().includes(q.trim().toLowerCase())),
  )

  return (
    <div className="flex flex-col gap-4">
      <Field label="Project name" required>
        <Input
          value={draft.name}
          onChange={(e) => patch({ name: e.target.value })}
          placeholder="e.g. Aanya & Rahul Wedding"
          autoFocus
        />
      </Field>

      <Switch
        checked={draft.show_quotation}
        onChange={(v) => patch({ show_quotation: v })}
        label="Show quotation to client"
        description="Client-visible deliverables and prices appear on their quotation link."
      />

      <div>
        <Label>Client</Label>
        <div className="mt-2 inline-flex gap-1 rounded-lg bg-muted p-1">
          {(['existing', 'new'] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => {
                setMode(m)
                patch(m === 'new' ? { client_id: '' } : { new_client_name: '', new_client_phone: '' })
              }}
              className={cn(
                'flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
                mode === m ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {m === 'existing' ? <Search className="size-3.5" /> : <UserPlus className="size-3.5" />}
              {m === 'existing' ? 'Existing client' : 'New client'}
            </button>
          ))}
        </div>

        {mode === 'existing' ? (
          <div className="mt-3 flex flex-col gap-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search by name or phone…"
                className="pl-9"
                aria-label="Search clients"
              />
            </div>
            <div className="max-h-64 overflow-y-auto rounded-lg border border-border">
              {matches.length === 0 ? (
                <p className="p-4 text-sm text-muted-foreground">
                  No clients match. Switch to “New client” to add one.
                </p>
              ) : (
                <ul className="divide-y divide-border">
                  {matches.map((c) => (
                    <li key={c.id}>
                      <button
                        type="button"
                        onClick={() => patch({ client_id: c.id })}
                        className={cn(
                          'flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors',
                          draft.client_id === c.id ? 'bg-primary/5' : 'hover:bg-accent',
                        )}
                      >
                        <Users className="size-4 shrink-0 text-muted-foreground" />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium">{c.name}</span>
                          <span className="block truncate text-xs text-muted-foreground">
                            {c.phone ?? '—'}
                          </span>
                        </span>
                        {draft.client_id === c.id && <CheckCircle2 className="size-4 text-primary" />}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        ) : (
          <div className="mt-3 grid gap-4 sm:grid-cols-2">
            <Field label="Client name" required>
              <Input
                value={draft.new_client_name}
                onChange={(e) => patch({ new_client_name: e.target.value })}
                placeholder="Sharma Family"
              />
            </Field>
            <Field label="Phone" required hint="Required — used for duplicate checks and lookups.">
              <Input
                value={draft.new_client_phone}
                onChange={(e) => patch({ new_client_phone: e.target.value })}
                placeholder="9876543210"
              />
            </Field>
            <Field label="Email">
              <Input
                value={draft.new_client_email}
                onChange={(e) => patch({ new_client_email: e.target.value })}
                placeholder="client@example.com"
              />
            </Field>
            <Field label="Relation" hint="Referral, Repeat, Vendor…">
              <Input
                value={draft.new_client_relation}
                onChange={(e) => patch({ new_client_relation: e.target.value })}
                placeholder="Referral"
              />
            </Field>
            <div className="sm:col-span-2">
              <Field label="Address">
                <Input
                  value={draft.new_client_address}
                  onChange={(e) => patch({ new_client_address: e.target.value })}
                  placeholder="Street, area, city"
                />
              </Field>
            </div>
            <div className="sm:col-span-2">
              <Field label="Notes">
                <textarea
                  value={draft.new_client_notes}
                  onChange={(e) => patch({ new_client_notes: e.target.value })}
                  rows={2}
                  placeholder="Anything the studio should remember about this client"
                  className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm"
                />
              </Field>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

/**
 * The full list of shoot types, searchable, behind the Add shoot button.
 *
 * Seventeen types is too many for chips and too few for the command palette,
 * so it is a menu that opens with the search box focused: type three letters
 * and press Enter, or scroll and click. Anything not on the list is typed in
 * the box and added by name, which is how a studio's odd one-off gets in
 * without anyone maintaining a list of every ceremony in the country.
 */
function AddShootMenu({
  shoots,
  onAdd,
  extraNames = [],
}: {
  shoots: ShootDraft[]
  onAdd: (name: string) => void
  /** This studio's own saved shoot names, merged into the common list. */
  extraNames?: readonly string[]
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const root = useRef<HTMLDivElement>(null)
  const search = useRef<HTMLInputElement>(null)
  const list = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (open) search.current?.focus()
    else setQuery('')
  }, [open])

  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const taken = new Set(shoots.map((s) => s.name.trim().toLowerCase()))
  const matches = matchShootTypes(query, extraNames)
  const custom = query.trim()
  const free = matches.filter((m) => !taken.has(m.toLowerCase()))

  const choose = (name: string) => {
    onAdd(name)
    setOpen(false)
  }

  /** Arrow keys walk from the box into the list and back, as a menu should. */
  function step(from: HTMLElement | null, dir: 1 | -1) {
    const items = [...(list.current?.querySelectorAll<HTMLElement>('button:not(:disabled)') ?? [])]
    if (items.length === 0) return
    const at = from ? items.indexOf(from) : -1
    const next = at === -1 ? (dir === 1 ? 0 : items.length - 1) : at + dir
    if (next < 0) search.current?.focus()
    else items[Math.min(next, items.length - 1)]?.focus()
  }

  return (
    <div ref={root} className="relative">
      <Button size="sm" onClick={() => setOpen((v) => !v)} aria-expanded={open} aria-haspopup="menu">
        <Plus /> Add shoot
      </Button>

      {open && (
        <div
          role="menu"
          aria-label="Shoot types"
          className="ipc-menu ipc-menu-left absolute left-0 top-full z-40 mt-2 w-72 max-w-[calc(100vw-3rem)] overflow-hidden rounded-lg border border-border bg-card shadow-lg"
          onKeyDown={(e) => {
            if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
            e.preventDefault()
            step(document.activeElement as HTMLElement, e.key === 'ArrowDown' ? 1 : -1)
          }}
        >
          <div className="border-b border-border p-2">
            <div className="relative">
              <Search
                className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden
              />
              <Input
                ref={search}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  // Enter takes the obvious one: the first type still free, or
                  // the words just typed if the list has nothing to offer.
                  if (e.key !== 'Enter') return
                  e.preventDefault()
                  const pick = free[0] ?? (custom || null)
                  if (pick) choose(pick)
                }}
                placeholder="Search shoot type…"
                aria-label="Search shoot type"
                className="pl-8"
              />
            </div>
          </div>

          <div ref={list} className="max-h-64 overflow-y-auto p-1.5">
            <p className="px-2 py-1 text-[0.65rem] font-semibold uppercase tracking-wider text-muted-foreground">
              Common
            </p>
            {matches.length === 0 ? (
              <p className="px-2 py-3 text-sm text-muted-foreground">
                No type matches “{custom}”. Add it below.
              </p>
            ) : (
              matches.map((name) => {
                const already = taken.has(name.toLowerCase())
                return (
                  <button
                    key={name}
                    type="button"
                    role="menuitem"
                    disabled={already}
                    onClick={() => choose(name)}
                    className={cn(
                      'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors',
                      already
                        ? 'cursor-not-allowed text-muted-foreground opacity-60'
                        : 'hover:bg-muted focus-visible:bg-muted focus-visible:outline-none',
                    )}
                  >
                    <span className="flex-1">{name}</span>
                    {already && <Check className="size-4 shrink-0" aria-hidden />}
                  </button>
                )
              })
            )}
          </div>

          <div className="border-t border-border p-2">
            <Button
              size="sm"
              className="w-full"
              onClick={() => choose(custom)}
              disabled={!!custom && taken.has(custom.toLowerCase())}
            >
              <Plus /> {custom ? `Add “${custom}”` : 'Add new shoot type'}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * The busiest step in the wizard, so it opens with the shortcuts rather than a
 * blank row: a chip per common shoot day, a preset that lays down the four a
 * standard wedding books, and the whole searchable list behind Add shoot.
 */
function ShootsStep({ draft, patch }: { draft: ProjectDraft; patch: Patch }) {
  const services = useServices()
  const shootPresets = useShootPresets('shoot')
  const shootTypes = useShootTypes()
  // Library first, hardcoded fallback: QUICK_SHOOTS stays when the catalog is empty.
  const quickShoots = (shootTypes.data ?? []).filter((t) => !t.is_archived).slice(0, 8).map((t) => t.name)
  const quickList = quickShoots.length ? quickShoots : [...QUICK_SHOOTS]
  const listRef = useRef<HTMLDivElement>(null)
  // The chips sit above a list that can already be several cards long, so a
  // shoot added from up there would otherwise land off the bottom of the
  // screen. Only a growing list scrolls — arriving on the step should not.
  const count = useRef(draft.shoots.length)
  useEffect(() => {
    if (draft.shoots.length > count.current) scrollIntoView(listRef.current?.lastElementChild ?? null)
    count.current = draft.shoots.length
  }, [draft.shoots.length])

  const set = (i: number, p: Partial<ShootDraft>) =>
    patch({ shoots: draft.shoots.map((s, idx) => (idx === i ? { ...s, ...p } : s)) })

  const add = (names: readonly string[]) => patch({ shoots: withShoots(draft.shoots, names) })
  // An empty name is the "add new shoot type" case with nothing typed yet: a
  // blank row to fill in, which withShoots would otherwise drop.
  const addNamed = (name: string) =>
    patch({ shoots: name ? withShoots(draft.shoots, [name]) : [...draft.shoots, newShoot()] })
  const wedding = withShoots(draft.shoots, SHOOT_PRESET)

  /** A saved day, stamped out whole: its crew and its edit-room list with it. */
  const applyShootPreset = (preset: ShootPreset) => {
    const at = draft.shoots.length
    patch({
      shoots: [
        ...draft.shoots,
        {
          ...newShoot(),
          name: preset.name,
          requirements: preset.payload.requirements.map((r) => ({
            name: r.name,
            quantity: String(r.quantity),
          })),
        },
      ],
      deliverables: [
        ...draft.deliverables,
        ...preset.payload.internal_work.map((title) => newInternalWork(at, title)),
      ],
    })
  }

  return (
    <div className="flex flex-col gap-4">
      {/* One list for every requirement input on the step: the browser reads
          it by id, and rendering it per row would repeat it a dozen times. */}
      <datalist id={SERVICE_LIST_ID}>
        {(services.data ?? []).map((s) => (
          <option key={s.id} value={s.name} />
        ))}
      </datalist>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-medium">Shoot schedule</p>
          <p className="text-xs text-muted-foreground">
            Add every shoot day. Pick a common one below, or add a custom shoot.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <AddShootMenu
            shoots={draft.shoots}
            onAdd={addNamed}
            extraNames={(shootPresets.data ?? []).map((p) => p.name)}
          />
          <PresetMenu
            label="Apply preset"
            presets={shootPresets.data ?? []}
            onApply={applyShootPreset}
            builtIn={{
              label: `Standard wedding — ${SHOOT_PRESET.join(', ')}`,
              disabled: wedding.length === draft.shoots.length,
              onApply: () => patch({ shoots: wedding }),
            }}
          />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Quick add{(shootTypes.data ?? []).length ? ' · from library' : ''}
        </span>
        {quickList.map((name, i) => {
          const already = draft.shoots.some(
            (s) => s.name.trim().toLowerCase() === name.toLowerCase(),
          )
          return (
            <ToneChip
              key={name}
              tone={toneAt(i)}
              label={name}
              selected={already}
              disabled={already}
              onClick={() => add([name])}
              title={already ? `${name} is already on the schedule` : `Add ${name}`}
            />
          )
        })}
      </div>

      {draft.shoots.length === 0 ? (
        <div className="flex flex-col items-center gap-1 rounded-lg border border-dashed border-border px-6 py-10 text-center">
          <CalendarDays className="size-5 text-muted-foreground" aria-hidden />
          <p className="mt-1 font-medium">No shoots yet</p>
          <p className="text-sm text-muted-foreground">
            Add Haldi, Wedding Day, Reception and the rest with the buttons above. Deliverable
            dates count forward from these.
          </p>
        </div>
      ) : (
        <div ref={listRef} className="flex flex-col gap-3">
          {draft.shoots.map((s, i) => (
            <ShootCard
              key={i}
              index={i}
              shoot={s}
              draft={draft}
              onChange={(p) => set(i, p)}
              onRemove={() => patch(removeShootAt(draft, i))}
            />
          ))}
        </div>
      )}
    </div>
  )
}

/**
 * Picking the crew a shoot needs.
 *
 * Everything a shoot can ask for, grouped by when in the job it happens —
 * pre-production, on the day, post-production — with a colour per group, so
 * the eye finds "the people on the floor" before it reads a single name. The
 * studio's own requirements come first in each group; library defaults after.
 *
 * What is picked sits beside the suggestions (above them on a phone), each
 * with a visible − / + so the quantity can't be missed. Tapping a chip that is
 * already picked adds one more, and the chip shows its count, so "two candid
 * photographers" is two taps without looking anywhere else.
 *
 * The draft is local until Save, so half-tapped chips do not leak into the
 * project when somebody backs out.
 */
function RequirementsDialog({
  shootName,
  requirements,
  onSave,
}: {
  shootName: string
  requirements: ShootRequirementDraft[]
  onSave: (next: ShootRequirementDraft[]) => void
}) {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState<ShootRequirementDraft[]>(requirements)
  const [custom, setCustom] = useState('')
  const services = useServices()
  const library = useRoleLibrary()
  const remember = useRememberService()

  const options = useMemo(
    () => requirementOptions(services.data ?? [], library.data ?? []),
    [services.data, library.data],
  )
  const groups = useMemo(() => groupRequirementOptions(options), [options])

  const indexOf = (name: string) =>
    draft.findIndex((r) => r.name.trim().toLowerCase() === name.trim().toLowerCase())
  const qty = (r: ShootRequirementDraft) => Math.max(1, Number(r.quantity) || 1)

  /** Add it, or — if it is already picked — one more of it. */
  const bump = (name: string) => {
    const clean = name.trim()
    if (!clean) return
    const at = indexOf(clean)
    if (at >= 0) {
      setDraft((d) => d.map((r, i) => (i === at ? { ...r, quantity: String(Math.min(99, qty(r) + 1)) } : r)))
    } else {
      setDraft((d) => [...d, { name: clean, quantity: '1' }])
    }
  }

  const addCustom = () => {
    const clean = custom.trim()
    if (!clean) return
    const known = options.some((o) => o.name.toLowerCase() === clean.toLowerCase())
    bump(clean)
    // Learned now, not when the project is saved: the next shoot on this very
    // project should already offer it.
    if (!known) remember.mutate(clean)
    setCustom('')
  }

  const setQuantity = (at: number, n: number) =>
    setDraft((d) => d.map((r, i) => (i === at ? { ...r, quantity: String(n) } : r)))

  const people = draft.reduce((sum, r) => sum + qty(r), 0)

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o)
        if (o) {
          setDraft(requirements)
          setCustom('')
        }
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm">
          <SlidersHorizontal /> {requirements.length ? 'Edit requirements' : 'Add requirements'}
        </Button>
      </DialogTrigger>
      <DialogContent
        className="max-w-4xl"
        title="Shoot requirements"
        description={`Who does “${shootName || 'this shoot'}” need? Tap to add — tap again for one more.`}
      >
        <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_21rem]">
          {/* ── what is picked: first on a phone, alongside on a wider screen ── */}
          <section
            aria-label="Selected for this shoot"
            className="order-first rounded-lg border border-primary/25 bg-primary/5 p-3 md:order-last md:self-start"
          >
            <p className="mb-2 flex items-baseline justify-between text-sm font-semibold text-primary">
              Selected for this shoot
              <span className="text-xs font-medium text-muted-foreground">
                {people} {people === 1 ? 'person' : 'people'}
              </span>
            </p>
            {draft.length === 0 ? (
              <p className="rounded-md border border-dashed border-warning/40 bg-warning/10 px-3 py-3 text-center text-sm text-warning">
                Nothing picked yet. Tap who this shoot needs.
              </p>
            ) : (
              <ul className="flex max-h-56 flex-col gap-1.5 overflow-y-auto md:max-h-[50vh]">
                {draft.map((r, at) => {
                  const tone = STAGE_TONE[stageOfRequirement(r.name, options)]
                  return (
                    <li key={at} className="flex items-center gap-2 rounded-md bg-card px-2 py-1.5">
                      <span className={cn('size-2 shrink-0 rounded-full', TONE_DOT[tone])} aria-hidden />
                      <span className="min-w-0 flex-1 break-words text-sm font-medium leading-tight">{r.name}</span>
                      <QuantityStepper value={qty(r)} onChange={(n) => setQuantity(at, n)} label={r.name} />
                      <button
                        type="button"
                        onClick={() => setDraft((d) => d.filter((_, i) => i !== at))}
                        className="rounded p-1 text-muted-foreground transition-colors hover:text-destructive"
                      >
                        <X className="size-3.5" aria-hidden />
                        <span className="sr-only">Remove {r.name}</span>
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
          </section>

          {/* ── what can be picked ── */}
          <div className="flex min-w-0 flex-col gap-4 md:max-h-[60vh] md:overflow-y-auto md:pr-1">
            <div className="flex items-center gap-2">
              <Input
                value={custom}
                onChange={(e) => setCustom(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key !== 'Enter') return
                  e.preventDefault()
                  addCustom()
                }}
                placeholder="Someone not listed? e.g. Highlight Editor"
                aria-label="Add your own requirement"
              />
              <Button variant="outline" onClick={addCustom} disabled={!custom.trim()}>
                <Plus /> Add
              </Button>
            </div>

            {groups.map((g) => (
              <div key={g.stage}>
                <p className={cn('mb-1.5 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider', TONE_TEXT[g.tone])}>
                  <span className={cn('size-2 rounded-full', TONE_DOT[g.tone])} aria-hidden />
                  {g.label}
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {g.options.map((o) => {
                    const at = indexOf(o.name)
                    return (
                      <ToneChip
                        key={o.name}
                        tone={g.tone}
                        label={o.name}
                        selected={at >= 0}
                        count={at >= 0 ? qty(draft[at]!) : undefined}
                        onClick={() => bump(o.name)}
                        title={at >= 0 ? `Add one more ${o.name}` : `Add ${o.name}`}
                      />
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-4 flex items-center justify-end gap-2 border-t border-border pt-3">
          <DialogClose asChild>
            <Button type="button" variant="outline">
              Cancel
            </Button>
          </DialogClose>
          <Button
            onClick={() => {
              onSave(draft.filter((r) => r.name.trim()))
              setOpen(false)
            }}
          >
            <Check /> Save {draft.length > 0 ? `${people} ${people === 1 ? 'person' : 'people'}` : 'requirements'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

/** Shared by every requirement input on the step. */
const SERVICE_LIST_ID = 'ipc-shoot-services'

/**
 * One shoot day, whole: when it is, where it is, who it needs, and what the
 * edit room owes off the back of it.
 *
 * The card tints when something is missing rather than blocking — a studio
 * booking a date off a phone call has the day before it has the crew, and the
 * wizard should take the booking either way. Only a missing title actually
 * stops the step.
 */
function ShootCard({
  index,
  shoot,
  draft,
  onChange,
  onRemove,
}: {
  index: number
  shoot: ShootDraft
  draft: ProjectDraft
  onChange: (p: Partial<ShootDraft>) => void
  onRemove: () => void
}) {
  const issues = shootIssues(shoot)
  const ready = issues.length === 0
  const work = internalWorkFor(draft, index)
  const services = useServices()
  const library = useRoleLibrary()
  const options = useMemo(
    () => requirementOptions(services.data ?? [], library.data ?? []),
    [services.data, library.data],
  )
  return (
    <div
      className={cn(
        // Red while anything is missing, green the moment it isn't: the card
        // itself says whether this day is done, without reading the badges.
        'card-enter rounded-lg border p-4 transition-colors duration-300',
        ready ? 'border-success/40 bg-success/[0.04]' : 'border-destructive/25 bg-destructive/5',
      )}
    >
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span
          className={cn(
            'flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold transition-colors',
            ready ? 'bg-success text-card' : 'bg-primary/10 text-primary',
          )}
        >
          {ready ? <Check className="size-3.5" aria-hidden /> : index + 1}
        </span>
        <span className="font-medium">{shoot.name.trim() || `Shoot ${index + 1}`}</span>
        {ready ? (
          <StatusBadge tone="success">
            <CheckCircle2 className="mr-1 size-3" aria-hidden />
            Ready
          </StatusBadge>
        ) : (
          issues.map((issue) => (
            <StatusBadge key={issue} tone={issue === 'Title & date needed' ? 'danger' : 'warning'}>
              <AlertCircle className="mr-1 size-3" aria-hidden />
              {issue}
            </StatusBadge>
          ))
        )}
        <div className="ml-auto flex items-center gap-1">
          <SavePresetButton
            kind="shoot"
            defaultName={shoot.name.trim() || `Shoot ${index + 1}`}
            label="Save as preset"
            payload={{
              requirements: shoot.requirements
                .filter((r) => r.name.trim())
                .map((r) => ({ name: r.name.trim(), quantity: Math.max(1, Number(r.quantity) || 1) })),
              internal_work: work.map((w) => w.item.title.trim()).filter(Boolean),
            }}
          />
          <Button variant="ghost" size="icon" onClick={onRemove}>
            <Trash2 className="text-destructive" />
            <span className="sr-only">Remove shoot {index + 1}</span>
          </Button>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Shoot title" required>
          <Input
            value={shoot.name}
            onChange={(e) => onChange({ name: e.target.value })}
            placeholder="Wedding day"
            aria-invalid={!shoot.name.trim()}
          />
        </Field>
        <Field label="Date" icon={CalendarDays}>
          <Input
            type="date"
            value={shoot.shoot_date}
            onChange={(e) => onChange({ shoot_date: e.target.value })}
            aria-invalid={!shoot.shoot_date}
          />
        </Field>
        <Field label="Time" icon={Clock}>
          <Input
            type="time"
            value={shoot.start_time}
            onChange={(e) => onChange({ start_time: e.target.value })}
            aria-invalid={!shoot.start_time}
          />
        </Field>
        <Field label="City / Venue" icon={MapPin}>
          <Input
            value={shoot.location}
            onChange={(e) => onChange({ location: e.target.value })}
            placeholder="e.g. Jaipur"
          />
        </Field>
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="lg:col-span-3">
          <Field
            label="Google Map link"
            icon={MapPin}
            hint="Optional. Paste a Google Maps link only — the address text belongs in City / Venue."
          >
            <Input
              type="url"
              inputMode="url"
              value={shoot.map_link}
              onChange={(e) => onChange({ map_link: e.target.value })}
              placeholder="Paste Google Maps link"
            />
          </Field>
        </div>
        <Field label="Status">
          <Select
            value={shoot.status}
            onChange={(e) => onChange({ status: e.target.value as ShootDraft['status'] })}
          >
            <option value="planned">Planned</option>
            <option value="confirmed">Confirmed</option>
          </Select>
        </Field>
      </div>

      {/* ── who this day needs ── */}
      <SubCard
        icon={Users}
        title="Shoot requirements"
        hint="Pick people or services and set how many of each this day needs."
        actions={
          <RequirementsDialog
            shootName={shoot.name}
            requirements={shoot.requirements}
            onSave={(requirements) => onChange({ requirements })}
          />
        }
      >
        {shoot.requirements.length === 0 ? (
          <Band tone="warning">No requirements yet — tap “Add requirements” to plan the team.</Band>
        ) : (
          // A summary, not an editor: changes happen in the dialog, so the card
          // stays readable when a wedding day needs eight people.
          <div className="flex flex-wrap gap-2">
            {shoot.requirements.map((r, at) => {
              const tone = STAGE_TONE[stageOfRequirement(r.name, options)]
              return (
                <span
                  key={at}
                  className={cn(
                    'flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm font-medium',
                    TONE_CHIP_STATIC[tone],
                  )}
                >
                  {r.name.trim() || 'Unnamed'}
                  <span className="rounded-full bg-card/60 px-1.5 text-xs font-semibold tabular-nums">
                    ×{Math.max(1, Number(r.quantity) || 1)}
                  </span>
                </span>
              )
            })}
          </div>
        )}
      </SubCard>

    </div>
  )
}

/**
 * The team's own list for one shoot — culling, sorting, the reel — kept off
 * the quotation because a client is not buying "data sorting", they are
 * buying the album it feeds.
 *
 * It lives on the Deliverables step, one block per shoot. It used to sit
 * inside each shoot card as well, so the wizard asked "deliverables for this
 * shoot?" on step 2 and then asked about deliverables again on step 3 — the
 * same question twice, on the step that should only be about the day itself.
 */
function InternalWorkBlock({
  index,
  shoot,
  draft,
  patch,
  work,
}: {
  index: number
  shoot: ShootDraft
  draft: ProjectDraft
  patch: Patch
  work: { at: number; item: DeliverableDraft }[]
}) {
  const titles = new Set(work.map((w) => w.item.title.trim().toLowerCase()))
  const suggestions = internalWorkSuggestions(shoot.name).filter(
    (s) => !titles.has(s.toLowerCase()),
  )
  const presets = useShootPresets('internal_work')
  /** Null = closed, -1 = adding, else the index in draft.deliverables to edit. */
  const [editing, setEditing] = useState<number | null>(null)

  const addTitles = (names: string[]) =>
    patch({
      deliverables: [
        ...draft.deliverables,
        ...names
          .filter((n) => !n.trim() || !titles.has(n.trim().toLowerCase()))
          .map((n) => newInternalWork(index, n.trim())),
      ],
    })

  return (
    <SubCard
      icon={Package}
      title={shoot.name.trim() || `Shoot ${index + 1}`}
      hint="What the team edits, sorts and hands off from this day."
      actions={
        <>
          <PresetMenu
            label="Apply preset"
            variant="ghost"
            presets={presets.data ?? []}
            onApply={(p) => addTitles([...p.payload.internal_work])}
          />
          <SavePresetButton
            kind="internal_work"
            defaultName={shoot.name.trim() ? `${shoot.name.trim()} edit room` : 'Edit room'}
            label="Save preset"
            payload={{
              requirements: [],
              internal_work: work.map((w) => w.item.title.trim()).filter(Boolean),
            }}
          />
          <Button size="sm" onClick={() => setEditing(-1)}>
            <Plus /> Add more deliverables
          </Button>
        </>
      }
    >
      {work.length === 0 ? (
        <Band>No deliverables added for this shoot yet.</Band>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {work.map(({ at, item }) => (
            <li
              key={at}
              className="card-enter flex flex-wrap items-center gap-x-2 gap-y-1 rounded-md border border-primary/20 bg-primary/5 px-3 py-2 text-xs"
            >
              <CheckCircle2 className="size-3.5 shrink-0 text-primary" aria-hidden />
              <span className="font-medium">{item.title.trim() || 'Untitled'}</span>
              {/* The date it will be saved with -- the same rule the client list uses. */}
              {(() => {
                const due = estimatedDateFor(draft, item)
                return (
                  <span className="text-muted-foreground">
                    · {due ? `Due ${prettyDate(due)}` : 'Due date once the shoot has a date'}
                  </span>
                )
              })()}
              <span className="ml-auto flex items-center gap-0.5">
                <Button variant="ghost" size="icon" onClick={() => setEditing(at)}>
                  <Pencil />
                  <span className="sr-only">Edit {item.title.trim() || 'this deliverable'}</span>
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() =>
                    patch({ deliverables: draft.deliverables.filter((_, i) => i !== at) })
                  }
                >
                  <X />
                  <span className="sr-only">Remove {item.title.trim() || 'this deliverable'}</span>
                </Button>
              </span>
            </li>
          ))}
        </ul>
      )}

      <AddDeliverableDialog
        open={editing !== null}
        onOpenChange={(next) => setEditing(next ? editing : null)}
        shootName={shoot.name}
        // The row being edited is not a duplicate of itself.
        existingTitles={
          editing !== null && editing >= 0
            ? new Set(
                work
                  .filter((w) => w.at !== editing)
                  .map((w) => w.item.title.trim().toLowerCase()),
              )
            : titles
        }
        initial={editing !== null && editing >= 0 ? draft.deliverables[editing] : undefined}
        onSubmit={(v) =>
          patch({
            deliverables:
              editing !== null && editing >= 0
                ? draft.deliverables.map((d, i) => (i === editing ? { ...d, ...v } : d))
                : [
                    ...draft.deliverables,
                    { ...newInternalWork(index, v.title), ...v, shoot_index: index },
                  ],
          })
        }
      />

      {suggestions.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            <Sparkles className="size-3.5" aria-hidden />
            Suggested for {shoot.name.trim() || 'this shoot'}
          </span>
          {suggestions.map((title) => (
            <ToneChip key={title} tone="teal" label={title} onClick={() => addTitles([title])} />
          ))}
        </div>
      )}
    </SubCard>
  )
}

/** A titled block inside a shoot card: heading, hint, buttons, body. */
function SubCard({
  icon: Icon,
  title,
  hint,
  actions,
  children,
}: {
  icon: LucideIcon
  title: string
  hint: string
  actions: ReactNode
  children: ReactNode
}) {
  return (
    <div className="mt-4 rounded-lg border border-border bg-card p-3">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="flex items-center gap-2 text-sm font-medium">
            <Icon className="size-4 text-muted-foreground" aria-hidden />
            {title}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">{actions}</div>
      </div>
      {children}
    </div>
  )
}

/** The dashed "nothing here yet" strip inside a sub-card. */
function Band({ tone, children }: { tone?: 'warning'; children: ReactNode }) {
  return (
    <p
      className={cn(
        'rounded-md border border-dashed px-3 py-4 text-center text-sm',
        tone === 'warning'
          ? 'border-warning/40 bg-warning/10 text-warning'
          : 'border-border text-muted-foreground',
      )}
    >
      {children}
    </p>
  )
}

/**
 * Saved shapes, listed. The built-in wedding preset rides in the same menu as
 * the studio's own, because from the pressing end they are the same thing.
 */
function PresetMenu({
  label,
  presets,
  onApply,
  builtIn,
  variant = 'outline',
}: {
  label: string
  presets: ShootPreset[]
  onApply: (preset: ShootPreset) => void
  builtIn?: { label: string; disabled: boolean; onApply: () => void }
  variant?: 'outline' | 'ghost'
}) {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const remove = useDeleteShootPreset()

  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div ref={root} className="relative">
      <Button size="sm" variant={variant} onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <Sparkles /> {label}
      </Button>
      {open && (
        <div
          role="menu"
          aria-label={label}
          className="ipc-menu absolute right-0 top-full z-40 mt-2 w-72 max-w-[calc(100vw-3rem)] overflow-hidden rounded-lg border border-border bg-card p-1.5 shadow-lg"
        >
          {builtIn && (
            <button
              type="button"
              role="menuitem"
              disabled={builtIn.disabled}
              onClick={() => {
                builtIn.onApply()
                setOpen(false)
              }}
              className={cn(
                'w-full rounded-md px-2 py-1.5 text-left text-sm transition-colors',
                builtIn.disabled
                  ? 'cursor-not-allowed text-muted-foreground opacity-60'
                  : 'hover:bg-muted',
              )}
            >
              {builtIn.label}
            </button>
          )}
          {presets.length === 0 ? (
            <p className="px-2 py-3 text-sm text-muted-foreground">
              No saved presets yet. Set a shoot up the way you like it, then save it.
            </p>
          ) : (
            presets.map((p) => (
              <div key={p.id} className="flex items-center gap-1">
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    onApply(p)
                    setOpen(false)
                  }}
                  className="flex-1 rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-muted"
                >
                  {p.name}
                </button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-7"
                  onClick={() => remove.mutate(p.id)}
                  disabled={remove.isPending}
                >
                  <Trash2 />
                  <span className="sr-only">Delete preset {p.name}</span>
                </Button>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  )
}

/**
 * Save this shape under a name. The name field opens in place rather than in a
 * dialog: it is one short answer, and a modal over a wizard step is a lot of
 * ceremony for a text box.
 */
function SavePresetButton({
  kind,
  defaultName,
  label,
  payload,
}: {
  kind: ShootPresetKind
  defaultName: string
  label: string
  payload: ShootPresetPayload
}) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState(defaultName)
  const save = useSaveShootPreset()
  const empty = payload.requirements.length === 0 && payload.internal_work.length === 0

  const submit = () => {
    if (!name.trim()) return
    save.mutate({ kind, name: name.trim(), payload }, { onSuccess: () => setOpen(false) })
  }

  return (
    <div className="relative">
      <Button
        size="sm"
        variant="ghost"
        onClick={() => {
          setName(defaultName)
          setOpen((v) => !v)
        }}
        disabled={empty}
        title={empty ? 'Nothing to save yet' : undefined}
      >
        <Bookmark /> {label}
      </Button>
      {open && (
        <div className="ipc-menu absolute right-0 top-full z-40 mt-2 flex w-64 items-center gap-2 rounded-lg border border-border bg-card p-2 shadow-lg">
          <Input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submit()
              if (e.key === 'Escape') setOpen(false)
            }}
            aria-label="Preset name"
            placeholder="Preset name"
          />
          <Button size="sm" onClick={submit} disabled={!name.trim() || save.isPending}>
            Save
          </Button>
        </div>
      )}
    </div>
  )
}
/**
 * What the client is promised, what costs extra, and what only the team sees —
 * three lists rather than one, because those are three different conversations
 * and only the first two ever reach a quotation.
 *
 * A row's list is not a stored field: it falls out of the two switches the row
 * already carries, so turning "Charged on top" on moves an item into add-ons
 * with no second source of truth to disagree.
 */
function DeliverablesStep({ draft, patch }: { draft: ProjectDraft; patch: Patch }) {
  const sets = useDeliverableSets()
  const saveSet = useSaveDeliverableSet()
  const deleteSet = useDeleteDeliverableSet()
  const [naming, setNaming] = useState(false)
  const [setName, setSetName] = useState('')

  const quick = useMemo(() => quickDeliverables(learnedDeliverables()), [])
  const client = deliverablesIn(draft, 'client')
  const addOns = deliverablesIn(draft, 'add_on')
  // Per-shoot work is listed under its shoot below; only what belongs to no
  // shoot needs a list of its own.
  const loose = deliverablesIn(draft, 'internal').filter(({ item }) => item.shoot_index === null)

  const add = (items: { title: string }[]) =>
    patch({ deliverables: withDeliverables(draft.deliverables, items) })

  const saveable = [...client, ...addOns].map(({ item }) => ({
    title: item.title.trim(),
    is_additional_charge: item.is_additional_charge,
    additional_charge_amount: money(item.additional_charge_amount),
    show_on_quotation: item.show_on_quotation,
  })).filter((i) => i.title)

  return (
    <div className="flex flex-col gap-4">
      {/* ── what the client is promised ── */}
      <SubCard
        icon={Package}
        title="Client deliverables"
        hint="What you promise the client. Everything here appears on the quotation."
        actions={
          <Button
            size="sm"
            variant="outline"
            onClick={() => patch({ deliverables: [...draft.deliverables, newClientDeliverable()] })}
          >
            <Plus /> Add row
          </Button>
        }
      >
        <div className="mb-3 rounded-lg border border-border bg-muted/30 p-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Load set
            </span>
            {BUILT_IN_SETS.map((s) => (
              <ToneChip
                key={s.name}
                tone="amber"
                label={s.name}
                onClick={() => add(s.titles.map((title) => ({ title })))}
                title={s.titles.join(', ')}
              />
            ))}
            {(sets.data ?? []).map((s) => (
              <span
                key={s.id}
                className={cn('flex items-center rounded-full border pr-1 text-sm font-medium', TONE_CHIP_STATIC.rose)}
              >
                <button
                  type="button"
                  onClick={() => patch({ deliverables: withDeliverables(draft.deliverables, s.items) })}
                  title={s.items.map((i) => i.title).join(', ')}
                  className="flex items-center gap-1 rounded-full px-3 py-1 transition-colors hover:text-primary"
                >
                  <Plus className="size-3.5" aria-hidden />
                  {s.name}
                </button>
                <button
                  type="button"
                  onClick={() => deleteSet.mutate(s.id)}
                  disabled={deleteSet.isPending}
                  className="rounded-full p-1 text-muted-foreground transition-colors hover:text-destructive"
                >
                  <X className="size-3.5" aria-hidden />
                  <span className="sr-only">Delete set {s.name}</span>
                </button>
              </span>
            ))}
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-2">
            {naming ? (
              <>
                <Input
                  autoFocus
                  value={setName}
                  onChange={(e) => setSetName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') setNaming(false)
                    if (e.key !== 'Enter' || !setName.trim()) return
                    saveSet.mutate(
                      { name: setName.trim(), items: saveable },
                      { onSuccess: () => setNaming(false) },
                    )
                  }}
                  placeholder="Name this set"
                  aria-label="Set name"
                  className="w-56"
                />
                <Button
                  size="sm"
                  onClick={() =>
                    saveSet.mutate(
                      { name: setName.trim(), items: saveable },
                      { onSuccess: () => setNaming(false) },
                    )
                  }
                  disabled={!setName.trim() || saveSet.isPending}
                >
                  Save
                </Button>
              </>
            ) : (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setSetName('')
                  setNaming(true)
                }}
                disabled={saveable.length === 0}
                title={saveable.length === 0 ? 'Add a deliverable first' : undefined}
              >
                <Save /> Save as set
              </Button>
            )}
            <span className="text-xs text-muted-foreground">
              Sets are shared with your whole team. Delivery-time memory stays on this device.
            </span>
          </div>
        </div>

        <div className="mb-3 flex flex-wrap items-center gap-2">
          <span className="flex items-center gap-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
            <Sparkles className="size-3.5" aria-hidden />
            Quick add
          </span>
          {quick.map(({ title, learned }, i) => {
            const already = draft.deliverables.some(
              (d) => d.title.trim().toLowerCase() === title.toLowerCase(),
            )
            return (
              <ToneChip
                key={title}
                // What this studio has used before stands out in one colour;
                // the generic list cycles through the rest.
                tone={learned ? 'rose' : toneAt(i + 1)}
                label={title}
                selected={already}
                disabled={already}
                onClick={() => add([{ title }])}
                title={
                  already
                    ? `${title} is already on the list`
                    : learned
                      ? `${title} — you've used this before`
                      : `Add ${title}`
                }
              />
            )
          })}
        </div>

        {client.length === 0 ? (
          <Band>
            No deliverables yet. Tap a Quick add chip above, or load one of your sets.
          </Band>
        ) : (
          <div className="flex flex-col gap-3">
            {client.map(({ at, item }) => (
              <DeliverableRow key={at} at={at} item={item} draft={draft} patch={patch} />
            ))}
          </div>
        )}
      </SubCard>

      {/* ── what costs extra ── */}
      <SubCard
        icon={Wallet}
        title="Additional client services"
        hint="Add-ons billed on top of the package, listed on the quotation with their price."
        actions={
          <Button
            size="sm"
            variant="outline"
            onClick={() => patch({ deliverables: [...draft.deliverables, newAddOn()] })}
          >
            <Plus /> Add row
          </Button>
        }
      >
        {addOns.length === 0 ? (
          <Band>Nothing billed separately yet. Use “Add row” to add an extra.</Band>
        ) : (
          <div className="flex flex-col gap-3">
            {addOns.map(({ at, item }) => (
              <DeliverableRow key={at} at={at} item={item} draft={draft} patch={patch} />
            ))}
          </div>
        )}
      </SubCard>

      {/* ── what only the team sees, shoot by shoot ── */}
      {draft.shoots.length > 0 && (
        <div className="flex flex-col gap-1">
          <p className="mt-2 flex items-center gap-2 text-sm font-semibold">
            <Users className="size-4 text-muted-foreground" aria-hidden />
            Team work for each shoot
          </p>
          <p className="text-xs text-muted-foreground">
            Culling, sorting, reels — what your team does off the back of each day. Never shown on the quotation.
          </p>
        </div>
      )}
      {draft.shoots.map((shoot, i) => (
        <InternalWorkBlock
          key={i}
          index={i}
          shoot={shoot}
          draft={draft}
          patch={patch}
          work={internalWorkFor(draft, i)}
        />
      ))}
      {loose.length > 0 && (
        <SubCard
          icon={Users}
          title="Other team work"
          hint="Internal items not tied to one shoot. Never shown on the quotation."
          actions={null}
        >
          <div className="flex flex-col gap-2">
            {loose.map(({ at, item }) => (
              <DeliverableRow key={at} at={at} item={item} draft={draft} patch={patch} />
            ))}
          </div>
        </SubCard>
      )}
    </div>
  )
}

/**
 * One deliverable, edited in place.
 *
 * The lead time is remembered per title on this device as it is typed, so the
 * next project that quotes a "Photo Album" starts from the turnaround this
 * studio actually works to instead of an empty box.
 */
function DeliverableRow({
  at,
  item,
  draft,
  patch,
}: {
  at: number
  item: DeliverableDraft
  draft: ProjectDraft
  patch: Patch
}) {
  const set = (p: Partial<DeliverableDraft>) =>
    patch({ deliverables: draft.deliverables.map((d, i) => (i === at ? { ...d, ...p } : d)) })
  const due = estimatedDateFor(draft, item)

  return (
    <div className="card-enter rounded-lg border border-border p-4">
      <div className="mb-3 flex items-center gap-2">
        <Package className="size-4 text-muted-foreground" />
        <span className="text-sm font-medium">{item.title.trim() || 'Untitled deliverable'}</span>
        <Button
          variant="ghost"
          size="icon"
          className="ml-auto"
          onClick={() => patch({ deliverables: draft.deliverables.filter((_, i) => i !== at) })}
        >
          <Trash2 />
          <span className="sr-only">Remove {item.title.trim() || 'this deliverable'}</span>
        </Button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Title" required>
          <Input
            value={item.title}
            onChange={(e) => set({ title: e.target.value })}
            placeholder="Wedding album"
          />
        </Field>
        {/* The client's clock, which is the one the quotation prints. */}
        <Field label="Delivery days">
          <Input
            inputMode="numeric"
            value={item.due_days}
            onChange={(e) => set({ due_days: e.target.value })}
            onBlur={(e) => rememberDueDays(item.title, e.target.value)}
            placeholder="45"
          />
        </Field>
        <Field label="Due basis">
          <Select
            value={item.due_basis}
            onChange={(e) => set({ due_basis: e.target.value as DeliverableDraft['due_basis'] })}
          >
            {DUE_BASIS_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        </Field>

        {(item.due_basis === 'custom' || item.due_basis === 'custom_after') && (
          <Field label={item.due_basis === 'custom_after' ? 'Count days from' : 'Estimated date'}>
            <Input
              type="date"
              value={item.custom_date}
              onChange={(e) => set({ custom_date: e.target.value })}
            />
          </Field>
        )}

      </div>

      <p className="mt-3 flex items-center gap-1.5 text-xs text-muted-foreground">
        <CalendarDays className="size-3.5" />
        {due ? (
          <>
            Estimated delivery <span className="font-medium text-foreground">{prettyDate(due)}</span>
          </>
        ) : (
          'Estimated delivery appears once the shoot it counts from has a date.'
        )}
      </p>

      <div className="mt-4 flex flex-wrap items-end gap-4 border-t border-border pt-4">
        <Switch
          className="w-auto"
          checked={item.is_additional_charge}
          onChange={(v) => set({ is_additional_charge: v })}
          label="Charged on top of the package"
        />
        {item.is_additional_charge && (
          <Field label="Amount (₹)" required>
            <Input
              inputMode="numeric"
              value={item.additional_charge_amount}
              onChange={(e) => set({ additional_charge_amount: e.target.value })}
              placeholder="15000"
              className="w-40"
            />
          </Field>
        )}
      </div>
    </div>
  )
}
function BillingStep({
  draft,
  patch,
  totals,
}: {
  draft: ProjectDraft
  patch: Patch
  totals: ReturnType<typeof draftTotals>
}) {
  const set = (i: number, p: Partial<ProjectDraft['payments'][number]>) =>
    patch({ payments: draft.payments.map((x, idx) => (idx === i ? { ...x, ...p } : x)) })

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Package cost (₹)" hint="The headline price, before any chargeable extras.">
          <Input
            inputMode="numeric"
            value={draft.package_cost}
            onChange={(e) => patch({ package_cost: e.target.value })}
            placeholder="150000"
          />
        </Field>
        <div className="rounded-lg border border-border bg-muted/30 p-4 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Chargeable deliverables</span>
            <span className="tabular-nums font-medium">{formatINR(totals.addOns)}</span>
          </div>
          <div className="mt-2 flex justify-between border-t border-border pt-2">
            <span className="font-medium">Project total</span>
            <span className="tabular-nums text-base font-semibold">{formatINR(totals.total)}</span>
          </div>
        </div>
      </div>

      <div>
        <h3 className="mb-3 text-sm font-medium">Advance payments</h3>
        <RowList
          items={draft.payments}
          empty="Nothing received yet. Add an advance if the client has already paid."
          addLabel="Add payment"
          onAdd={() => patch({ payments: [...draft.payments, newPayment()] })}
        >
          {draft.payments.map((p, i) => (
            <div key={i} className="rounded-lg border border-border p-4">
              <div className="mb-3 flex items-center gap-2">
                <Wallet className="size-4 text-muted-foreground" />
                <span className="text-sm font-medium">Payment {i + 1}</span>
                <Button
                  variant="ghost"
                  size="icon"
                  className="ml-auto"
                  onClick={() => patch({ payments: draft.payments.filter((_, idx) => idx !== i) })}
                >
                  <Trash2 />
                  <span className="sr-only">Remove payment {i + 1}</span>
                </Button>
              </div>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <Field label="Amount (₹)" required>
                  <Input
                    inputMode="numeric"
                    value={p.amount}
                    onChange={(e) => set(i, { amount: e.target.value })}
                    placeholder="50000"
                  />
                </Field>
                <Field label="Received on">
                  <Input type="date" value={p.paid_on} onChange={(e) => set(i, { paid_on: e.target.value })} />
                </Field>
                <PaymentModePicker value={p.mode} onChange={(v) => set(i, { mode: v })} />
                <Field label="Reference">
                  <Input
                    value={p.reference}
                    onChange={(e) => set(i, { reference: e.target.value })}
                    placeholder="UTR / cheque no."
                  />
                </Field>
                <Field label="Status">
                  <Select value={p.status} onChange={(e) => set(i, { status: e.target.value as 'paid' | 'pending' })}>
                    <option value="paid">Paid</option>
                    <option value="pending">Pending</option>
                  </Select>
                </Field>
                <Field label="Description">
                  <Input value={p.description} onChange={(e) => set(i, { description: e.target.value })} placeholder="Advance / instalment…" />
                </Field>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={p.is_gst} onChange={(e) => set(i, { is_gst: e.target.checked })} />
                  GST receipt
                </label>
                {p.is_gst && (
                  <Field label="GST number">
                    <Input value={p.gst_number} onChange={(e) => set(i, { gst_number: e.target.value })} placeholder="GSTIN" />
                  </Field>
                )}
              </div>
              <div className="mt-3">
                <Field label="Notes">
                  <Input value={p.notes} onChange={(e) => set(i, { notes: e.target.value })} placeholder="Optional note" />
                </Field>
              </div>
            </div>
          ))}
        </RowList>
      </div>
    </div>
  )
}

/**
 * The last look before the project exists.
 *
 * Six tiles rather than a table of twenty rows: what a studio checks here is
 * "is this the right client, the right days, the right money", and each tile
 * carries the Edit that takes them back to fix it. A tile whose step still has
 * a problem says what the problem is, in place — so nobody has to open a step
 * to find out why the button won't fire.
 */
function ReviewStep({
  draft,
  totals,
  errors,
  onJump,
}: {
  draft: ProjectDraft
  totals: ReturnType<typeof draftTotals>
  errors: ReturnType<typeof stepErrors>
  onJump: (s: WizardStep) => void
}) {
  const { data: clients } = useClients()
  const client = Array.isArray(clients) ? clients.find((c) => c.id === draft.client_id) : undefined
  const clientName = client?.name ?? draft.new_client_name.trim()
  const problems = WIZARD_STEPS.filter((s) => errors[s])

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <ReviewTile
          label="Project"
          value={draft.name.trim() || '—'}
          problem={errors.client && !draft.name.trim() ? errors.client : undefined}
          onEdit={() => onJump('client')}
        />
        <ReviewTile
          label="Client"
          value={clientName || 'Not set'}
          problem={errors.client && !clientName ? errors.client : undefined}
          onEdit={() => onJump('client')}
        />
        <ReviewTile
          label="Shoots"
          value={
            draft.shoots.length ? `${countLabel(draft.shoots.length, 'shoot')} added` : 'None added'
          }
          hint={summarise(draft.shoots.map((s) => s.name.trim() || 'Untitled'))}
          problem={errors.shoots}
          onEdit={() => onJump('shoots')}
        />
        <ReviewTile
          label="Deliverables"
          value={
            draft.deliverables.length
              ? `${countLabel(draft.deliverables.length, 'deliverable')} added`
              : 'None added'
          }
          hint={summarise(draft.deliverables.map((d) => d.title.trim() || 'Untitled'))}
          problem={errors.deliverables}
          onEdit={() => onJump('deliverables')}
        />
        <ReviewTile
          label="Package / add-ons / total"
          value={`${formatINR(totals.packageCost)} + ${formatINR(totals.addOns)} = ${formatINR(totals.total)}`}
          accent
          onEdit={() => onJump('billing')}
        />
        <ReviewTile
          label="Payments"
          value={`Received ${formatINR(totals.received)} · Pending ${formatINR(totals.balance)}`}
          problem={errors.billing}
          onEdit={() => onJump('billing')}
        />
      </div>

      {problems.length > 0 ? (
        <p className="text-sm font-medium text-warning">
          Some required fields are missing. Use Edit to fix them before creating the project.
        </p>
      ) : (
        <p className="text-sm text-muted-foreground">
          Creating this makes {countLabel(1, 'project')}
          {draft.shoots.length ? `, ${countLabel(draft.shoots.length, 'shoot')}` : ''}
          {draft.deliverables.length ? `, ${countLabel(draft.deliverables.length, 'deliverable')}` : ''}
          {draft.payments.length ? ` and ${countLabel(draft.payments.length, 'payment')}` : ''}
          {draft.client_id ? '' : ' and a new client record'}.
        </p>
      )}
    </div>
  )
}

/** One fact about the project, and the way back to change it. */
function ReviewTile({
  label,
  value,
  hint,
  problem,
  accent,
  onEdit,
}: {
  label: string
  value: string
  hint?: string
  problem?: string | undefined
  accent?: boolean
  onEdit: () => void
}) {
  return (
    <div
      className={cn(
        'flex items-start gap-3 rounded-lg border p-4',
        problem
          ? 'border-destructive/30 bg-destructive/5'
          : accent
            ? 'border-primary/30 bg-primary/5'
            : 'border-border bg-muted/30',
      )}
    >
      <div className="min-w-0 flex-1">
        <p className="text-[0.7rem] font-semibold uppercase tracking-wider text-muted-foreground">
          {label}
        </p>
        <p className={cn('break-words font-semibold', accent && 'text-primary')}>
          {value}
        </p>
        {problem ? (
          <p className="mt-1 text-xs text-destructive">{problem}</p>
        ) : (
          hint && <p className="truncate text-xs text-muted-foreground">{hint}</p>
        )}
      </div>
      <Button variant="ghost" size="sm" onClick={onEdit}>
        <Pencil /> Edit
      </Button>
    </div>
  )
}

const countLabel = (n: number, noun: string) => `${n} ${noun}${n === 1 ? '' : 's'}`

const summarise = (names: string[]) => (names.length === 0 ? 'None' : names.join(', '))

export interface AddedDeliverable {
  title: string
  description: string
  due_days: string
  due_basis: DueBasis
  custom_date: string
  visibility_scope: 'client' | 'internal'
  show_on_quotation: boolean
  start_rule: DeliverableDraft['start_rule']
  lead_days: string
}

/**
 * Add one deliverable to a shoot.
 *
 * Two clocks, because a studio runs two. The top pair is what the client was
 * told — "thirty days after the wedding" — and it is what lands on the
 * quotation. The panel below is production's: nothing can be edited before the
 * footage arrives, so that work is timed from when its data lands. Typing a
 * title people recognise fills both, which is the point — those numbers are
 * trade knowledge, not decisions worth stopping over.
 */
function AddDeliverableDialog({
  open,
  onOpenChange,
  shootName,
  existingTitles,
  initial,
  onSubmit: onSubmitValue,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  shootName: string
  /** Titles already on this shoot, lowercased — to warn before duplicating. */
  existingTitles: Set<string>
  /** Given when reopening on a row: the same form, editing what is there. */
  initial?: DeliverableDraft | undefined
  onSubmit: (value: AddedDeliverable) => void
}) {
  const [title, setTitle] = useState('')
  const [dueDays, setDueDays] = useState('30')
  const [dueBasis, setDueBasis] = useState<DueBasis>('after_wedding_day')
  const [customDate, setCustomDate] = useState('')
  const [description, setDescription] = useState('')
  // Work tied to a shoot is the team's own; client promises are added under
  // Client deliverables. The lead time follows the title, not a form field.
  const [leadDays, setLeadDays] = useState('7')
  const [confirmDuplicate, setConfirmDuplicate] = useState(false)
  /** Whether the title has been typed into since the dialog opened. */
  const [typed, setTyped] = useState(false)

  // Opening resets the form: to the row being edited, or to blank. A
  // half-typed title left over from last time is worse than retyping one.
  useEffect(() => {
    if (!open) return
    setTitle(initial?.title ?? '')
    setDueDays(initial?.due_days || '30')
    setDueBasis(initial?.due_basis ?? 'after_wedding_day')
    setCustomDate(initial?.custom_date ?? '')
    setDescription(initial?.description ?? '')
    setLeadDays(initial?.lead_days || '7')
    setConfirmDuplicate(false)
    setTyped(false)
  }, [open, initial])

  // Typing a name the trade knows fills in the timings behind it — but only
  // once someone types, so reopening a row does not overwrite its numbers.
  useEffect(() => {
    const t = title.trim()
    if (!typed || !t) return
    const rule = deliverableRuleForTitle(t)
    setDueDays(String(rule.due_days))
    setDueBasis(rule.due_basis)
    setLeadDays(String(internalLeadDaysForTitle(t)))
  }, [title, typed])

  const trimmed = title.trim()
  const duplicate = trimmed.length > 0 && existingTitles.has(trimmed.toLowerCase())
  const valid = trimmed.length > 0 && (!duplicate || confirmDuplicate)

  function submit(e: FormEvent) {
    e.preventDefault()
    if (!valid) return
    onSubmitValue({
      title: trimmed,
      description: description.trim(),
      due_days: dueDays.trim(),
      due_basis: dueBasis,
      custom_date: dueBasis === 'custom' || dueBasis === 'custom_after' ? customDate : '',
      visibility_scope: 'internal',
      show_on_quotation: false,
      start_rule: 'this_shoot',
      lead_days: leadDays.trim(),
    })
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        // Two panels of fields is taller than a laptop dialog, so it scrolls
        // rather than pushing its own buttons off the screen.
        className="max-h-[88vh] overflow-y-auto"
        title={initial ? 'Edit deliverable' : 'Add deliverable'}
        description={
          <>
            Linked to{' '}
            <span className="font-medium text-foreground">{shootName.trim() || 'this shoot'}</span>.
            Team work — not shown to the client.
          </>
        }
      >
        <form onSubmit={submit} className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label>Deliverable title *</Label>
            <Input
              autoFocus
              value={title}
              onChange={(e) => {
                setTitle(e.target.value)
                setTyped(true)
              }}
              placeholder="e.g. Haldi Highlight Teaser"
            />
            {duplicate && (
              <label className="flex items-center gap-2 text-xs text-warning">
                <input
                  type="checkbox"
                  checked={confirmDuplicate}
                  onChange={(e) => setConfirmDuplicate(e.target.checked)}
                  className="size-3.5 accent-current"
                />
                Already on this shoot — add anyway
              </label>
            )}
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label>Delivery days</Label>
              <Input
                inputMode="numeric"
                value={dueDays}
                onChange={(e) => setDueDays(e.target.value)}
                placeholder="30"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Due basis</Label>
              <Select value={dueBasis} onChange={(e) => setDueBasis(e.target.value as DueBasis)}>
                {DUE_BASIS_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </Select>
            </div>
          </div>

          {(dueBasis === 'custom' || dueBasis === 'custom_after') && (
            <div className="flex flex-col gap-1.5">
              <Label>{dueBasis === 'custom_after' ? 'Count days from' : 'Estimated date'}</Label>
              <Input
                type="date"
                value={customDate}
                onChange={(e) => setCustomDate(e.target.value)}
              />
            </div>
          )}

          <div className="flex flex-col gap-1.5">
            <Label>Brief / instructions (optional)</Label>
            <textarea
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What does the team need to know?"
              className="w-full rounded-md border border-input bg-card px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>

          <div className="mt-1 flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!valid}>
              {initial ? 'Save changes' : 'Add deliverable'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
