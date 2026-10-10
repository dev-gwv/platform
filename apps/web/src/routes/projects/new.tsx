import { useEffect, useMemo, useRef, useState, type MutableRefObject, type ReactNode } from 'react'
import { useLearn, type Learn } from '@/features/help/LearnCard'
import { useNavigate } from '@tanstack/react-router'
import { toast } from 'sonner'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, ArrowRight, CheckCircle2, RotateCcw } from 'lucide-react'
import { z, type CreateShootRequest } from '@ipc/contracts'
import { callApi } from '@/shared/api/client'
import { AuthedPage } from '@/shared/layout/AuthedPage'
import { Breadcrumbs } from '@/shared/layout/breadcrumbs'
import { PageHeader } from '@/shared/layout/page-header'
import { Button } from '@/shared/ui/button'
import { Card, CardContent } from '@/shared/ui/card'
import { cn } from '@/shared/ui/cn'
import { StatusBadge } from '@/shared/ui/status-badge'
import { Stepper } from '@/shared/ui/stepper'
import { useConfirm } from '@/shared/ui/confirm'
import { scrollIntoView } from '@/shared/ui/motion'
import { useCreateClient } from '@/features/clients/api'
import { useCreateProject } from '@/features/projects/api'
import { useCloseSetup, useFromSetup } from '@/features/onboarding/setup-flow'
import {
  EMPTY_DRAFT,
  rememberDeliverables,
  STEP_HINTS,
  STEP_LABELS,
  WIZARD_STEPS,
  canSubmit,
  clearDraft,
  deliverablesIn,
  draftTotals,
  stepReady,
  STEP_DONE,
  isDirty,
  loadDraft,
  newShoot,
  nextStep,
  prevStep,
  saveDraft,
  stepErrors,
  stepIndex,
  toProjectRequest,
  shootDeliverables,
  toShootRequests,
  withShoots,
  type ProjectDraft,
  type WizardStep,
} from '@/features/projects/wizard'
import { ClientStep } from '@/features/projects/wizard/StepClient'
import { ShootsStep } from '@/features/projects/wizard/StepShoots'
import { AddShootMenu } from '@/features/projects/wizard/ShootMenus'
import { DeliverablesStep } from '@/features/projects/wizard/StepDeliverables'
import { BillingStep } from '@/features/projects/wizard/StepBilling'
import { ReviewStep } from '@/features/projects/wizard/StepReview'
import { missedWarning } from '@/features/projects/wizard/wizard-state'
import { useINR } from '@/shared/money/MoneyMask'

/**
 * Create project: the page, its step bar and its running total. Each step's
 * form lives in `features/projects/wizard/`, one file per step.
 */
export function NewProjectPage() {
  return (
    <AuthedPage module="projects">
      <NewProject />
    </AuthedPage>
  )
}

function NewProject() {
  const navigate = useNavigate()
  const fromSetup = useFromSetup()
  const closeSetup = useCloseSetup()
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
  /** This step's how-to video: told when Next is refused, or a step is done. */
  const learn = useRef<Learn | null>(null)
  const [savedAt, setSavedAt] = useState<string | null>(null)
  const [restored, setRestored] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /** Set once the project exists; the dialog takes over from there. */
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
    let base = EMPTY_DRAFT
    if (stored && isDirty(stored.draft)) {
      base = stored.draft
      setRestored(stored.savedAt)
    }
    // ?client=<id> -- the client just saved on the setup step before this one
    // -- is picked for the project unless the draft already names someone.
    const preselect = new URLSearchParams(window.location.search).get('client')
    if (preselect && !base.client_id) {
      base = { ...base, client_id: preselect, new_client_name: '', new_client_phone: '' }
    }
    if (base !== EMPTY_DRAFT) setDraft(base)
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
      learn.current?.refused()
      return
    }
    learn.current?.progress()
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
      const warning = missedWarning(failed, failedWork)
      // The project exists now, so the wizard's job is done whether or not
      // every shoot landed. Everyone goes straight to the quotation -- the
      // owner's order is quotation, then invoice, then team -- a new studio's
      // first project included (it used to stop on a "set up" dialog that
      // only offered the dashboard). Any bad news rides along as a message
      // that stays until it is read.
      if (fromSetup) {
        void closeSetup('done')
        toast.success('Your studio is set up. Check the quotation, then create the invoice.')
      }
      if (warning) toast.warning(warning, { duration: 15_000 })
      void navigate({ to: '/projects/$id/quotation', params: { id } })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create the project.')
    } finally {
      setBusy(false)
    }
  }

  /**
   * "Send them a form" (0244): the studio types only the project, a name and a
   * phone; the project is made now and opens with the details form ready to
   * send, and the client fills the rest -- their dates and their events.
   */
  async function sendForm() {
    setError(null)
    if (!draft.name.trim()) return setError('Add the project name first.')
    if (!draft.client_id && (!draft.new_client_name.trim() || !draft.new_client_phone.trim()))
      return setError('Add the client’s name and phone first.')
    setBusy(true)
    try {
      let clientId = draft.client_id
      if (!clientId) {
        const { toNewClientRequest } = await import('@/features/projects/wizard')
        const created = await createClient.mutateAsync(toNewClientRequest(draft))
        clientId = created.id
        patch({ client_id: created.id })
      }
      const { id } = await createProject.mutateAsync(toProjectRequest({ ...draft, deliverables: [], payments: [] }, clientId))
      clearDraft()
      if (fromSetup) void closeSetup('done')
      void navigate({ to: '/projects/$id', params: { id }, search: { details: '1' } as never })
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
          <StepLearn key={step} step={step} into={learn} />
          {step === 'client' && <ClientStep draft={draft} patch={patch} onSendForm={busy ? undefined : () => void sendForm()} />}
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

          <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
            {/* Why Next did not go on, beside the button that was pressed. */}
            {showErrors && stepError && step !== 'review' && (
              <span role="status" className="text-sm font-medium text-destructive">
                {stepError}
              </span>
            )}
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
  const inr = useINR()
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={cn('tabular-nums', strong ? 'text-base font-semibold text-primary' : 'font-medium')}>
        {inr(value)}
      </p>
    </div>
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

/** Which how-to video goes with each step of the wizard. */
const STEP_VIDEO: Record<WizardStep, string> = {
  client: 'project-client',
  shoots: 'project-shoots',
  deliverables: 'project-deliverables',
  billing: 'project-billing',
  review: 'project-billing',
}

/** The step's how-to card, at the top of the step; gone once they know the way. */
function StepLearn({ step, into }: { step: WizardStep; into: MutableRefObject<Learn | null> }) {
  const learn = useLearn(STEP_VIDEO[step])
  into.current = learn
  return learn.card ? <div className="mb-4">{learn.card}</div> : null
}
