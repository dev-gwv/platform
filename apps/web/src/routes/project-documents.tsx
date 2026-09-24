import { useMemo, useState } from 'react'
import { FileSignature, Copy, CheckCircle2, Clock, Eye, History, Search, MessageCircle, RefreshCw, AlertTriangle, FileText, Send } from 'lucide-react'
import { toast } from 'sonner'
import { AuthedPage } from '@/shared/layout/AuthedPage'
import { PageHeader } from '@/shared/layout/page-header'
import { Button } from '@/shared/ui/button'
import { Input, Label, Select } from '@/shared/ui/input'
import { StatCard } from '@/shared/ui/stat-card'
import { Dialog, DialogClose, DialogContent, DialogTrigger } from '@/shared/ui/dialog'
import { StatusBadge } from '@/shared/ui/status-badge'
import { ErrorState, EmptyState } from '@/shared/ui/states'
import { SkeletonList } from '@/shared/ui/skeleton'
import { useTermsDocuments, useIssueTerms, useSendTermsAgain, useTermsEmailLogs, type TermsDocument } from '@/features/terms/api'
import { Link } from '@tanstack/react-router'
import { buildWhatsAppUrl } from '@ipc/contracts'
import { useProjects } from '@/features/projects/api'
import { TermsDocumentViewer } from '@/features/terms/TermsDocumentViewer'

const when = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })

type DocStatus = 'acknowledged' | 'sent' | 'expiring' | 'expired' | 'no_link'

const STATUS_META: Record<DocStatus, { label: string; tone: 'success' | 'info' | 'warning' | 'danger' | 'neutral' }> = {
  acknowledged: { label: 'Acknowledged', tone: 'success' },
  sent: { label: 'Sent', tone: 'info' },
  expiring: { label: 'Expiring soon', tone: 'warning' },
  expired: { label: 'Link expired', tone: 'danger' },
  no_link: { label: 'No link', tone: 'neutral' },
}

function docStatus(d: TermsDocument): DocStatus {
  if (d.acknowledged_at) return 'acknowledged'
  if (!d.has_active_link) return d.link_expires_at ? 'expired' : 'no_link'
  if (d.link_expires_at) {
    const days = (new Date(d.link_expires_at).getTime() - Date.now()) / 86400000
    if (days <= 7) return 'expiring'
  }
  return 'sent'
}

function termsLink(token: string): string {
  return `${window.location.origin}/terms/acknowledge?token=${token}`
}

function clientMessage(d: TermsDocument, link: string): string {
  const client = d.client_name?.trim() || 'there'
  const project = d.project_name?.trim() || 'your project'
  return `Hi ${client}, please review and acknowledge the Terms & Conditions for ${project} here:\n\n${link}`
}

export function ProjectDocumentsPage() {
  return (
    <AuthedPage module="projects">
      <ProjectDocuments />
    </AuthedPage>
  )
}

function ProjectDocuments() {
  const { data, isLoading, isError, refetch } = useTermsDocuments()
  const sendAgain = useSendTermsAgain()
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState<'all' | DocStatus>('all')
  const [quick, setQuick] = useState<'all' | 'missing_link' | 'pending_ack' | 'expiring_soon'>('all')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [busy, setBusy] = useState<{ id: string; kind: 'copy' | 'wa' | 'gen' } | null>(null)
  const [logFor, setLogFor] = useState<string | null>(null)

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase()
    return (data ?? []).filter((d) => {
      if (q && !`${d.project_name ?? ''} ${d.client_name ?? ''}`.toLowerCase().includes(q)) return false
      const s = docStatus(d)
      if (status !== 'all' && s !== status) return false
      if (quick === 'missing_link' && (d.has_active_link || d.acknowledged_at)) return false
      if (quick === 'pending_ack' && (d.acknowledged_at || !d.has_active_link)) return false
      if (quick === 'expiring_soon' && s !== 'expiring') return false
      const day = d.created_at.slice(0, 10)
      if (from && day < from) return false
      if (to && day > to) return false
      return true
    })
  }, [data, search, status, quick, from, to])

  const kpis = useMemo(() => {
    const all = data ?? []
    return {
      total: all.length,
      acknowledged: all.filter((d) => d.acknowledged_at).length,
      sent: all.filter((d) => !d.acknowledged_at && d.has_active_link).length,
      expiring: all.filter((d) => docStatus(d) === 'expiring').length,
      expired: all.filter((d) => ['expired', 'no_link'].includes(docStatus(d))).length,
      projects: new Set(all.map((d) => d.project_id).filter(Boolean)).size,
    }
  }, [data])

  // A fresh link for the SAME document -- never a new one. (This used to
  // issue a placeholder document, which then replaced the real terms.)
  async function generateLink(d: TermsDocument): Promise<string> {
    if (d.acknowledged_at) throw new Error('The client has already agreed to these terms.')
    const res = await sendAgain.mutateAsync({ documentId: d.id })
    return res.url || termsLink(res.token)
  }

  async function onCopy(d: TermsDocument) {
    if (busy) return
    setBusy({ id: d.id, kind: 'copy' })
    try {
      const link = await generateLink(d)
      await navigator.clipboard.writeText(clientMessage(d, link))
      toast.success('Client message copied')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not generate link.')
    } finally {
      setBusy(null)
    }
  }

  async function onWhatsApp(d: TermsDocument) {
    if (busy) return
    setBusy({ id: d.id, kind: 'wa' })
    try {
      const link = await generateLink(d)
      window.open(buildWhatsAppUrl(d.client_phone, clientMessage(d, link)), '_blank', 'noopener')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not generate link.')
    } finally {
      setBusy(null)
    }
  }

  async function onGenerate(d: TermsDocument) {
    if (busy) return
    setBusy({ id: d.id, kind: 'gen' })
    try {
      const link = await generateLink(d)
      await navigator.clipboard.writeText(link)
      toast.success(d.has_active_link ? 'Link rotated and copied' : 'Link generated and copied')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not generate link.')
    } finally {
      setBusy(null)
    }
  }

  /** The document being read in-app, if any. */
  const [viewing, setViewing] = useState<string | null>(null)

  const isBusy = (id: string, kind: 'copy' | 'wa' | 'gen') => busy?.id === id && busy.kind === kind

  return (
    <>
      <PageHeader
        title="Project Documents"
        description="Terms & conditions sent to each client, and whether they've agreed."
        actions={<IssueTermsDialog />}
      />

      <div className="mt-4 grid gap-3 grid-cols-2 sm:grid-cols-3 lg:grid-cols-6">
        <StatCard label="Total docs" value={String(kpis.total)} icon={FileText} />
        <StatCard label="Acknowledged" value={String(kpis.acknowledged)} icon={CheckCircle2} />
        <StatCard label="Sent" value={String(kpis.sent)} icon={Send} />
        <StatCard label="Expiring soon" value={String(kpis.expiring)} icon={Clock} />
        <StatCard label="Expired / no link" value={String(kpis.expired)} icon={AlertTriangle} />
        <StatCard label="Projects" value={String(kpis.projects)} icon={FileSignature} />
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card p-3">
        <label className="relative min-w-52 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search project or client…" aria-label="Search documents" className="pl-9" />
        </label>
        <Select value={status} onChange={(e) => setStatus(e.target.value as typeof status)} aria-label="Filter by status" className="w-44">
          <option value="all">All statuses</option>
          <option value="acknowledged">Acknowledged</option>
          <option value="sent">Sent</option>
          <option value="expiring">Expiring soon</option>
          <option value="expired">Link expired</option>
          <option value="no_link">No link</option>
        </Select>
        <Select value={quick} onChange={(e) => setQuick(e.target.value as typeof quick)} aria-label="Quick filter" className="w-52">
          <option value="all">All documents</option>
          <option value="missing_link">Missing client link</option>
          <option value="pending_ack">Pending acknowledgement</option>
          <option value="expiring_soon">Link expiring (≤ 7d)</option>
        </Select>
        <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="Sent from" className="w-40" />
        <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} aria-label="Sent to" className="w-40" />
      </div>

      <div className="mt-4">
        {isLoading ? (
          <SkeletonList rows={5} columns={4} />
        ) : isError ? (
          <ErrorState onRetry={() => void refetch()} />
        ) : rows.length === 0 ? (
          <EmptyState
            title="No documents found"
            description="Try a different filter, or issue terms for a project."
            action={<IssueTermsDialog />}
          />
        ) : (
          <div className="table-wrap rounded-lg border border-border">
            <table className="table-sticky w-full min-w-[36rem] text-sm">
              <thead className="bg-muted/50 text-left text-muted-foreground">
                <tr>
                  <th className="px-4 py-2 font-medium">Project</th>
                  <th className="px-4 py-2 font-medium">Client</th>
                  <th className="px-4 py-2 font-medium">Status</th>
                  <th className="px-4 py-2 font-medium">Sent</th>
                  <th className="px-4 py-2 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((d) => {
                  const s = docStatus(d)
                  const meta = STATUS_META[s]
                  return (
                    <tr key={d.id} className="border-t border-border hover:bg-muted/30">
                      <td className="px-4 py-2 font-medium">
                        <span className="flex items-center gap-2">
                          <FileSignature className="size-4 text-muted-foreground" />
                          {d.project_name ?? '—'}
                        </span>
                      </td>
                      <td className="px-4 py-2 text-muted-foreground">{d.client_name ?? '—'}</td>
                      <td className="px-4 py-2">
                        <StatusBadge tone={meta.tone}>
                          {meta.label}
                          {d.acknowledged_at && d.acknowledged_by_name ? ` by ${d.acknowledged_by_name}` : ''}
                        </StatusBadge>
                      </td>
                      <td className="px-4 py-2 text-muted-foreground">{when.format(new Date(d.created_at))}</td>
                      <td className="px-4 py-2">
                        <div className="flex justify-end gap-1">
                          <Button size="sm" variant="ghost" onClick={() => setViewing(d.id)} title="Read this document">
                            <Eye className="size-4" />
                            <span className="sr-only">View document</span>
                          </Button>
                          <Button size="sm" variant="ghost" disabled={isBusy(d.id, 'gen')} onClick={() => void onGenerate(d)} title={d.has_active_link ? 'Rotate link' : 'Generate link'}>
                            <RefreshCw className={isBusy(d.id, 'gen') ? 'animate-spin' : ''} /> {d.has_active_link ? 'Rotate' : 'Generate'}
                          </Button>
                          <Button size="sm" variant="ghost" disabled={isBusy(d.id, 'copy')} onClick={() => void onCopy(d)} title="Copy client message">
                            <Copy />
                          </Button>
                          <Button size="sm" variant="ghost" disabled={isBusy(d.id, 'wa')} onClick={() => void onWhatsApp(d)} title="Send on WhatsApp">
                            <MessageCircle />
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => setLogFor(d.id)} title="Email history">
                            <History />
                          </Button>
                          {d.project_id ? (
                            <Button variant="outline" size="sm" asChild>
                              <Link to="/projects/$id" params={{ id: d.project_id }} search={{ tab: 'terms' }}>
                                Open
                              </Link>
                            </Button>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {logFor && <EmailLogDialog documentId={logFor} onClose={() => setLogFor(null)} />}
      <TermsDocumentViewer documentId={viewing} onClose={() => setViewing(null)} />
    </>
  )
}

/**
 * Was it actually emailed, to whom, and did it land? "I sent it, they say it
 * never arrived" is otherwise unanswerable — the log keeps the address, the
 * outcome and the provider's own error.
 */
function EmailLogDialog({ documentId, onClose }: { documentId: string; onClose: () => void }) {
  const { data, isLoading } = useTermsEmailLogs(documentId)
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent title="Email history" description="Every send attempt for this document.">
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : !data || data.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            This document has not been emailed yet — it may have been shared by link or WhatsApp.
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {data.map((row) => (
              <li key={row.id} className="flex flex-wrap items-center gap-2 py-2 text-sm">
                <span className="min-w-0 flex-1 truncate">{row.to_email ?? 'No address recorded'}</span>
                <StatusBadge tone={row.status === 'sent' ? 'success' : row.status === 'failed' ? 'danger' : 'neutral'}>
                  {row.status}
                </StatusBadge>
                <span className="text-xs text-muted-foreground">{when.format(new Date(row.created_at))}</span>
                {row.error && <span className="w-full text-xs text-destructive">{row.error}</span>}
              </li>
            ))}
          </ul>
        )}
        <div className="mt-3 flex justify-end">
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

export function IssueTermsDialog({ projectId, trigger }: { projectId?: string | null; trigger?: React.ReactNode }) {
  const { data: projects } = useProjects()
  const issue = useIssueTerms()
  const [open, setOpen] = useState(false)
  const [selectedProject, setSelectedProject] = useState(projectId ?? '')
  const [body, setBody] = useState('')
  const [link, setLink] = useState<string | null>(null)

  async function onSubmit() {
    if (!body.trim()) return
    const res = await issue.mutateAsync({ project_id: selectedProject || null, rendered_body: body.trim() })
    setLink(termsLink(res.token))
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o)
        if (!o) {
          setLink(null)
          setBody('')
        }
      }}
    >
      <DialogTrigger asChild>
        {trigger ?? (
          <Button>
            <FileSignature /> Issue terms
          </Button>
        )}
      </DialogTrigger>
      <DialogContent
        title="Issue terms & conditions"
        description="Generates a link the client opens to read and agree."
      >
        {link ? (
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/30 p-3">
              <CheckCircle2 className="size-4 shrink-0 text-success" />
              <p className="min-w-0 flex-1 truncate text-sm">{link}</p>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => {
                  void navigator.clipboard.writeText(link)
                  toast.success('Link copied')
                }}
              >
                <Copy className="size-4" />
              </Button>
            </div>
            <div className="flex justify-end">
              <DialogClose asChild>
                <Button>Done</Button>
              </DialogClose>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <Label>Project (optional)</Label>
              <Select value={selectedProject} onChange={(e) => setSelectedProject(e.target.value)}>
                <option value="">Not linked to a project</option>
                {(projects ?? []).map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Terms & conditions text</Label>
              <textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                rows={8}
                placeholder="Paste or write the terms the client needs to agree to…"
                className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm"
              />
            </div>
            <div className="flex justify-end gap-2">
              <DialogClose asChild>
                <Button variant="outline">Cancel</Button>
              </DialogClose>
              <Button onClick={() => void onSubmit()} disabled={!body.trim() || issue.isPending}>
                {issue.isPending ? (
                  <>
                    <Clock className="size-4 animate-pulse" /> Issuing…
                  </>
                ) : (
                  'Generate link'
                )}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
