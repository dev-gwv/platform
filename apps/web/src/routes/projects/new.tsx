import { useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react'
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
  ChevronDown,
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
import { DUE_BASIS_OPTIONS } from '@ipc/domain'
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
  useDeliverableTypeList,
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
import { SetupFinished, useFromSetup } from '@/features/onboarding/setup-flow'
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
  dueSummary,
  firstOpenShoot,
  nextUnfinishedShoot,
  shootSummary,
  stepReady,
  STEP_DONE,
  estimatedDateFor,
  isDirty,
  internalWorkFor,
  loadDraft,
  matchShootTypes,
  money,
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
  const ready = stepReady(draft, step)
  const submittable = canSubmit(draft)

  // The platform points at the next thing to press: when an edit finishes a
  // step, Next turns green, names where it goes, and rings three times. Only
  // an edit counts — a restored draft that is already complete, or going
  // Back to a finished step, shows the green button without the knock.
  const touched = useRef(false)
  const [nudge, setNudge] = useState<{ n: number; step: WizardStep | null }>({ n: 0, step: null })
  const seen = useRef({ step, ready })
  useEffect(() => {
    const before = seen.current
    seen.current = { step, ready }
    if (before.step !== step) {
      // Arriving on Review with everything done is the one arrival worth a
      // knock: the only thing left is the button.
      setNudge((p) => (step === 'review' && ready ? { n: p.n + 1, step } : { n: p.n, step: null }))
      return
    }
    if (ready && !before.ready && touched.current) setNudge((p) => ({ n: p.n + 1, step }))
  }, [step, ready])
  const knock = nudge.step === step

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
    touched.current = true
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
        // Remember the client now: if the project call below fails and the
        // owner presses Create again, it must not make a second client.
        patch({ client_id: created.id })
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
      const failedWork: string[] = []
      for (const { draftIndex, ...shoot } of shoots) {
        let made: { id: string }
        try {
          made = await createShoot.mutateAsync(shoot)
        } catch {
          failed.push(shoot.name)
          continue
        }
        // That shoot's own team work, now that there is a shoot to tie it to.
        // The shoot itself is saved either way, so a miss here is reported
        // as the work item, not as the shoot.
        for (const d of perShoot.get(draftIndex) ?? []) {
          try {
            await callApi(`/projects/${id}/deliverables`, {
              method: 'POST',
              body: { ...d, shoot_id: made.id },
              responseSchema: z.object({ id: z.string() }),
            })
          } catch {
            failedWork.push(`${d.title} (${shoot.name})`)
          }
        }
      }
      void qc.invalidateQueries({ queryKey: ['shoots'] })

      clearDraft()
      // The project exists now, so the wizard's job is done whether or not
      // every shoot landed. Hand over to the "what next?" dialog and carry the
      // bad news into it rather than dropping someone on a page with a toast.
      setCreated({
        id,
        warning: missedWarning(failed, failedWork),
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
        actions={
          <>
            {/* The draft is quiet: one chip that says it is safe, not a banner. */}
            <StatusBadge tone={savedAt ? 'success' : 'neutral'}>
              {savedAt
                ? `Draft saved ${prettyTime(savedAt)}`
                : restored
                  ? `Draft restored ${prettyTime(restored)}`
                  : 'Not saved yet'}
            </StatusBadge>
            {isDirty(draft) && (
              <Button variant="ghost" size="sm" onClick={() => void onDiscard()}>
                <RotateCcw /> Discard
              </Button>
            )}
            <Button variant="outline" size="sm" onClick={() => void navigate({ to: '/projects' })}>
              <ArrowLeft /> Back to projects
            </Button>
          </>
        }
      />

      <div className="flex flex-wrap items-center justify-between gap-2">
        <Stepper
          steps={WIZARD_STEPS.map((s) => ({ value: s, label: STEP_LABELS[s] }))}
          current={step}
          visited={visited}
          invalid={invalid}
          onJump={goTo}
        />
        <StatusBadge tone="info">
          Step {stepIndex(step) + 1} of {WIZARD_STEPS.length}
        </StatusBadge>
      </div>

      <div ref={sectionRef} className="mt-3 scroll-mt-4">
        <Section title={STEP_LABELS[step]} hint={STEP_HINTS[step]}>
          {step === 'client' && <ClientStep draft={draft} patch={patch} />}
          {step === 'shoots' && <ShootsStep draft={draft} patch={patch} />}
          {step === 'deliverables' && (
            <DeliverablesStep draft={draft} patch={patch} />
          )}
          {step === 'billing' && <BillingStep draft={draft} patch={patch} totals={totals} />}
          {step === 'review' && <ReviewStep draft={draft} totals={totals} errors={errors} onJump={goTo} />}

          {ready && !showErrors && !error && (
            <StepDoneBar step={step} onNext={onNext}>
              {step === 'shoots' && (
                <AddShootMenu
                  variant="ghost"
                  label="Add another"
                  shoots={draft.shoots}
                  onAdd={(name) =>
                    patch({ shoots: name ? withShoots(draft.shoots, [name]) : [...draft.shoots, newShoot()] })
                  }
                />
              )}
            </StepDoneBar>
          )}

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
      {/* Edge to edge of <main>'s padding and no further, so the bar never
          pushes the page into a sideways scroll. */}
      <div className="sticky bottom-0 z-30 -mx-3 -mb-3 mt-4 border-t border-border bg-card md:-mx-4 md:-mb-4">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 px-3 py-3 md:px-4">
          <Money label="Package" value={totals.packageCost} />
          <Money label="Add-ons" value={totals.addOns} />
          <Money label="Total" value={totals.total} strong />
          {totals.received > 0 && <Money label="Received" value={totals.received} />}
          {totals.promised > 0 && <Money label="Promised" value={totals.promised} />}
          {totals.received + totals.promised > 0 && <Money label="Still to collect" value={totals.balance} />}

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
            {/* `key` remounts the button on each knock so the ring replays. */}
            {step === 'review' ? (
              <Button
                key={`create-${nudge.n}`}
                variant={submittable ? 'success' : 'default'}
                className={cn(submittable && knock && 'ipc-nudge')}
                onClick={() => void onSubmit()}
                disabled={!submittable || busy}
              >
                {busy ? 'Creating…' : 'Create project'}
              </Button>
            ) : (
              <Button
                key={`next-${nudge.n}`}
                variant={ready ? 'success' : 'default'}
                className={cn(ready && knock && 'ipc-nudge')}
                onClick={onNext}
                disabled={busy}
              >
                {ready ? `Next: ${STEP_LABELS[nextStep(step)]}` : 'Next'} <ArrowRight />
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

  const openProject = (quotation?: boolean) =>
    void navigate({ to: quotation ? '/projects/$id/quotation' : '/projects/$id', params: { id: projectId } })

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        title="Project created"
        description={fromSetup ? 'Your first project is saved.' : 'What would you like to do next?'}
      >
        {/* A shoot that failed to save is the one thing here worth
            interrupting for — the project exists either way. */}
        {warning && (
          <p className="mb-3 rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm text-warning">
            {warning}
          </p>
        )}

        {/* The last setup step: say so, and offer the one obvious next place. */}
        {fromSetup && !link ? (
          <SetupFinished />
        ) : link ? (
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

/**
 * The green line under a finished step: what just got done and where to go
 * next, in words, beside the button that goes there.
 */
function StepDoneBar({ step, onNext, children }: { step: WizardStep; onNext: () => void; children?: ReactNode }) {
  return (
    <div
      role="status"
      className="card-enter mt-4 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-success/40 bg-success/[0.06] px-4 py-2.5 text-sm"
    >
      <CheckCircle2 className="size-4 shrink-0 text-success" aria-hidden />
      <span className="min-w-0 flex-1">{STEP_DONE[step]}</span>
      {children}
      {step !== 'review' && (
        <Button variant="link" size="sm" onClick={onNext}>
          Go to {STEP_LABELS[nextStep(step)]} <ArrowRight />
        </Button>
      )}
    </div>
  )
}

/** Close a hand-rolled menu on a press outside it, or on Escape. */
function useDismiss(root: RefObject<HTMLElement | null>, open: boolean, close: () => void) {
  const onClose = useRef(close)
  onClose.current = close
  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) onClose.current()
    }
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') onClose.current()
    }
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open, root])
}

/** A repeated block of rows — shoots, deliverables, payments all share it. */
function RowList({
  items,
  empty,
  addLabel,
  onAdd,
  addVariant = 'outline',
  addFirst = false,
  children,
}: {
  items: unknown[]
  empty: string
  addLabel: string
  onAdd: () => void
  addVariant?: 'outline' | 'default'
  /** While the list is empty, lead with the button instead of the empty note. */
  addFirst?: boolean
  children: ReactNode
}) {
  const button = (
    <div>
      <Button variant={addVariant} onClick={onAdd}>
        <Plus /> {addLabel}
      </Button>
    </div>
  )
  if (addFirst && items.length === 0) {
    return (
      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-dashed border-border p-4">
        {button}
        <span className="text-sm text-muted-foreground">{empty}</span>
      </div>
    )
  }
  return (
    <div className="flex flex-col gap-3">
      {items.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border p-4 text-center text-sm text-muted-foreground">
          {empty}
        </p>
      ) : (
        children
      )}
      {button}
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
  variant = 'default',
  label = 'Add shoot',
}: {
  shoots: ShootDraft[]
  onAdd: (name: string) => void
  /** This studio's own saved shoot names, merged into the common list. */
  extraNames?: readonly string[]
  variant?: 'default' | 'ghost'
  label?: string
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

  useDismiss(root, open, () => setOpen(false))

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
      <Button size="sm" variant={variant} onClick={() => setOpen((v) => !v)} aria-expanded={open} aria-haspopup="menu">
        <Plus /> {label}
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
  const deliverableTypes = useDeliverableTypeList()
  // Library first, hardcoded fallback: QUICK_SHOOTS stays when the catalog is empty.
  const quickShoots = (shootTypes.data ?? []).filter((t) => !t.is_archived).slice(0, 8).map((t) => t.name)
  const quickList = quickShoots.length ? quickShoots : [...QUICK_SHOOTS]
  const listRef = useRef<HTMLDivElement>(null)
  const cardAt = (i: number) => listRef.current?.children[i] ?? null

  // One card open at a time; the rest fold to a line. Arriving on the step
  // opens the first one still missing something.
  const [openShoot, setOpenShoot] = useState<number | null>(() => firstOpenShoot(draft.shoots))

  // The chips sit above a list that can already be several cards long, so a
  // shoot added from up there would otherwise land off the bottom of the
  // screen. A growing list opens the FIRST of the new cards and scrolls to it:
  // people fill top-down, so three chips tapped in a row start on the first.
  const count = useRef(draft.shoots.length)
  useEffect(() => {
    if (draft.shoots.length > count.current) {
      const first = count.current
      setOpenShoot(first)
      scrollIntoView(cardAt(first))
    }
    count.current = draft.shoots.length
  }, [draft.shoots.length])

  // The moment the open card turns green it folds and the next unfinished
  // one opens — the platform walks them down the list. It waits while a
  // picker or dialog is still open, or while they are typing in the card, so
  // nothing folds out from under a half-set time or a venue being typed.
  const shoots = useRef(draft.shoots)
  shoots.current = draft.shoots
  const openShootDraft = openShoot === null ? undefined : draft.shoots[openShoot]
  const openIssues = openShootDraft ? shootIssues(openShootDraft).length : -1
  const last = useRef({ at: openShoot, issues: openIssues })
  const [armed, setArmed] = useState(false)
  useEffect(() => {
    const before = last.current
    last.current = { at: openShoot, issues: openIssues }
    if (openShoot === null || openIssues !== 0) setArmed(false)
    else if (before.at === openShoot && before.issues > 0) setArmed(true)
  }, [openShoot, openIssues])
  useEffect(() => {
    if (!armed || openShoot === null) return
    let timer: ReturnType<typeof setTimeout>
    const fold = () => {
      const active = document.activeElement
      const typing =
        !!active && cardAt(openShoot)?.contains(active) && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA')
      if (typing || document.querySelector('[data-radix-popper-content-wrapper], [role="dialog"], [role="listbox"]')) {
        timer = setTimeout(fold, 400)
        return
      }
      setArmed(false)
      const next = nextUnfinishedShoot(shoots.current, openShoot)
      setOpenShoot(next)
      if (next !== null) scrollIntoView(cardAt(next))
    }
    // A beat first, so the card is seen turning green before it folds.
    timer = setTimeout(fold, 700)
    return () => clearTimeout(timer)
  }, [armed, openShoot])

  const set = (i: number, p: Partial<ShootDraft>) =>
    patch({ shoots: draft.shoots.map((s, idx) => (idx === i ? { ...s, ...p } : s)) })

  const remove = (i: number) => {
    setOpenShoot((o) => (o === null || o === i ? null : o > i ? o - 1 : o))
    patch(removeShootAt(draft, i))
  }

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
        ...preset.payload.internal_work.map((title) => newInternalWork(at, title, deliverableTypes)),
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
        <div ref={listRef} className="flex flex-col gap-2">
          {draft.shoots.map((s, i) => (
            <ShootCard
              key={i}
              index={i}
              shoot={s}
              draft={draft}
              open={openShoot === i}
              onToggle={() => setOpenShoot((o) => (o === i ? null : i))}
              onChange={(p) => set(i, p)}
              onRemove={() => remove(i)}
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
/**
 * One shoot day. Open, it is the form; folded, it is one line — green with a
 * summary when the day is complete, red with what is missing when it is not.
 * Blue is the one being edited.
 */
function ShootCard({
  index,
  shoot,
  draft,
  open,
  onToggle,
  onChange,
  onRemove,
}: {
  index: number
  shoot: ShootDraft
  draft: ProjectDraft
  open: boolean
  onToggle: () => void
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
  const name = shoot.name.trim() || `Shoot ${index + 1}`
  return (
    <div
      className={cn(
        'card-enter rounded-lg border transition-[border-color,background-color,box-shadow] duration-300',
        open
          ? 'border-primary/50 bg-card ring-2 ring-primary/15'
          : ready
            ? 'border-success/40 bg-success/[0.04] hover:border-success/60'
            : 'border-destructive/25 bg-destructive/5 hover:border-destructive/40',
      )}
    >
      <div className="flex items-center gap-1 pr-2">
        <button
          type="button"
          aria-expanded={open}
          onClick={onToggle}
          className="flex min-w-0 flex-1 items-center gap-2 rounded-lg px-4 py-2.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span
            className={cn(
              'flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold transition-colors',
              ready ? 'bg-success text-success-foreground' : 'bg-primary/10 text-primary',
            )}
          >
            {ready ? <Check className="size-3.5" aria-hidden /> : index + 1}
          </span>
          <span className="shrink-0 font-medium">{name}</span>
          {ready ? (
            open ? (
              <StatusBadge tone="success">
                <CheckCircle2 className="mr-1 size-3" aria-hidden />
                Ready
              </StatusBadge>
            ) : (
              <span className="min-w-0 truncate text-sm text-muted-foreground">{shootSummary(shoot)}</span>
            )
          ) : (
            <>
              {/* A phone has room for one chip, not three: say how many. */}
              <StatusBadge tone="warning" className="shrink-0 sm:hidden">
                <AlertCircle className="mr-1 size-3" aria-hidden />
                {issues.length} to fill
              </StatusBadge>
              <span className="hidden min-w-0 flex-wrap gap-1.5 sm:flex">
              {issues.map((issue) => (
                <StatusBadge key={issue} tone={issue === 'Title & date needed' ? 'danger' : 'warning'}>
                  <AlertCircle className="mr-1 size-3" aria-hidden />
                  {issue}
                </StatusBadge>
              ))}
              </span>
            </>
          )}
          <ChevronDown
            className={cn('ml-auto size-4 shrink-0 text-muted-foreground transition-transform', open && 'rotate-180')}
            aria-hidden
          />
        </button>
        {/* Always on the card, folded or open: a studio saves the day it
            just set up as a preset, and that is usually once it is done. */}
        <SavePresetButton
          kind="shoot"
          defaultName={name}
          label="Save as preset"
          disabled={!shoot.name.trim()}
          disabledHint="Name the shoot first"
          payload={{
            requirements: shoot.requirements
              .filter((r) => r.name.trim())
              .map((r) => ({ name: r.name.trim(), quantity: Math.max(1, Number(r.quantity) || 1) })),
            internal_work: work.map((w) => w.item.title.trim()).filter(Boolean),
          }}
        />
        {open && (
          <>
            <Button variant="ghost" size="icon" onClick={onRemove}>
              <Trash2 className="text-destructive" />
              <span className="sr-only">Remove {name}</span>
            </Button>
          </>
        )}
      </div>

      {open && (
        <div className="px-4 pb-4">
          {/* Venue before Time: the card folds once the last required field
              is set, so the optional one sits ahead of it. */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="Shoot title" required>
              <Input
                value={shoot.name}
                onChange={(e) => onChange({ name: e.target.value })}
                placeholder="Wedding day"
                autoFocus={!shoot.name}
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
            <Field label="City / Venue" icon={MapPin}>
              <Input
                value={shoot.location}
                onChange={(e) => onChange({ location: e.target.value })}
                placeholder="e.g. Jaipur"
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
          </div>

          <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="lg:col-span-3">
              {/* Whatever the client sent — a Maps link, a short link, or the
                  venue's name from WhatsApp. It is stored as given. */}
              <Field label="Map link" icon={MapPin}>
                <Input
                  value={shoot.map_link}
                  onChange={(e) => onChange({ map_link: e.target.value })}
                  placeholder="Paste the map link"
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
      )}
    </div>
  )
}

/** "Created, but …" for whatever did not save after the project itself did. */
function missedWarning(shoots: string[], work: string[]): string | null {
  const parts = [
    shoots.length ? `these shoots did not save: ${shoots.join(', ')}.` : '',
    work.length ? `This team work did not save: ${work.join(', ')}.` : '',
  ].filter(Boolean)
  if (parts.length === 0) return null
  const text = parts.join(' ')
  return `Created, but ${text.charAt(0).toLowerCase()}${text.slice(1)} Add them from the project.`
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
  useDismiss(root, open, () => setOpen(false))

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
  disabled,
  disabledHint,
}: {
  kind: ShootPresetKind
  defaultName: string
  label: string
  payload: ShootPresetPayload
  /** Overrides the "nothing to save" rule: a shoot preset is worth saving by name alone. */
  disabled?: boolean
  disabledHint?: string
}) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState(defaultName)
  const save = useSaveShootPreset()
  const empty = disabled ?? (payload.requirements.length === 0 && payload.internal_work.length === 0)

  const submit = () => {
    if (!name.trim()) return
    save.mutate({ kind, name: name.trim(), payload }, { onSuccess: () => setOpen(false) })
  }

  return (
    <div className="relative">
      <Button
        size="sm"
        variant="outline"
        onClick={() => {
          setName(defaultName)
          setOpen((v) => !v)
        }}
        disabled={empty}
        title={empty ? (disabledHint ?? 'Nothing to save yet') : label}
        aria-label={label}
      >
        <Bookmark /> <span className="hidden sm:inline">{label}</span>
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
/** How many quick-add chips show before "+N more": two lines on a laptop. */
const QUICK_LIMIT = 12

/**
 * What the client is promised, as one short list.
 *
 * Each line is folded to a sentence — the title, when it is due, and an
 * Add-on tag if it is charged on top — and opens in place to edit. One is
 * open at a time, so a wedding's six deliverables fit on a laptop screen
 * without scrolling. Add-ons live in the same list: turning "Charged on top"
 * on tags the line instead of moving it to another section.
 *
 * The team's own work (culling, sorting, reels) is not asked for here. It
 * comes in with the shoot presets, is still created with each shoot, and is
 * edited on the project page where the people doing it are assigned.
 */
function DeliverablesStep({ draft, patch }: { draft: ProjectDraft; patch: Patch }) {
  const deliverableTypes = useDeliverableTypeList()
  const [openRow, setOpenRow] = useState<number | null>(null)
  const [flash, setFlash] = useState<ReadonlySet<number>>(() => new Set())
  const [showAll, setShowAll] = useState(false)
  useEffect(() => {
    if (flash.size === 0) return
    const t = setTimeout(() => setFlash(new Set()), 1000)
    return () => clearTimeout(t)
  }, [flash])

  const quick = useMemo(() => quickDeliverables(learnedDeliverables()), [])
  const shown = showAll ? quick : quick.slice(0, QUICK_LIMIT)
  const rows = draft.deliverables
    .map((item, at) => ({ at, item }))
    .filter(({ item }) => item.visibility_scope === 'client')
  const team = draft.deliverables.length - rows.length

  /** Chips and sets add folded lines, with a green wash on what just arrived. */
  const add = (items: Parameters<typeof withDeliverables>[1]) => {
    const before = draft.deliverables.length
    const next = withDeliverables(draft.deliverables, items, deliverableTypes)
    if (next === draft.deliverables) return
    patch({ deliverables: next })
    setFlash(new Set(Array.from({ length: next.length - before }, (_, k) => before + k)))
  }
  /** A blank line opens straight away: it needs a title before it is anything. */
  const addBlank = () => {
    setOpenRow(draft.deliverables.length)
    patch({ deliverables: [...draft.deliverables, newClientDeliverable()] })
  }
  const remove = (i: number) => {
    setOpenRow((o) => (o === null || o === i ? null : o > i ? o - 1 : o))
    setFlash(new Set())
    patch({ deliverables: draft.deliverables.filter((_, at) => at !== i) })
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="flex items-center gap-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
          <Sparkles className="size-3.5" aria-hidden />
          Quick add
        </span>
        <div className="ml-auto flex items-center gap-2">
          <SetMenu draft={draft} onLoad={add} />
          <Button size="sm" variant="outline" onClick={addBlank}>
            <Plus /> Add row
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {shown.map(({ title, learned }, i) => {
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
        {quick.length > QUICK_LIMIT && (
          <button
            type="button"
            onClick={() => setShowAll((v) => !v)}
            className="rounded-full px-3 py-1 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            {showAll ? 'Show less' : `+${quick.length - QUICK_LIMIT} more`}
          </button>
        )}
      </div>

      {rows.length === 0 ? (
        <Band>No deliverables yet. Tap a chip above, or load one of your sets.</Band>
      ) : (
        <div className="flex flex-col gap-2">
          {rows.map(({ at, item }) => (
            <DeliverableRow
              key={at}
              at={at}
              item={item}
              draft={draft}
              patch={patch}
              open={openRow === at}
              flash={flash.has(at)}
              onToggle={() => setOpenRow((o) => (o === at ? null : at))}
              onRemove={() => remove(at)}
            />
          ))}
        </div>
      )}

      {team > 0 && (
        <p className="text-xs text-muted-foreground">
          Team work: {countLabel(team, 'item')} from your presets — edit them on the project page.
        </p>
      )}
    </div>
  )
}

/**
 * Packages a studio sells again and again, one tap away: the built-in
 * wedding sets, the studio's own, and "save this list" for next time. In a
 * menu so the step's heading carries only the quick-add chips.
 */
function SetMenu({
  draft,
  onLoad,
}: {
  draft: ProjectDraft
  onLoad: (items: Parameters<typeof withDeliverables>[1]) => void
}) {
  const sets = useDeliverableSets()
  const saveSet = useSaveDeliverableSet()
  const deleteSet = useDeleteDeliverableSet()
  const [open, setOpen] = useState(false)
  const [naming, setNaming] = useState(false)
  const [name, setName] = useState('')
  const root = useRef<HTMLDivElement>(null)
  useDismiss(root, open, () => setOpen(false))

  const saveable = draft.deliverables
    .filter((d) => d.visibility_scope === 'client' && d.title.trim())
    .map((d) => ({
      title: d.title.trim(),
      is_additional_charge: d.is_additional_charge,
      additional_charge_amount: money(d.additional_charge_amount),
      show_on_quotation: d.show_on_quotation,
    }))

  const load = (items: Parameters<typeof withDeliverables>[1]) => {
    onLoad(items)
    setOpen(false)
  }
  const save = () => {
    if (!name.trim()) return
    saveSet.mutate(
      { name: name.trim(), items: saveable },
      {
        onSuccess: () => {
          setNaming(false)
          setOpen(false)
        },
      },
    )
  }

  const item = 'w-full rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-muted'
  return (
    <div ref={root} className="relative">
      <Button
        size="sm"
        variant="outline"
        onClick={() => {
          setNaming(false)
          setOpen((v) => !v)
        }}
        aria-expanded={open}
        aria-haspopup="menu"
      >
        <Bookmark /> Load a set <ChevronDown />
      </Button>
      {open && (
        <div
          role="menu"
          aria-label="Deliverable sets"
          className="ipc-menu absolute right-0 top-full z-40 mt-2 w-72 max-w-[calc(100vw-3rem)] overflow-hidden rounded-lg border border-border bg-card p-1.5 shadow-lg"
        >
          {BUILT_IN_SETS.map((s) => (
            <button key={s.name} type="button" role="menuitem" onClick={() => load(s.titles.map((title) => ({ title })))} className={item}>
              {s.name}
              <span className="block truncate text-xs text-muted-foreground">{s.titles.join(', ')}</span>
            </button>
          ))}
          {(sets.data ?? []).map((s) => (
            <div key={s.id} className="flex items-center gap-1">
              <button type="button" role="menuitem" onClick={() => load(s.items)} className={cn(item, 'min-w-0 flex-1')}>
                {s.name}
                <span className="block truncate text-xs text-muted-foreground">
                  {s.items.map((i) => i.title).join(', ')}
                </span>
              </button>
              <Button
                variant="ghost"
                size="icon"
                className="size-7"
                onClick={() => deleteSet.mutate(s.id)}
                disabled={deleteSet.isPending}
              >
                <Trash2 />
                <span className="sr-only">Delete set {s.name}</span>
              </Button>
            </div>
          ))}
          <div className="my-1 border-t border-border" />
          {naming ? (
            <div className="flex items-center gap-2 p-1">
              <Input
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') save()
                }}
                placeholder="Name this set"
                aria-label="Set name"
              />
              <Button size="sm" onClick={save} disabled={!name.trim() || saveSet.isPending}>
                Save
              </Button>
            </div>
          ) : (
            <button
              type="button"
              role="menuitem"
              disabled={saveable.length === 0}
              title={saveable.length === 0 ? 'Add a deliverable first' : undefined}
              onClick={() => {
                setName('')
                setNaming(true)
              }}
              className={cn(item, 'flex items-center gap-2 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent')}
            >
              <Save className="size-4" aria-hidden /> Save this list as a set…
            </button>
          )}
          <p className="px-2 pb-1 pt-1.5 text-xs text-muted-foreground">Sets are shared with your whole team.</p>
        </div>
      )}
    </div>
  )
}

/**
 * One deliverable: a single line until it is opened, then edited in place.
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
  open,
  flash,
  onToggle,
  onRemove,
}: {
  at: number
  item: DeliverableDraft
  draft: ProjectDraft
  patch: Patch
  open: boolean
  flash: boolean
  onToggle: () => void
  onRemove: () => void
}) {
  const set = (p: Partial<DeliverableDraft>) =>
    patch({ deliverables: draft.deliverables.map((d, i) => (i === at ? { ...d, ...p } : d)) })
  const due = estimatedDateFor(draft, item)
  const amount = money(item.additional_charge_amount)
  const title = item.title.trim() || 'Untitled deliverable'

  return (
    <div
      className={cn(
        'card-enter rounded-lg border transition-[border-color,box-shadow] duration-200',
        open ? 'border-primary/50 bg-card ring-2 ring-primary/15' : 'border-border bg-card hover:border-primary/30',
        flash && 'ipc-row-flash',
      )}
    >
      <div className="flex items-center gap-1 pr-1.5">
        <button
          type="button"
          aria-expanded={open}
          onClick={onToggle}
          className="flex min-w-0 flex-1 items-center gap-2.5 rounded-lg px-3 py-2.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Package className={cn('size-4 shrink-0', open ? 'text-primary' : 'text-muted-foreground')} aria-hidden />
          <span className={cn('shrink-0 text-sm font-medium', !item.title.trim() && 'text-muted-foreground')}>
            {title}
          </span>
          <span className="min-w-0 truncate text-xs text-muted-foreground">
            {dueSummary(item)}
            {due && item.due_basis !== 'custom' ? ` · due ${prettyDate(due)}` : ''}
          </span>
          {item.is_additional_charge && (
            <StatusBadge tone={amount > 0 ? 'info' : 'warning'} className="shrink-0">
              {amount > 0 ? `Add-on ${formatINR(amount)}` : 'Add-on · amount needed'}
            </StatusBadge>
          )}
          <ChevronDown
            className={cn('ml-auto size-4 shrink-0 text-muted-foreground transition-transform', open && 'rotate-180')}
            aria-hidden
          />
        </button>
        <Button variant="ghost" size="icon" className="size-8" onClick={onRemove}>
          <X />
          <span className="sr-only">Remove {title}</span>
        </Button>
      </div>

      {open && (
        <div className="border-t border-border p-3">
          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_7rem_minmax(0,1fr)]">
            <Field label="Title" required>
              <Input
                value={item.title}
                onChange={(e) => set({ title: e.target.value })}
                placeholder="Wedding album"
                autoFocus={!item.title}
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
            <Field label="Counted from">
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
          </div>

          {(item.due_basis === 'custom' || item.due_basis === 'custom_after') && (
            <div className="mt-3 sm:w-1/2">
              <Field label={item.due_basis === 'custom_after' ? 'Count days from' : 'Delivery date'}>
                <Input
                  type="date"
                  value={item.custom_date}
                  onChange={(e) => set({ custom_date: e.target.value })}
                />
              </Field>
            </div>
          )}

          <div className="mt-3 flex flex-wrap items-end gap-x-4 gap-y-2">
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
                  className="w-36"
                />
              </Field>
            )}
            <p className="ml-auto flex items-center gap-1.5 text-xs text-muted-foreground">
              <CalendarDays className="size-3.5" aria-hidden />
              {due ? (
                <>
                  Estimated delivery <span className="font-medium text-foreground">{prettyDate(due)}</span>
                </>
              ) : (
                'The date shows once the shoot it counts from has a date.'
              )}
            </p>
          </div>
        </div>
      )}
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
        <h3 className="text-sm font-medium">Advance from client</h3>
        <p className="mb-3 text-xs text-muted-foreground">
          Has the client already paid something? Add it here so the balance is right from day one.
        </p>
        <RowList
          items={draft.payments}
          empty="Nothing received yet."
          addLabel="Add advance payment from client"
          addVariant="default"
          addFirst
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
  const promised = draft.deliverables.filter((d) => d.visibility_scope === 'client')
  const team = draft.deliverables.length - promised.length

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
          value={promised.length ? `${countLabel(promised.length, 'deliverable')} added` : 'None added'}
          hint={summarise(promised.map((d) => d.title.trim() || 'Untitled'))}
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
          value={`Received ${formatINR(totals.received)}${totals.promised ? ` · Promised ${formatINR(totals.promised)}` : ''} · Still to collect ${formatINR(totals.balance)}`}
          problem={errors.billing}
          onEdit={() => onJump('billing')}
        />
      </div>

      {team > 0 && (
        <p className="text-xs text-muted-foreground">
          Team work: {countLabel(team, 'item')} from your presets — edit them on the project page.
        </p>
      )}

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
