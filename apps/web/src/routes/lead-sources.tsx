import { useState, type FormEvent, type ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Check, ChevronDown, Copy, Facebook, Globe, Pencil, Plus, Trash2 } from 'lucide-react'
import {
  createLeadSourceRequest,
  leadSourceRow,
  z,
  type CreateLeadSourceRequest,
  type LeadQuality,
  type LeadSource,
  type LeadSourceKind,
  type LeadSourceRow,
  type WebhookSourceType,
  type UpdateLeadSourceRequest,
} from '@ipc/contracts'
import { callApi } from '@/shared/api/client'
import { config } from '@/shared/config'
import { useAuth } from '@/shared/auth/AuthProvider'
import { useAccess } from '@/shared/auth/useAccess'
import { AuthedPage } from '@/shared/layout/AuthedPage'
import { PageHeader } from '@/shared/layout/page-header'
import { Button } from '@/shared/ui/button'
import { SkeletonCards } from '@/shared/ui/skeleton'
import { Card, CardContent } from '@/shared/ui/card'
import { cn } from '@/shared/ui/cn'
import { Dialog, DialogClose, DialogContent, DialogTrigger } from '@/shared/ui/dialog'
import { useFormDraft } from '@/shared/hooks/use-form-draft'
import { HowToUse } from '@/shared/ui/how-to-use'
import { Input, Label, Select } from '@/shared/ui/input'
import { StatusBadge } from '@/shared/ui/status-badge'
import { EmptyState, ErrorState } from '@/shared/ui/states'
import { useConfirm } from '@/shared/ui/confirm'
import { MetaConnectionCard } from '@/features/facebook/MetaConnectionCard'
import { MetaSetupChecklist } from '@/features/facebook/MetaSetupChecklist'
import { useMembers } from '@/features/allocation/api'
import { ImportLogPanel } from '@/features/facebook/ImportLogPanel'

const list = leadSourceRow.array()
const noContent = z.any()

const dayFormat = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })

/**
 * The public URL a form or Meta posts to. Built from the same base the app
 * talks to, so what is shown is what will work — in dev that is a relative
 * path, which is honest about it only working from this machine.
 */
const endpointFor = (key: string): string => {
  const base = config.apiBaseUrl.startsWith('http')
    ? config.apiBaseUrl
    : `${window.location.origin}${config.apiBaseUrl}`
  return `${base}/webhooks/lead/${key}`
}

export function LeadSourcesPage() {
  return (
    <AuthedPage module="lead_sources">
      <LeadSources />
    </AuthedPage>
  )
}

function useSources() {
  const { session } = useAuth()
  const access = useAccess()
  return useQuery({
    queryKey: ['crm', 'sources'],
    queryFn: () => callApi('/crm/sources', { responseSchema: list }),
    enabled: !!session && access.hasModule('lead_sources'),
    staleTime: 30_000,
  })
}

function LeadSources() {
  const { data, isLoading, isError, refetch } = useSources()

  return (
    <>
      <PageHeader
        title="Lead sources"
        description="The forms and ad campaigns that drop leads straight into your CRM."
        actions={<NewSourceDialog />}
      />

      <HowToUse
        title="Connect a source once, then forget it"
        description="Each source has its own URL. Point a web form or a Meta lead-ads webhook at it and the leads arrive assigned, deduped, and ready to follow up."
        steps={[
          'Create a source and copy its URL.',
          'Point your form or ad account at it.',
          'Watch the lead count climb here.',
        ]}
      />

      <div className="mt-6">
        <MetaConnectionCard />
        <MetaSetupChecklist />
      </div>

      <div className="mt-6">
        {isLoading ? (
          <SkeletonCards count={3} />
        ) : isError ? (
          <ErrorState onRetry={() => void refetch()} />
        ) : !data || data.length === 0 ? (
          <Card>
            <CardContent className="py-4">
              <EmptyState
                title="No lead sources yet"
                description="Until a source exists, leads have to be typed in by hand. Create one and your website form can post straight into the CRM."
                action={<NewSourceDialog />}
              />
            </CardContent>
          </Card>
        ) : (
          <div className="flex flex-col gap-3">
            {data.map((s) => (
              <SourceCard key={s.id} source={s} />
            ))}
          </div>
        )}
      </div>

      <p className="mt-4 text-xs text-muted-foreground">
        A source URL is a credential: anyone holding it can post leads into this studio. Pause or
        delete a source to stop it working.
      </p>
    </>
  )
}

function useSourceMutation<TInput>(fn: (input: TInput) => Promise<unknown>, success: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      toast.success(success)
      void qc.invalidateQueries({ queryKey: ['crm', 'sources'] })
    },
    onError: (e: Error) => toast.error(e.message),
  })
}

function SourceCard({ source }: { source: LeadSourceRow }) {
  const [showSetup, setShowSetup] = useState(false)
  const [showLog, setShowLog] = useState(false)
  const [copied, setCopied] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const [label, setLabel] = useState(source.label ?? '')
  const confirm = useConfirm()

  const update = useSourceMutation(
    (patch: UpdateLeadSourceRequest) =>
      callApi(`/crm/sources/${source.id}`, { method: 'PATCH', body: patch, responseSchema: noContent }),
    'Lead source updated',
  )
  const remove = useSourceMutation(
    () => callApi(`/crm/sources/${source.id}`, { method: 'DELETE', responseSchema: noContent }),
    'Lead source deleted',
  )

  const url = endpointFor(source.source_key)
  const Icon = source.kind === 'meta' ? Facebook : Globe

  async function onDelete() {
    const yes = await confirm({
      title: `Delete ${source.label ?? 'this source'}?`,
      description:
        'The URL stops working immediately, so anything still posting to it will start failing. Leads it already brought in stay in your CRM.',
      confirmLabel: 'Delete source',
      destructive: true,
    })
    if (yes) remove.mutate(undefined as never)
  }

  return (
    <Card className={cn(!source.is_active && 'opacity-75')}>
      <CardContent className="p-4 sm:p-4">
        <div className="flex flex-wrap items-center gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Icon className="size-4" />
          </span>
          {renaming ? (
            <div className="flex min-w-0 flex-1 items-center gap-2">
              <Input value={label} onChange={(e) => setLabel(e.target.value)} className="h-8" autoFocus />
              <Button
                size="sm"
                disabled={!label.trim() || update.isPending}
                onClick={() => update.mutate({ label: label.trim() }, { onSuccess: () => setRenaming(false) })}
              >
                Save
              </Button>
              <Button size="sm" variant="outline" onClick={() => setRenaming(false)}>
                Cancel
              </Button>
            </div>
          ) : (
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium">{source.label ?? source.source_key}</p>
              <p className="text-xs text-muted-foreground">
                {source.kind === 'meta' ? 'Meta lead ads' : 'Web form'} · added{' '}
                {dayFormat.format(new Date(source.created_at))}
              </p>
            </div>
          )}

          <StatusBadge tone={source.is_active ? 'success' : 'neutral'}>
            {source.is_active ? 'Active' : 'Paused'}
          </StatusBadge>
          <StatusBadge tone={source.lead_count > 0 ? 'info' : 'neutral'}>
            {source.lead_count} {source.lead_count === 1 ? 'lead' : 'leads'}
          </StatusBadge>

          {!renaming && (
            <div className="flex items-center gap-1">
              <Button size="sm" variant="ghost" onClick={() => { setLabel(source.label ?? ''); setRenaming(true) }}>
                <Pencil />
                <span className="sr-only">Rename {source.label ?? source.source_key}</span>
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={update.isPending}
                onClick={() => update.mutate({ is_active: !source.is_active })}
              >
                {source.is_active ? 'Pause' : 'Resume'}
              </Button>
              <Button size="sm" variant="ghost" disabled={remove.isPending} onClick={() => void onDelete()}>
                <Trash2 />
                <span className="sr-only">Delete {source.label ?? source.source_key}</span>
              </Button>
            </div>
          )}
        </div>

        <div className="mt-4 flex items-center gap-2 rounded-lg border border-border bg-muted/40 p-3">
          <code className="min-w-0 flex-1 truncate font-mono text-xs">{url}</code>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              void navigator.clipboard.writeText(url)
              setCopied(true)
              toast.success('URL copied')
            }}
          >
            {copied ? <Check /> : <Copy />} Copy
          </Button>
        </div>

        {source.last_lead_at && (
          <p className="mt-2 text-xs text-muted-foreground">
            Last lead {dayFormat.format(new Date(source.last_lead_at))}
          </p>
        )}

        <button
          type="button"
          onClick={() => setShowSetup((v) => !v)}
          className="mt-3 flex items-center gap-1 text-sm font-medium text-primary hover:underline"
        >
          <ChevronDown className={cn('size-4 transition-transform', showSetup && 'rotate-180')} />
          How to connect this
        </button>

        {showSetup && <SetupHelp kind={source.kind} url={url} />}

        <button
          type="button"
          onClick={() => setShowLog((v) => !v)}
          className="mt-3 flex items-center gap-1 text-sm font-medium text-primary hover:underline"
        >
          <ChevronDown className={cn('size-4 transition-transform', showLog && 'rotate-180')} />
          Import log
        </button>

        {showLog && <ImportLogPanel sourceId={source.id} sourceLabel={source.label ?? source.source_key} />}
      </CardContent>
    </Card>
  )
}

/**
 * What kind of thing is posting to this endpoint. It is not cosmetic: it is
 * what tells you, six months from now, why one source stopped receiving —
 * and the dialog used to hardcode it to 'website_form' whatever you picked.
 */
const SOURCE_TYPES: { value: WebhookSourceType; label: string }[] = [
  { value: 'website_form', label: 'Website contact form' },
  { value: 'google_form', label: 'Google Form' },
  { value: 'elementor', label: 'Elementor / WordPress' },
  { value: 'landing_page', label: 'Landing page' },
  { value: 'webhook', label: 'Generic webhook' },
  { value: 'other', label: 'Something else' },
]

/** Stamped onto every lead this source creates, so nothing lands unlabelled. */
const DEFAULT_SOURCES: { value: LeadSource; label: string }[] = [
  { value: 'webform', label: 'Web form' },
  { value: 'facebook', label: 'Facebook' },
  { value: 'instagram', label: 'Instagram' },
  { value: 'whatsapp', label: 'WhatsApp' },
  { value: 'google_form', label: 'Google Form' },
  { value: 'referral', label: 'Referral' },
  { value: 'enquiry', label: 'Enquiry' },
  { value: 'other', label: 'Other' },
]

/** What to actually do with the URL, per kind. */
function SetupHelp({ kind, url }: { kind: LeadSourceKind; url: string }) {
  if (kind === 'meta') {
    return (
      <Help>
        <p>
          In Meta Business Suite, open your lead-ads webhook settings and add this as the callback
          URL. Meta verifies it with a challenge first — that handshake is already handled.
        </p>
        <Snippet>{url}</Snippet>
        <p>
          Each submitted lead form then posts here. Name, phone and email are read; everything else
          is kept on the lead as source data.
        </p>
      </Help>
    )
  }

  return (
    <Help>
      <p>Post a JSON body with at least a phone number. From your website:</p>
      <Snippet>{`fetch('${url}', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    name: form.name.value,
    phone: form.phone.value,
    email: form.email.value,
  }),
})`}</Snippet>
      <p>Or to test it right now, from a terminal:</p>
      <Snippet>{`curl -X POST ${url} \\
  -H 'Content-Type: application/json' \\
  -d '{"name":"Test lead","phone":"9876543210"}'`}</Snippet>
      <p className="text-muted-foreground">
        A number that already exists returns the lead it matched instead of creating a second one,
        so a double-submitted form cannot split one enquiry in two.
      </p>
    </Help>
  )
}

function Help({ children }: { children: ReactNode }) {
  return (
    <div className="mt-3 flex flex-col gap-2 rounded-lg border border-border bg-muted/20 p-4 text-sm">
      {children}
    </div>
  )
}

function Snippet({ children }: { children: string }) {
  return (
    <pre className="overflow-x-auto rounded-md border border-border bg-card p-3 font-mono text-xs">
      {children}
    </pre>
  )
}

function NewSourceDialog() {
  const qc = useQueryClient()
  const [open, setOpen] = useState(false)
  const [label, setLabel] = useState('')
  const [kind, setKind] = useState<LeadSourceKind>('webform')
  /**
   * Everything below was already in createLeadSourceRequest, the API handler
   * and the table. The dialog asked for a name and a kind, then sent
   * `source_type: 'website_form'` hardcoded — so picking Meta lead ads created
   * a website form, and the four per-source defaults could not be set at all.
   */
  const [sourceType, setSourceType] = useState<WebhookSourceType>('website_form')
  const [allowedOrigin, setAllowedOrigin] = useState('')
  const [defaultSource, setDefaultSource] = useState<LeadSource | ''>('')
  const [defaultQuality, setDefaultQuality] = useState<LeadQuality | ''>('')
  const [assignedTo, setAssignedTo] = useState('')
  const [created, setCreated] = useState<LeadSourceRow | null>(null)
  const [copied, setCopied] = useState(false)
  // What was typed survives a refresh or a closed tab until it is saved. Off
  // once the source exists: the ready screen is not a form.
  const draft = useFormDraft(
    open && !created ? 'lead-source:new' : null,
    { label, kind, sourceType, allowedOrigin, defaultSource, defaultQuality, assignedTo },
    (v) => {
      setLabel(v.label)
      setKind(v.kind)
      setSourceType(v.sourceType)
      setAllowedOrigin(v.allowedOrigin)
      setDefaultSource(v.defaultSource)
      setDefaultQuality(v.defaultQuality)
      setAssignedTo(v.assignedTo)
    },
  )
  const members = useMembers()

  const create = useMutation({
    mutationFn: (input: CreateLeadSourceRequest) =>
      callApi('/crm/sources', {
        method: 'POST',
        body: createLeadSourceRequest.parse(input),
        responseSchema: leadSourceRow,
      }),
    onSuccess: (row) => {
      draft.clear()
      setCreated(row)
      void qc.invalidateQueries({ queryKey: ['crm', 'sources'] })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  function reset() {
    setLabel('')
    setKind('webform')
    setSourceType('website_form')
    setAllowedOrigin('')
    setDefaultSource('')
    setDefaultQuality('')
    setAssignedTo('')
    setCreated(null)
    setCopied(false)
  }

  /** Meta posts through its own webhook; the web-form-only fields do not apply. */
  const isMeta = kind === 'meta'

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    create.mutate({
      label: label.trim(),
      kind,
      source_type: isMeta ? 'webhook' : sourceType,
      ...(!isMeta && allowedOrigin.trim() ? { allowed_origin: allowedOrigin.trim() } : {}),
      ...(defaultSource ? { default_source: defaultSource } : {}),
      ...(defaultQuality ? { default_quality: defaultQuality } : {}),
      ...(assignedTo ? { default_assigned_to: assignedTo } : {}),
    })
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o)
        if (!o) reset()
      }}
    >
      <DialogTrigger asChild>
        <Button>
          <Plus /> New source
        </Button>
      </DialogTrigger>
      <DialogContent
        title={created ? 'Source ready' : 'New lead source'}
        description={
          created
            ? 'Point your form or ad account at this URL.'
            : 'Name it after where the leads come from — you will be reading this list in six months.'
        }
      >
        {created ? (
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-2 rounded-md border border-border bg-muted/40 p-3">
              <code className="min-w-0 flex-1 truncate font-mono text-xs">
                {endpointFor(created.source_key)}
              </code>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  void navigator.clipboard.writeText(endpointFor(created.source_key))
                  setCopied(true)
                }}
              >
                {copied ? <Check /> : <Copy />} {copied ? 'Copied' : 'Copy'}
              </Button>
            </div>
            {/* The same per-kind instructions the source card shows. A Meta
                callback URL and a JSON endpoint need different things done to
                them, and this panel used to explain neither. */}
            <SetupHelp kind={created.kind} url={endpointFor(created.source_key)} />
            <p className="text-sm text-muted-foreground">
              Treat it like a password: anyone holding it can post leads into your CRM. You can
              always pause or delete the source.
            </p>
            <div className="flex justify-end">
              <DialogClose asChild>
                <Button>Done</Button>
              </DialogClose>
            </div>
          </div>
        ) : (
          <form onSubmit={onSubmit} className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <Label>
                Name <span className="text-destructive">*</span>
              </Label>
              <Input
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="Website contact form"
                autoFocus
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Kind</Label>
              <Select
                value={kind}
                onChange={(e) => {
                  const next = e.target.value as LeadSourceKind
                  setKind(next)
                  // Pre-set the label a lead will carry to match the channel,
                  // unless the studio has already chosen one deliberately.
                  if (!defaultSource) setDefaultSource(next === 'meta' ? 'facebook' : 'webform')
                }}
              >
                <option value="webform">Web form — your site posts JSON</option>
                <option value="meta">Meta lead ads — Facebook or Instagram</option>
              </Select>
            </div>

            {isMeta ? (
              <p className="rounded-md border border-border bg-muted/20 p-3 text-xs text-muted-foreground">
                Meta posts through its own webhook, so there is nothing else to configure here.
                Create the source and the next screen gives you the callback URL to paste into your
                lead-ads webhook settings.
              </p>
            ) : (
              <>
                <div className="flex flex-col gap-1.5">
                  <Label>What is posting to it</Label>
                  <Select
                    value={sourceType}
                    onChange={(e) => setSourceType(e.target.value as WebhookSourceType)}
                  >
                    {SOURCE_TYPES.map((t) => (
                      <option key={t.value} value={t.value}>
                        {t.label}
                      </option>
                    ))}
                  </Select>
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label>Only accept posts from</Label>
                  <Input
                    value={allowedOrigin}
                    onChange={(e) => setAllowedOrigin(e.target.value)}
                    placeholder="https://yourstudio.in"
                  />
                  <p className="text-xs text-muted-foreground">
                    Optional. Leave it empty and anyone holding the URL can post; set it and only
                    your own site can.
                  </p>
                </div>
              </>
            )}

            <div className="rounded-md border border-border p-3">
              <p className="text-xs font-medium">Stamped on every lead from this source</p>
              <div className="mt-2 grid gap-3 sm:grid-cols-2">
                <div className="flex flex-col gap-1.5">
                  <Label>Source label</Label>
                  <Select
                    value={defaultSource}
                    onChange={(e) => setDefaultSource(e.target.value as LeadSource | '')}
                  >
                    <option value="">Leave unset</option>
                    {DEFAULT_SOURCES.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </Select>
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label>Quality</Label>
                  <Select
                    value={defaultQuality}
                    onChange={(e) => setDefaultQuality(e.target.value as LeadQuality | '')}
                  >
                    <option value="">Leave unset</option>
                    <option value="hot">Hot</option>
                    <option value="warm">Warm</option>
                    <option value="cold">Cold</option>
                  </Select>
                </div>
                <div className="flex flex-col gap-1.5 sm:col-span-2">
                  <Label>Assign to</Label>
                  <Select value={assignedTo} onChange={(e) => setAssignedTo(e.target.value)}>
                    <option value="">Use the distribution rules</option>
                    {(members.data ?? []).map((m) => (
                      <option key={m.user_id} value={m.user_id}>
                        {m.name}
                      </option>
                    ))}
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    Pick someone to send every lead from this source straight to them, bypassing the
                    rota.
                  </p>
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-2">
              <DialogClose asChild>
                <Button type="button" variant="outline">
                  Cancel
                </Button>
              </DialogClose>
              <Button type="submit" disabled={create.isPending || label.trim().length < 2}>
                {create.isPending ? 'Creating…' : 'Create source'}
              </Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}
