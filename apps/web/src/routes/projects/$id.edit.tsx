import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from '@tanstack/react-router'
import { AlertTriangle, ArrowLeft, Camera, ListChecks, Pencil, User } from 'lucide-react'
import { AuthedPage } from '@/shared/layout/AuthedPage'
import { Breadcrumbs } from '@/shared/layout/breadcrumbs'
import { PageHeader } from '@/shared/layout/page-header'
import { Button } from '@/shared/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/ui/card'
import { Input, Label, Select } from '@/shared/ui/input'
import { SkeletonCards } from '@/shared/ui/skeleton'
import { ErrorState } from '@/shared/ui/states'
import { useConfirm } from '@/shared/ui/confirm'
import { useAccess } from '@/shared/auth/useAccess'
import { formatINR } from '@/shared/ui/format'
import type { ProjectStatus, UpdateProjectRequest } from '@ipc/contracts'
import { useProject, useUpdateProject } from '@/features/projects/api'
import { useClient, useUpdateClient } from '@/features/clients/api'
import { ShootsTab } from '@/features/projects/tabs/ShootsTab'
import { DraftRestoredBanner, useFormDraft } from '@/shared/hooks/use-form-draft'
import { toast } from 'sonner'

const CLS_TEXTAREA =
  "w-full rounded-md border border-input bg-card px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"

export function ProjectEditPage() {
  return (
    <AuthedPage module="projects">
      <ProjectEdit />
    </AuthedPage>
  )
}

/**
 * Full-page project editor (Lovable parity with _app.projects.$id.edit).
 *
 * The header dialog covers quick renames; this page is for the longer session:
 * project fields up top, live shoot planning underneath, and a close-confirm
 * so a stray Back press never eats unsaved work.
 */
function ProjectEdit() {
  const { id } = useParams({ from: '/authed/projects/$id/edit' })
  const navigate = useNavigate()
  const access = useAccess()
  const canEdit = access.hasAction('projects', 'edit')
  const { data, isLoading, isError, refetch } = useProject(id)
  const update = useUpdateProject(id)
  const confirm = useConfirm()

  const [form, setForm] = useState<UpdateProjectRequest>({})
  const [packageCostText, setPackageCostText] = useState('')
  const [loaded, setLoaded] = useState(false)

  // The client's own contact details. The old app let you fix a wrong phone or
  // a missing email right here, which matters because a client with no email
  // blocks every document send — and the project page could not do it at all.
  const clientQuery = useClient(data?.client_id ?? '')
  const updateClient = useUpdateClient(data?.client_id ?? '')
  const [clientForm, setClientForm] = useState({ name: '', phone: '', email: '', address: '' })
  const [clientLoaded, setClientLoaded] = useState(false)

  useEffect(() => {
    const c = clientQuery.data
    if (!c || clientLoaded) return
    setClientForm({
      name: c.name ?? '',
      phone: c.phone ?? '',
      email: c.email ?? '',
      address: c.address ?? '',
    })
    setClientLoaded(true)
  }, [clientQuery.data, clientLoaded])

  useEffect(() => {
    if (data && !loaded) {
      setForm({
        name: data.name,
        status: data.status,
        package_cost: data.package_cost,
        show_quotation: data.show_quotation,
      })
      setPackageCostText(String(data.package_cost))
      setLoaded(true)
    }
  }, [data, loaded])

  // Derived state, computed before any early return: the effect below is a
  // hook, so it has to run on every render including the loading one.
  const received = data?.payments.reduce((sum, p) => sum + p.amount, 0) ?? 0
  const dirty =
    !!data &&
    ((form.name ?? '') !== data.name ||
      form.status !== data.status ||
      Number(form.package_cost ?? 0) !== data.package_cost ||
      (form.show_quotation ?? false) !== data.show_quotation)
  const belowReceived = !!data && Number(form.package_cost ?? 0) < received

  const c = clientQuery.data
  const clientDirty =
    !!c &&
    (clientForm.name !== (c.name ?? '') ||
      clientForm.phone !== (c.phone ?? '') ||
      clientForm.email !== (c.email ?? '') ||
      clientForm.address !== (c.address ?? ''))
  const anyDirty = dirty || clientDirty
  const addOns = data?.additional_deliverables_cost ?? 0
  const liveTotal = Number(form.package_cost ?? 0) + addOns
  const busy = update.isPending || updateClient.isPending

  // What was typed survives a refresh or a closed tab until it is saved. It
  // switches on once both records have filled the form, so that is the baseline.
  const draft = useFormDraft(
    loaded && clientLoaded ? `project-edit:${id}` : null,
    { form, packageCostText, clientForm },
    (v) => {
      setForm(v.form)
      setPackageCostText(v.packageCostText)
      setClientForm(v.clientForm)
    },
    // The page already asks before leaving with unsaved edits.
    { warnOnLeave: false },
  )

  // Warn on tab close / reload with unsaved work. Declared with the other
  // hooks, above the guards — moving it below them changed the hook count
  // between the loading render and the loaded one, which React refuses.
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (anyDirty && !busy) {
        e.preventDefault()
        e.returnValue = ''
      }
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [anyDirty, busy])

  if (isLoading) return <SkeletonCards count={3} />
  if (isError || !data) return <ErrorState onRetry={() => void refetch()} />
  if (!canEdit) {
    return <ErrorState message="No permission to edit projects. Ask an admin for projects:edit access, then try again." />
  }

  // Narrowed once, so the hoisted helpers below do not each have to re-prove
  // that the project loaded.
  const project = data

  async function onBack() {
    if (anyDirty && !busy) {
      const leave = await confirm({
        title: 'Discard unsaved changes?',
        description: 'Your edits to this project have not been saved.',
        confirmLabel: 'Discard',
      })
      if (!leave) return
      draft.clear()
    }
    void navigate({ to: '/projects/$id', params: { id } })
  }

  /**
   * Two records, saved together because they read as one screen. `close`
   * separates "Save" from "Save and close" — a long editing session should not
   * be thrown back to the project every time you commit a change.
   */
  async function save(close: boolean) {
    if (belowReceived) {
      const yes = await confirm({
        title: `New total is below ${formatINR(received)} already received?`,
        description: 'The package no longer covers the money recorded. Continue anyway?',
        confirmLabel: 'Save anyway',
      })
      if (!yes) return
    }
    if (!clientForm.name.trim() && clientDirty) {
      toast.error('The client needs a name.')
      return
    }
    try {
      if (dirty) await update.mutateAsync(form)
      if (clientDirty) {
        await updateClient.mutateAsync({
          name: clientForm.name.trim(),
          phone: clientForm.phone.trim() || null,
          email: clientForm.email.trim() || null,
          address: clientForm.address.trim() || null,
        })
      }
      draft.clear()
      if (close) void navigate({ to: '/projects/$id', params: { id } })
      else toast.success('Saved')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'We could not save those changes.')
    }
  }

  function discard() {
    draft.clear()
    const p = project
    setForm({
      name: p.name,
      status: p.status,
      package_cost: p.package_cost,
      show_quotation: p.show_quotation,
    })
    setPackageCostText(String(p.package_cost))
    if (c) {
      setClientForm({ name: c.name ?? '', phone: c.phone ?? '', email: c.email ?? '', address: c.address ?? '' })
    }
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    await save(false)
  }

  return (
    <>
      <Breadcrumbs
        items={[
          { label: 'Home', to: '/dashboard' },
          { label: 'Projects', to: '/projects' },
          { label: data.name, to: `/projects/${id}` },
          { label: 'Edit' },
        ]}
      />
      <PageHeader
        title={`Edit ${data.name}`}
        description="Project fields up top, live shoot planning below. Nothing saves until you press Save."
        actions={
          <Button variant="outline" size="sm" onClick={() => void onBack()}>
            <ArrowLeft /> Back to project
          </Button>
        }
      />

      {draft.restoredAt && (
        <div className="mt-4">
          <DraftRestoredBanner at={draft.restoredAt} onDismiss={draft.dismissRestored} onDiscard={discard} />
        </div>
      )}

      <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_1.4fr]">
        <Card className="self-start">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2">
              <Pencil className="size-4" aria-hidden /> Project details
            </CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={(e) => void onSubmit(e)} className="flex flex-col gap-3">
              <div className="flex flex-col gap-1.5">
                <Label>Name</Label>
                <Input
                  value={form.name ?? ''}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  required
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1.5">
                  <Label>Status</Label>
                  <Select
                    value={form.status}
                    onChange={(e) => setForm({ ...form, status: e.target.value as ProjectStatus })}
                  >
                    <option value="active">Active</option>
                    <option value="on_hold">On hold</option>
                    <option value="completed">Completed</option>
                    <option value="cancelled">Cancelled</option>
                  </Select>
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label>Package (₹)</Label>
                  <Input
                    inputMode="decimal"
                    value={packageCostText}
                    onChange={(e) => {
                      setPackageCostText(e.target.value)
                      setForm({ ...form, package_cost: e.target.value.trim() ? Number(e.target.value) : 0 })
                    }}
                  />
                </div>
              </div>
              {belowReceived && (
                <p className="flex items-start gap-1.5 rounded-md border border-warning/40 bg-warning/10 p-2 text-xs text-warning">
                  <AlertTriangle className="mt-0.5 size-3 shrink-0" />
                  <span>
                    Received {formatINR(received)} already exceeds this package. Review the Billing tab after saving.
                  </span>
                </p>
              )}
              {/* Add-ons are driven by deliverables, so the total moves without
                  anyone typing it — show the arithmetic rather than one field. */}
              <dl className="rounded-lg border border-border bg-muted/30 p-3 text-xs">
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">Package</dt>
                  <dd className="tabular-nums">{formatINR(Number(form.package_cost ?? 0))}</dd>
                </div>
                <div className="mt-1 flex justify-between">
                  <dt className="text-muted-foreground">Add-ons</dt>
                  <dd className="tabular-nums">{formatINR(addOns)}</dd>
                </div>
                <div className="mt-1.5 flex justify-between border-t border-border pt-1.5 font-semibold">
                  <dt>Total</dt>
                  <dd className="tabular-nums text-primary">{formatINR(liveTotal)}</dd>
                </div>
              </dl>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={form.show_quotation ?? false}
                  onChange={(e) => setForm({ ...form, show_quotation: e.target.checked })}
                />
                Show quotation to client
              </label>
            </form>
          </CardContent>
        </Card>

        {/* Client — the old app let you fix contact details without leaving the
            project, and a client with no email blocks every document send. */}
        <Card className="self-start">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2">
              <User className="size-4" aria-hidden /> Client
            </CardTitle>
            <p className="mt-0.5 text-sm text-muted-foreground">
              The linked client cannot be swapped here — edit their details to fix a phone or email.
            </p>
          </CardHeader>
          <CardContent>
            {clientQuery.isLoading ? (
              <p className="text-sm text-muted-foreground">Loading…</p>
            ) : !c ? (
              <p className="text-sm text-muted-foreground">No client linked to this project.</p>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="flex flex-col gap-1.5">
                  <Label>
                    Name <span className="text-destructive">*</span>
                  </Label>
                  <Input
                    value={clientForm.name}
                    onChange={(e) => setClientForm({ ...clientForm, name: e.target.value })}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label>Phone</Label>
                  <Input
                    value={clientForm.phone}
                    onChange={(e) => setClientForm({ ...clientForm, phone: e.target.value })}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label>Email</Label>
                  <Input
                    type="email"
                    value={clientForm.email}
                    onChange={(e) => setClientForm({ ...clientForm, email: e.target.value })}
                    placeholder="client@example.com"
                  />
                  {!clientForm.email.trim() && (
                    <p className="text-[11px] text-warning">
                      No email on file — quotations, receipts and terms cannot be emailed to this client.
                    </p>
                  )}
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label>Address</Label>
                  <textarea
                    rows={2}
                    value={clientForm.address}
                    onChange={(e) => setClientForm({ ...clientForm, address: e.target.value })}
                    placeholder="City, address"
                    className={CLS_TEXTAREA}
                  />
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="self-start">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2">
              <Camera className="size-4" aria-hidden /> Shoots — live
            </CardTitle>
            <p className="mt-0.5 text-sm text-muted-foreground">
              Add, edit and schedule shoots here; every change saves immediately.
            </p>
          </CardHeader>
          <CardContent>
            <ShootsTab projectId={id} />
          </CardContent>
        </Card>
      </div>

      {/* Review — the old app closed the editor with the counts you just
          changed, so you can see the shape of the project without navigating. */}
      <Card className="mt-4">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2">
            <ListChecks className="size-4" aria-hidden /> Review
          </CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Stat label="Deliverables" value={String(data.deliverables.length)} />
          <Stat label="Payments" value={String(data.payments.length)} />
          <Stat label="Received" value={formatINR(received)} />
          <Stat label="Balance" value={formatINR(Math.max(0, liveTotal - received))} />
        </CardContent>
      </Card>

      <p className="mt-4 text-xs text-muted-foreground">
        Deliverables and payments are edited on the{' '}
        <Link to="/projects/$id" params={{ id }} className="font-medium text-primary hover:underline">
          project page
        </Link>
        , where each change saves immediately. Prefer the client paperwork?{' '}
        <Link to="/projects/$id/quotation" params={{ id }} className="font-medium text-primary hover:underline">
          Open the staff quotation
        </Link>
        .
      </p>

      {/* Sticky action bar: the running total next to the buttons that commit
          it, so a long edit never hides what it is about to save. */}
      <div className="sticky bottom-0 z-10 -mx-1 mt-4 rounded-xl border border-border bg-card/95 p-4 shadow-md backdrop-blur">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <dl className="grid grid-cols-3 gap-4 text-xs">
            <div>
              <dt className="text-muted-foreground">Package</dt>
              <dd className="font-semibold tabular-nums">{formatINR(Number(form.package_cost ?? 0))}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Add-ons</dt>
              <dd className="font-semibold tabular-nums">{formatINR(addOns)}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Total</dt>
              <dd className="text-base font-semibold tabular-nums text-primary">{formatINR(liveTotal)}</dd>
            </div>
          </dl>
          <div className="flex flex-wrap items-center gap-2">
            {anyDirty && <span className="text-xs text-muted-foreground">Unsaved changes</span>}
            <Button variant="ghost" onClick={discard} disabled={!anyDirty || busy}>
              Discard
            </Button>
            <Button variant="outline" onClick={() => void onBack()}>
              Close
            </Button>
            <Button variant="outline" onClick={() => void save(false)} disabled={!anyDirty || busy}>
              {busy ? 'Saving…' : 'Save'}
            </Button>
            <Button onClick={() => void save(true)} disabled={!anyDirty || busy}>
              Save and close
            </Button>
          </div>
        </div>
        <p className="mt-2 text-[11px] text-muted-foreground">
          Shoots save the moment you change them. Project and client details save when you press Save.
        </p>
      </div>
    </>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-lg font-semibold tabular-nums">{value}</p>
    </div>
  )
}
